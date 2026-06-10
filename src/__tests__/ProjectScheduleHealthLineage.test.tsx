import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-151: Schedule Health on the parent aggregates across the lineage (parent
// + all redesign permits). Viewing a redesign's own page computes from its own
// permits only (no upward chase). We capture the `permits` prop handed to
// ScheduleHealthTable to assert the cohort.

const T = 'test-tenant-uuid';
const PARENT = 'p-parent';
const NOW = '2026-05-14T12:00:00Z';

const refs = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  allPermits: [] as Record<string, unknown>[],
  scopedPermits: [] as Record<string, unknown>[], // usePermitsByProject(currentPage)
}));
const shCapture = vi.hoisted(() => ({ permits: [] as { id: number }[] }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refs.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refs.allPermits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermitsByProject', () => ({
  usePermitsByProject: () => ({ data: refs.scopedPermits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock('../components/ProjectDetail/ProjectDetailHeader', () => ({
  default: () => <div data-testid="stub-project-header" />,
}));
// Capturing stub: records the permits cohort handed to Schedule Health.
vi.mock('../components/ProjectDetail/ScheduleHealthTable', () => ({
  default: (props: { permits: { id: number }[] }) => {
    shCapture.permits = props.permits;
    return <div data-testid="stub-schedule-health-table" />;
  },
}));
vi.mock('../components/ProjectDetail/NotesDocsFooter', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/ProjectSettingsModal', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/DeleteProjectDialog', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/QuickEditPermitModal', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/PermitDetailV2', () => ({ default: () => null }));

import ProjectDetail from '../pages/ProjectDetail';

function project(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'x', address: 'addr', juris: 'Seattle', archived: false, notes: null,
    acq_lead: null, external_team: {}, builder_id: null, permit_order: [],
    entitlement_lead: null, design_manager: null, go_date: null, units: null,
    zone: null, lot_width: null, lot_depth: null, unit_types: null,
    parking_type: null, parking_stalls: null, alley: null, product_types: [],
    project_tags: null, builder_name: null, builder_company: null,
    builder_email: null, builder_phone: null,
    redesign_of_project_id: null, redesign_trigger: null,
    redesign_reuses_original_permit: null,
    created_at: NOW, updated_at: NOW, ...over,
  };
}
function permit(id: number, projectId: string): Record<string, unknown> {
  return {
    id, project_id: projectId, type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: null, dm: null,
    ent_lead: null, dual_da: null, target_submit: null, dd_start: null,
    dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null,
    kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
    nickname: null, struct_address: null, portal_url: null, updated_at: NOW,
    permit_cycles: [],
  };
}

function renderAt(pathId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/project/${pathId}`]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/project/:id" element={<ProjectDetail />} />
    </Routes>,
    { wrapper },
  );
}

const capturedIds = () => shCapture.permits.map((p) => p.id).sort((a, b) => a - b);

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  shCapture.permits = [];
});

describe('Schedule Health lineage cohort (fix-151)', () => {
  it('parent with no redesigns → cohort is the parent permits only', () => {
    refs.projects = [project({ id: PARENT })];
    refs.scopedPermits = [permit(1, PARENT), permit(2, PARENT)];
    refs.allPermits = [permit(1, PARENT), permit(2, PARENT)];
    renderAt(PARENT);
    expect(capturedIds()).toEqual([1, 2]);
  });

  it('parent + redesign with permits → cohort is parent permits + redesign permits', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT }),
    ];
    refs.scopedPermits = [permit(1, PARENT)];
    refs.allPermits = [permit(1, PARENT), permit(10248, 'r1')];
    renderAt(PARENT);
    expect(capturedIds()).toEqual([1, 10248]);
  });

  it('parent + reuses-permit redesign (no permits) → cohort is parent permits only', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT, redesign_reuses_original_permit: true }),
    ];
    refs.scopedPermits = [permit(1, PARENT)];
    refs.allPermits = [permit(1, PARENT)]; // redesign has none
    renderAt(PARENT);
    expect(capturedIds()).toEqual([1]);
  });

  it("viewing the redesign's own page → cohort is the redesign permits only (no upward chase)", () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT }),
    ];
    refs.scopedPermits = [permit(10248, 'r1')]; // usePermitsByProject('r1')
    refs.allPermits = [permit(1, PARENT), permit(10248, 'r1')];
    renderAt('r1');
    expect(capturedIds()).toEqual([10248]); // NOT the parent's permit 1
  });
});
