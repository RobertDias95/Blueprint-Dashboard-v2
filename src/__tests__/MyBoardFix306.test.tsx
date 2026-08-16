import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams, useSearchParams } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-306 — register #29, #30, #31, #32, #33, #35.
//
// ★ #30/#31/#32 WERE ONE CHARACTER. The router serves `project/:id` (singular);
// the board and the bell linked to `/projects/{uuid}` (plural), which resolves
// to the ProjectList route and ignores the trailing segment. Every link on the
// board and in the bell landed on a list with nothing selected.
//
// ★ AND MY TESTS AGREED WITH THE BUG. fix-303/fix-304 asserted
// getAttribute('href') === '/projects/p1' — the string, never the destination —
// and fix-304's harness went further and MOUNTED a `/projects/:id` route that
// the app does not have, so a navigation assertion passed against a route
// invented by the test. That is the fourth control in this feature that
// rendered and did nothing. The tests below resolve the REAL route.

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
import BoardBell from '../components/BoardBell';

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

/** Stands in for ProjectDetail, reporting which project it received and which
 *  permit the ?permit= deep-link selected. */
function ProjectDetailProbe() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  return (
    <div data-testid="landed-project" data-id={id} data-permit={sp.get('permit') ?? ''} />
  );
}

/** ★ The REAL route table, copied from router.tsx. `projects` (plural) is the
 *  LIST; `project/:id` (singular) is the detail. A link to /projects/{uuid}
 *  falls into the list and the uuid is ignored — which is exactly the bug. */
function renderIn(ui: React.ReactNode, at = '/board') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/board" element={ui} />
        <Route path="/projects" element={<div data-testid="landed-project-LIST" />} />
        <Route path="/project/:id" element={<ProjectDetailProbe />} />
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

function oneMilestonePermit() {
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
}

// ---------------------------------------------------------------------------
describe('fix-306 #30/#31/#32: ★ the links RESOLVE', () => {
  it('★ clicking a forecast row lands on project/:id — not the list', () => {
    oneMilestonePermit();
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId(/^board-row-open-m-/));
    expect(screen.getByTestId('landed-project').getAttribute('data-id')).toBe('p1');
    expect(screen.queryByTestId('landed-project-LIST')).toBeNull();
  });

  it('★ the row click carries ?permit= through, so the permit is selected', () => {
    oneMilestonePermit();
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId(/^board-row-open-m-/));
    expect(screen.getByTestId('landed-project').getAttribute('data-permit')).toBe('1');
  });

  it('★ clicking the address link resolves', () => {
    oneMilestonePermit();
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId(/^board-row-project-m-/));
    expect(screen.getByTestId('landed-project').getAttribute('data-id')).toBe('p1');
  });

  it('★ clicking the permit number resolves, and selects the permit', () => {
    oneMilestonePermit();
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId(/^board-row-permit-m-/));
    const landed = screen.getByTestId('landed-project');
    expect(landed.getAttribute('data-id')).toBe('p1');
    expect(landed.getAttribute('data-permit')).toBe('1');
  });

  it('★ the queue permit link resolves too', () => {
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
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId(/^board-permit-\d+-link$/));
    expect(screen.getByTestId('landed-project').getAttribute('data-id')).toBe('p1');
  });

  it('★ the queue project link resolves', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({
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
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId(/^board-queue-project-/));
    expect(screen.getByTestId('landed-project').getAttribute('data-id')).toBe('p1');
  });

  it('★ a BELL link resolves', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [mkPermit({ id: 10230, da: null, ent_lead: 'Miles' })];
    state.activity = [
      {
        id: 1,
        created_at: '2026-08-14T15:47:20Z',
        action: 'scrape_cycle_change_applied',
        row_id: '10230:cycle:3',
        permit_num: 'X-1',
        permit_type: 'ULS',
        address: 'A St',
        ent_lead: 'Miles',
        project_id: 'p1',
        changes: { applied: { corr_issued: '2026-08-14' } },
      },
    ];
    renderIn(<BoardBell />);
    fireEvent.click(screen.getByTestId('board-bell-button'));
    // fix-307 replaced the flip-only list with the unseen-items list; the
    // link is the same destination under a new testid.
    fireEvent.click(screen.getByTestId(/^bell-new-link-/));
    expect(screen.getByTestId('landed-project').getAttribute('data-id')).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
describe('fix-306 #29: a milestone says what to DO', () => {
  it('★ every milestone row renders an action line', () => {
    oneMilestonePermit();
    renderIn(<MyBoard />);
    const action = screen.getByTestId(/^board-row-action-m-/);
    expect(action.textContent).toBeTruthy();
  });

  it('the action tells a newcomer what happens next, per milestone', () => {
    const cases: Array<[Partial<PermitWithCycles>, RegExp]> = [
      [{ intake_date: '2026-01-01' }, /Upload the set, then attend/],
      [{ target_submit: '2026-01-01' }, /File it/],
      [{ approval_date: '2026-01-01' }, /Pay issuance fees/],
    ];
    for (const [over, want] of cases) {
      pid = 0;
      state.projects = [mkProject('p1', 'A St')];
      state.permits = [mkPermit({ da: null, ent_lead: 'Miles', ...over })];
      const r = renderIn(<MyBoard />);
      const actions = screen
        .getAllByTestId(/^board-row-action-/)
        .map((e) => e.textContent ?? '');
      expect(actions.some((a) => want.test(a))).toBe(true);
      r.unmount();
    }
  });

  it('a WAITING row says who it is with — also an answer to "what do I do"', () => {
    state.projects = [mkProject('p1', 'A St')];
    const wp = mkPermit({ da: 'Fisk', ent_lead: 'Miles', target_submit: '2026-01-01' });
    state.permits = [wp];
    // ★ fix-308: "with Fisk" is only true where Fisk has a design leg.
    state.tasks = [designTask(wp.id)];
    renderIn(<MyBoard />);
    const waiting = screen
      .getAllByTestId(/^board-row-action-/)
      .map((e) => e.textContent ?? '');
    expect(waiting.some((a) => /with Fisk/.test(a))).toBe(true);
  });

  it('★ it stays ONE line — #22 is not undone', () => {
    oneMilestonePermit();
    renderIn(<MyBoard />);
    const action = screen.getByTestId(/^board-row-action-m-/).textContent ?? '';
    expect(action.split('\n')).toHaveLength(1);
    expect(action.length).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
describe('fix-306 #35: the queue scope toggle', () => {
  function brittani() {
    state.name = 'Brittani';
    state.members = [{ name: 'Brittani', role: 'dm', is_oversight: false }];
    state.dmRows = [
      { dm_name: 'Brittani', da_name: 'Fisk' },
      { dm_name: 'Brittani', da_name: 'Marc' },
    ];
    state.projects = [mkProject('p1', 'A St'), mkProject('p2', 'B St')];
    state.permits = [
      // Fisk's — hers only via the team scope.
      mkPermit({
        project_id: 'p1',
        da: 'Fisk',
        ent_lead: 'Miles',
        updated_at: '2026-05-01T12:00:00Z',
        permit_cycles: [
          {
            id: 'c1', permit_id: 1, cycle_index: 1,
            submitted: '2026-04-01', intake_accepted: '2026-04-02',
            city_target: null, corr_issued: null, resubmitted: null,
            created_at: '', updated_at: '',
          },
        ] as never,
      }),
      // Marc's.
      mkPermit({
        project_id: 'p2',
        da: 'Marc',
        ent_lead: 'Miles',
        updated_at: '2026-05-01T12:00:00Z',
        permit_cycles: [
          {
            id: 'c2', permit_id: 2, cycle_index: 1,
            submitted: '2026-04-01', intake_accepted: '2026-04-02',
            city_target: null, corr_issued: null, resubmitted: null,
            created_at: '', updated_at: '',
          },
        ] as never,
      }),
    ];
  }

  it('defaults to My queue — nobody is handed 90 permits on load', () => {
    brittani();
    renderIn(<MyBoard />);
    expect(screen.getByTestId('board-scope-mine').getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Brittani is on neither permit, so her own queue is empty.
    expect(screen.queryAllByTestId(/^board-queue-row-/)).toHaveLength(0);
  });

  it('★ My team fills the queue with her DAs work', () => {
    brittani();
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId('board-scope-team'));
    expect(screen.getAllByTestId(/^board-queue-row-/).length).toBeGreaterThan(1);
  });

  it('★ picking one person narrows it to that person', () => {
    brittani();
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId('board-scope-team'));
    const both = screen.getAllByTestId(/^board-queue-row-/).length;
    fireEvent.change(screen.getByTestId('board-scope-person'), {
      target: { value: 'Fisk' },
    });
    const one = screen.getAllByTestId(/^board-queue-row-/).length;
    expect(one).toBeLessThan(both);
    expect(one).toBe(1);
  });

  it('★★ THE RULE: the toggle does NOT touch the forecast', () => {
    // A manager's day is their own. This is the rule most likely to be got
    // wrong, so it is asserted directly: the forecast rows are byte-identical
    // across all three scopes.
    brittani();
    // Give Brittani something of her own, dated, so the forecast is non-empty.
    const hers = mkPermit({
      project_id: 'p1',
      da: 'Brittani',
      ent_lead: 'Miles',
      target_submit: '2026-01-01',
    });
    state.permits.push(hers);
    // ★ fix-308: Brittani's design leg exists only where design work does.
    state.tasks = [...state.tasks, designTask(hers.id)];
    renderIn(<MyBoard />);
    const forecastNow = () =>
      screen.getAllByTestId(/^board-forecast-row-/).map((r) => r.getAttribute('data-testid'));

    const mine = forecastNow();
    fireEvent.click(screen.getByTestId('board-scope-team'));
    expect(forecastNow()).toEqual(mine);
    fireEvent.change(screen.getByTestId('board-scope-person'), {
      target: { value: 'Fisk' },
    });
    expect(forecastNow()).toEqual(mine);
  });

  it('★ a DA gets no toggle', () => {
    state.name = 'Fisk';
    state.members = [{ name: 'Fisk', role: 'da', is_oversight: false }];
    state.dmRows = [{ dm_name: 'Brittani', da_name: 'Fisk' }];
    renderIn(<MyBoard />);
    expect(screen.queryByTestId('board-queue-scope')).toBeNull();
  });

  it('an entitlement lead gets their DAs from da_team_routing', () => {
    state.name = 'Miles';
    state.members = [{ name: 'Miles', role: 'ent_lead', is_oversight: false }];
    state.entRows = [
      { da: 'Cam', ent_lead: 'Miles' },
      { da: 'Fisk', ent_lead: 'Miles' },
      { da: 'Ahmadi', ent_lead: 'Briana' },
    ];
    renderIn(<MyBoard />);
    const people = Array.from(
      screen.getByTestId('board-scope-person').querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(people).toContain('Cam');
    expect(people).toContain('Fisk');
    expect(people).not.toContain('Ahmadi');
  });

  it('★ the page still does not grow with a team scope selected', () => {
    brittani();
    renderIn(<MyBoard />);
    fireEvent.click(screen.getByTestId('board-scope-team'));
    // ★ fix-313: fills the shell's bounded <main>, no viewport math.
    expect(screen.getByTestId('my-board').style.height).toBe('100%');
  });
});

// ---------------------------------------------------------------------------
describe('fix-306 #33: the queue row scans', () => {
  it('leads with the project, then the permit, state, age and clock', () => {
    state.projects = [mkProject('p1', '233 31st Ave E')];
    state.permits = [
      mkPermit({
        num: 'BLD2026-0319',
        type: 'ULS',
        da: null,
        ent_lead: 'Miles',
        updated_at: '2026-05-01T12:00:00Z',
        permit_cycles: [
          {
            id: 'c1', permit_id: 1, cycle_index: 2,
            submitted: '2026-04-01', intake_accepted: '2026-04-02',
            city_target: '2026-06-01', corr_issued: null, resubmitted: null,
            created_at: '', updated_at: '',
          },
        ] as never,
      }),
    ];
    renderIn(<MyBoard />);
    expect(screen.getByTestId(/^board-queue-project-/).textContent).toContain(
      '233 31st Ave E',
    );
    expect(screen.getByTestId(/^board-permit-\d+-link$/).textContent).toContain(
      'BLD2026-0319',
    );
    expect(screen.getByTestId(/^board-permit-\d+-state$/).textContent).toContain(
      'in review',
    );
    expect(screen.getByTestId(/^board-permit-\d+-target$/).textContent).toContain(
      'target 06-01',
    );
  });

  it('★ a missing target still says so, in the clock column', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({
        da: null,
        ent_lead: 'Miles',
        updated_at: '2026-05-01T12:00:00Z',
        permit_cycles: [
          {
            id: 'c1', permit_id: 1, cycle_index: 1,
            submitted: '2026-04-01', intake_accepted: '2026-04-02',
            city_target: null, corr_issued: null, resubmitted: null,
            created_at: '', updated_at: '',
          },
        ] as never,
      }),
    ];
    renderIn(<MyBoard />);
    expect(screen.getByTestId(/^board-permit-\d+-target$/).textContent).toBe(
      'No target date',
    );
  });
});
