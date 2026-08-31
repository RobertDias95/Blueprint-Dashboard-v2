import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockTaskOwnership } from '../test/taskOwnership';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// fix-348 — My Board, reviewed holistically: THE RENDERED HALF.
//
// ★★ The domain rules are asserted in MyBoardHolisticFix348.test.ts. This file
// asserts what a PERSON sees, because both of Bobby's contradictions were
// screen-level facts that every domain unit test passed straight through:
//
//   · the same permit in PAST DUE *and* in HANDED OFF was produced by the PAGE
//     re-filtering the forecast's own buckets, not by anything in myBoard.ts;
//   · "Sitting with the entitlement lead" and "Wait — with Cam" were two fields
//     of one item that no test ever read together.
//
// ★ fix-308b's file makes the same argument and it has been right twice: a
// tested function with no caller, or two correct fields rendered into one
// incoherent card, is not caught by unit tests.

const state = vi.hoisted(() => ({
  permits: [] as Record<string, unknown>[],
  projects: [] as Record<string, unknown>[],
  tasks: [] as Record<string, unknown>[],
  members: [] as unknown[],
  name: 'Bobby' as string | null,
  userId: 'user-1',
  /** ★ The real resolver is exercised in the domain suite; here the page's
   *  injection point is what matters, so it is a spy with a real rule. */
  owns: (task: Record<string, unknown>, name: string | null) =>
    (task.assigned_to ?? name) === name || task.assigned_to == null,
}));

// ★ fix-365: the design-manager lens. It reads dm_da_groups + the roster, and
// these suites render the board without a QueryClient by design — so it is
// mocked inert here. `hasAssociates: false` is also the state 25 of the 29
// logins are in, so this is the ordinary board, unchanged.
vi.mock('../hooks/useBoardLens', () => ({
  useBoardLens: () => ({
    associates: [],
    hasAssociates: false,
    lens: { mode: 'off', focus: null },
    setLens: vi.fn(),
    unmanaged: [],
  }),
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({
      session: { user: { id: state.userId } },
      user: { id: state.userId, email: 'x@test' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      activeTenantId: 't1',
    }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: state.permits, isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: state.members,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: state.name, roles: [], scope: 'permit' },
    userId: state.userId,
    isLoading: false,
  }),
  useScopeMode: () => ({
    mode: 'all',
    setMode: vi.fn(),
    identity: { name: state.name, roles: [], scope: 'permit' },
  }),
}));
// ★ fix-459: the shared double (src/test/taskOwnership), so the other three
//   members arrive complete and this suite only states the one it cares about.
//   `matches` reads `state.owns` at CALL time, so a test can still swap it.
vi.mock('../hooks/useTaskOwnership', () =>
  mockTaskOwnership({
    matches: (t, n) => state.owns(t as unknown as Record<string, unknown>, n),
  }),
);
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: [] }),
  // ★ fix-370: the model reads a second, uncapped aggregate for the TRUE
  // suppressed totals. Null here = the pre-fix-370 fallback (count the page),
  // which keeps every existing expectation in this suite meaningful.
  useScraperActivitySummary: () => ({ data: null }),
}));
vi.mock('../hooks/useMilestoneAcks', () => ({
  useMilestoneAcks: () => ({ data: [] }),
  useAckMilestone: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));
vi.mock('../hooks/useDaTeamRouting', () => ({ useDaTeamRouting: () => ({ data: [] }) }));
vi.mock('../hooks/useConfirmHandoff', () => ({
  useConfirmHandoff: () => ({ confirm: vi.fn(), pendingId: null, isPending: false }),
}));
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [] }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({
    data: state.tasks,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../components/TaskDetailEditor', () => ({
  default: () => <div data-testid="stub-editor" />,
}));

import MyBoard from '../pages/MyBoard';

let pid = 0;
let tid = 0;

function mkPermit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'PAR/Pre-Sub',
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    target_submit: null,
    approval_date: null,
    actual_issue: null,
    intake_date: null,
    dd_start: null,
    dd_end: null,
    parent_permit_id: null,
    updated_at: '2026-08-17T00:00:00Z',
    permit_cycles: [{ id: 'c0', permit_id: 1, cycle_index: 0 }],
    ...over,
  };
}

function mkTask(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `t${++tid}`,
    permit_id: 1,
    parent_task_id: null,
    project_id: 'p1',
    project_address: '4137 54th Ave SW',
    permit_type: 'PAR/Pre-Sub',
    bucket: 'de',
    text: 'Enter permit number',
    start_date: null,
    target_date: null,
    due_date: null,
    done_at: null,
    sort_order: 0,
    assigned_to: null,
    primary_assignee: null,
    co_assignees: [],
    discipline: 'ent',
    status: 'Open',
    ...over,
  };
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** ★ The board takes "today" from the clock, so the fixtures are dated relative
 *  to it rather than pinning a date the suite would then have to freeze. */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

beforeEach(() => {
  pid = 0;
  tid = 0;
  state.permits = [];
  state.projects = [{ id: 'p1', address: '4137 54th Ave SW' }];
  state.tasks = [];
  state.members = [];
  state.name = 'Bobby';
  state.userId = 'user-1';
  state.owns = (task, name) => (task.assigned_to ?? name) === name || task.assigned_to == null;
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// The screenshot, rebuilt and rendered.
// ---------------------------------------------------------------------------

describe('fix-348: the 4137 54th Ave SW row, on screen', () => {
  /** Permit 10491's prod shape: two-leg (a DA and an open arch task), target
   *  submit one day past, nothing submitted → the ENT leg waits on design. */
  function theScreenshot() {
    state.permits = [
      mkPermit({ id: 1, da: 'Cam', ent_lead: 'Bobby', target_submit: daysFromToday(-1) }),
    ];
    state.tasks = [
      mkTask({ id: 'arch-1', permit_id: 1, discipline: 'arch', assigned_to: 'Cam' }),
    ];
  }

  it('★★★ appears ONCE — past due, and NOT also under "Handed off"', () => {
    theScreenshot();
    wrap(<MyBoard />);
    expect(screen.getByTestId('board-sec-past-due-total').textContent).toContain('1');
    // The whole section is absent, not merely empty: nothing was handed off.
    expect(screen.queryByTestId('board-sec-handed-off-wrap')).toBeNull();
  });

  it('★★★ every string in the row names CAM, and none of them names Bobby', () => {
    theScreenshot();
    wrap(<MyBoard />);
    const row = screen.getByTestId('board-forecast-row-m-1-target_submit-entitlement');
    expect(row.textContent).toContain('Wait — with Cam');
    expect(row.textContent).toContain('Not yours yet — with Cam');
    // ★ The regression: "Sitting with the entitlement lead." on a row whose
    // entitlement lead is the viewer, above a line saying it is with Cam.
    expect(row.textContent).not.toMatch(/sitting with/i);
    expect(row.textContent).not.toMatch(/entitlement lead/i);
    expect(row.textContent).not.toContain('Bobby');
  });

  it('★ the row is still marked WAITING and offers no checkbox', () => {
    theScreenshot();
    wrap(<MyBoard />);
    const row = screen.getByTestId('board-forecast-row-m-1-target_submit-entitlement');
    expect(row.getAttribute('data-actionable')).toBe('false');
    expect(row.textContent).toContain('◆ waiting');
    expect(
      screen.queryByTestId('board-forecast-check-m-1-target_submit-entitlement'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The blend.
// ---------------------------------------------------------------------------

describe('fix-348: tasks appear in the forecast, and read differently', () => {
  it('★★★ a dated task renders in its date bucket — it never did before', () => {
    state.permits = [mkPermit({ id: 1, ent_lead: 'Bobby' })];
    state.tasks = [
      mkTask({ id: 'task-1', permit_id: 1, target_date: daysFromToday(-2), text: 'Enter permit number' }),
    ];
    wrap(<MyBoard />);
    const row = screen.getByTestId('board-forecast-row-t-task-1');
    expect(row.getAttribute('data-kind')).toBe('task');
    expect(row.textContent).toContain('Enter permit number');
    expect(row.textContent).toContain('✓ task');
  });

  it('★★ a task and a milestone in the same bucket stay tellable apart', () => {
    state.permits = [
      mkPermit({ id: 1, ent_lead: 'Bobby', target_submit: daysFromToday(-1) }),
    ];
    state.tasks = [mkTask({ id: 'task-1', permit_id: 1, target_date: daysFromToday(-1) })];
    wrap(<MyBoard />);
    expect(
      screen.getByTestId('board-forecast-row-t-task-1').getAttribute('data-kind'),
    ).toBe('task');
    expect(
      screen
        .getByTestId('board-forecast-row-m-1-target_submit-entitlement')
        .getAttribute('data-kind'),
    ).toBe('milestone');
  });

  it('★★ the header reports the SPLIT, so a capped section never hides a kind', () => {
    state.permits = [
      mkPermit({ id: 1, ent_lead: 'Bobby', target_submit: daysFromToday(-1) }),
    ];
    state.tasks = [mkTask({ id: 'task-1', permit_id: 1, target_date: daysFromToday(-1) })];
    wrap(<MyBoard />);
    const split = screen.getByTestId('board-sec-past-due-split');
    expect(split.textContent).toContain('1 milestone');
    expect(split.textContent).toContain('1 task');
  });

  it('★ and says nothing when the section holds only one kind', () => {
    state.permits = [
      mkPermit({ id: 1, ent_lead: 'Bobby', target_submit: daysFromToday(-1) }),
    ];
    wrap(<MyBoard />);
    expect(screen.queryByTestId('board-sec-past-due-split')).toBeNull();
  });

  it('★★ the forecast reads the SAME ownership rule the page injects', () => {
    // Nothing is mine → nothing renders, even though the task is dated and live.
    state.owns = () => false;
    state.permits = [mkPermit({ id: 1, ent_lead: 'Bobby' })];
    state.tasks = [mkTask({ id: 'task-1', permit_id: 1, target_date: daysFromToday(-2) })];
    wrap(<MyBoard />);
    expect(screen.queryByTestId('board-forecast-row-t-task-1')).toBeNull();
    expect(screen.getByTestId('board-sec-past-due-total').textContent).toContain('0');
  });
});

// ---------------------------------------------------------------------------
// The outgoing side still works.
// ---------------------------------------------------------------------------

describe('fix-348: "Handed off — waiting on others" is the OUTGOING side only', () => {
  it('★★ a DA whose design half is finished sees the row there, naming the LEAD', () => {
    state.name = 'Cam';
    state.permits = [
      mkPermit({ id: 1, da: 'Cam', ent_lead: 'Bobby', target_submit: daysFromToday(-3) }),
    ];
    state.tasks = [
      mkTask({ id: 'arch-1', permit_id: 1, discipline: 'arch', status: 'Resolved' }),
    ];
    wrap(<MyBoard />);
    const wrapEl = screen.getByTestId('board-sec-handed-off-wrap');
    expect(wrapEl.textContent).toContain('Bobby');
    expect(wrapEl.textContent).toContain('3 days');
    // ★ And it LEFT past due — it is no longer late FOR THE SENDER.
    expect(screen.getByTestId('board-sec-past-due-total').textContent).toContain('0');
  });

  it('★ it never escalates, at any age — fix-308 #46, unchanged', () => {
    state.name = 'Cam';
    state.permits = [
      mkPermit({ id: 1, da: 'Cam', ent_lead: 'Bobby', target_submit: daysFromToday(-400) }),
    ];
    state.tasks = [
      mkTask({ id: 'arch-1', permit_id: 1, discipline: 'arch', status: 'Resolved' }),
    ];
    wrap(<MyBoard />);
    const row = screen.getByTestId('board-handed-off-row-m-1-target_submit-design');
    expect(row.getAttribute('data-escalates')).toBe('false');
    expect(row.getAttribute('data-days-ago')).toBe('400');
  });
});
