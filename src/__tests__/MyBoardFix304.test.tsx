import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-304 §19–§23 as rendered — register #19, #20, #21, #22, #23.

const state = vi.hoisted(() => ({
  permits: [] as PermitWithCycles[],
  projects: [] as Project[],
  tasks: [] as unknown[],
  members: [] as unknown[],
  name: 'Miles' as string | null,
  activity: [] as unknown[],
  acks: [] as unknown[],
  dmRows: [] as unknown[],
  entRows: [] as unknown[],
  ackMutate: vi.fn(),
  taskMutate: vi.fn(),
  confirmHandoff: vi.fn(),
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
    userId: 'u1',
    isLoading: false,
  }),
}));
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
// ★ fix-390: the board now also reads permit-scoped holds. Mocked inert here,
// exactly as its project-scoped sibling above is — these suites render the
// board without a QueryClientProvider by design, and an unheld book is the
// state every assertion below was written against.
vi.mock('../hooks/usePermitHolds', () => ({
  useAllPermitHolds: () => ({ data: [] }),
  usePermitHolds: () => ({ data: [] }),
  activeHoldPermitIds: () => new Set<number>(),
  activeHoldByPermitId: () => new Map(),
  activePermitHold: () => null,
  useSetPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
  useLiftPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
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
// ★★ fix-438 mocks the TENTH board source, for the same reason as the eighth
// and the ninth above: this suite renders without a QueryClientProvider, so a
// real react-query hook throws "No QueryClient set" before anything is
// asserted. `useAcknowledgeCondition` is mocked with it because BoardBell
// calls it unconditionally to render the "I know" control.
vi.mock('../hooks/usePermitConditions', () => ({
  usePermitConditions: () => ({ data: [], isLoading: false, error: null }),
  useAcknowledgeCondition: () => ({ mutate: vi.fn(), isPending: false }),
}));
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
// fix-307 added per-user read state. These files predate it and assert other
// contracts, so reads are simply empty here — every item reads as unseen,
// which changes only the highlight, never the rows.
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [] }),
  useMarkBoardItemsRead: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock('../hooks/useConfirmHandoff', () => ({
  useConfirmHandoff: () => ({
    confirm: state.confirmHandoff,
    pendingId: null,
    isPending: false,
  }),
}));
vi.mock('../components/TaskDetailEditor', () => ({
  default: ({ task }: { task: { id: string } }) => (
    <div data-testid="stub-task-detail-editor" data-task={task.id} />
  ),
}));

import MyBoard from '../pages/MyBoard';

let pid = 0;
function mkPermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    num: null,
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
  text: 'A task',
  discipline: 'ent',
  status: 'Open',
  assigned_to: 'Miles',
  due_date: null,
  start_date: null,
  target_date: null,
  done_at: null,
  sort_order: 0,
  primary_assignee: null,
  co_assignees: [],
  ...over,
});

/** Renders the board with the REAL project route mounted, so a navigation
 *  caused by clicking a row is observable AND has to match what the app
 *  actually serves.
 *
 *  ★ fix-306: this harness previously mounted `/projects/:id` — a path the
 *  router does not have. The board linked to the same wrong path, so the test
 *  passed while every real click landed on the project LIST. The test agreed
 *  with the bug instead of catching it. The route below is copied from
 *  router.tsx deliberately. */
function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/board']}>
      <Routes>
        <Route path="/board" element={<MyBoard />} />
        <Route
          path="/project/:id"
          element={<div data-testid="landed-on-project" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pid = 0;
  state.permits = [];
  state.projects = [mkProject('p1', '3626 164th Pl SE')];
  state.tasks = [];
  state.members = [];
  state.name = 'Miles';
  state.activity = [];
  state.acks = [];
  state.dmRows = [];
  state.entRows = [];
  state.ackMutate.mockClear();
  state.taskMutate.mockClear();
  state.confirmHandoff.mockClear();
});

/** A milestone-only board — Bobby's shape, and the one that opened nothing. */
function milestoneOnlyBoard() {
  state.projects = [mkProject('p1', '3626 164th Pl SE')];
  state.permits = [
    mkPermit({
      num: 'BLD2026-0319',
      type: 'ULS',
      da: null,
      ent_lead: 'Miles',
      target_submit: '2026-01-01',
    }),
  ];
  state.tasks = [];
}

// ---------------------------------------------------------------------------
describe('fix-304 §19: ★ every row opens something', () => {
  it('★ a MILESTONE row with no task is clickable and opens the permit', () => {
    // THE defect. Phase 3 wired the drawer to item.task, which is null on
    // every milestone — so on a board made entirely of milestones (Bobby's),
    // nothing on the page opened at all.
    milestoneOnlyBoard();
    renderBoard();
    const open = screen.getByTestId(/^board-row-open-m-/);
    expect(open).toBeTruthy();
    fireEvent.click(open);
    expect(screen.getByTestId('landed-on-project')).toBeTruthy();
  });

  it('the row declares what it will open, before the click', () => {
    milestoneOnlyBoard();
    renderBoard();
    expect(
      screen.getByTestId(/^board-forecast-row-m-/).getAttribute('data-opens'),
    ).toBe('permit');
  });

  it('a TASK row still opens the shared editor drawer', () => {
    state.tasks = [mkTask({ id: 'task-1', due_date: '2026-01-01' })];
    renderBoard();
    expect(
      screen.getByTestId(/^board-forecast-row-t-/).getAttribute('data-opens'),
    ).toBe('task');
    fireEvent.click(screen.getByTestId('board-row-open-t-task-1'));
    expect(screen.getByTestId('stub-task-detail-editor')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('fix-304 §20: the permit is a link, in both panels', () => {
  it('★ the forecast row links to the permit as well as the project', () => {
    milestoneOnlyBoard();
    renderBoard();
    const permitLink = screen.getByTestId(/^board-row-permit-m-/);
    expect(permitLink.getAttribute('href')).toBe('/project/p1?permit=1');
    // …and it names the permit rather than saying "Permit".
    expect(permitLink.textContent).toContain('BLD2026-0319');
    expect(screen.getByTestId(/^board-row-project-m-/).getAttribute('href')).toBe(
      '/project/p1',
    );
  });

  it('★ the queue row links the permit number too', () => {
    state.projects = [mkProject('p1', '233 31st Ave E')];
    state.permits = [
      mkPermit({
        num: 'BLD2026-0319',
        da: null,
        ent_lead: 'Miles',
        updated_at: '2026-05-01T12:00:00Z',
        permit_cycles: [
          {
            id: 'c1',
            permit_id: 1,
            cycle_index: 1,
            submitted: '2026-04-01',
            intake_accepted: '2026-04-02',
            city_target: null,
            corr_issued: null,
            resubmitted: null,
            created_at: '',
            updated_at: '',
          },
        ] as never,
      }),
    ];
    renderBoard();
    // ★ fix-397: same link, now on the queue row itself — and the href it
    // must produce is byte-for-byte the one fix-304 pinned.
    const link = screen.getByTestId(/^board-queue-permit-/);
    expect(link.getAttribute('href')).toBe('/project/p1?permit=1');
    expect(link.textContent).toContain('BLD2026-0319');
  });
});

// ---------------------------------------------------------------------------
describe('fix-304 §21: tasks and milestones are distinguishable', () => {
  it('★ on a real attribute, not just wording', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ da: null, ent_lead: 'Miles', target_submit: '2026-01-01' }),
    ];
    state.tasks = [mkTask({ id: 'task-1', due_date: '2026-01-02' })];
    renderBoard();
    const kinds = screen
      .getAllByTestId(/^board-forecast-row-/)
      .map((r) => r.getAttribute('data-kind'));
    expect(kinds).toContain('task');
    expect(kinds).toContain('milestone');
  });

  it('and carries a visible badge saying which', () => {
    state.tasks = [mkTask({ id: 'task-1', due_date: '2026-01-02' })];
    renderBoard();
    expect(screen.getByTestId('board-row-kind-t-task-1').textContent).toContain('task');
  });

  it('★ they still live in ONE date-ordered list, not two columns', () => {
    // "What do I do Tuesday" does not care which kind it is.
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ da: null, ent_lead: 'Miles', target_submit: '2026-01-01' }),
    ];
    state.tasks = [mkTask({ id: 'task-1', due_date: '2026-01-01' })];
    renderBoard();
    // Both kinds appear inside the SAME past-due section.
    const rows = screen.getAllByTestId(/^board-forecast-row-/);
    expect(rows.length).toBeGreaterThan(1);
    expect(screen.queryByTestId('board-sec-tasks')).toBeNull();
    expect(screen.queryByTestId('board-sec-milestones')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('fix-304 §22: the verbiage is gone', () => {
  it('★ the repeated intake sentence no longer renders', () => {
    // It appeared verbatim on five consecutive rows: noise pretending to help.
    state.projects = Array.from({ length: 5 }, (_, i) => mkProject('p' + i, i + ' St'));
    state.permits = Array.from({ length: 5 }, (_, i) =>
      mkPermit({ project_id: 'p' + i, da: null, ent_lead: 'Miles', intake_date: '2026-01-01' }),
    );
    renderBoard();
    expect(screen.queryByText(/The set must be uploaded first/)).toBeNull();
    expect(screen.queryByText(/Booked\./)).toBeNull();
  });

  it('the queue drops "reviewers moving normally" but keeps the facts', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({
        num: 'X-9',
        da: null,
        ent_lead: 'Miles',
        updated_at: '2026-05-01T12:00:00Z',
        permit_cycles: [
          {
            id: 'c1',
            permit_id: 1,
            cycle_index: 1,
            submitted: '2026-04-01',
            intake_accepted: '2026-04-02',
            city_target: null,
            corr_issued: null,
            resubmitted: null,
            created_at: '',
            updated_at: '',
          },
        ] as never,
      }),
    ];
    renderBoard();
    expect(screen.queryByText(/reviewers moving normally/)).toBeNull();
    // Depth is not verbosity — the facts stay.
    expect(screen.getByTestId(/^board-queue-row-/).textContent).toContain('X-9');
  });
});

// ---------------------------------------------------------------------------
// ★★★ fix-444 §B1 INVERTS THE FIRST TWO PINS HERE, AND THE INVERSION IS THE
// RULING.
//
// fix-304 §23 built this section on Bobby's "maybe even like a next week
// column". Bobby, 2026-08-29, narrowing that himself: *"My Board = short
// snapshot of what needs you now … 'Needs you now' = past due + due within 7
// days. Beyond 7 days lives on My Tasks only."*
//
// ★★ THE THIRD PIN IS UNTOUCHED — the page still must not grow. That one was
//    never about this section, and a narrowing ticket is not licence to sweep
//    a describe block clean.
describe('fix-304 §23 → fix-444 §B1: the Next week bucket leaves the snapshot', () => {
  it('★ a row due in 10 days is in NO forecast section — and is COUNTED', () => {
    state.projects = [mkProject('p1', 'A St'), mkProject('p2', 'B St')];
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const iso = soon.toISOString().slice(0, 10);
    state.permits = [
      mkPermit({ project_id: 'p1', da: null, ent_lead: 'Miles', target_submit: iso }),
    ];
    renderBoard();
    // ★ The section is gone…
    expect(screen.queryByTestId('board-sec-next-week')).toBeNull();
    // ★ …and so is the ROW. Not filtered into a neighbour, not still rendered
    //   under a different header — off the Board entirely.
    expect(screen.queryAllByTestId(/^board-forecast-row-/)).toHaveLength(0);
    // ★★★ THE HALF THAT MAKES IT HONEST. A silent drop and an empty week look
    //     identical, and only one of them is true here.
    expect(
      screen.getByTestId('board-sec-next-week-beyond-count').textContent,
    ).toContain('1');
    expect(
      screen.getByTestId('board-sec-next-week-beyond-link').getAttribute('href'),
    ).toContain('tab=tasks');
  });

  it('★ the count is the TRUE total, uncapped — twelve rows say twelve', () => {
    // ★★ fix-304 capped this section at 8 and offered "Show all". The cap was
    //    a reading aid for a list; there is no list now, so the number must be
    //    the whole truth or it is worse than the section it replaced.
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const iso = soon.toISOString().slice(0, 10);
    state.projects = Array.from({ length: 12 }, (_, i) => mkProject('p' + i, i + ' St'));
    state.permits = Array.from({ length: 12 }, (_, i) =>
      mkPermit({ project_id: 'p' + i, da: null, ent_lead: 'Miles', target_submit: iso }),
    );
    renderBoard();
    expect(screen.queryAllByTestId(/^board-forecast-row-/)).toHaveLength(0);
    expect(screen.queryByTestId('board-sec-next-week-showall')).toBeNull();
    expect(
      screen.getByTestId('board-sec-next-week-beyond-count').textContent,
    ).toContain('12');
  });

  it('★ and says nothing at all when there is nothing out there', () => {
    // A permanent "0 more" line is the decoration this ruling removes.
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [];
    renderBoard();
    expect(screen.queryByTestId('board-sec-next-week-beyond')).toBeNull();
  });

  it('★ and the page still does not grow', () => {
    renderBoard();
    // ★ fix-313: fills the shell's bounded <main>, no viewport math.
    expect(screen.getByTestId('my-board').style.height).toBe('100%');
  });
});


// ===========================================================================
// ★★★ fix-444 §B2 — THE QUEUE PANEL, AND THE ONE LINE OF THE BRIEF THE
//     MEASUREMENT RE-RULED.
// ===========================================================================
//
// These live in fix-304's file because they need fix-304's harness — the same
// twenty-odd inert hook mocks this board has needed since fix-318's one-query
// rule. A second copy of that harness is the partial-mock trap, not hygiene.
describe('fix-444 §B2: the queue keeps what needs you, drops what does not', () => {
  it('★ a submittal due in 20 days leaves the queue as a count and a link', () => {
    const far = new Date();
    far.setDate(far.getDate() + 20);
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({
        project_id: 'p1',
        da: null,
        ent_lead: 'Miles',
        target_submit: far.toISOString().slice(0, 10),
      }),
    ];
    renderBoard();
    expect(screen.queryByTestId('board-queue-band-later')).toBeNull();
    expect(screen.queryAllByTestId(/^board-queue-row-/)).toHaveLength(0);
    expect(
      screen.getByTestId('board-queue-beyond-count').textContent,
    ).toContain('1');
    expect(
      screen.getByTestId('board-queue-beyond-link').getAttribute('href'),
    ).toContain('tab=tasks');
  });

  it('★★★ but an UNDATED corrections row STAYS, under its own header', () => {
    // ★★★ THIS IS THE DEVIATION, PINNED. The brief asked for `later` AND
    //     `no_date` to collapse. Measured on prod first: all 33 live
    //     corrections rows sit in `no_date`, because fix-397's resolver puts
    //     them there ON PURPOSE — no date exists that anyone promised. They
    //     are the work we owe the city today. Collapsing them would empty the
    //     snapshot of exactly what it is for, and ruling 3 in the same brief
    //     keeps `No target date` as a banded header everywhere.
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({
        project_id: 'p1',
        da: null,
        ent_lead: 'Miles',
        target_submit: null,
        permit_cycles: [
          {
            id: 'c1',
            permit_id: 1,
            cycle_index: 1,
            submitted: '2026-04-01',
            intake_accepted: '2026-04-02',
            city_target: null,
            corr_issued: null,
            resubmitted: null,
            created_at: '',
            updated_at: '',
          },
        ] as never,
      }),
    ];
    renderBoard();
    expect(screen.getByTestId('board-queue-band-no_date')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^board-queue-row-/).length).toBeGreaterThan(0);
    // ★ …and the collapse line does not claim it took anything.
    expect(screen.queryByTestId('board-queue-beyond')).toBeNull();
  });

  it('★ the four dated snapshot bands are untouched', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({
        project_id: 'p1',
        da: null,
        ent_lead: 'Miles',
        target_submit: soon.toISOString().slice(0, 10),
      }),
    ];
    renderBoard();
    expect(screen.getByTestId('board-queue-band-this_week')).toBeInTheDocument();
    expect(screen.queryByTestId('board-queue-beyond')).toBeNull();
  });
});
