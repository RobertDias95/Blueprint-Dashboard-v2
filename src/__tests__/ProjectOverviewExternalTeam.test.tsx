import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';

// fix-196 / fix-227: the Project Overview "Team → External" editor
// (ExternalTeamEditor in ProjectDetailHeader) applies the SHARED fix-193
// show-rules (common four always; others when assigned or via "+ Add
// discipline"; empty CTA when nothing assigned) and reads/writes the
// projects.external_team blob. fix-227: the firm field is now a DROPDOWN sourced
// from the central External Team directory; picking writes the blob, "+ Add new
// firm…" also inserts into the directory, and an existing free-text blob firm
// not in the directory still renders.

const T = 'test-tenant-uuid';
const TOKEN = '2026-06-24T12:00:00Z';

const updateMutateAsync = vi.hoisted(() => vi.fn());
const DIR_REF = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const upsertDirSpy = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({
    data: DIR_REF.rows,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertDirectoryFirm: () => ({
    mutate: upsertDirSpy,
    mutateAsync: upsertDirSpy,
    isPending: false,
  }),
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function firm(discipline: string, name: string, active = true) {
  return { id: `${discipline}-${name}`, discipline, name, active, created_at: '2026-01-01' };
}

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-test',
    address: '224 2nd Ave N',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: null,
    units: 4,
    num_lots: null,
    is_corner_lot: null,
    closing_date: null,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: TOKEN,
    updated_at: TOKEN,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function setup(over: Partial<Record<string, unknown>> = {}, allProjects?: unknown[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const project = projectFixture(over);
  queryClient.setQueryData(queryKeys.projects(T), allProjects ?? [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={[]} bp={null} />,
    { wrapper },
  );
}

const sel = (d: string) =>
  screen.getByTestId(`pd-ext-${d.toLowerCase()}`) as HTMLSelectElement;

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({});
  upsertDirSpy.mockClear();
  DIR_REF.rows = [];
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('Project Overview → Team → External (fix-196 show-rules / fix-227 directory)', () => {
  it('224 2nd Ave N (Surveyor=Emerald): shows the common four (NOT all 13); the unassigned non-common are hidden', () => {
    setup({ external_team: { Surveyor: 'Emerald' } });
    for (const d of ['Civil', 'Surveyor', 'Structural', 'Arborist']) {
      expect(screen.getByTestId(`pd-ext-row-${d}`)).toBeInTheDocument();
    }
    // The Surveyor slot shows the real firm even though it isn't in the directory.
    expect(sel('Surveyor').value).toBe('Emerald');
    // Unassigned non-common disciplines are hidden until added/assigned.
    expect(screen.queryByTestId('pd-ext-row-Energy')).toBeNull();
    expect(screen.queryByTestId('pd-ext-row-Geotech')).toBeNull();
    expect(screen.queryByTestId('pd-ext-row-Architect')).toBeNull();
  });

  it('a non-common discipline renders once the blob assigns it', () => {
    setup({ external_team: { Geotech: 'GeoCo' } });
    expect(screen.getByTestId('pd-ext-row-Geotech')).toBeInTheDocument();
    expect(sel('Geotech').value).toBe('GeoCo');
  });

  it('empty blob shows the empty-state CTA', () => {
    setup({ external_team: {} });
    expect(screen.getByTestId('pd-ext-empty-cta')).toBeInTheDocument();
  });

  it('a blob with an assignment hides the empty CTA', () => {
    setup({ external_team: { Surveyor: 'Emerald' } });
    expect(screen.queryByTestId('pd-ext-empty-cta')).toBeNull();
  });

  it('+ Add discipline surfaces a hidden discipline as a slot', async () => {
    setup({ external_team: {} });
    expect(screen.queryByTestId('pd-ext-row-Energy')).toBeNull();
    fireEvent.change(screen.getByTestId('pd-ext-add-discipline'), {
      target: { value: 'Energy' },
    });
    await waitFor(() => expect(screen.getByTestId('pd-ext-row-Energy')).toBeInTheDocument());
  });

  it('the firm dropdown lists the directory active firms for that discipline', () => {
    DIR_REF.rows = [
      firm('Civil', 'Facet'),
      firm('Civil', 'Prism'),
      firm('Civil', 'OldCo', false),
      firm('Surveyor', 'Emerald'),
    ];
    setup({ external_team: {} });
    const values = within(sel('Civil'))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain('Facet');
    expect(values).toContain('Prism');
    expect(values).not.toContain('OldCo'); // inactive
    expect(values).not.toContain('Emerald'); // other discipline
  });

  it('selecting a directory firm writes the blob (merge, existing key kept)', async () => {
    DIR_REF.rows = [firm('Civil', 'Facet')];
    setup({ external_team: { Surveyor: 'Emerald' } });
    fireEvent.change(sel('Civil'), { target: { value: 'Facet' } });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    const call = updateMutateAsync.mock.calls[0][0];
    expect(call.projectId).toBe('p-test');
    expect(call.expectedUpdatedAt).toBe(TOKEN);
    expect(call.patch).toEqual({ external_team: { Surveyor: 'Emerald', Civil: 'Facet' } });
  });

  it('+ Add new firm inserts into the directory and writes the blob', async () => {
    setup({ external_team: {} });
    fireEvent.change(sel('Civil'), { target: { value: '__add_new_firm__' } });
    const input = screen.getByTestId('pd-ext-civil-add-input');
    fireEvent.change(input, { target: { value: 'Facet' } });
    fireEvent.blur(input);
    await waitFor(() => expect(upsertDirSpy).toHaveBeenCalledTimes(1));
    expect(upsertDirSpy.mock.calls[0][0]).toEqual({ discipline: 'Civil', name: 'Facet' });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({
      external_team: { Civil: 'Facet' },
    });
  });

  it('selecting Unassigned removes the discipline key from the blob', async () => {
    setup({ external_team: { Surveyor: 'Emerald' } });
    fireEvent.change(sel('Surveyor'), { target: { value: '' } });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({ external_team: {} });
  });
});
