import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  within,
  waitFor,
} from '@testing-library/react';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-71: a permit ADDED to an existing project now auto-seeds ACQ Target
// (expected_issue) + Target Submit using the SAME Phase B rules as the New
// Project wizard (permitSeedingDefaults). Anchors: the project's GO date + the
// Building Permit's ACQ. These tests drive the add-permit save and assert the
// seeded values land in the RPC payload for the new permit only.

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync, isPending: false }),
}));
// fix-195: modal renders ProjectExternalTeamPanel (blob-backed) — mock its
// useProjects + useUpdateProject inert so this suite stays isolated.
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
// fix-227: modal renders ProjectExternalTeamPanel — mock the directory inert.
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
// fix-167: modal renders ProjectHoldPanel — mock its hooks inert.
vi.mock('../hooks/useProjectHolds', () => ({
  useProjectHolds: () => ({ data: [], isLoading: false, error: null }),
  activeHold: () => null,
  useSetProjectHold: () => ({ mutate: vi.fn(), isPending: false }),
  useLiftProjectHold: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProjectHold: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({ data: [] }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit' },
      { name: 'Demolition' },
      { name: 'PAR/Pre-Sub' },
    ],
  }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock('../components/builder/BuilderAutocompleteField', () => ({
  default: ({ value }: { value: string }) => <input readOnly value={value} />,
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));
// fix-93: ProjectSettingsModal now reads productTypeOptions from
// app_config. Mock the hook so this test (which renders without a
// QueryClientProvider) doesn't blow up on the unmocked useQuery.
vi.mock('../hooks/useAppConfig', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useAppConfig')>();
  return {
    ...actual,
    useAppConfig: () => ({
      map: new Map<string, unknown>(),
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

const permitsData = vi.hoisted(() => ({ rows: [] as PermitWithCycles[] }));
vi.mock('../hooks/usePermitsByProject', () => ({
  usePermitsByProject: () => ({ data: permitsData.rows }),
}));

import ProjectSettingsModal from '../components/ProjectDetail/ProjectSettingsModal';

const NOW = '2026-05-20T12:00:00Z';

// Project with a known GO date; the BP carries the ACQ anchor.
function makeProject(): Project {
  return {
    id: 'proj-1',
    address: '215 31st Ave',
    juris: 'Seattle',
    go_date: '2026-06-01',
    updated_at: NOW,
  } as unknown as Project;
}

function makeBp(): PermitWithCycles {
  return {
    id: 256,
    project_id: 'proj-1',
    type: 'Building Permit',
    da: 'Jake',
    ent_lead: null,
    portal_url: null,
    num: null,
    struct_address: null,
    expected_issue: '2026-12-01', // BP ACQ anchor
    target_submit: '2026-03-26',
    updated_at: NOW,
    permit_cycles: [],
  } as unknown as PermitWithCycles;
}

/** Add a permit, set its type, save, and return the new-permit upsert payload. */
async function addPermitOfTypeAndSave(type: string) {
  render(<ProjectSettingsModal project={makeProject()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByTestId('psm-add-permit'));
  const newRow = screen.getByTestId('psm-permit-row-new');
  // Type is the first <select> in the row (Type / ENT / DA).
  const typeSelect = within(newRow).getAllByRole('combobox')[0];
  fireEvent.change(typeSelect, { target: { value: type } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('psm-save'));
  });
  const arg = mutateAsync.mock.calls[0][0];
  return arg.permitUpserts.find((p: { id?: number }) => p.id == null);
}

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({
    conflict: false,
    conflictKind: null,
    conflictId: null,
    projectUpdatedAt: '2026-05-20T13:00:00Z',
    permits: [],
  });
  permitsData.rows = [makeBp()];
});

describe('ProjectSettingsModal — fix-71 add-permit auto-seed', () => {
  it('seeds a GO-anchored type (PAR/Pre-Sub): expected_issue = GO+30, target_submit = GO+3', async () => {
    const newPermit = await addPermitOfTypeAndSave('PAR/Pre-Sub');
    expect(newPermit).toBeTruthy();
    expect(newPermit.type).toBe('PAR/Pre-Sub');
    expect(newPermit.expected_issue).toBe('2026-07-01'); // 2026-06-01 + 30d
    expect(newPermit.target_submit).toBe('2026-06-04'); // 2026-06-01 + 3d
  });

  it('seeds a BP-ACQ-anchored type (Demolition): expected_issue = BP ACQ, no target_submit', async () => {
    const newPermit = await addPermitOfTypeAndSave('Demolition');
    expect(newPermit.expected_issue).toBe('2026-12-01'); // = BP expected_issue
    // Demolition has no GO-anchored submit rule → target_submit stays engine-owned.
    expect('target_submit' in newPermit).toBe(false);
  });

  it('does not seed a type with no rule (Building Permit stays NULL/engine-owned)', async () => {
    const newPermit = await addPermitOfTypeAndSave('Building Permit');
    expect('expected_issue' in newPermit).toBe(false);
    expect('target_submit' in newPermit).toBe(false);
  });

  it('leaves the existing Building Permit row untouched (no seeded fields injected)', async () => {
    await addPermitOfTypeAndSave('PAR/Pre-Sub');
    const arg = mutateAsync.mock.calls[0][0];
    const existing = arg.permitUpserts.find((p: { id?: number }) => p.id === 256);
    expect(existing).toBeTruthy();
    expect('expected_issue' in existing).toBe(false);
    expect('target_submit' in existing).toBe(false);
  });

  it('skips GO-anchored seeding when the project has no GO date', async () => {
    permitsData.rows = [makeBp()];
    render(
      <ProjectSettingsModal
        project={{ ...makeProject(), go_date: null } as unknown as Project}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('psm-add-permit'));
    const newRow = screen.getByTestId('psm-permit-row-new');
    fireEvent.change(within(newRow).getAllByRole('combobox')[0], {
      target: { value: 'PAR/Pre-Sub' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('psm-save'));
    });
    const arg = mutateAsync.mock.calls[0][0];
    const newPermit = arg.permitUpserts.find((p: { id?: number }) => p.id == null);
    // No GO date → neither GO-anchored field seeds.
    expect('expected_issue' in newPermit).toBe(false);
    expect('target_submit' in newPermit).toBe(false);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  });
});
