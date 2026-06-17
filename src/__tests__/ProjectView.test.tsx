import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// fix-90: Project View overhaul. Filter chips + sort + per-row caret +
// nested permit mini-table with stage badge + reviewer rollup. The
// Monday-triage workspace.

const T = 'test-tenant-uuid';

const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'p-a',
      address: '100 Apple Way',
      juris: 'Seattle',
      archived: false,
      notes: null,
      project_tags: ['ECA'],
      go_date: '2026-03-10',
    },
    {
      id: 'p-b',
      address: '300 Oak Ln',
      juris: 'Bellevue',
      archived: false,
      notes: null,
      project_tags: null,
      go_date: '2026-01-05',
    },
    {
      id: 'p-c',
      address: '500 Pike St',
      juris: 'Seattle',
      archived: false,
      notes: null,
      project_tags: null,
      go_date: '2026-05-01',
    },
    // archived → never rendered
    {
      id: 'p-arch',
      address: '999 Archived Rd',
      juris: 'Seattle',
      archived: true,
      notes: null,
      project_tags: null,
      go_date: null,
    },
  ],
  permits: [
    // p-a: one BP in corrections (cycle 1 corr_issued without resubmitted)
    {
      id: 1,
      project_id: 'p-a',
      type: 'Building Permit',
      stage: null,
      stage_override: null,
      status: null,
      num: 'BP-100',
      da: 'Trevor',
      dm: null,
      ent_lead: 'Bobby',
      dual_da: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-15T12:00:00Z',
      permit_cycles: [
        {
          id: 'c0-1',
          permit_id: 1,
          cycle_index: 0,
          submitted: '2026-04-01',
          intake_accepted: '2026-04-03',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          created_at: '2026-05-15T12:00:00Z',
          updated_at: '2026-05-15T12:00:00Z',
        },
        {
          id: 'c1-1',
          permit_id: 1,
          cycle_index: 1,
          submitted: '2026-04-03',
          intake_accepted: null,
          city_target: null,
          corr_issued: '2026-04-20',
          resubmitted: null,
          created_at: '2026-05-15T12:00:00Z',
          updated_at: '2026-05-15T12:00:00Z',
        },
      ],
    },
    // p-b: one BP under review (submitted, no corrections)
    {
      id: 2,
      project_id: 'p-b',
      type: 'Building Permit',
      stage: null,
      stage_override: null,
      status: null,
      num: 'BP-200',
      da: 'Cam',
      dm: null,
      ent_lead: 'Alex',
      dual_da: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-15T12:00:00Z',
      permit_cycles: [
        {
          id: 'c0-2',
          permit_id: 2,
          cycle_index: 0,
          submitted: '2026-04-10',
          intake_accepted: '2026-04-12',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          created_at: '2026-05-15T12:00:00Z',
          updated_at: '2026-05-15T12:00:00Z',
        },
      ],
    },
    // p-c: BP issued (actual_issue set → effectiveStage='is')
    {
      id: 3,
      project_id: 'p-c',
      type: 'Building Permit',
      stage: null,
      stage_override: null,
      status: null,
      num: 'BP-300',
      da: 'Trevor',
      dm: null,
      ent_lead: 'Bobby',
      dual_da: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: '2026-05-01',
      approval_date: null,
      intake_date: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-15T12:00:00Z',
      permit_cycles: [],
    },
    // p-c also has a demolition permit (extra to test the "multiple
    // permits per project" caret expansion).
    {
      id: 4,
      project_id: 'p-c',
      type: 'Demolition',
      stage: null,
      stage_override: null,
      status: null,
      num: 'DEMO-300',
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: '2026-04-15',
      intake_date: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-15T12:00:00Z',
      permit_cycles: [],
    },
  ],
  reviewers: [
    // Permit 1 (the corrections BP): 3 reviewers, 1 approved
    {
      id: 'r-1a',
      permit_id: 1,
      cycle_index: 1,
      reviewer_name: 'Stephen',
      discipline: 'Energy',
      current_status: 'corrections_required',
      last_event_date: '2026-04-20',
    },
    {
      id: 'r-1b',
      permit_id: 1,
      cycle_index: 1,
      reviewer_name: 'Susan',
      discipline: 'Land Use',
      current_status: 'approved',
      last_event_date: '2026-04-20',
    },
    {
      id: 'r-1c',
      permit_id: 1,
      cycle_index: 1,
      reviewer_name: 'Mike',
      discipline: 'Structural',
      current_status: 'in_review',
      last_event_date: '2026-04-20',
    },
  ],
  team: [
    { id: '1', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '2', name: 'Alex', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '3', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
    { id: '4', name: 'Cam', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
  ],
  // fix-178: p-b has an ACTIVE hold; p-a has only a CLOSED past hold (must NOT
  // count as held). p-c has none.
  holds: [
    {
      id: 'h-b', tenant_id: 'test-tenant-uuid', project_id: 'p-b', reason: 'Financing', note: 'waiting on closing',
      hold_start: '2026-05-01', hold_end: null, created_by: null, created_at: '', updated_at: '',
    },
    {
      id: 'h-a', tenant_id: 'test-tenant-uuid', project_id: 'p-a', reason: 'MHA', note: null,
      hold_start: '2026-03-01', hold_end: '2026-03-20', created_by: null, created_at: '', updated_at: '',
    },
  ],
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({
    data: fixtures.reviewers,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: fixtures.team,
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
// fix-178: ProjectList now reads holds (badge + filter). Mock only the bulk
// hook; keep the real pure helpers (activeHoldProjectIds / activeHoldByProjectId).
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({
      data: fixtures.holds,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
// The page mounts NewProjectWizard. Stub it inert so the wizard's data
// hooks don't have to be mocked here.
vi.mock('../components/NewProjectWizard', () => ({
  default: () => null,
}));

import ProjectList from '../pages/ProjectList';

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

function visibleProjectIds(): string[] {
  return Array.from(
    document.querySelectorAll('tr[data-testid^="project-view-row-"]'),
  ).map((el) => {
    const tid = (el as HTMLElement).dataset.testid ?? '';
    return tid.replace('project-view-row-', '');
  });
}

beforeEach(() => {
  // Each test starts with a clean filter state — otherwise the localStorage
  // persistence carries between tests.
  window.localStorage.clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('<ProjectView /> (fix-90)', () => {
  it('renders one row per non-archived project, archived projects excluded', () => {
    renderIt();
    const ids = visibleProjectIds();
    expect(ids).toContain('p-a');
    expect(ids).toContain('p-b');
    expect(ids).toContain('p-c');
    expect(ids).not.toContain('p-arch');
    expect(screen.getByTestId('project-view-count').textContent).toMatch(
      /3 total · 3 match/,
    );
  });

  it('sort by go_date asc reorders rows (oldest first → newest)', () => {
    renderIt();
    // Default sort is address asc; switch to go_date.
    fireEvent.click(screen.getByTestId('project-view-th-go_date'));
    expect(visibleProjectIds()).toEqual(['p-b', 'p-a', 'p-c']);
    // Second click flips to desc.
    fireEvent.click(screen.getByTestId('project-view-th-go_date'));
    expect(visibleProjectIds()).toEqual(['p-c', 'p-a', 'p-b']);
  });

  it('Target Submit column renders + is sortable (fix-142)', () => {
    renderIt();
    // Column header present (mirrors the existing click-to-sort surface).
    expect(screen.getByTestId('project-view-th-target_submit')).toBeTruthy();
    // Fixture permits all have target_submit null → cell shows the em dash.
    expect(
      screen.getByTestId('project-view-target-submit-p-a').textContent,
    ).toBe('—');
    // Clicking sorts without error; all-null projects tie-break by address asc.
    fireEvent.click(screen.getByTestId('project-view-th-target_submit'));
    expect(visibleProjectIds()).toEqual(['p-a', 'p-b', 'p-c']);
  });

  it('stage filter "Corrections" narrows to projects with at least one corrections permit', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('project-view-stage-chip-co'));
    const ids = visibleProjectIds();
    expect(ids).toEqual(['p-a']);
    expect(screen.getByTestId('project-view-count').textContent).toMatch(
      /3 total · 1 match/,
    );
  });

  it('ent lead filter narrows to projects with that ent_lead on at least one permit', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('project-view-filter-ent-select'), {
      target: { value: 'Bobby' },
    });
    const ids = visibleProjectIds();
    expect(ids).toEqual(expect.arrayContaining(['p-a', 'p-c']));
    expect(ids).not.toContain('p-b');
  });

  it('DA filter narrows the same way', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('project-view-filter-da-select'), {
      target: { value: 'Cam' },
    });
    expect(visibleProjectIds()).toEqual(['p-b']);
  });

  it('multiple filters compose (Stage=Corrections AND Juris=Seattle)', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('project-view-stage-chip-co'));
    fireEvent.change(screen.getByTestId('project-view-filter-juris-select'), {
      target: { value: 'Seattle' },
    });
    expect(visibleProjectIds()).toEqual(['p-a']);
    // Switch Juris to Bellevue → both filters miss → empty state.
    fireEvent.click(screen.getByTestId('project-view-filter-juris-remove-Seattle'));
    fireEvent.change(screen.getByTestId('project-view-filter-juris-select'), {
      target: { value: 'Bellevue' },
    });
    expect(visibleProjectIds()).toEqual([]);
    expect(screen.getByTestId('project-view-empty')).toBeInTheDocument();
  });

  it('free-text search matches the address', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('project-view-search'), {
      target: { value: 'pike' },
    });
    expect(visibleProjectIds()).toEqual(['p-c']);
  });

  it("clicking a row's caret expands it; expansion shows each permit with stage badge + reviewer text", () => {
    renderIt();
    // p-c has two permits (BP issued + Demolition approved).
    fireEvent.click(screen.getByTestId('project-view-caret-p-c'));
    const expansion = screen.getByTestId('project-view-expansion-p-c');
    expect(expansion).toBeInTheDocument();
    expect(
      screen.getByTestId('project-view-permit-row-p-c-3'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('project-view-permit-row-p-c-4'),
    ).toBeInTheDocument();
    // Stage badges render with the correct labels — issued + approved.
    expect(
      screen.getByTestId('project-view-stage-badge-3').textContent,
    ).toMatch(/Issued/);
    expect(
      screen.getByTestId('project-view-stage-badge-4').textContent,
    ).toMatch(/Approved/);
  });

  it('expansion of the corrections project shows the 4-part reviewer breakdown (fix-95)', () => {
    // Permit 1's mocked reviewers: 1 corrections_required (Stephen),
    // 1 approved (Susan), 1 in_review (Mike). fix-95: cell renders as
    // a 2-line stacked breakdown — header "3 reviewers" + detail
    // "1 approved · 1 corrections · 1 outstanding".
    renderIt();
    fireEvent.click(screen.getByTestId('project-view-caret-p-a'));
    const reviewer = screen.getByTestId('project-view-reviewer-1');
    expect(reviewer.textContent).toMatch(/3 reviewers/);
    const breakdown = screen.getByTestId(
      'project-view-reviewer-breakdown-1',
    );
    expect(breakdown.textContent).toMatch(/1 approved/);
    expect(breakdown.textContent).toMatch(/1 corrections/);
    expect(breakdown.textContent).toMatch(/1 outstanding/);
  });

  it('clicking the caret again collapses', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('project-view-caret-p-c'));
    expect(screen.getByTestId('project-view-expansion-p-c')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('project-view-caret-p-c'));
    expect(screen.queryByTestId('project-view-expansion-p-c')).not.toBeInTheDocument();
  });

  it('filter state persists across remount via localStorage', () => {
    const { unmount } = renderIt();
    fireEvent.click(screen.getByTestId('project-view-stage-chip-co'));
    expect(window.localStorage.getItem('projectView.filters.v1')).toMatch(
      /"stages":\["co"\]/,
    );
    unmount();
    renderIt();
    // The Corrections chip is still selected on remount → only p-a visible.
    expect(visibleProjectIds()).toEqual(['p-a']);
  });

  it('shows the empty state with a Reset link when no projects match', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('project-view-search'), {
      target: { value: 'definitely-not-an-address-token-xyz' },
    });
    expect(screen.getByTestId('project-view-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('project-view-empty-reset'));
    // After reset every project is back.
    expect(visibleProjectIds().length).toBe(3);
  });
});

// fix-178 Part B: hold badge + three-way hold filter on the Project List.
describe('<ProjectView /> hold badge + filter (fix-178)', () => {
  it('badges the held project (active hold) and NOT one with only a closed past hold', () => {
    renderIt();
    // p-b has an active hold → badge present with its reason.
    const badge = screen.getByTestId('project-view-hold-p-b');
    expect(badge.textContent).toContain('On Hold');
    expect(badge.textContent).toContain('Financing');
    // p-a's only hold is closed → no badge.
    expect(screen.queryByTestId('project-view-hold-p-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-view-hold-p-c')).not.toBeInTheDocument();
  });

  it("default 'All' shows everything", () => {
    renderIt();
    expect(visibleProjectIds().sort()).toEqual(['p-a', 'p-b', 'p-c']);
  });

  it("'Only Holds' shows just the actively-held project", () => {
    renderIt();
    fireEvent.click(screen.getByTestId('project-view-hold-filter-only'));
    expect(visibleProjectIds()).toEqual(['p-b']);
  });

  it("'Exclude Holds' hides the actively-held project (closed-hold project stays)", () => {
    renderIt();
    fireEvent.click(screen.getByTestId('project-view-hold-filter-exclude'));
    // p-b drops; p-a (closed hold) + p-c remain.
    expect(visibleProjectIds().sort()).toEqual(['p-a', 'p-c']);
  });
});
