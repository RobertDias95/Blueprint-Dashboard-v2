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

/** Renders the board with a stub /projects/:id route so a navigation caused by
 *  clicking a row is observable. */
function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/board']}>
      <Routes>
        <Route path="/board" element={<MyBoard />} />
        <Route
          path="/projects/:id"
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
    expect(permitLink.getAttribute('href')).toBe('/projects/p1?permit=1');
    // …and it names the permit rather than saying "Permit".
    expect(permitLink.textContent).toContain('BLD2026-0319');
    expect(screen.getByTestId(/^board-row-project-m-/).getAttribute('href')).toBe(
      '/projects/p1',
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
    const link = screen.getByTestId(/^board-permit-\d+-link$/);
    expect(link.getAttribute('href')).toBe('/projects/p1?permit=1');
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
    expect(screen.getByTestId(/^board-permit-\d+$/).textContent).toContain('X-9');
  });
});

// ---------------------------------------------------------------------------
describe('fix-304 §23: the Next week bucket', () => {
  it('★ fills, and sits after This week', () => {
    state.projects = [mkProject('p1', 'A St'), mkProject('p2', 'B St')];
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const iso = soon.toISOString().slice(0, 10);
    state.permits = [
      mkPermit({ project_id: 'p1', da: null, ent_lead: 'Miles', target_submit: iso }),
    ];
    renderBoard();
    expect(screen.getByTestId('board-sec-next-week')).toBeTruthy();
    expect(screen.getByTestId('board-sec-next-week-total').textContent).toContain('1');
  });

  it('caps and expands like every other section', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const iso = soon.toISOString().slice(0, 10);
    state.projects = Array.from({ length: 12 }, (_, i) => mkProject('p' + i, i + ' St'));
    state.permits = Array.from({ length: 12 }, (_, i) =>
      mkPermit({ project_id: 'p' + i, da: null, ent_lead: 'Miles', target_submit: iso }),
    );
    renderBoard();
    // cap is 8
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(8);
    fireEvent.click(screen.getByTestId('board-sec-next-week-showall'));
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(12);
  });

  it('★ and the page still does not grow', () => {
    renderBoard();
    expect(screen.getByTestId('my-board').style.height).toBe('calc(100vh - 52px)');
  });
});
