import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-305 (register #24) as rendered — the Concord case on the actual board.

const state = vi.hoisted(() => ({
  permits: [] as PermitWithCycles[],
  projects: [] as Project[],
  tasks: [] as unknown[],
  members: [] as unknown[],
  name: 'Briana' as string | null,
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
    ent_lead: 'Briana',
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
    updated_at: '2026-08-10T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

const mkProject = (id: string, address: string): Project =>
  ({ id, address, juris: 'Seattle', archived: false, notes: null }) as Project;

function ProjectProbe() {
  const { id } = useParams();
  return <div data-testid="landed-project" data-id={id} />;
}

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/board']}>
      <Routes>
        <Route path="/board" element={<MyBoard />} />
        <Route path="/projects" element={<div data-testid="landed-LIST" />} />
        <Route path="/project/:id" element={<ProjectProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The real Concord Building Permit: submitted 12 May, Ready for Intake,
 *  scraped 10 August. Its age depends on today, so the days assertion below is
 *  relative rather than pinned to 94. */
function concord() {
  state.projects = [mkProject('p1', '4000 SW Concord St')];
  state.permits = [
    mkPermit({
      num: '7138853-CN',
      status: 'Ready for Intake',
      ent_lead: 'Briana',
      da: 'Fisk',
      updated_at: '2026-08-10T12:00:00Z',
      permit_cycles: [
        {
          id: 'c1',
          permit_id: 1,
          cycle_index: 1,
          submitted: '2026-05-12',
          intake_accepted: null,
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          created_at: '',
          updated_at: '',
        },
      ] as never,
    }),
  ];
}

beforeEach(() => {
  pid = 0;
  state.permits = [];
  state.projects = [mkProject('p1', 'A St')];
  state.tasks = [];
  state.members = [];
  state.name = 'Briana';
  state.activity = [];
  state.acks = [];
  state.dmRows = [];
  state.entRows = [];
  state.ackMutate.mockClear();
  state.taskMutate.mockClear();
  state.confirmHandoff.mockClear();
});

describe('fix-305: ★★ Concord on the actual board', () => {
  it('★ the Building Permit appears, marked Urgent, ranked by days in state', () => {
    concord();
    renderBoard();
    const row = screen.getByTestId(/^board-aged-\d+$/);
    expect(row.getAttribute('data-level')).toBe('priority');
    expect(Number(row.getAttribute('data-days'))).toBeGreaterThan(90);
    expect(row.textContent).toContain('4000 SW Concord St');
    expect(row.textContent).toContain('7138853-CN');
    expect(row.textContent).toContain('Urgent');
    expect(row.textContent).toContain('Intake booked and attended');
  });

  it('★ its link resolves to the permit', () => {
    concord();
    renderBoard();
    fireEvent.click(screen.getByTestId(/^board-aged-\d+-link$/));
    expect(screen.getByTestId('landed-project').getAttribute('data-id')).toBe('p1');
    expect(screen.queryByTestId('landed-LIST')).toBeNull();
  });

  it('★ and offers NO chase task, because its clock started before deploy', () => {
    concord();
    renderBoard();
    expect(screen.queryByTestId(/^board-aged-\d+-chase$/)).toBeNull();
    expect(state.taskMutate).not.toHaveBeenCalled();
  });

  it('★ on day one NOTHING offers a chase task — every clock predates deploy', () => {
    // Not a conditional assertion: on the day this ships no anchor can be both
    // after the epoch AND seven days old, so the correct board-wide state is
    // zero chase buttons. The post-deploy case needs an injected clock and is
    // covered in boardAging.test.ts, where `today` can be moved forward.
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ approval_date: '2026-01-01', ent_lead: 'Briana' }),
      mkPermit({ approval_date: '2026-06-01', ent_lead: 'Briana' }),
    ];
    renderBoard();
    expect(screen.getAllByTestId(/^board-aged-\d+$/).length).toBe(2);
    expect(screen.queryAllByTestId(/^board-aged-\d+-chase$/)).toHaveLength(0);
    expect(state.taskMutate).not.toHaveBeenCalled();
  });
});

describe('fix-305: the data-gap group is visible', () => {
  it('★ a permit with no anchor is surfaced, not omitted', () => {
    state.projects = [mkProject('p1', '4000 SW Concord St')];
    state.permits = [
      mkPermit({
        num: '3044084-LU',
        type: 'ULS',
        status: 'Additional Info Requested',
        ent_lead: 'Briana',
        permit_cycles: [] as never,
      }),
    ];
    renderBoard();
    const gap = screen.getByTestId(/^board-gap-\d+$/);
    expect(gap.textContent).toContain('3044084-LU');
    expect(gap.textContent).toContain('no submitted date');
    // …and it is NOT given an invented age.
    expect(screen.queryByTestId(/^board-aged-\d+$/)).toBeNull();
  });
});

describe('fix-305: prior contracts survive', () => {
  it('the board still fits, and Show All still works on the aging section', () => {
    state.projects = Array.from({ length: 12 }, (_, i) => mkProject('p' + i, i + ' St'));
    state.permits = Array.from({ length: 12 }, (_, i) =>
      mkPermit({ project_id: 'p' + i, ent_lead: 'Briana', approval_date: '2026-01-01' }),
    );
    renderBoard();
    // ★ fix-313: fills the shell's bounded <main>, no viewport math.
    expect(screen.getByTestId('my-board').style.height).toBe('100%');
    expect(screen.getAllByTestId(/^board-aged-\d+$/)).toHaveLength(5);
    fireEvent.click(screen.getByTestId('board-sec-aging-showall'));
    expect(screen.getAllByTestId(/^board-aged-\d+$/)).toHaveLength(12);
  });

  it('no checkbox on a waiting row', () => {
    state.projects = [mkProject('p1', 'A St')];
    const wp = mkPermit({ da: 'Fisk', ent_lead: 'Briana', target_submit: '2026-01-01' });
    state.permits = [wp];
    // ★ fix-308: a waiting row needs a design half to be waiting ON.
    state.tasks = [designTask(wp.id)];
    renderBoard();
    const waiting = screen
      .queryAllByTestId(/^board-forecast-row-/)
      .filter((r) => r.getAttribute('data-actionable') === 'false');
    expect(waiting.length).toBeGreaterThan(0);
    expect(screen.queryByTestId(/^board-forecast-check-m-/)).toBeNull();
  });
});
