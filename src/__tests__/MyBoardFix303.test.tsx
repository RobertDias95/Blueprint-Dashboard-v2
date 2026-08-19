import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-303 — the Show All button, team sections, the mapping gap, and depth.
//
// Kept separate from MyBoard.test.tsx so the Phase 1/2 contracts and the
// fix-303 additions can be read (and can fail) independently.

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
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: state.activity }),
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
// The real editor is covered by MyTasks' own 58 tests. Here we only need to
// know the board opens THE SAME component rather than growing its own.
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

function renderBoard() {
  return render(
    <MemoryRouter>
      <MyBoard />
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

// ---------------------------------------------------------------------------
describe('fix-303 §1: ★ Show all actually does something', () => {
  function twentyPastDue() {
    state.projects = Array.from({ length: 20 }, (_, i) => mkProject('p' + i, i + ' St'));
    state.permits = Array.from({ length: 20 }, (_, i) =>
      mkPermit({
        project_id: 'p' + i,
        da: null,
        ent_lead: 'Miles',
        target_submit: '2026-01-01',
      }),
    );
  }

  it('★ clicking it expands the section from the cap to the full list', () => {
    // Phase 1 wired onClick to a prop no caller ever passed. The control
    // rendered, looked interactive, and did nothing for two releases.
    twentyPastDue();
    renderBoard();
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(5);
    fireEvent.click(screen.getByTestId('board-sec-past-due-showall'));
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(20);
  });

  it('and clicking again collapses it back', () => {
    twentyPastDue();
    renderBoard();
    const btn = () => screen.getByTestId('board-sec-past-due-showall');
    fireEvent.click(btn());
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(20);
    expect(btn().textContent).toContain('Show less');
    fireEvent.click(btn());
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(5);
    expect(btn().textContent).toContain('Show all (20)');
  });

  it('★ the page still does not grow — the panel scrolls instead', () => {
    twentyPastDue();
    renderBoard();
    fireEvent.click(screen.getByTestId('board-sec-past-due-showall'));
    // The Phase 1 layout contract, re-checked with a section expanded.
    // ★ fix-313: fills the shell's bounded <main>, no viewport math.
    expect(screen.getByTestId('my-board').style.height).toBe('100%');
    expect(screen.getByTestId('my-board-forecast-scroll').className).toContain(
      'overflow-y-auto',
    );
  });

  it('the true total stays visible whether expanded or not', () => {
    twentyPastDue();
    renderBoard();
    expect(screen.getByTestId('board-sec-past-due-total').textContent).toContain('20');
    fireEvent.click(screen.getByTestId('board-sec-past-due-showall'));
    expect(screen.getByTestId('board-sec-past-due-total').textContent).toContain('20');
  });
});

// ---------------------------------------------------------------------------
// fix-306 #35 REPLACED fix-303's fixed per-report sections with a scope toggle
// on the queue — "a holistic view of my whole team's queue, then fine-tune by
// individuals". These tests keep the original INTENT (who can reach whose
// queue, and that a DA reaches nobody's) against the new control.
describe('fix-303 §2 → fix-306 #35: who can reach whose queue', () => {
  it('★ Bobby can reach the whole company, and one person at a time', () => {
    state.name = 'Bobby';
    state.members = [{ name: 'Bobby', role: 'ent_lead', is_oversight: true }];
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ ent_lead: 'Miles', da: 'Fisk' }),
      mkPermit({ ent_lead: 'Briana', da: 'Marc' }),
    ];
    renderBoard();
    expect(screen.getByTestId('board-queue-scope')).toBeTruthy();
    const people = Array.from(
      screen.getByTestId('board-scope-person').querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(people).toContain('Miles');
    expect(people).toContain('Briana');
  });

  it('★ a DA sees no toggle at all', () => {
    state.name = 'Fisk';
    state.members = [{ name: 'Fisk', role: 'da', is_oversight: false }];
    state.dmRows = [{ dm_name: 'Brittani', da_name: 'Fisk' }];
    renderBoard();
    expect(screen.queryByTestId('board-queue-scope')).toBeNull();
  });

  it('a DM can reach their own DAs, and not another manager list', () => {
    state.name = 'Brittani';
    state.members = [{ name: 'Brittani', role: 'dm', is_oversight: false }];
    state.dmRows = [
      { dm_name: 'Brittani', da_name: 'Ahmadi' },
      { dm_name: 'Brittani', da_name: 'Fisk' },
      { dm_name: 'Lindsay', da_name: 'Trevor' },
    ];
    renderBoard();
    const people = Array.from(
      screen.getByTestId('board-scope-person').querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(people).toContain('Ahmadi');
    expect(people).toContain('Fisk');
    expect(people).not.toContain('Trevor');
  });

  it('★ the unassigned-DA gap is still visible, on the toggle', () => {
    state.name = 'Brittani';
    state.members = [
      { name: 'Brittani', role: 'dm', is_oversight: false },
      { name: 'Fisk', role: 'da', active: true, former: false },
      { name: 'Cam', role: 'da', active: true, former: false },
    ];
    state.dmRows = [{ dm_name: 'Brittani', da_name: 'Fisk' }];
    state.projects = [mkProject('p1', 'A St')];
    state.permits = Array.from({ length: 41 }, () => mkPermit({ da: 'Cam' }));
    renderBoard();
    expect(screen.getByTestId('board-scope-gap').textContent).toContain('1');
  });
});

// ---------------------------------------------------------------------------
describe('fix-303 §4: permit rows have real depth', () => {
  const cycle = (over: Record<string, unknown>) => ({
    id: 'c1',
    permit_id: 1,
    cycle_index: 2,
    submitted: '2026-04-01',
    intake_accepted: '2026-04-02',
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    created_at: '',
    updated_at: '',
    ...over,
  });

  it('★ a queue row names the permit, its dates and its target', () => {
    state.projects = [mkProject('p1', '233 31st Ave E')];
    state.permits = [
      mkPermit({
        num: 'BLD2026-0319',
        type: 'ULS',
        da: null,
        ent_lead: 'Miles',
        updated_at: '2026-05-01T12:00:00Z',
        permit_cycles: [cycle({ city_target: '2026-06-01' })] as never,
      }),
    ];
    renderBoard();
    const row = screen.getByTestId(/^board-permit-\d+$/);
    // fix-306 #33 redesigned this line to scan: identity · state+age · clock.
    // The FACTS are unchanged, the prose around them is gone.
    expect(row.textContent).toContain('BLD2026-0319');
    expect(row.textContent).toContain('ULS');
    expect(row.textContent).toContain('cy2');
    expect(row.textContent).toContain('in review');
    expect(row.textContent).toContain('target 06-01');
    // The overdue marker, now a flag rather than the word "passed".
    expect(row.textContent).toContain('⚑');
  });

  it('★ a missing target date says so rather than rendering blank', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({
        da: null,
        ent_lead: 'Miles',
        updated_at: '2026-05-01T12:00:00Z',
        permit_cycles: [cycle({ city_target: null })] as never,
      }),
    ];
    renderBoard();
    expect(screen.getByTestId(/^board-permit-\d+-target$/).textContent).toBe(
      'No target date',
    );
  });
});

// ---------------------------------------------------------------------------
// fix-304 §19 generalised the open affordance from task-only
// (board-task-open-<id>, which fired on NO milestone row) to every row
// (board-row-open-<key>). The behaviour these tests pin is unchanged — a task
// row still opens the shared editor — only the testid moved with the fix.
describe('fix-303 §3: full task functionality', () => {
  it('★ opening a task uses the SAME editor component, not a board copy', () => {
    state.tasks = [mkTask({ id: 'task-1', text: 'Pick up redlines', due_date: '2026-01-01' })];
    renderBoard();
    fireEvent.click(screen.getByTestId('board-row-open-t-task-1'));
    const drawer = screen.getByTestId('board-task-drawer');
    expect(
      within(drawer).getByTestId('stub-task-detail-editor').getAttribute('data-task'),
    ).toBe('task-1');
  });

  it('the drawer does not change the board height contract', () => {
    state.tasks = [mkTask({ id: 'task-1', due_date: '2026-01-01' })];
    renderBoard();
    fireEvent.click(screen.getByTestId('board-row-open-t-task-1'));
    // ★ fix-313: fills the shell's bounded <main>, no viewport math.
    expect(screen.getByTestId('my-board').style.height).toBe('100%');
  });

  it('subtasks nest under their parent, as in My Tasks', () => {
    state.tasks = [
      mkTask({ id: 'parent-1', text: 'Parent task', due_date: '2026-01-01' }),
      mkTask({ id: 'child-1', text: 'Child task', parent_task_id: 'parent-1' }),
    ];
    renderBoard();
    expect(screen.getByTestId('board-subtask-child-1').textContent).toContain(
      'Child task',
    );
  });

  it('a task row links to the project and the permit', () => {
    state.tasks = [mkTask({ id: 'task-1', due_date: '2026-01-01' })];
    renderBoard();
    expect(
      screen.getByTestId('board-row-project-t-task-1').getAttribute('href'),
    ).toBe('/project/p1');
    expect(screen.getByTestId('board-row-permit-t-task-1').getAttribute('href')).toBe(
      '/project/p1?permit=1',
    );
    // ★ fix-313 #62: the third link, to /my-tasks?task=…, is GONE. That route
    // now redirects to /board, so it would have led back to this screen. The
    // task still opens — the row opens the fix-303 editor drawer in place,
    // which is what §19 wanted all along.
    expect(screen.queryByTestId('board-row-mytasks-t-task-1')).toBeNull();
  });
});
