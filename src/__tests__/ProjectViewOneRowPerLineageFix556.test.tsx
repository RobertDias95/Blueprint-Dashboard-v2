import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// ★★★ fix-556 §D (P-263) — PROJECT VIEW LISTS ONE ROW PER LINEAGE
// ===========================================================================
//
// Before this ticket the table listed `2443 5th Ave W` and
// `2443 5th Ave W [Redesign 1]` as two peer rows — **and the ORIGINAL was the
// one with the permits.** §C has just made both read as the same address, so
// leaving the pair would print one address twice with different numbers beside
// it, and the row carrying `4` would be the retired one.
//
// ★★★ THE ORIGINAL IS REMOVED BEFORE FILTERING, NOT AT RENDER TIME. That is
//     what makes `N total · M match`, the Stage / Ent / DA / Juris options, the
//     Active toggle and every sort agree with what is on screen. Hiding a row
//     in the JSX would have left it counted in all four.

const T = 'test-tenant-uuid';
const ORIGINAL = 'f89fce48-4ef4-400d-a096-2e0612043201';
const REDESIGN = '95c72aeb-65db-4b46-b2af-12704a7b8128';
const OTHER = 'p-other';
const NOW = '2026-09-14T12:00:00Z';

const fixtures = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  permits: [] as Record<string, unknown>[],
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: fixtures.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: fixtures.permits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [], activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));

import ProjectList from '../pages/ProjectList';

function project(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'x', address: 'addr', juris: 'Seattle', archived: false, notes: null,
    project_tags: null, go_date: null,
    redesign_of_project_id: null, redesign_reuses_original_permit: null,
    created_at: NOW, updated_at: NOW, ...over,
  };
}
function permit(id: number, projectId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, project_id: projectId, type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: 'Nicky', dm: null,
    ent_lead: null, dual_da: null, target_submit: null, dd_start: null,
    dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null,
    kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
    nickname: null, struct_address: null, portal_url: null,
    parent_permit_id: null, updated_at: NOW, permit_cycles: [], ...over,
  };
}

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function visibleRowIds(): string[] {
  return Array.from(
    document.querySelectorAll('tr[data-testid^="project-view-row-"]'),
  ).map((el) => (el.getAttribute('data-testid') ?? '').replace('project-view-row-', ''));
}

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T });
  fixtures.projects = [
    project({ id: ORIGINAL, address: '2443 5th Ave W' }),
    project({
      id: REDESIGN,
      address: '2443 5th Ave W [Redesign 1]',
      redesign_of_project_id: ORIGINAL,
      redesign_reuses_original_permit: true,
    }),
    project({ id: OTHER, address: '999 Elsewhere Ave' }),
  ];
  fixtures.permits = [
    permit(10499, ORIGINAL, { type: 'Building Permit', status: 'Ready for Issuance' }),
    permit(10500, ORIGINAL, { type: 'Demolition', status: 'Issued' }),
    permit(10501, ORIGINAL, { type: 'ULS', status: 'Ready for Intake' }),
    permit(10502, ORIGINAL, { type: 'PAR/Pre-Sub', status: 'Completed' }),
    permit(900, OTHER),
  ];
});

describe('fix-556 §D — one row per lineage, the original folded under it', () => {
  it('★★★ 2443 is ONE row, and it is the current project', () => {
    renderIt();
    const ids = visibleRowIds();
    expect(ids).toContain(REDESIGN);
    expect(ids).not.toContain(ORIGINAL);
  });

  it('★★★ the current row carries the permits — it showed a dash before', () => {
    renderIt();
    const row = screen.getByTestId(`project-view-row-${REDESIGN}`);
    // ★ The permit-count cell is the last one; the row read `—` before this
    //   ticket because the four permits were on the row that is now folded.
    expect(row.textContent).toContain('4');
  });

  it('★★★ `N total · M match` counts CURRENT projects — the original is not one', () => {
    renderIt();
    // 3 projects, 2 lineages: 2443 (redesign + folded original) and 999.
    expect(screen.getByText(/2 total · 2 match/)).toBeTruthy();
  });

  it('★★★ searching `2443` finds exactly one row', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('project-view-search'), {
      target: { value: '2443' },
    });
    expect(visibleRowIds()).toEqual([REDESIGN]);
    expect(screen.getByText(/2 total · 1 match/)).toBeTruthy();
  });

  it('★★★ the original is COLLAPSED by default and the caret reveals it', () => {
    renderIt();
    expect(screen.queryByTestId(`project-view-original-row-${REDESIGN}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`project-view-original-toggle-${REDESIGN}`));
    const folded = screen.getByTestId(`project-view-original-row-${REDESIGN}`);
    expect(folded.textContent).toContain('2443 5th Ave W');
    // ★★ THE MARKER: one chip, `Original`, at the one site that lists an
    //    original without the purple hatch already saying it.
    expect(screen.getByTestId(`project-view-original-chip-${ORIGINAL}`).textContent)
      .toBe('Original');
  });

  it('★★★ the folded row LINKS to the original — the way to the frozen snapshot', () => {
    // ★ fix-524 §D's snapshot is what /project/<original> renders for a
    //   superseded project, so there is no second destination to keep in step.
    renderIt();
    fireEvent.click(screen.getByTestId(`project-view-original-toggle-${REDESIGN}`));
    const link = screen.getByTestId(`project-view-original-link-${ORIGINAL}`);
    expect(link.getAttribute('href')).toBe(`/project/${ORIGINAL}`);
  });

  it('★★★ no row prints `[Redesign 1]` — and the fixture still stores it', () => {
    renderIt();
    expect(document.body.textContent).not.toContain('[Redesign 1]');
    expect(
      (fixtures.projects.find((p) => p.id === REDESIGN) as { address: string }).address,
    ).toBe('2443 5th Ave W [Redesign 1]');
  });

  it('★★ a project that superseded nothing has no second caret', () => {
    renderIt();
    expect(screen.queryByTestId(`project-view-original-toggle-${OTHER}`)).toBeNull();
  });
});
