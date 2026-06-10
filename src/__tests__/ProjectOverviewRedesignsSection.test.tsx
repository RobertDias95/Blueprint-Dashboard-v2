import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-151: the Redesigns section at the bottom of the permits sidebar lists each
// redesign of the project + its permits (reuses-permit redesigns show a
// sub-label instead). Rows link to the redesign's project overview.

const T = 'test-tenant-uuid';
const PARENT = 'p-parent';
const NOW = '2026-05-14T12:00:00Z';

const refs = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  allPermits: [] as Record<string, unknown>[],
  parentPermits: [] as Record<string, unknown>[],
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refs.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refs.allPermits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermitsByProject', () => ({
  usePermitsByProject: () => ({ data: refs.parentPermits, isLoading: false, error: null, refetch: vi.fn() }),
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
vi.mock('../components/ProjectDetail/ScheduleHealthTable', () => ({
  default: () => <div data-testid="stub-schedule-health-table" />,
}));
vi.mock('../components/ProjectDetail/NotesDocsFooter', () => ({
  default: () => <div data-testid="stub-notes-docs-footer" />,
}));
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
function permit(id: number, projectId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, project_id: projectId, type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: null, dm: null,
    ent_lead: null, dual_da: null, target_submit: null, dd_start: null,
    dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null,
    kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
    nickname: null, struct_address: null, portal_url: null, updated_at: NOW,
    permit_cycles: [], ...over,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/project/${PARENT}`]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/project/:id" element={<ProjectDetail />} />
    </Routes>,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  refs.projects = [project({ id: PARENT, address: '4120 49th Ave S' })];
  refs.parentPermits = [permit(1, PARENT)];
  refs.allPermits = [permit(1, PARENT)];
});

describe('<ProjectDetail /> Redesigns section (fix-151)', () => {
  it('does not render the section when the project has no redesigns', () => {
    renderPage();
    expect(screen.queryByTestId('project-overview-redesigns-section')).toBeNull();
  });

  it('renders a redesign (new permits) with its trigger + permit rows', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT, redesign_trigger: 'acquisitions' }),
    ];
    refs.allPermits = [permit(1, PARENT), permit(10248, 'r1', { type: 'Building Permit' })];
    renderPage();
    expect(screen.getByTestId('project-overview-redesigns-section')).toBeTruthy();
    const row = screen.getByTestId('project-overview-redesign-row-r1');
    expect(row.textContent).toContain('Redesign 1');
    expect(row.textContent).toContain('Acquisitions');
    expect(screen.getByTestId('project-overview-redesign-permit-10248')).toBeTruthy();
  });

  it('renders a reuses-permit redesign with the "Reuses parent\'s permits" sub-label and no permit rows', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT, redesign_reuses_original_permit: true }),
    ];
    refs.allPermits = [permit(1, PARENT)]; // redesign has none
    renderPage();
    const section = screen.getByTestId('project-overview-redesigns-section');
    expect(section.textContent).toContain("Reuses parent's permits");
    expect(screen.queryByTestId(/project-overview-redesign-permit-/)).toBeNull();
  });

  it('renders multiple redesigns in created_at order (Redesign 1, Redesign 2)', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r2', redesign_of_project_id: PARENT, created_at: '2026-05-20T00:00:00Z' }),
      project({ id: 'r1', redesign_of_project_id: PARENT, created_at: '2026-05-10T00:00:00Z' }),
    ];
    refs.allPermits = [permit(1, PARENT)];
    renderPage();
    expect(screen.getByTestId('project-overview-redesign-row-r1').textContent).toContain('Redesign 1');
    expect(screen.getByTestId('project-overview-redesign-row-r2').textContent).toContain('Redesign 2');
  });

  it('redesign row links to the redesign project overview', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT }),
    ];
    refs.allPermits = [permit(1, PARENT)];
    renderPage();
    expect(
      screen.getByTestId('project-overview-redesign-row-r1').getAttribute('href'),
    ).toBe('/project/r1');
  });

  it('redesign permit links to the redesign project (no per-permit deep route)', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT }),
    ];
    refs.allPermits = [permit(1, PARENT), permit(10248, 'r1')];
    renderPage();
    expect(
      screen.getByTestId('project-overview-redesign-permit-10248').getAttribute('href'),
    ).toBe('/project/r1');
  });
});
