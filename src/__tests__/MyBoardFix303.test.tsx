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
    expect(screen.getByTestId('my-board').style.height).toBe('calc(100vh - 52px)');
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
describe('fix-303 §2: team sections — a split, never a merge', () => {
  it('★ Bobby sees his OWN queue and Miles and Briana as separate sections', () => {
    state.name = 'Bobby';
    state.members = [{ name: 'Bobby', role: 'ent_lead', is_oversight: true }];
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ ent_lead: 'Miles', da: 'Fisk' }),
      mkPermit({ ent_lead: 'Briana', da: 'Marc' }),
    ];
    renderBoard();
    // His own three groups are still his…
    expect(screen.getByTestId('board-sec-blocked')).toBeTruthy();
    // …and theirs sit alongside, each labelled with whose they are.
    expect(screen.getByTestId('board-team-Miles')).toBeTruthy();
    expect(screen.getByTestId('board-team-Briana')).toBeTruthy();
    expect(screen.getByTestId('board-sec-team-Miles').textContent).toContain('Miles');
  });

  it('★ a DA sees no team section at all', () => {
    state.name = 'Fisk';
    state.members = [{ name: 'Fisk', role: 'da', is_oversight: false }];
    state.dmRows = [{ dm_name: 'Brittani', da_name: 'Fisk' }];
    renderBoard();
    expect(screen.queryByTestId('board-team-wrap')).toBeNull();
  });

  it('a DM sees one section per design associate, and only their own', () => {
    state.name = 'Brittani';
    state.members = [{ name: 'Brittani', role: 'dm', is_oversight: false }];
    state.dmRows = [
      { dm_name: 'Brittani', da_name: 'Ahmadi' },
      { dm_name: 'Brittani', da_name: 'Fisk' },
      { dm_name: 'Lindsay', da_name: 'Trevor' },
    ];
    renderBoard();
    expect(screen.getByTestId('board-team-Ahmadi')).toBeTruthy();
    expect(screen.getByTestId('board-team-Fisk')).toBeTruthy();
    expect(screen.queryByTestId('board-team-Trevor')).toBeNull();
  });

  it('★ the unassigned-DA gap is visible, naming Cam and his load', () => {
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
    const gap = screen.getByTestId('board-gap-unassigned');
    expect(gap.textContent).toContain('Cam');
    expect(gap.textContent).toContain('41');
    // …and it says where to fix it. NOT a link: Settings is a modal with no
    // URL, so a Link would fall through to the dashboard — a dead control, the
    // very thing this ticket opened by complaining about.
    expect(screen.getByTestId('board-gap-fix-hint').textContent).toContain(
      'Settings',
    );
    expect(screen.queryByTestId('board-gap-fix-link')).toBeNull();
  });

  it('former staff still in a group are named too', () => {
    state.name = 'Derry';
    state.members = [
      { name: 'Derry', role: 'dm', is_oversight: false },
      { name: 'Chad', role: 'da', active: false, former: true },
    ];
    state.dmRows = [{ dm_name: 'Derry', da_name: 'Chad' }];
    renderBoard();
    expect(screen.getByTestId('board-gap-former').textContent).toContain('Chad');
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
    expect(row.textContent).toContain('BLD2026-0319');
    expect(row.textContent).toContain('ULS');
    expect(row.textContent).toContain('submitted 2026-04-01');
    expect(row.textContent).toContain('City target 2026-06-01');
    expect(row.textContent).toContain('passed');
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
describe('fix-303 §3: full task functionality', () => {
  it('★ opening a task uses the SAME editor component, not a board copy', () => {
    state.tasks = [mkTask({ id: 'task-1', text: 'Pick up redlines', due_date: '2026-01-01' })];
    renderBoard();
    fireEvent.click(screen.getByTestId('board-task-open-task-1'));
    const drawer = screen.getByTestId('board-task-drawer');
    expect(
      within(drawer).getByTestId('stub-task-detail-editor').getAttribute('data-task'),
    ).toBe('task-1');
  });

  it('the drawer does not change the board height contract', () => {
    state.tasks = [mkTask({ id: 'task-1', due_date: '2026-01-01' })];
    renderBoard();
    fireEvent.click(screen.getByTestId('board-task-open-task-1'));
    expect(screen.getByTestId('my-board').style.height).toBe('calc(100vh - 52px)');
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

  it('a task row links to the project, the permit and My Tasks', () => {
    state.tasks = [mkTask({ id: 'task-1', due_date: '2026-01-01' })];
    renderBoard();
    expect(
      screen.getByTestId('board-row-project-t-task-1').getAttribute('href'),
    ).toBe('/projects/p1');
    expect(screen.getByTestId('board-row-permit-t-task-1').getAttribute('href')).toBe(
      '/projects/p1?permit=1',
    );
    // Clicking through to My Tasks still works and is liked — the point is that
    // you should not HAVE to.
    expect(screen.getByTestId('board-row-mytasks-t-task-1').getAttribute('href')).toBe(
      '/my-tasks?task=task-1',
    );
  });
});
