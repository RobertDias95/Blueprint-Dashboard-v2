import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { resetShowHeldWorkCache } from '../lib/heldWorkPref';
import { resetShowCoAssignedCache } from '../lib/coAssignedPref';
import type { MyTaskNode, TeamMember } from '../lib/database.types';

// fix-80: My Tasks v1-layout — three-pane kanban (D&E | Permitting | Task
// Detail) with Not Started / In Progress sub-columns per bucket, top counters,
// and a v1 filter row. fix-79 adds the lifecycle bucket (de/pm) on the wire;
// until that lands MyTaskNode doesn't carry it in the typed shape, so fixtures
// here declare bucket inline. The page reads it defensively (bucket ?? 'de').

type TaskFixture = MyTaskNode & { bucket?: 'de' | 'pm' };

const allTasksSpy = vi.hoisted(() => vi.fn());
const upsertMutate = vi.hoisted(() => vi.fn());
const setAssigneesMutate = vi.hoisted(() => vi.fn());
const teamRef = vi.hoisted(() => ({
  current: [] as TeamMember[],
}));
const tasksRef = vi.hoisted(() => ({ current: [] as TaskFixture[] }));

// ★ fix-409: My Tasks reads permit-scoped holds now, the way My Board has
// since fix-390. Mocked inert — an unheld book is the state every assertion in
// this file was written against, and a real query here would reach the network.
vi.mock('../hooks/usePermitHolds', () => ({
  useAllPermitHolds: () => ({ data: [] }),
  usePermitHolds: () => ({ data: [] }),
  activeHoldPermitIds: () => new Set<number>(),
  activeHoldByPermitId: () => new Map(),
  activePermitHold: () => null,
  useSetPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
  useLiftPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTeamMembers', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual, // keep the real activeMemberNamesOf helper (fix-233)
    useTeamMembers: () => ({
      all: teamRef.current,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

// fix-179: useScopeMode now consults useProjects (assignment-driven scope). The
// My tab doesn't use the project/permit distinction, so an empty list is fine —
// mock it inert so no network call fires from the scope hook.
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

// fix-294: the task-detail Notes box is now the permit's NotesPanel, so its
// data hooks have to be inert here. addNoteMutate lets a test assert the box
// writes to the PERMIT rather than to permit_tasks.notes.
const addNoteMutate = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: addNoteMutate, isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));

// fix-228: the detail editor reads permits (ent_lead) + projects (schematic)
// to resolve the PRIMARY owner. fix-238b: the Everyone-view role/person filter
// now resolves ownership the SAME way (useTaskOwnership → permits.ent_lead/da),
// so ref-back the mock — role-filter tests set permit context; the default []
// keeps every other test's ownership derived purely from permit_da / literal
// assigned_to (no permit needed).
const permitsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: permitsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useTaskTree', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useTaskTree')>();
  return {
    ...actual, // keep resolveUserName
    useAllTasks: () => {
      allTasksSpy();
      return {
        data: tasksRef.current,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      };
    },
    useUpsertTask: () => ({
      mutate: upsertMutate,
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }),
    // fix-224: assignment goes through the join-table RPC.
    useSetTaskAssignees: () => ({ mutate: setAssigneesMutate }),
  };
});

// fix-224: the detail editor resolves co-assignee role tokens via dm_da_groups.
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: [{ da_name: 'Trevor', dm_name: 'Lindsay' }] }),
}));

// fix-140: the Waiting On view (mounted when ?view=waiting-on) reads
// bp_list_waiting_on_tasks via useWaitingOnTasks. This suite runs under fake
// timers; mock the hook to return synchronous inert data so the view renders
// its empty state with no async query firing under fake timers (which could
// otherwise leak a post-test state update). groupByDisciplineThenFirm stays
// real. WaitingOnView's own behavior is covered in WaitingOnView.test.tsx.
vi.mock('../hooks/useWaitingOnTasks', async (importActual) => {
  const actual =
    await importActual<typeof import('../hooks/useWaitingOnTasks')>();
  return {
    ...actual,
    useWaitingOnTasks: () => ({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

// fix-264: the board drops tasks belonging to a CANCELLED project. Partial mock
// so the real cancelledProjectIds runs over a settable holds list.
const holdsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({
      data: holdsRef.current,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

import MyTasks from '../pages/MyTasks';

/** An OPEN project_holds row of either kind. */
function openHold(projectId: string, kind: 'hold' | 'cancelled') {
  return {
    id: `h-${projectId}`,
    project_id: projectId,
    kind,
    reason: 'because',
    note: null,
    hold_start: '2026-05-01',
    hold_end: null,
  };
}

function member(over: Partial<TeamMember> & Pick<TeamMember, 'name' | 'role'>): TeamMember {
  return {
    id: `m-${over.name}-${over.role}`,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-01-01T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

function task(over: Partial<TaskFixture> & Pick<TaskFixture, 'id'>): TaskFixture {
  return {
    permit_id: 1,
    project_id: 'p1',
    project_address: '123 Main St',
    permit_type: 'Building Permit',
    parent_task_id: null,
    discipline: 'arch',
    text: 'Task text',
    status: 'Open',
    start_date: null,
    target_date: null,
    done_at: null,
    sort_order: 0,
    primary_assignee: null,
    co_assignees: [],
    bucket: 'de',
    ...over,
  };
}

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<MyTasks />, { wrapper });
}

// fix-229: the primary shows ONCE in the select's selected option (e.g.
// "Design Associate · Trevor") — no separate resolved-person chip.
function primaryDetailText(): string {
  const s = screen.getByTestId('task-detail-primary-select') as HTMLSelectElement;
  return s.selectedOptions[0]?.textContent ?? '';
}

/** Stable "today" for overdue math — picked to make 2026-05-20 in the past
 *  and 2026-06-15 in the future regardless of CI clock drift. The page reads
 *  today from new Date() so we anchor a fixed Date.now() in beforeEach. */
const TODAY = '2026-06-01';

beforeEach(() => {
  allTasksSpy.mockReset();
  upsertMutate.mockReset();
  // Anchor "today" for overdue math.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  teamRef.current = [
    member({ name: 'Bobby', role: 'ent_lead' }),
    member({ name: 'Edmund', role: 'ent' }),
    member({ name: 'Trevor', role: 'da' }),
    member({ name: 'Ainsley', role: 'da' }),
    member({ name: 'Miles', role: 'dm' }),
  ];
  tasksRef.current = [];
  permitsRef.current = [];
  holdsRef.current = [];
  useAuthStore.setState({
    // ★ fix-409: an `id` as well as an email. fix-403's per-user filter memory
    //   keys on `user.id`, and this fixture had never needed one — which is
    //   how the "Show held work" switch first appeared to do nothing here.
    user: { id: 'u-bobby', email: 'bobby@x.com' } as never,
    activeTenantId: 'test-tenant',
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
  // ★ ...and the module cache behind the switch, which sessionStorage.clear()
  //   cannot reach. See lib/heldWorkPref.resetShowHeldWorkCache.
  resetShowHeldWorkCache();
  // ★ fix-445: same module-cache trap, same seam — see lib/coAssignedPref.
  resetShowCoAssignedCache();
});

/** Varied fixture for counter / partition / filter / detail tests. Mix of:
 *  - both buckets (de/pm)
 *  - both disciplines (arch/ent)
 *  - all three statuses
 *  - overdue, on-target, no-target dates
 *  - two projects
 *  - rostered + co-assigned co-consultants */
function varied(): TaskFixture[] {
  return [
    task({
      id: 'de-open-overdue',
      bucket: 'de',
      project_id: 'p1',
      project_address: '123 Main St',
      permit_id: 1,
      permit_type: 'Building Permit',
      discipline: 'arch',
      status: 'Open',
      text: 'Submit drawings to SDCI',
      primary_assignee: 'Trevor',
      target_date: '2026-05-15', // in the past
    }),
    task({
      id: 'de-inprog',
      bucket: 'de',
      project_id: 'p1',
      project_address: '123 Main St',
      permit_id: 1,
      permit_type: 'Building Permit',
      discipline: 'ent',
      status: 'In Progress',
      text: 'Address ECA corrections',
      primary_assignee: 'Bobby',
      target_date: '2026-06-30', // future
    }),
    task({
      id: 'pm-open',
      bucket: 'pm',
      project_id: 'p2',
      project_address: '500 Pike St',
      permit_id: 2,
      permit_type: 'PAR/Pre-Sub',
      discipline: 'arch',
      status: 'Open',
      text: 'Pull steep-slope study',
      primary_assignee: 'Ainsley',
      target_date: null,
    }),
    task({
      id: 'pm-inprog',
      bucket: 'pm',
      project_id: 'p2',
      project_address: '500 Pike St',
      permit_id: 2,
      permit_type: 'PAR/Pre-Sub',
      discipline: 'ent',
      status: 'In Progress',
      text: 'Update site plan',
      primary_assignee: 'Edmund',
      co_assignees: ['Outside Consult LLC'], // not rostered → consultant family
      target_date: '2026-06-10',
    }),
    task({
      id: 'pm-resolved-past',
      bucket: 'pm',
      project_id: 'p2',
      project_address: '500 Pike St',
      permit_id: 2,
      permit_type: 'PAR/Pre-Sub',
      discipline: 'ent',
      status: 'Resolved',
      text: 'Submit MUP application',
      primary_assignee: 'Miles',
      target_date: '2026-05-01', // past but Resolved → NOT overdue
    }),
  ];
}

/** fix-238b: the permits behind varied() — permit 1 (Building Permit) → DA
 *  Trevor / ent lead Bobby; permit 2 (PAR/Pre-Sub) → DA Ainsley / ent lead
 *  Edmund. The role/person filter resolves an unset-assigned task's owner from
 *  these, exactly as My Work does. Cast loose: useTaskOwnership reads only
 *  id/da/dm/ent_lead. */
const VARIED_PERMITS: unknown[] = [
  { id: 1, da: 'Trevor', dm: null, ent_lead: 'Bobby' },
  { id: 2, da: 'Ainsley', dm: null, ent_lead: 'Edmund' },
];

// fix-264: cancelled projects fall off the board. fix-262's server sweep already
// parked their Open/In-Progress tasks, but it deliberately leaves RESOLVED tasks
// alone — so without a project-level filter a cancelled project still showed a
// card under "show resolved" and still counted in the "Projects" tile.
// ★★★ fix-445 §B1: the four role dropdowns now live inside the "People ▾"
// panel. Their TEST IDS ARE UNCHANGED (§B3) — only their parent moved — so
// every assertion below still reads the same control; it just has to open the
// drawer first, exactly as a person now does.
function openPeople() {
  const btn = screen.getByTestId('mytasks-filter-people-button');
  if (btn.getAttribute('aria-expanded') !== 'true') fireEvent.click(btn);
}

describe('MyTasks — cancelled projects (fix-264)', () => {
  it('drops every card from a cancelled project, resolved ones included', () => {
    tasksRef.current = varied();
    holdsRef.current = [openHold('p2', 'cancelled')];
    renderIt();
    // Reveal Resolved — the cancelled project's resolved task must stay gone.
    fireEvent.click(screen.getByTestId('mytasks-filter-active'));

    expect(screen.queryByTestId('mytask-card-pm-open')).toBeNull();
    expect(screen.queryByTestId('mytask-card-pm-inprog')).toBeNull();
    expect(screen.queryByTestId('mytask-card-pm-resolved-past')).toBeNull();
    // p1's cards untouched.
    expect(screen.getByTestId('mytask-card-de-open-overdue')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-card-de-inprog')).toBeInTheDocument();
  });

  it('counters are computed from the filtered set, not the raw one', () => {
    tasksRef.current = varied();
    holdsRef.current = [openHold('p2', 'cancelled')];
    renderIt();
    // Only p1's two tasks survive: both open, one overdue, one project, none
    // resolved. Compare against the un-cancelled baseline of 4/1/2 and 1/5 · 20%.
    expect(screen.getByTestId('mytasks-counter-open-value').textContent).toBe('2');
    expect(screen.getByTestId('mytasks-counter-overdue-value').textContent).toBe('1');
    expect(screen.getByTestId('mytasks-counter-projects-value').textContent).toBe('1');
    expect(screen.getByTestId('mytasks-counter-done-text').textContent).toBe('0/2 · 0%');
  });

  // =========================================================================
  // ★★★ SUPERSEDED BY fix-409 — AND NOT MISTAKEN
  // =========================================================================
  //
  // This test used to read *"a HELD project keeps every card and stays in the
  // counters"*, and it was RIGHT for fix-264: that ticket's whole point was
  // that HOLD and CANCEL are different, and it proved it by showing that a
  // cancelled project's cards vanish while a held project's do not.
  //
  // fix-409 is Bobby changing the default, not the distinction:
  //
  //   "the default is you show all active projects/permits. anything with a
  //    hold gets auto turned off, but you can switch that on/off in the my
  //    tasks/my boards."  — register P-039, 2026-08-25
  //
  // ★★ SO THE PROPERTY fix-264 WAS PROTECTING IS ASSERTED HERE, UNCHANGED, one
  // switch-flip away: turn held work on and the numbers are byte-identical to
  // the no-holds baseline again. A held project's work still EXISTS — which is
  // the thing a cancelled project's does not. The two states are still two
  // states; only which one you see by default has moved.
  it('a HELD project is hidden BY DEFAULT (fix-409), and comes back on', () => {
    tasksRef.current = varied();
    holdsRef.current = [openHold('p1', 'hold'), openHold('p2', 'hold')];
    renderIt();

    // ★ Default: held work is off, so nothing from either project renders...
    expect(screen.queryByTestId('mytask-card-de-open-overdue')).toBeNull();
    expect(screen.queryByTestId('mytask-card-pm-open')).toBeNull();
    // ★★ ...AND THE COUNTERS AGREE WITH THAT. The brief's hard requirement:
    //    a header reading 4 over an empty board is the fix-264 defect again.
    expect(screen.getByTestId('mytasks-counter-open-value').textContent).toBe('0');
    expect(screen.getByTestId('mytasks-counter-projects-value').textContent).toBe('0');

    // ★★★ Flip the switch — fix-264's assertion, intact.
    fireEvent.click(screen.getByTestId('mytasks-filter-held'));
    expect(screen.getByTestId('mytask-card-de-open-overdue')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-card-pm-open')).toBeInTheDocument();
    // Byte-identical to the no-holds baseline.
    expect(screen.getByTestId('mytasks-counter-open-value').textContent).toBe('4');
    expect(screen.getByTestId('mytasks-counter-projects-value').textContent).toBe('2');
    expect(screen.getByTestId('mytasks-counter-done-text').textContent).toBe('1/5 · 20%');
  });

  it('★★ a held card carries the On Hold chip once it is shown', () => {
    tasksRef.current = varied();
    holdsRef.current = [openHold('p1', 'hold'), openHold('p2', 'hold')];
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-filter-held'));
    // ★ The chip is the answer to "why is this stale?" — without it a person
    //   who switched held work on is looking at rows they cannot explain.
    const chip = screen.getByTestId('mytask-card-de-open-overdue-hold');
    expect(chip.textContent).toContain('On Hold');
    // ★ Compact: the REASON lives in the tooltip, not in the row.
    expect(chip.textContent).not.toContain('because');
    expect(chip.getAttribute('title')).toContain('because');
  });

  it('★★★ CANCEL is still not HOLD — a cancelled project is gone, switch or no switch', () => {
    // fix-262/264's distinction, re-asserted against the new control: the
    // switch reveals PAUSED work, never work on a project somebody ended.
    tasksRef.current = varied();
    holdsRef.current = [openHold('p2', 'cancelled')];
    renderIt();
    expect(screen.queryByTestId('mytask-card-pm-open')).toBeNull();
    fireEvent.click(screen.getByTestId('mytasks-filter-held'));
    expect(screen.queryByTestId('mytask-card-pm-open')).toBeNull();
    // ...and p1, which is neither held nor cancelled, was never affected.
    expect(screen.getByTestId('mytask-card-de-open-overdue')).toBeInTheDocument();
  });
});

describe('MyTasks (fix-80 v1 three-pane kanban)', () => {
  it('counters reflect the FULL filtered set (Active Only hides Resolved cards but the % still counts them)', () => {
    tasksRef.current = varied();
    renderIt();
    // 4 not-resolved tasks; 1 overdue (de-open-overdue: 2026-05-15 < 2026-06-01,
    // status='Open'); 2 distinct projects; 5 total, 1 resolved → 20%.
    expect(
      screen.getByTestId('mytasks-counter-open-value').textContent,
    ).toBe('4');
    expect(
      screen.getByTestId('mytasks-counter-overdue-value').textContent,
    ).toBe('1');
    expect(
      screen.getByTestId('mytasks-counter-projects-value').textContent,
    ).toBe('2');
    expect(screen.getByTestId('mytasks-counter-done-text').textContent).toBe(
      '1/5 · 20%',
    );
  });

  it('D&E and Permitting columns partition by bucket; Not Started/In Progress partition by status', () => {
    tasksRef.current = varied();
    renderIt();
    const de = screen.getByTestId('mytasks-bucket-de');
    const pm = screen.getByTestId('mytasks-bucket-pm');
    expect(de.querySelector('[data-testid="mytask-card-de-open-overdue"]')).toBeTruthy();
    expect(de.querySelector('[data-testid="mytask-card-de-inprog"]')).toBeTruthy();
    expect(de.querySelector('[data-testid="mytask-card-pm-open"]')).toBeNull();
    expect(pm.querySelector('[data-testid="mytask-card-pm-open"]')).toBeTruthy();
    expect(pm.querySelector('[data-testid="mytask-card-pm-inprog"]')).toBeTruthy();
    // Sub-column split by status.
    const deNotStarted = screen.getByTestId('mytasks-bucket-de-sub-not-started');
    const deInProgress = screen.getByTestId('mytasks-bucket-de-sub-in-progress');
    expect(deNotStarted.querySelector('[data-testid="mytask-card-de-open-overdue"]')).toBeTruthy();
    expect(deInProgress.querySelector('[data-testid="mytask-card-de-inprog"]')).toBeTruthy();
    // Sub-column counts.
    expect(
      screen.getByTestId('mytasks-bucket-de-sub-not-started-count').textContent,
    ).toBe('1');
    expect(
      screen.getByTestId('mytasks-bucket-de-sub-in-progress-count').textContent,
    ).toBe('1');
    // Open count on the bucket header.
    expect(
      screen.getByTestId('mytasks-bucket-de-open-count').textContent,
    ).toBe('2 open');
  });

  it('Active Only default hides Resolved; toggling OFF reveals the Resolved sub-column', () => {
    tasksRef.current = varied();
    renderIt();
    // Resolved hidden by default — no Resolved sub-column rendered.
    expect(
      screen.queryByTestId('mytasks-bucket-pm-sub-resolved'),
    ).toBeNull();
    expect(screen.queryByTestId('mytask-card-pm-resolved-past')).toBeNull();
    // Toggle OFF Active Only.
    fireEvent.click(screen.getByTestId('mytasks-filter-active'));
    expect(screen.getByTestId('mytasks-bucket-pm-sub-resolved')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-card-pm-resolved-past')).toBeInTheDocument();
  });

  it('empty state copy: "Select a task to view details." renders when no card is clicked', () => {
    tasksRef.current = varied();
    renderIt();
    const empty = screen.getByTestId('mytasks-detail-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/Select a task to view details/);
  });

  it('clicking a card populates the Task Detail pane with the task\'s details (v1-restored 9 fields)', () => {
    tasksRef.current = varied();
    renderIt();
    expect(screen.getByTestId('mytasks-detail-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mytask-card-de-inprog'));
    expect(screen.queryByTestId('mytasks-detail-empty')).toBeNull();
    const detail = screen.getByTestId('mytasks-detail');
    expect(
      detail.querySelector('[data-testid="mytasks-detail-text"]')?.textContent,
    ).toBe('Address ECA corrections');
    expect(
      screen.getByTestId('mytasks-detail-discipline').textContent,
    ).toMatch(/entitlements/i);
    expect(
      screen.getByTestId('mytasks-detail-bucket').textContent,
    ).toMatch(/D&E/);
    // fix-138-c: all 9 v1 field controls are rendered.
    expect(screen.getByTestId('task-detail-project')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-permit')).toBeInTheDocument();
    // fix-224: the single-owner "Assigned To" select is retired; assignment is
    // now the co-assignee editor (join table).
    expect(screen.queryByTestId('task-detail-assigned')).toBeNull();
    expect(screen.getByTestId('task-detail-co-assignees')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-waiting-on')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-priority')).toBeInTheDocument();
    // fix-229: dates use the shared TaskDateField — the always-present wrapper
    // is `<testId>-field` (an empty date shows a muted "—" until clicked).
    expect(screen.getByTestId('task-detail-start-field')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-target-field')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-completed-field')).toBeInTheDocument();
    // fix-294: field 9 is no longer a private task-notes textarea. It is the
    // PERMIT's notes panel — the same one Project Overview and the permit
    // detail mount — so a note typed here is visible to everybody.
    expect(screen.getByTestId('task-detail-permit-notes')).toBeInTheDocument();
    expect(screen.getByTestId('notes-panel')).toBeInTheDocument();
    expect(
      screen.getByTestId('task-detail-open-project'),
    ).toBeInTheDocument();
  });

  // fix-219: the LIVE My Tasks detail panel's "Open in Project View" must deep-
  // link to the task's PERMIT (?permit=<permit_id>), not the project top. fix-217/
  // 218 only hardened the unused TaskDetailPanel component, so the param never
  // reached prod. This asserts the real, rendered panel. The link is built
  // straight from task.permit_id + task.project_id on the MyTaskNode (no permit-
  // object lookup), so it can never silently drop the param on a map miss.
  it('fix-219: "Open in Project View" deep-links to the task\'s permit (?permit=<permit_id>)', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-de-inprog')); // p1 / permit 1
    const link = screen.getByTestId('task-detail-open-project');
    expect(link.getAttribute('href')).toBe('/project/p1?permit=1');
  });

  it('fix-219: the deep-link param is present even for a permit the app has no lookup for (built from task.permit_id)', () => {
    // A task whose permit_id would miss any permitsById cache — the MyTaskNode
    // still carries permit_id + project_id, so the link is unaffected.
    tasksRef.current = [
      task({
        id: 'orphan',
        bucket: 'de',
        project_id: 'proj-1953',
        project_address: '1953 10th Ave W',
        permit_id: 223,
        permit_type: 'Building Permit',
        discipline: 'ent',
        status: 'Open',
        text: 'Submit SCL EDG Application',
      }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-orphan'));
    expect(
      screen.getByTestId('task-detail-open-project').getAttribute('href'),
    ).toBe('/project/proj-1953?permit=223');
  });

  it('fix-138-c: fixture task with waiting_on="Civil" shows "Civil" preselected; changing to "Structural" fires the upsert RPC with waiting_on="Structural"', () => {
    tasksRef.current = [
      task({
        id: 'civil-blocked',
        bucket: 'de',
        discipline: 'ent',
        status: 'In Progress',
        text: 'Need updated civil drawings',
        waiting_on: 'Civil',
      }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-civil-blocked'));
    const waitingSelect = screen.getByTestId(
      'task-detail-waiting-on',
    ) as HTMLSelectElement;
    expect(waitingSelect.value).toBe('Civil');
    // Change → upsert fires with the new value.
    fireEvent.change(waitingSelect, { target: { value: 'Structural' } });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'civil-blocked',
      waitingOn: 'Structural',
    });
  });

  it('Waiting On set to "—" (empty) → upsert fires with clearWaitingOn=true', () => {
    tasksRef.current = [
      task({
        id: 't1',
        bucket: 'de',
        discipline: 'ent',
        waiting_on: 'Civil',
      }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    fireEvent.change(screen.getByTestId('task-detail-waiting-on'), {
      target: { value: '' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      clearWaitingOn: true,
      waitingOn: null,
    });
  });

  it('fix-224: adding an assignee writes the co_assignees join table (bp_set_task_assignees), not assigned_to', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', co_assignees: [] })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    fireEvent.change(screen.getByTestId('task-detail-co-assignee-add'), {
      target: { value: 'Trevor' },
    });
    expect(setAssigneesMutate).toHaveBeenCalledTimes(1);
    expect(setAssigneesMutate.mock.calls[0][0]).toMatchObject({
      taskId: 't1',
      permitId: 1,
      assignees: ['Trevor'],
    });
    // assignment does NOT go through the task upsert.
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it('fix-224: co_assignees render as chips (never blank when non-empty); a role token resolves to the person', () => {
    tasksRef.current = [
      task({
        id: 't1',
        bucket: 'de',
        permit_da: 'Trevor',
        co_assignees: ['Miles', 'role:design_manager'],
      }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    // plain person chip
    expect(screen.getByTestId('task-detail-co-assignee-Miles')).toBeInTheDocument();
    // role token chip resolves to the DM for DA Trevor (Lindsay via dm_da_groups)
    const roleChip = screen.getByTestId('task-detail-co-assignee-role:design_manager');
    expect(roleChip.textContent).toContain('Lindsay');
    expect(screen.queryByTestId('task-detail-co-assignees-empty')).toBeNull();
  });

  it('fix-228/229: shows the PRIMARY owner (default → the DA) once, in the select', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', permit_da: 'Trevor', assigned_to: null })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    // Unset assigned_to → DEFAULT primary = the DA (Trevor), shown in the select
    // ("Design Associate · Trevor"); no separate resolved-person chip.
    expect(primaryDetailText()).toContain('Trevor');
    expect(screen.queryByTestId('task-detail-primary')).toBeNull();
  });

  it('fix-228: picking "Design Manager" resolves the primary to the project DM (dm_da_groups)', () => {
    tasksRef.current = [
      task({ id: 't1', bucket: 'de', permit_da: 'Trevor', assigned_to: 'Design Manager' }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    // DA Trevor → DM Lindsay via the mocked dm_da_groups.
    expect(primaryDetailText()).toContain('Lindsay');
  });

  it('fix-230: an unset ENT-discipline task defaults its primary select to Entitlements (not Design Associate)', () => {
    tasksRef.current = [
      task({ id: 't1', bucket: 'de', discipline: 'ent', permit_da: 'Trevor', assigned_to: null }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    // fix-230: ent column → default team 'Entitlements' (→ ent_lead), NOT the DA.
    const sel = screen.getByTestId('task-detail-primary-select') as HTMLSelectElement;
    expect(sel.value).toBe('Entitlements');
  });

  it('fix-230: an unset ARCH-discipline task defaults its primary select to Design Associate (→ the DA)', () => {
    tasksRef.current = [
      task({ id: 't1', bucket: 'de', discipline: 'arch', permit_da: 'Trevor', assigned_to: null }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    const sel = screen.getByTestId('task-detail-primary-select') as HTMLSelectElement;
    expect(sel.value).toBe('Design Associate');
    expect(primaryDetailText()).toContain('Trevor');
  });

  it('fix-228: changing the primary selector writes assigned_to through the task upsert', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', permit_da: 'Trevor', assigned_to: null })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    fireEvent.change(screen.getByTestId('task-detail-primary-select'), {
      target: { value: 'Entitlements' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({ id: 't1', assignedTo: 'Entitlements' });
  });

  it('fix-228: a person who is the primary is not duplicated as a co-assignee chip', () => {
    // permit_da='Trevor', assigned_to unset → primary Trevor; co_assignees
    // [Trevor, Miles] → only Miles shows.
    tasksRef.current = [
      task({ id: 't1', bucket: 'de', permit_da: 'Trevor', co_assignees: ['Trevor', 'Miles'] }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    expect(primaryDetailText()).toContain('Trevor');
    expect(screen.getByTestId('task-detail-co-assignee-Miles')).toBeInTheDocument();
    expect(screen.queryByTestId('task-detail-co-assignee-Trevor')).toBeNull();
  });

  it('fix-224: editing the target date re-sends the current start date (no cross-field erase)', () => {
    tasksRef.current = [
      task({ id: 't1', bucket: 'de', start_date: '2026-05-01', target_date: null }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    // fix-229: target is empty → reveal the picker from the muted "—" first.
    fireEvent.click(screen.getByTestId('task-detail-target-empty'));
    const targetInput = screen.getByTestId('task-detail-target');
    fireEvent.change(targetInput, { target: { value: '2026-06-01' } });
    // fix-237: typing buffers locally — no mutation until blur/Enter commits.
    expect(upsertMutate).not.toHaveBeenCalled();
    fireEvent.blur(targetInput);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    // the patch carries BOTH dates — start_date is preserved, not nulled.
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      startDate: '2026-05-01',
      targetDate: '2026-06-01',
    });
  });

  it('fix-224: "By Project" groups the task list into per-project sections', () => {
    tasksRef.current = [
      task({ id: 'a', bucket: 'de', project_id: 'p1', project_address: '111 Oak St' }),
      task({ id: 'b', bucket: 'pm', project_id: 'p1', project_address: '111 Oak St' }),
      task({ id: 'c', bucket: 'de', project_id: 'p2', project_address: '222 Pine Ave' }),
    ];
    renderIt();
    // default: kanban buckets, no project grouping
    expect(screen.queryByTestId('mytasks-by-project')).toBeNull();
    fireEvent.click(screen.getByTestId('mytasks-filter-byproject'));
    // now grouped by project — the bucket columns are gone, project sections show
    expect(screen.getByTestId('mytasks-by-project')).toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-bucket-de')).toBeNull();
    expect(screen.getByTestId('mytasks-project-group-111 Oak St')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-project-group-222 Pine Ave')).toBeInTheDocument();
  });

  it('Priority toggle flips false → true on first click and fires the upsert', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de' })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    const star = screen.getByTestId('task-detail-priority');
    expect(star.getAttribute('data-priority')).toBe('false');
    fireEvent.click(star);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      priority: true,
    });
  });

  it('Completed date set → upsert fires with status="Resolved" + completed date; clearing reverts to Open', () => {
    tasksRef.current = [
      task({ id: 't1', bucket: 'de', status: 'In Progress' }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    // fix-229: completed is empty → reveal the picker from the muted "—" first.
    fireEvent.click(screen.getByTestId('task-detail-completed-empty'));
    const completedInput = screen.getByTestId('task-detail-completed');
    fireEvent.change(completedInput, { target: { value: '2026-06-01' } });
    // fix-237: commit on blur, not per keystroke.
    fireEvent.blur(completedInput);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      completed: '2026-06-01',
      status: 'Resolved',
    });
  });

  // fix-235: row checkbox advances forward-only and stops at Resolved.
  it('checkbox on an Open task advances to "In Progress"', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', status: 'Open' })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-toggle'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      status: 'In Progress',
    });
  });

  it('checkbox on an "In Progress" task advances to Resolved', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', status: 'In Progress' })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-toggle'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      status: 'Resolved',
    });
  });

  it('checkbox on a Resolved task is terminal — clicking does NOT fire a write', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', status: 'Resolved' })];
    renderIt();
    // Active-only hides Resolved cards by default; reveal them first.
    fireEvent.click(screen.getByTestId('mytasks-filter-active'));
    const box = screen.getByTestId('mytask-card-t1-status-toggle');
    expect(box.getAttribute('data-status-visual')).toBe('checked');
    fireEvent.click(box);
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it('detail Status dropdown can move a Resolved task backward to "In Progress"', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', status: 'Resolved' })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-filter-active')); // reveal Resolved
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    fireEvent.change(screen.getByTestId('task-detail-status'), {
      target: { value: 'In Progress' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      status: 'In Progress',
    });
  });

  it('detail Status dropdown labels Open as "Not started"', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', status: 'Open' })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    const sel = screen.getByTestId('task-detail-status') as HTMLSelectElement;
    const openOpt = Array.from(sel.options).find((o) => o.value === 'Open');
    expect(openOpt?.textContent).toBe('Not started');
  });

  // fix-294: the blur-commit textarea this test guarded is GONE. It wrote
  // permit_tasks.notes, which only this panel ever rendered — so its output was
  // invisible to everyone but the author. The replacement is the permit's own
  // NotesPanel; what is worth pinning now is that the task upsert can no longer
  // carry a `notes` field at all.
  it('the task detail can no longer write permit_tasks.notes', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', notes: null })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    expect(screen.queryByTestId('task-detail-notes')).toBeNull();
    expect(screen.getByTestId('task-detail-permit-notes')).toBeInTheDocument();
    for (const call of upsertMutate.mock.calls) {
      expect(call[0]).not.toHaveProperty('notes');
    }
  });

  it('fix-138-b: D&E bucket inner subgrid uses equal-width tracks (minmax(0,1fr) minmax(0,1fr))', () => {
    tasksRef.current = varied();
    renderIt();
    const subgrid = screen.getByTestId('mytasks-bucket-de-subgrid');
    expect(subgrid.getAttribute('style') ?? '').toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
    );
    // Permitting bucket too.
    const pmSubgrid = screen.getByTestId('mytasks-bucket-pm-subgrid');
    expect(pmSubgrid.getAttribute('style') ?? '').toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
    );
  });

  it('overdue date styling — past target_date + open status renders data-overdue="true"; a resolved task with the same past date does NOT', () => {
    tasksRef.current = varied();
    renderIt();
    expect(
      screen
        .getByTestId('mytask-card-de-open-overdue-due')
        .getAttribute('data-overdue'),
    ).toBe('true');
    // Toggle Active Only OFF to render the resolved-past card and assert it
    // is NOT marked overdue (Resolved short-circuits the rule).
    fireEvent.click(screen.getByTestId('mytasks-filter-active'));
    expect(
      screen
        .getByTestId('mytask-card-pm-resolved-past-due')
        .getAttribute('data-overdue'),
    ).toBe('false');
  });

  it('ENT dropdown narrows to tasks where an ENT roster name is an assignee', () => {
    tasksRef.current = varied();
    // fix-238b: ownership now resolves via the permit's ent_lead/da (the same
    // path My Work uses) — permit 1's ent_lead is Bobby, so the unset-assigned
    // ent task de-inprog resolves to Bobby.
    permitsRef.current = VARIED_PERMITS;
    renderIt();
    openPeople();
    fireEvent.change(screen.getByTestId('mytasks-filter-role-ent-select'), {
      target: { value: 'Bobby' },
    });
    // Bobby is the resolved owner of de-inprog (ent, permit 1). The others drop.
    expect(screen.getByTestId('mytask-card-de-inprog')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-open-overdue')).toBeNull();
    expect(screen.queryByTestId('mytask-card-pm-open')).toBeNull();
  });

  it('DA dropdown narrows to tasks where a DA roster name is an assignee', () => {
    tasksRef.current = varied();
    permitsRef.current = VARIED_PERMITS;
    renderIt();
    openPeople();
    fireEvent.change(screen.getByTestId('mytasks-filter-role-da-select'), {
      target: { value: 'Trevor' },
    });
    // de-open-overdue (arch, permit 1) resolves to DA Trevor; de-inprog (ent)
    // resolves to the ent lead, not the DA.
    expect(screen.getByTestId('mytask-card-de-open-overdue')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-inprog')).toBeNull();
  });

  // fix-238b: the reported bug — Everyone-view person/role filter now resolves
  // assigned_to ROLE placeholders (Design Manager → the project's DM) the SAME
  // way My Work does. Two 4040/4060 E Via Estrella arch tasks are assigned to
  // "Design Manager"; Derry is the DM.
  describe('fix-238b: Everyone-view filter resolves assigned_to roles', () => {
    function viaEstrella(): TaskFixture[] {
      return [
        task({
          id: 'via-4040',
          permit_id: 1,
          bucket: 'de',
          discipline: 'arch',
          project_address: '4040 E Via Estrella',
          text: 'Window & Door Schedule Review',
          assigned_to: 'Design Manager',
          permit_da: 'Qisheng',
          primary_assignee: 'Qisheng', // server-derived arch → DA (the old, wrong owner)
        }),
        task({
          id: 'via-4060',
          permit_id: 2,
          bucket: 'de',
          discipline: 'arch',
          project_address: '4060 E Via Estrella',
          text: 'Window & Door Schedule Review',
          assigned_to: 'Design Manager',
          permit_da: 'Qisheng',
          primary_assignee: 'Qisheng',
        }),
      ];
    }
    beforeEach(() => {
      // Roster: Qisheng is the DA, Derry the DM (so both dropdowns list them).
      teamRef.current = [
        member({ name: 'Qisheng', role: 'da' }),
        member({ name: 'Derry', role: 'dm' }),
      ];
      // Both permits: DA Qisheng, DM Derry. (Production resolves the DM via
      // dm_da_groups(DA); here the permit.dm fallback stands in.)
      permitsRef.current = [
        { id: 1, da: 'Qisheng', dm: 'Derry', ent_lead: 'Miles' },
        { id: 2, da: 'Qisheng', dm: 'Derry', ent_lead: 'Miles' },
      ];
      tasksRef.current = viaEstrella();
    });

    it('DM person filter (Derry) surfaces the "Design Manager" tasks — the bug', () => {
      renderIt();
      // Before fix: primary_assignee is the DA, so a Derry filter showed 0.
      openPeople();
      fireEvent.change(screen.getByTestId('mytasks-filter-role-dm-select'), {
        target: { value: 'Derry' },
      });
      expect(screen.getByTestId('mytask-card-via-4040')).toBeInTheDocument();
      expect(screen.getByTestId('mytask-card-via-4060')).toBeInTheDocument();
    });

    it('DA person filter (Qisheng) still shows them via the arch blanket', () => {
      renderIt();
      openPeople();
      fireEvent.change(screen.getByTestId('mytasks-filter-role-da-select'), {
        target: { value: 'Qisheng' },
      });
      expect(screen.getByTestId('mytask-card-via-4040')).toBeInTheDocument();
      expect(screen.getByTestId('mytask-card-via-4060')).toBeInTheDocument();
    });

    it('DM quick role-family chip returns the DM-assigned tasks', () => {
      renderIt();
      fireEvent.click(screen.getByTestId('mytasks-filter-allroles-dm'));
      expect(screen.getByTestId('mytask-card-via-4040')).toBeInTheDocument();
      expect(screen.getByTestId('mytask-card-via-4060')).toBeInTheDocument();
    });
  });

  it('CONSULTANT dropdown surfaces tasks whose co-assignees include unrostered names', () => {
    tasksRef.current = varied();
    renderIt();
    openPeople();
    fireEvent.change(
      screen.getByTestId('mytasks-filter-role-consultant-select'),
      { target: { value: 'Outside Consult LLC' } },
    );
    // Only pm-inprog has the co-assignee.
    expect(screen.getByTestId('mytask-card-pm-inprog')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-pm-open')).toBeNull();
    expect(screen.queryByTestId('mytask-card-de-open-overdue')).toBeNull();
  });

  it('All stages multi-select filters by permit_type', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-stage'), {
      target: { value: 'PAR/Pre-Sub' },
    });
    // Only PAR/Pre-Sub tasks remain (de-* are Building Permit).
    expect(screen.queryByTestId('mytask-card-de-open-overdue')).toBeNull();
    expect(screen.queryByTestId('mytask-card-de-inprog')).toBeNull();
    expect(screen.getByTestId('mytask-card-pm-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-card-pm-inprog')).toBeInTheDocument();
    // Chip is rendered + removable.
    expect(
      screen.getByTestId('mytasks-filter-stage-chip-PAR/Pre-Sub'),
    ).toBeInTheDocument();
  });

  it('search input matches text, address, and assignee names (case-insensitive)', () => {
    tasksRef.current = varied();
    renderIt();
    // Match by task text.
    fireEvent.change(screen.getByTestId('mytasks-filter-search'), {
      target: { value: 'steep-slope' },
    });
    expect(screen.getByTestId('mytask-card-pm-open')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-inprog')).toBeNull();
    // Clear and match by project address.
    fireEvent.change(screen.getByTestId('mytasks-filter-search'), {
      target: { value: 'pike' },
    });
    expect(screen.getByTestId('mytask-card-pm-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-card-pm-inprog')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-inprog')).toBeNull();
    // Match by primary assignee name.
    fireEvent.change(screen.getByTestId('mytasks-filter-search'), {
      target: { value: 'bobby' },
    });
    expect(screen.getByTestId('mytask-card-de-inprog')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-open-overdue')).toBeNull();
  });

  // fix-380: Bobby — "Maybe I don't know the project by the project address,
  // but I know it by the structure address." The task rows are the
  // bp_list_tasks projection (project_address only), so the permit's
  // struct_address joins the haystack from the permits cache by permit_id.
  it('fix-380: search matches the permit struct_address', () => {
    tasksRef.current = varied();
    permitsRef.current = [
      { id: 1, da: 'Trevor', dm: null, ent_lead: 'Bobby', struct_address: null },
      { id: 2, da: 'Ainsley', dm: null, ent_lead: 'Edmund', struct_address: '4411 Cottage Ct' },
    ];
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-search'), {
      target: { value: 'cottage' },
    });
    // Permit 2's tasks match on its structure address…
    expect(screen.getByTestId('mytask-card-pm-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-card-pm-inprog')).toBeInTheDocument();
    // …permit 1 (no struct_address — 518 of 588 rows) neither matches nor breaks.
    expect(screen.queryByTestId('mytask-card-de-inprog')).toBeNull();
    expect(screen.queryByTestId('mytask-card-de-open-overdue')).toBeNull();
    // Address search unchanged.
    fireEvent.change(screen.getByTestId('mytasks-filter-search'), {
      target: { value: 'pike' },
    });
    expect(screen.getByTestId('mytask-card-pm-open')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-inprog')).toBeNull();
  });

  it('filters persist across unmount + remount via localStorage (key mytasks.filters.v2)', () => {
    tasksRef.current = varied();
    const { unmount } = renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-stage'), {
      target: { value: 'PAR/Pre-Sub' },
    });
    // ★★ fix-444 §A3: the "By Due Date" toggle is GONE — it was never a manual
    //    order (nothing in the app lets a person arrange tasks), so it chose
    //    between two date orders and the bands are the answer now. The KEY is
    //    left in the persisted shape, so a stored value from before this ships
    //    is simply ignored rather than breaking the parse — which is what this
    //    line proves.
    window.localStorage.setItem(
      'mytasks.filters.v2',
      JSON.stringify({
        ...JSON.parse(window.localStorage.getItem('mytasks.filters.v2') ?? '{}'),
        byDueDate: false,
      }),
    );
    expect(screen.queryByTestId('mytasks-filter-bydue')).toBeNull();
    // localStorage carries our v2 key.
    const stored = JSON.parse(
      window.localStorage.getItem('mytasks.filters.v2') ?? '{}',
    );
    expect(stored.permitTypes).toEqual(['PAR/Pre-Sub']);

    unmount();
    renderIt();
    // After remount the filters re-apply — and the stale key did no harm.
    expect(
      screen.getByTestId('mytasks-filter-stage-chip-PAR/Pre-Sub'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-open-overdue')).toBeNull();
    expect(screen.getByTestId('mytask-card-pm-open')).toBeInTheDocument();
  });
});

// fix-140: URL-backed view switcher between the existing board and the new
// Waiting On reporting view.
describe('MyTasks view switcher (fix-140)', () => {
  function renderAt(path: string) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <MyTasks />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders both options and defaults to the My Tasks board', () => {
    renderAt('/my-tasks');
    expect(screen.getByTestId('my-tasks-view-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('my-tasks-view-mine')).toBeInTheDocument();
    expect(screen.getByTestId('my-tasks-view-waiting-on')).toBeInTheDocument();
    // Default = board (the existing page renders mytasks-page), not the view.
    expect(screen.getByTestId('mytasks-page')).toBeInTheDocument();
    expect(screen.queryByTestId('waiting-on-view')).toBeNull();
    expect(
      screen.getByTestId('my-tasks-view-mine').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('clicking Waiting On swaps to the view and sets ?view=waiting-on', () => {
    renderAt('/my-tasks');
    fireEvent.click(screen.getByTestId('my-tasks-view-waiting-on'));
    expect(screen.getByTestId('waiting-on-view')).toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-page')).toBeNull();
    expect(
      screen.getByTestId('my-tasks-view-waiting-on').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('loads the Waiting On view directly from ?view=waiting-on (bookmark path)', () => {
    renderAt('/my-tasks?view=waiting-on');
    expect(screen.getByTestId('waiting-on-view')).toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-page')).toBeNull();
  });

  it('switching back to My Tasks unmounts the Waiting On view', () => {
    renderAt('/my-tasks?view=waiting-on');
    expect(screen.getByTestId('waiting-on-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('my-tasks-view-mine'));
    expect(screen.queryByTestId('waiting-on-view')).toBeNull();
    expect(screen.getByTestId('mytasks-page')).toBeInTheDocument();
  });

  // ── fix-155: BOT badge + filter + priority/auto sort ───────────────────
  function withAuto(): TaskFixture[] {
    return [
      task({
        id: 'human-1',
        bucket: 'pm',
        permit_id: 1,
        project_id: 'p1',
        project_address: '1 Human Way',
        permit_type: 'Building Permit',
        discipline: 'ent',
        status: 'Open',
        text: 'Human task',
        primary_assignee: 'Bobby',
      }),
      task({
        id: 'auto-corr',
        bucket: 'pm',
        permit_id: 1,
        project_id: 'p1',
        project_address: '1 Human Way',
        permit_type: 'Building Permit',
        discipline: 'ent',
        status: 'Open',
        text: 'Corrections issued (cycle 1) — send to consultants — BLD-1',
        primary_assignee: 'Bobby',
        is_auto_generated: true,
        auto_event: 'corr_issued',
        priority: true,
      }),
    ];
  }

  it('fix-155: BOT badge renders on auto rows, not on human rows', () => {
    tasksRef.current = withAuto();
    renderIt();
    expect(screen.getByTestId('bot-badge-auto-corr')).toBeInTheDocument();
    expect(screen.queryByTestId('bot-badge-human-1')).toBeNull();
  });

  it('fix-155: BOT quick-filter narrows to auto-tasks only', () => {
    tasksRef.current = withAuto();
    renderIt();
    expect(screen.getByTestId('mytask-card-human-1')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-card-auto-corr')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mytasks-filter-bot'));
    expect(screen.queryByTestId('mytask-card-human-1')).toBeNull();
    expect(screen.getByTestId('mytask-card-auto-corr')).toBeInTheDocument();
  });

  // ★★★ fix-444 §A2 INVERTS THIS PIN, AND THE INVERSION IS THE RULING.
  //
  // Bobby, 2026-08-29: *"The manual priority flag lifts a task to the top of
  // its band, never out of it."* fix-155 made `priority` the TOP sort key for
  // the whole column, so — as this test's own original comment said — a
  // flagged task due 2026-06-30 outranked an unflagged one due 2026-06-05.
  // That is "important" beating "urgent", which is exactly what ruling 3
  // settles: the two tasks are in different BANDS now, and no flag crosses a
  // band boundary.
  //
  // ★ The flag is not weakened — it still wins inside a band, which the test
  //   below this one proves. What it stops doing is hiding a nearer deadline.
  it('fix-155 → fix-444: priority does NOT lift a task out of its band', () => {
    // Both Open + pm → same sub-column, but DIFFERENT bands: against the
    // fixture clock (2026-06-01) 2026-06-05 is four days out — "This week" —
    // and 2026-06-30 is twenty-nine days out — "Later".
    tasksRef.current = [
      task({
        id: 'np-1',
        bucket: 'pm',
        permit_id: 1,
        project_id: 'p1',
        project_address: '1 Way',
        permit_type: 'Building Permit',
        discipline: 'ent',
        status: 'Open',
        text: 'no priority',
        primary_assignee: 'Bobby',
        target_date: '2026-06-05',
      }),
      task({
        id: 'pr-auto',
        bucket: 'pm',
        permit_id: 1,
        project_id: 'p1',
        project_address: '1 Way',
        permit_type: 'Building Permit',
        discipline: 'ent',
        status: 'Open',
        text: 'priority auto',
        primary_assignee: 'Bobby',
        target_date: '2026-06-30',
        is_auto_generated: true,
        auto_event: 'corr_issued',
        priority: true,
      }),
    ];
    renderIt();
    const auto = screen.getByTestId('mytask-card-pr-auto');
    const human = screen.getByTestId('mytask-card-np-1');
    // ★★★ The EARLIER-DUE, UNFLAGGED task comes first now — its band is above
    //     the flagged one's, and a flag cannot cross that line.
    expect(
      human.compareDocumentPosition(auto) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ★ …and they really are in different bands, so this is not an accident
    //   of two rows in one list.
    expect(
      screen.getByTestId('mytasks-band-pm-not-started-this_week'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mytasks-band-pm-not-started-later'),
    ).toBeInTheDocument();
  });

  it('fix-156: ENT filter matches a BOT task via DERIVED ent lead (assigned_to null)', () => {
    // fix-238b: "derived owner" now means the CLIENT resolver deriving from the
    // permit's ent_lead (assigned_to is still null). bot-ent sits on permit 1
    // (ent lead Edmund); the human 'other' on permit 2 (ent lead Bobby).
    permitsRef.current = [
      { id: 1, da: null, dm: null, ent_lead: 'Edmund' },
      { id: 2, da: null, dm: null, ent_lead: 'Bobby' },
    ];
    tasksRef.current = [
      task({
        id: 'bot-ent',
        permit_id: 1,
        bucket: 'de',
        discipline: 'ent',
        text: 'Enter permit number — was this submitted? — SDOT Tree @ X',
        // No static assigned_to — the owner derives from permit 1's ent lead.
        primary_assignee: 'Edmund',
        assigned_to: null,
        is_auto_generated: true,
        auto_event: 'number_entry',
      }),
      task({
        id: 'other',
        permit_id: 2,
        bucket: 'de',
        discipline: 'ent',
        text: 'human task',
        primary_assignee: 'Bobby',
      }),
    ];
    renderIt();
    // Filter ENT → Edmund. The BOT task matches via its derived ent lead.
    openPeople();
    fireEvent.change(screen.getByTestId('mytasks-filter-role-ent-select'), {
      target: { value: 'Edmund' },
    });
    expect(screen.getByTestId('mytask-card-bot-ent')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-other')).toBeNull();
  });

  it('fix-156/fix-294: a BOT task gets the same permit notes panel (full parity)', () => {
    tasksRef.current = [
      task({
        id: 'bot-notes',
        bucket: 'de',
        discipline: 'ent',
        text: 'Enter permit number…',
        primary_assignee: 'Edmund',
        is_auto_generated: true,
        auto_event: 'number_entry',
      }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-bot-notes'));
    // fix-294: parity is now about the PERMIT notes panel — a BOT task gets the
    // same shared notes surface as a human one, rather than the same private
    // field nobody could read.
    expect(screen.getByTestId('task-detail-permit-notes')).toBeInTheDocument();
    expect(screen.getByTestId('notes-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('task-detail-notes')).toBeNull();
  });
});

// ------------------------------------------------------------- fix-294 -----

// Two problems, both about the same thing: My Tasks showing something
// differently from everywhere else, or showing a control whose output goes
// nowhere.

describe('fix-294 subtasks nest under their parent', () => {
  it('renders a subtask inside its parent group, not as a sibling row', () => {
    tasksRef.current = [
      task({ id: 'p', text: 'Parent task', primary_assignee: 'Trevor' }),
      task({ id: 'c', text: 'Child task', parent_task_id: 'p', primary_assignee: 'Trevor' }),
    ];
    renderIt();
    const group = screen.getByTestId('mytask-group-p');
    expect(group).toContainElement(screen.getByTestId('mytask-card-p'));
    expect(group).toContainElement(screen.getByTestId('mytask-card-c'));
    // ...and the child is not its own top-level group.
    expect(screen.queryByTestId('mytask-group-c')).toBeNull();
  });

  it('marks the subtask as a subtask and the parent as not', () => {
    tasksRef.current = [
      task({ id: 'p', primary_assignee: 'Trevor' }),
      task({ id: 'c', parent_task_id: 'p', primary_assignee: 'Trevor' }),
    ];
    renderIt();
    expect(screen.getByTestId('mytask-card-p')).toHaveAttribute('data-subtask', 'false');
    expect(screen.getByTestId('mytask-card-c')).toHaveAttribute('data-subtask', 'true');
  });

  it('orders the parent above its subtask', () => {
    tasksRef.current = [
      task({ id: 'c', parent_task_id: 'p', primary_assignee: 'Trevor' }),
      task({ id: 'p', primary_assignee: 'Trevor' }),
    ];
    renderIt();
    const parent = screen.getByTestId('mytask-card-p');
    const child = screen.getByTestId('mytask-card-c');
    expect(
      parent.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // ★ The case that must not regress. My Tasks filters, so a subtask assigned
  // to you whose parent belongs to somebody else is routinely visible without
  // it. Nesting it under an absent parent would delete it from your list.
  it('still shows a subtask whose parent is not in the visible set', () => {
    // The real shape after any filter: the child is here, the parent is not.
    // Nesting it under an absent parent would delete it from the board.
    tasksRef.current = [
      task({ id: 'c', text: 'My child task', parent_task_id: 'absent-parent',
             primary_assignee: 'Trevor' }),
    ];
    renderIt();
    expect(screen.getByTestId('mytask-card-c')).toBeInTheDocument();
    // Promoted to top level, so it reads as an ordinary row rather than a
    // stray indent under nothing.
    expect(screen.getByTestId('mytask-card-c')).toHaveAttribute('data-subtask', 'false');
    expect(screen.getByTestId('mytask-group-c')).toBeInTheDocument();
  });

  it('nests inside the group-by-project view too', () => {
    tasksRef.current = [
      task({ id: 'p', primary_assignee: 'Trevor' }),
      task({ id: 'c', parent_task_id: 'p', primary_assignee: 'Trevor' }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-filter-byproject'));
    const group = screen.getByTestId('mytask-group-p');
    expect(group).toContainElement(screen.getByTestId('mytask-card-c'));
  });
});

describe('fix-294 the notes box writes where people can see it', () => {
  beforeEach(() => {
    addNoteMutate.mockClear();
  });

  it('is the permit notes panel, not a private task field', () => {
    tasksRef.current = [task({ id: 'a', permit_id: 42, primary_assignee: 'Trevor' })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-a'));
    expect(screen.getByTestId('task-detail-permit-notes')).toBeInTheDocument();
    expect(screen.getByTestId('notes-panel')).toBeInTheDocument();
    // ★ The old write surface is gone — not hidden, gone.
    expect(screen.queryByTestId('task-detail-notes')).toBeNull();
  });

  it('never writes permit_tasks.notes again', () => {
    tasksRef.current = [task({ id: 'a', permit_id: 42, primary_assignee: 'Trevor' })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-a'));
    // Exercise the panel; whatever it does must not be a task upsert carrying
    // a `notes` field.
    for (const call of upsertMutate.mock.calls) {
      expect(call[0]).not.toHaveProperty('notes');
    }
  });

  it('scopes the panel to the task own permit', () => {
    // permit_tasks.permit_id is NOT NULL (0 of 1,057 rows lack one), so there
    // is no "task without a permit" case to handle — the panel always has a
    // permit to write against.
    tasksRef.current = [task({ id: 'a', permit_id: 42, primary_assignee: 'Trevor' })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-a'));
    expect(screen.getByTestId('task-detail-permit-notes')).toBeInTheDocument();
    expect(screen.getByTestId('notes-panel')).toBeInTheDocument();
  });
});


// ===========================================================================
// ★★★ fix-445 — THE CO-ASSIGNED TOGGLE, AND THE FILTER ROW THAT STOPPED BEING
//     A WALL (ruling 4 / P-047)
// ===========================================================================
describe('fix-445: Co-assigned', () => {
  // Bobby is the logged-in user (see the file's beforeEach). Two tasks he can
  // see for two different reasons:
  //   own-1  assigned to him outright         → Rule 1, ownsDirectly
  //   co-1   assigned to Edmund, Bobby listed → Rule 2 only, isCoAssigned
  function twoWays(): TaskFixture[] {
    return [
      task({
        id: 'own-1',
        discipline: 'ent',
        assigned_to: 'Bobby',
        co_assignees: [],
        text: 'Mine outright',
      }) as TaskFixture,
      task({
        id: 'co-1',
        discipline: 'ent',
        assigned_to: 'Edmund',
        co_assignees: ['Bobby'],
        text: 'Shared with me',
      }) as TaskFixture,
    ];
  }

  beforeEach(() => {
    teamRef.current = [
      member({ name: 'Bobby', role: 'ent_lead', email: 'bobby@x.com' }),
      member({ name: 'Edmund', role: 'ent' }),
    ];
    permitsRef.current = [{ id: 1, da: null, dm: null, ent_lead: 'Edmund' }];
    tasksRef.current = twoWays();
  });

  function goMine() {
    fireEvent.click(screen.getByTestId('mytasks-scope-mine'));
  }

  it('★★★ ON (the default) shows both, and MARKS the shared one', () => {
    renderIt();
    goMine();
    expect(screen.getByTestId('mytask-card-own-1')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-card-co-1')).toBeInTheDocument();
    // ★★ The mark is on the Rule-2 row ONLY. Bobby: "'mine' and 'shared' are
    //    distinguishable rather than blended."
    expect(screen.getByTestId('mytask-card-co-1-coassigned')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-own-1-coassigned')).toBeNull();
    // ★ Default ON — measured: for five people on the roster the co-assigned
    //   list IS their list (Brittani 29 of 30). Defaulting off would have
    //   emptied their board the morning this shipped.
    expect(
      screen.getByTestId('mytasks-filter-coassigned').getAttribute('data-on'),
    ).toBe('true');
  });

  it('★★★ OFF hides the Rule-2 task and keeps the Rule-1 one', () => {
    renderIt();
    goMine();
    fireEvent.click(screen.getByTestId('mytasks-filter-coassigned'));
    expect(screen.getByTestId('mytask-card-own-1')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-co-1')).toBeNull();
    expect(
      screen.getByTestId('mytasks-filter-coassigned').getAttribute('data-on'),
    ).toBe('false');
  });

  it('★★ §A4: the counters follow the toggle', () => {
    renderIt();
    goMine();
    const open = () =>
      screen.getByTestId('mytasks-counter-open-value').textContent;
    expect(open()).toBe('2');
    fireEvent.click(screen.getByTestId('mytasks-filter-coassigned'));
    // ★ They count what is on screen, because the switch narrows `scopedTasks`
    //   — the one place "mine" is decided — and everything else reads
    //   downstream of it.
    expect(open()).toBe('1');
  });

  it('★★ it is DISABLED under Everyone, not hidden', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-scope-all'));
    const btn = screen.getByTestId('mytasks-filter-coassigned');
    // ★ Still there — a control that vanished between scopes would leave the
    //   reader hunting for it.
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute('data-disabled')).toBe('true');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/My Work/i);
  });

  it('★★ …and under Everyone NOTHING carries the mark', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-scope-all'));
    // A mark reading "co-assigned to you" would be a lie on somebody else's
    // task, so the set is empty outside "mine" whatever the stored value is.
    expect(screen.queryByTestId('mytask-card-co-1-coassigned')).toBeNull();
    expect(screen.queryByTestId('mytask-card-own-1-coassigned')).toBeNull();
  });

  it('★ clicking it while disabled does nothing', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-scope-all'));
    fireEvent.click(screen.getByTestId('mytasks-filter-coassigned'));
    goMine();
    // The stored value was never written, so My Work still shows both.
    expect(screen.getByTestId('mytask-card-co-1')).toBeInTheDocument();
  });
});

describe('fix-445 §B: the filter row reads as three things', () => {
  it('★★ the three clusters and their hairlines exist', () => {
    renderIt();
    expect(screen.getByTestId('mytasks-filtergroup-scope')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-filtergroup-who')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-filtergroup-what')).toBeInTheDocument();
    expect(screen.getAllByTestId('mytasks-filter-divider')).toHaveLength(2);
  });

  it('★★★ §B2: the People button carries a COUNT when a role filter is set', () => {
    teamRef.current = [
      member({ name: 'Trevor', role: 'da' }),
      member({ name: 'Ainsley', role: 'da' }),
    ];
    renderIt();
    // ★ Collapsed by default, and saying nothing because nothing is set.
    expect(screen.queryByTestId('mytasks-filter-people-panel')).toBeNull();
    expect(screen.queryByTestId('mytasks-filter-people-count')).toBeNull();

    openPeople();
    expect(screen.getByTestId('mytasks-filter-people-panel')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('mytasks-filter-role-da-select'), {
      target: { value: 'Trevor' },
    });
    // ★★★ A HIDDEN FILTER MUST NEVER BE A SILENT ONE. This badge is the whole
    //     reason collapsing the four dropdowns is safe.
    expect(screen.getByTestId('mytasks-filter-people-count').textContent).toBe('1');
  });

  it('★★ §B2: Clear empties the panel, and the badge with it', () => {
    teamRef.current = [member({ name: 'Trevor', role: 'da' })];
    renderIt();
    openPeople();
    fireEvent.change(screen.getByTestId('mytasks-filter-role-da-select'), {
      target: { value: 'Trevor' },
    });
    expect(screen.getByTestId('mytasks-filter-people-count')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mytasks-filter-reset'));
    // fix-428's Clear is untouched — the role dropdowns were always
    // `filters.roles`; collapsing them changed where they are drawn, not what
    // Clear means.
    expect(screen.queryByTestId('mytasks-filter-people-count')).toBeNull();
  });

  it('★★ §B3: every control kept its test id', () => {
    // ★ ScopeToggle renders NOTHING when the login cannot be resolved to a
    //   roster name, and the file's default roster gives Bobby no email. The
    //   inventory is only meaningful with every control actually on screen.
    teamRef.current = [
      member({ name: 'Bobby', role: 'ent_lead', email: 'bobby@x.com' }),
    ];
    renderIt();
    openPeople();
    for (const id of [
      'mytasks-scope',
      'mytasks-filter-search',
      'mytasks-filter-role-ent',
      'mytasks-filter-role-da',
      'mytasks-filter-role-dm',
      'mytasks-filter-role-consultant',
      'mytasks-filter-allroles',
      'mytasks-filter-stage',
      'mytasks-filter-active',
      'mytasks-filter-byproject',
      'mytasks-filter-bot',
      'mytasks-filter-held',
      'mytasks-filter-coassigned',
      'mytasks-filter-reset',
    ]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
  });

  it('★ §B4: the panel does NOT remember being open', () => {
    const { unmount } = renderIt();
    openPeople();
    expect(screen.getByTestId('mytasks-filter-people-panel')).toBeInTheDocument();
    unmount();
    renderIt();
    // "Which drawer was open when I left" is a gesture, not a preference — and
    // a row that changes height on load for an invisible reason is worse than
    // one click.
    expect(screen.queryByTestId('mytasks-filter-people-panel')).toBeNull();
  });
});
