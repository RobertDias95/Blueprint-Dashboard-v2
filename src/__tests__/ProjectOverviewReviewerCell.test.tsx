import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// fix-95: focused tests for the Project Overview permits-list "Reviewers"
// cell — the 2-line stacked breakdown that replaces the prior compact
// "X of Y signed off · K⚠" string. Lives in ProjectList.tsx's
// PermitMiniTable; data shape comes from summarizeReviewers in
// projectViewHelpers.ts.
//
// Bobby's mental buckets:
//   TOTAL         = current_status <> 'not_required'
//   APPROVED      = current_status = 'approved'
//   CORRECTIONS   = current_status = 'corrections_required'
//   OUTSTANDING   = total − approved − corrections
//                   (= assigned + in_review + in_process; the helper
//                    computes it directly as inReview + pending)

const T = 'test-tenant-uuid';

// Hoisted mutable state — each test overrides reviewers before render.
const fixtureState = vi.hoisted(() => ({
  reviewers: [] as Array<{
    id: string;
    permit_id: number;
    cycle_index: number;
    reviewer_name: string;
    discipline: string | null;
    current_status: string;
    last_event_date: string;
  }>,
}));

const baseProject = {
  id: 'p-a',
  address: '100 Apple Way',
  juris: 'Seattle',
  archived: false,
  notes: null,
  project_tags: [],
  go_date: '2026-03-10',
};

const basePermit = {
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
      cycle_index: 1,
      submitted: '2026-04-01',
      intake_accepted: '2026-04-03',
      city_target: null,
      corr_issued: null,
      resubmitted: null,
      created_at: '2026-05-15T12:00:00Z',
      updated_at: '2026-05-15T12:00:00Z',
    },
  ],
};

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [baseProject],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [basePermit],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({
    data: fixtureState.reviewers,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [],
    activeDas: [],
    formerDas: [],
    dms: [],
    ents: [],
    acqs: [],
    isLoading: false,
    error: null,
    data: [],
    refetch: vi.fn(),
  }),
}));
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));

import ProjectList from '../pages/ProjectList';

function renderAndExpand() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId('project-view-caret-p-a'));
  return result;
}

function reviewer(
  id: string,
  status: string,
  cycleIndex = 1,
): (typeof fixtureState.reviewers)[number] {
  return {
    id,
    permit_id: 1,
    cycle_index: cycleIndex,
    reviewer_name: id,
    discipline: null,
    current_status: status,
    last_event_date: '2026-04-20',
  };
}

beforeEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  fixtureState.reviewers = [];
});

describe('<ProjectList /> permits-mini-table reviewer cell — fix-95 breakdown', () => {
  it('renders 4-part breakdown when reviewers exist (6 total, 2 approved, 3 corrections, 1 outstanding)', () => {
    fixtureState.reviewers = [
      reviewer('a1', 'approved'),
      reviewer('a2', 'approved'),
      reviewer('c1', 'corrections_required'),
      reviewer('c2', 'corrections_required'),
      reviewer('c3', 'corrections_required'),
      reviewer('o1', 'assigned'),
    ];
    renderAndExpand();
    const cell = screen.getByTestId('project-view-reviewer-1');
    expect(cell.textContent).toMatch(/6 reviewers/);
    const breakdown = screen.getByTestId(
      'project-view-reviewer-breakdown-1',
    );
    expect(breakdown.textContent).toMatch(/2 approved/);
    expect(breakdown.textContent).toMatch(/3 corrections/);
    expect(breakdown.textContent).toMatch(/1 outstanding/);
  });

  it('excludes not_required from total (5 normal + 2 not_required → total reads 5)', () => {
    fixtureState.reviewers = [
      reviewer('a1', 'approved'),
      reviewer('a2', 'approved'),
      reviewer('a3', 'approved'),
      reviewer('c1', 'corrections_required'),
      reviewer('o1', 'in_review'),
      // Two N/A rows that must NOT count.
      reviewer('nr1', 'not_required'),
      reviewer('nr2', 'not_required'),
    ];
    renderAndExpand();
    const cell = screen.getByTestId('project-view-reviewer-1');
    expect(cell.textContent).toMatch(/5 reviewers/);
    expect(cell.textContent).not.toMatch(/7 reviewers/);
    const breakdown = screen.getByTestId(
      'project-view-reviewer-breakdown-1',
    );
    expect(breakdown.textContent).toMatch(/3 approved/);
    expect(breakdown.textContent).toMatch(/1 corrections/);
    expect(breakdown.textContent).toMatch(/1 outstanding/);
    // not_required reviewers don't surface anywhere in the cell text.
    expect(cell.textContent).not.toMatch(/not.required/i);
  });

  it('all-approved state shows zero corrections + zero outstanding explicitly (no auto-hide)', () => {
    fixtureState.reviewers = [
      reviewer('a1', 'approved'),
      reviewer('a2', 'approved'),
      reviewer('a3', 'approved'),
      reviewer('a4', 'approved'),
    ];
    renderAndExpand();
    const cell = screen.getByTestId('project-view-reviewer-1');
    expect(cell.textContent).toMatch(/4 reviewers/);
    const breakdown = screen.getByTestId(
      'project-view-reviewer-breakdown-1',
    );
    expect(breakdown.textContent).toMatch(/4 approved/);
    expect(breakdown.textContent).toMatch(/0 corrections/);
    expect(breakdown.textContent).toMatch(/0 outstanding/);
  });

  it("empty state shows 'no reviewers' muted, with no breakdown rendered", () => {
    fixtureState.reviewers = [];
    renderAndExpand();
    const cell = screen.getByTestId('project-view-reviewer-1');
    expect(cell.textContent).toMatch(/no reviewers/i);
    // Breakdown row not in the DOM when total = 0.
    expect(
      screen.queryByTestId('project-view-reviewer-breakdown-1'),
    ).not.toBeInTheDocument();
  });
});
