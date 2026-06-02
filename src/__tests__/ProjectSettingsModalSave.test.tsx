import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-36: ProjectSettingsModal now saves through ONE atomic RPC
// (useUpdateProjectWithPermits) instead of N sequential mutations. This suite
// pins: a save fires the RPC exactly once; target_submit is never in a permit
// payload (engine-owned); a conflict shows one toast and keeps the modal open.

const mutateAsync = vi.hoisted(() => vi.fn());
const pushToastSpy = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({ data: [] }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({ data: [{ name: 'Building Permit' }, { name: 'Demolition' }] }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock('../components/builder/BuilderAutocompleteField', () => ({
  default: ({ value }: { value: string }) => <input readOnly value={value} />,
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: pushToastSpy,
}));
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

function makeProject(): Project {
  return {
    id: 'proj-1',
    address: '3626 164th Pl SE',
    juris: 'Bellevue',
    updated_at: NOW,
  } as unknown as Project;
}

function makePermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 256,
    project_id: 'proj-1',
    type: 'Building Permit',
    da: 'Jake',
    ent_lead: null,
    portal_url: null,
    num: null,
    struct_address: null,
    target_submit: '2026-03-26',
    updated_at: NOW,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
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
  pushToastSpy.mockReset();
  permitsData.rows = [makePermit()];
});

describe('ProjectSettingsModal — fix-36 atomic save', () => {
  it('saves through the RPC exactly once, with target_submit absent from permit payloads', async () => {
    const onClose = vi.fn();
    render(<ProjectSettingsModal project={makeProject()} onClose={onClose} />);

    // Add a new permit row (the "+ Add Permit Type" affordance).
    fireEvent.click(screen.getByTestId('psm-add-permit'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('psm-save'));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const arg = mutateAsync.mock.calls[0][0];
    expect(arg.projectId).toBe('proj-1');
    expect(arg.projectExpectedUpdatedAt).toBe(NOW);
    // Existing BP (256) update + the new permit insert.
    expect(arg.permitUpserts.length).toBe(2);
    // Engine-owned field must never be sent.
    for (const p of arg.permitUpserts) {
      expect('target_submit' in p).toBe(false);
    }
    // Existing permit carries its OCC token; the new one has no id.
    expect(arg.permitUpserts.some((p: { id?: number }) => p.id === 256)).toBe(true);
    expect(arg.permitUpserts.some((p: { id?: number }) => p.id == null)).toBe(true);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('on conflict shows one toast and keeps the modal open', async () => {
    mutateAsync.mockResolvedValue({
      conflict: true,
      conflictKind: 'permit',
      conflictId: '256',
      projectUpdatedAt: null,
      permits: [],
    });
    const onClose = vi.fn();
    render(<ProjectSettingsModal project={makeProject()} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('psm-save'));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    const warnCalls = pushToastSpy.mock.calls.filter((c) => c[1] === 'warn');
    expect(warnCalls.length).toBe(1);
    expect(warnCalls[0][0]).toMatch(/modified elsewhere/i);
  });
});
