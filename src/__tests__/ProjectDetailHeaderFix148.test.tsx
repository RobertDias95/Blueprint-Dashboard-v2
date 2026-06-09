import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-148: Closing date moved from the Project Site cell into the DD Phase
// cell. It renders for all three DD Phase states (BP project / reuse-redesign /
// neither) and is gone from Project Site.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const updateMutateAsync = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));
// DD Phase editors + cells touch these — inert stubs.
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [], activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useOriginalPermitForRedesign', () => ({
  useOriginalPermitForRedesign: () => ({ data: null, isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-test',
    address: '500 Pike St',
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
    redesign_of_project_id: null,
    redesign_reuses_original_permit: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Project;
}

function bpFixture(): PermitWithCycles {
  return {
    id: 1, project_id: 'p-test', type: 'Building Permit', num: 'BP-1', status: null,
    portal_url: null, struct_address: null, ent_lead: null, dm: null, da: 'Trevor',
    dual_da: null, architect: null, kickoff_date: null, dd_start: null, dd_end: null,
    expected_issue: null, target_submit: null, target_submit_is_manual: false,
    intake_date: null, approval_date: null, actual_issue: null, corr_rounds: null,
    extras: null, last_scraper_update_at: null, nickname: null, cycle_model: null,
    view_cycle: null, notes: null, created_at: NOW, updated_at: NOW, permit_cycles: [],
  } as unknown as PermitWithCycles;
}

function renderHeader(project: Project, permits: PermitWithCycles[]) {
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={permits} bp={bp} allProjects={[]} />,
    { wrapper },
  );
}

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({});
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-148: Closing date moved to DD Phase', () => {
  it('renders Closing in the DD Phase cell', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    expect(screen.getByTestId('project-overview-closing')).toBeTruthy();
  });

  it('no longer renders Closing in the Project Site cell (no pd-site-closing)', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    expect(screen.queryByTestId('pd-site-closing')).toBeNull();
  });

  it('editing Closing commits closing_date via useUpdateProject', async () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const input = screen.getByTestId('project-overview-closing') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-30' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({
      closing_date: '2026-09-30',
    });
    expect(updateMutateAsync.mock.calls[0][0].fieldLabel).toBe('Closing Date');
  });

  it('renders Closing in all three DD Phase states', () => {
    // 1) BP project
    const a = renderHeader(projectFixture(), [bpFixture()]);
    expect(screen.getByTestId('project-overview-closing')).toBeTruthy();
    a.unmount();
    // 2) reuse-redesign with no BP
    const b = renderHeader(
      projectFixture({
        redesign_of_project_id: 'parent-uuid',
        redesign_reuses_original_permit: true,
      }),
      [],
    );
    expect(screen.getByTestId('project-overview-closing')).toBeTruthy();
    b.unmount();
    // 3) neither (normal project, no BP)
    renderHeader(projectFixture(), []);
    expect(screen.getByTestId('project-overview-closing')).toBeTruthy();
    expect(screen.getByText('No building permit')).toBeTruthy();
  });
});
