import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-307 (register #36–#41) — the badge counts what is UNSEEN.
//
// ★ THE HARNESS RULE, learned the hard way. fix-306 found that fix-304's
// harness stubbed a `/projects/:id` route the app does not have: the test
// invented a route to match buggy code and then passed. So these tests assert
// OBSERVABLE OUTCOMES, never mechanisms —
//   not "the read mutation was called" -> the badge decrements and the
//   highlight clears; not "the row has a handler" -> clicking changes what a
//   second render shows.
// The read state below is therefore a REAL store the mutation writes to and
// the query reads back, so a click genuinely changes the next render. Routes
// are the real ones from router.tsx.

const state = vi.hoisted(() => {
  const reads = new Map<string, Set<string>>(); // userId -> item keys
  return {
    permits: [] as PermitWithCycles[],
    projects: [] as Project[],
    tasks: [] as unknown[],
    members: [] as unknown[],
    name: 'Miles' as string | null,
    userId: 'user-miles',
    activity: [] as unknown[],
    acks: [] as unknown[],
    dmRows: [] as unknown[],
    entRows: [] as unknown[],
    reads,
    readsFor(u: string) {
      return reads.get(u) ?? new Set<string>();
    },
    ackMutate: vi.fn(),
    taskMutate: vi.fn(),
    confirmHandoff: vi.fn(),
  };
});

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
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: state.permits, isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: state.members, isLoading: false }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: state.name, roles: [], scope: 'permit' },
    userId: state.userId,
    isLoading: false,
  }),
}));
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: state.activity }),
  // ★ fix-370: the model reads a second, uncapped aggregate for the TRUE
  // suppressed totals. Null here = the pre-fix-370 fallback (count the page),
  // which keeps every existing expectation in this suite meaningful.
  useScraperActivitySummary: () => ({ data: null }),
}));
vi.mock('../hooks/useMilestoneAcks', () => ({
  useMilestoneAcks: () => ({ data: state.acks }),
  useAckMilestone: () => ({ mutate: state.ackMutate, isPending: false }),
}));
// fix-329: the board reads chat mentions as a fifth "new item" source. Mocked
// empty here — this suite is about the other four, and an unmocked query would
// reach for a QueryClient this harness deliberately does not provide.
// ★ fix-354: the EIGHTH board source, mocked here for the same reason
// fix-339 mocked the seventh — these suites deliberately render without a
// QueryClient, and an unmocked query would reach for one.
vi.mock('../hooks/useAutoClosures', () => ({
  useAutoClosures: () => ({ data: [], isLoading: false, error: null }),
}));
// ★ fix-360 mocks the ninth, for the same reason: this suite renders without a
// QueryClient and an unmocked query would reach for one.
// ★ fix-363 mocks the tenth input: the notification's subtitle now names the
// person who assigned the task ("Briana assigned you a task"), which is one
// more query — and these suites render without a QueryClient by design.
vi.mock('../hooks/useTaskProvenance', () => ({
  useTaskAssigners: () => ({ data: [], isLoading: false, error: null }),
  useTaskProvenance: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useMyPostReactions', () => ({
  useMyPostReactions: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/usePostRequests', () => ({
  // ★ fix-339: the SHARED post-request item. Empty here — these suites are
  // about the other sources, and an unmocked query would reach for a
  // QueryClient this harness deliberately does not provide.
  useMyPostRequests: () => ({ data: [], isLoading: false, error: null }),
  useResolvePostRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjectMessages', () => ({
  useMyMentions: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({ data: state.tasks, isLoading: false }),
  useUpsertTask: () => ({
    mutate: state.taskMutate,
    mutateAsync: state.taskMutate,
    isPending: false,
  }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: state.dmRows }),
}));
vi.mock('../hooks/useDaTeamRouting', () => ({
  useDaTeamRouting: () => ({ data: state.entRows }),
}));
vi.mock('../hooks/useConfirmHandoff', () => ({
  useConfirmHandoff: () => ({
    confirm: state.confirmHandoff,
    pendingId: null,
    isPending: false,
  }),
}));
// ★ A REAL store, per user. Writing through the mutation changes what the next
// render reads — which is what makes "the badge decrements" assertable at all.
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [...state.readsFor(state.userId)] }),
  useMarkBoardItemsRead: () => ({
    mutate: (keys: string[]) => {
      const set = state.reads.get(state.userId) ?? new Set<string>();
      for (const k of keys) set.add(k);
      state.reads.set(state.userId, set);
    },
    isPending: false,
  }),
}));
vi.mock('../components/TaskDetailEditor', () => ({
  default: ({ task }: { task: { id: string } }) => (
    <div data-testid="stub-task-detail-editor" data-task={task.id} />
  ),
}));

import MyBoard from '../pages/MyBoard';
import BoardBell from '../components/BoardBell';

const AFTER = '2026-08-20T10:00:00Z';

/** ★ fix-308 (#42/#43): a design task, so the permit genuinely HAS a design
 *  leg. A named DA alone no longer creates one — "if no tasks for design, then
 *  it falls on ENT" — so a fixture that needs a two-leg permit has to supply
 *  the design work that makes it two-leg. */
let dtid = 0;
function designTask(permitId: number): Record<string, unknown> {
  return {
    id: `dt${++dtid}`,
    permit_id: permitId,
    parent_task_id: null,
    project_id: 'p1',
    project_address: 'A St',
    permit_type: 'Building Permit',
    bucket: 'de',
    text: 'Draw the redlines',
    start_date: null,
    target_date: null,
    due_date: null,
    done_at: null,
    sort_order: 0,
    assigned_to: null,
    discipline: 'arch',
    status: 'Open',
  };
}

let pid = 0;
function mkPermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    num: 'BLD-1',
    status: null,
    stage: null,
    stage_override: null,
    da: 'Fisk',
    dm: null,
    ent_lead: 'Miles',
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    parent_permit_id: null,
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
    updated_at: '2026-08-01T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

const mkProject = (id: string, address: string): Project =>
  ({ id, address, juris: 'Seattle', archived: false, notes: null }) as Project;

const mkTask = (over: Record<string, unknown>) => ({
  id: 't1',
  permit_id: 1,
  parent_task_id: null,
  project_id: 'p1',
  project_address: 'A St',
  permit_type: 'Building Permit',
  bucket: 'de',
  text: 'Pick up redlines',
  discipline: 'ent',
  status: 'Open',
  assigned_to: 'Miles',
  due_date: '2026-01-01',
  start_date: null,
  target_date: null,
  done_at: null,
  sort_order: 0,
  primary_assignee: null,
  co_assignees: [],
  created_at: AFTER,
  ...over,
});

function ProjectProbe() {
  const { id } = useParams();
  return <div data-testid="landed-project" data-id={id} />;
}

/** The REAL routes, as in router.tsx. */
function renderIn(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/board']}>
      <Routes>
        <Route path="/board" element={ui} />
        <Route path="/projects" element={<div data-testid="landed-LIST" />} />
        <Route path="/project/:id" element={<ProjectProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pid = 0;
  state.permits = [];
  state.projects = [mkProject('p1', 'A St')];
  state.tasks = [];
  state.members = [];
  state.name = 'Miles';
  state.userId = 'user-miles';
  state.activity = [];
  state.acks = [];
  state.dmRows = [];
  state.entRows = [];
  state.reads.clear();
  state.ackMutate.mockClear();
  state.taskMutate.mockClear();
  state.confirmHandoff.mockClear();
});

const badge = () => screen.queryByTestId('board-bell-badge')?.textContent ?? '0';

// ---------------------------------------------------------------------------
describe('fix-307 #36: the badge counts UNSEEN, not undone', () => {
  it('★ a past-due task that has been read does not count', () => {
    // The old model counted past due + today + blocked and never reached zero.
    state.permits = [mkPermit({})];
    state.tasks = [mkTask({})]; // assigned to Miles, due 2026-01-01 = past due
    const r = renderIn(<BoardBell />);
    expect(badge()).toBe('1');

    // Acknowledge it, then re-render as a fresh page load would.
    fireEvent.click(screen.getByTestId('board-bell-button'));
    fireEvent.click(screen.getByTestId('bell-new-read-task:t1'));
    r.unmount();
    renderIn(<BoardBell />);
    // ★ The observable outcome: the badge decremented.
    expect(badge()).toBe('0');
  });

  it('★ zero does not mean "nothing to do" — the standing counts remain', () => {
    state.permits = [mkPermit({})];
    state.tasks = [mkTask({})];
    state.reads.set('user-miles', new Set(['task:t1']));
    renderIn(<BoardBell />);
    expect(badge()).toBe('0');
    fireEvent.click(screen.getByTestId('board-bell-button'));
    // Still past due, still shown — as context, under its own heading.
    expect(screen.getByTestId('board-bell-standing')).toBeTruthy();
    expect(screen.getByTestId('bell-past-due-value').textContent).toBe('1');
    expect(screen.getByTestId('board-bell-new-empty')).toBeTruthy();
  });

  it('★ Mark all read zeroes the badge', () => {
    state.permits = [mkPermit({})];
    state.tasks = [
      mkTask({ id: 't1' }),
      mkTask({ id: 't2', text: 'Another' }),
      mkTask({ id: 't3', text: 'Third' }),
    ];
    const r = renderIn(<BoardBell />);
    expect(badge()).toBe('3');
    fireEvent.click(screen.getByTestId('board-bell-button'));
    fireEvent.click(screen.getByTestId('board-bell-mark-all-read'));
    r.unmount();
    renderIn(<BoardBell />);
    expect(badge()).toBe('0');
  });

  it('opening the bell does NOT mark anything read on its own', () => {
    // Acknowledgement is a click, per Bobby.
    state.permits = [mkPermit({})];
    state.tasks = [mkTask({})];
    const r = renderIn(<BoardBell />);
    fireEvent.click(screen.getByTestId('board-bell-button'));
    r.unmount();
    renderIn(<BoardBell />);
    expect(badge()).toBe('1');
  });
});

// ---------------------------------------------------------------------------
describe('fix-307 #39/#40: ★★ read is NOT done', () => {
  function boardWithNewTask() {
    state.permits = [mkPermit({})];
    state.tasks = [mkTask({})];
  }

  it('a new row is highlighted on the board', () => {
    boardWithNewTask();
    renderIn(<MyBoard />);
    expect(
      screen.getByTestId('board-forecast-row-t-t1').getAttribute('data-new'),
    ).toBe('true');
    expect(screen.getByTestId('board-row-new-t-t1')).toBeTruthy();
  });

  it('★ clicking it clears the highlight — observed on a second render', () => {
    boardWithNewTask();
    const r = renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId('board-row-open-t-t1'));
    r.unmount();
    renderIn(<MyBoard />);
    expect(
      screen.getByTestId('board-forecast-row-t-t1').getAttribute('data-new'),
    ).toBe('false');
  });

  it('★★ and it STAYS on the board, unresolved', () => {
    // The rule most likely to be got wrong: acknowledging is not starting.
    boardWithNewTask();
    const r = renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId('board-row-open-t-t1'));
    // No task write of any kind.
    expect(state.taskMutate).not.toHaveBeenCalled();
    r.unmount();
    renderIn(<MyBoard />);
    // Still there, still past due.
    expect(screen.getByTestId('board-forecast-row-t-t1')).toBeTruthy();
    expect(screen.getByTestId('board-sec-past-due-total').textContent).toContain('1');
  });

  it('★ ticking a task marks it read — but marking read never ticks', () => {
    boardWithNewTask();
    const r = renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId('board-forecast-check-t-t1'));
    // Ticking DID write the task…
    expect(state.taskMutate).toHaveBeenCalledTimes(1);
    r.unmount();
    renderIn(<MyBoard />);
    // …and marked it read as a side effect.
    expect(
      screen.getByTestId('board-forecast-row-t-t1').getAttribute('data-new'),
    ).toBe('false');
    // The reverse was asserted above: reading wrote no task.
  });
});

// ---------------------------------------------------------------------------
describe('fix-307: ★ reading is per user, and scope-independent', () => {
  it('★ Brittani reading while scoped to Fisk marks it read for HER, not him', () => {
    // A manager glancing at someone's work must not silently clear that
    // person's notifications.
    const shared = mkTask({ id: 'shared-1', assigned_to: 'Fisk', co_assignees: ['Brittani'] });
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [mkPermit({ da: 'Fisk', ent_lead: 'Miles' })];
    state.tasks = [shared];
    state.dmRows = [{ dm_name: 'Brittani', da_name: 'Fisk' }];

    // Brittani reads it.
    state.name = 'Brittani';
    state.userId = 'user-brittani';
    state.members = [{ name: 'Brittani', role: 'dm', is_oversight: false }];
    let r = renderIn(<BoardBell />);
    expect(badge()).toBe('1');
    fireEvent.click(screen.getByTestId('board-bell-button'));
    fireEvent.click(screen.getByTestId('bell-new-read-task:shared-1'));
    r.unmount();
    r = renderIn(<BoardBell />);
    expect(badge()).toBe('0');
    r.unmount();

    // ★ Fisk still has it.
    state.name = 'Fisk';
    state.userId = 'user-fisk';
    state.members = [{ name: 'Fisk', role: 'da', is_oversight: false }];
    renderIn(<BoardBell />);
    expect(badge()).toBe('1');
  });

  it('★ switching the queue scope does not change the badge', () => {
    // The badge is always personal, whatever the queue is showing.
    state.name = 'Brittani';
    state.userId = 'user-brittani';
    state.members = [{ name: 'Brittani', role: 'dm', is_oversight: false }];
    state.dmRows = [
      { dm_name: 'Brittani', da_name: 'Fisk' },
      { dm_name: 'Brittani', da_name: 'Marc' },
    ];
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ da: 'Fisk', ent_lead: 'Miles' }),
      mkPermit({ da: 'Marc', ent_lead: 'Miles' }),
    ];
    state.tasks = [mkTask({ id: 'mine-1', assigned_to: 'Brittani' })];

    render(
      <MemoryRouter initialEntries={['/board']}>
        <Routes>
          <Route
            path="/board"
            element={
              <>
                <BoardBell />
                <MyBoard />
              </>
            }
          />
          <Route path="/project/:id" element={<ProjectProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(badge()).toBe('1');
    fireEvent.click(screen.getByTestId('board-scope-team'));
    expect(badge()).toBe('1');
    fireEvent.change(screen.getByTestId('board-scope-person'), {
      target: { value: 'Fisk' },
    });
    expect(badge()).toBe('1');
  });
});

// ---------------------------------------------------------------------------
describe('fix-307: prior contracts survive', () => {
  it('links still resolve to project/:id', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ da: null, ent_lead: 'Miles', target_submit: '2026-01-01' }),
    ];
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId(/^board-row-open-m-/));
    expect(screen.getByTestId('landed-project').getAttribute('data-id')).toBe('p1');
    expect(screen.queryByTestId('landed-LIST')).toBeNull();
  });

  it('no checkbox on a waiting row, and the board still fits', () => {
    state.projects = [mkProject('p1', 'A St')];
    const wp = mkPermit({ da: 'Fisk', ent_lead: 'Miles', target_submit: '2026-01-01' });
    state.permits = [wp];
    // ★ fix-308: a waiting row needs a design half to be waiting ON.
    state.tasks = [designTask(wp.id)];
    renderIn(<MyBoard />);
    const waiting = screen
      .getAllByTestId(/^board-forecast-row-/)
      .filter((r) => r.getAttribute('data-actionable') === 'false');
    expect(waiting.length).toBeGreaterThan(0);
    expect(screen.queryByTestId(/^board-forecast-check-m-/)).toBeNull();
    // ★ fix-313: fills the shell's bounded <main>, no viewport math.
    expect(screen.getByTestId('my-board').style.height).toBe('100%');
  });

  it('Show All still works', () => {
    state.projects = Array.from({ length: 20 }, (_, i) => mkProject('p' + i, i + ' St'));
    state.permits = Array.from({ length: 20 }, (_, i) =>
      mkPermit({ project_id: 'p' + i, da: null, ent_lead: 'Miles', target_submit: '2026-01-01' }),
    );
    renderIn(<MyBoard />);
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(5);
    fireEvent.click(screen.getByTestId('board-sec-past-due-showall'));
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(20);
  });
});
