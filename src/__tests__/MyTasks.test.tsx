import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
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

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: teamRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// fix-179: useScopeMode now consults useProjects (assignment-driven scope). The
// My tab doesn't use the project/permit distinction, so an empty list is fine —
// mock it inert so no network call fires from the scope hook.
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

// fix-228: the detail editor reads permits (ent_lead) + projects (schematic)
// to resolve the PRIMARY owner. Inert map is fine — DA/DM resolve from
// permit_da + dm_da_groups; ent_lead/schematic just fall back when absent.
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
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

import MyTasks from '../pages/MyTasks';

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
  useAuthStore.setState({
    user: { email: 'bobby@x.com' } as never,
    activeTenantId: 'test-tenant',
  });
  window.localStorage.clear();
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
    expect(screen.getByTestId('task-detail-start')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-target')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-completed')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-notes')).toBeInTheDocument();
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

  it('fix-228: shows the labeled PRIMARY owner (default → the DA), matching the permit bar', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', permit_da: 'Trevor', assigned_to: null })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    // Unset assigned_to → DEFAULT primary = the DA (Trevor).
    expect(screen.getByTestId('task-detail-primary').textContent).toBe('Trevor');
  });

  it('fix-228: picking "Design Manager" resolves the primary to the project DM (dm_da_groups)', () => {
    tasksRef.current = [
      task({ id: 't1', bucket: 'de', permit_da: 'Trevor', assigned_to: 'Design Manager' }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    // DA Trevor → DM Lindsay via the mocked dm_da_groups.
    expect(screen.getByTestId('task-detail-primary').textContent).toBe('Lindsay');
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
    expect(screen.getByTestId('task-detail-primary').textContent).toBe('Trevor');
    expect(screen.getByTestId('task-detail-co-assignee-Miles')).toBeInTheDocument();
    expect(screen.queryByTestId('task-detail-co-assignee-Trevor')).toBeNull();
  });

  it('fix-224: editing the target date re-sends the current start date (no cross-field erase)', () => {
    tasksRef.current = [
      task({ id: 't1', bucket: 'de', start_date: '2026-05-01', target_date: null }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    fireEvent.change(screen.getByTestId('task-detail-target'), {
      target: { value: '2026-06-01' },
    });
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
    fireEvent.change(screen.getByTestId('task-detail-completed'), {
      target: { value: '2026-06-01' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      completed: '2026-06-01',
      status: 'Resolved',
    });
  });

  it('Notes blur-commit fires the upsert ONCE with the final value (not on every keystroke)', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', notes: null })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    const notes = screen.getByTestId('task-detail-notes') as HTMLTextAreaElement;
    // Type three keystrokes — none should fire mutate.
    fireEvent.change(notes, { target: { value: 'W' } });
    fireEvent.change(notes, { target: { value: 'Wa' } });
    fireEvent.change(notes, { target: { value: 'Waiting on civil' } });
    expect(upsertMutate).not.toHaveBeenCalled();
    // Blur → single mutate with the final value.
    fireEvent.blur(notes);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      notes: 'Waiting on civil',
    });
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
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-role-ent-select'), {
      target: { value: 'Bobby' },
    });
    // Bobby is the primary on de-inprog. The other tasks drop.
    expect(screen.getByTestId('mytask-card-de-inprog')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-open-overdue')).toBeNull();
    expect(screen.queryByTestId('mytask-card-pm-open')).toBeNull();
  });

  it('DA dropdown narrows to tasks where a DA roster name is an assignee', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-role-da-select'), {
      target: { value: 'Trevor' },
    });
    expect(screen.getByTestId('mytask-card-de-open-overdue')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-de-inprog')).toBeNull();
  });

  it('CONSULTANT dropdown surfaces tasks whose co-assignees include unrostered names', () => {
    tasksRef.current = varied();
    renderIt();
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

  it('filters persist across unmount + remount via localStorage (key mytasks.filters.v2)', () => {
    tasksRef.current = varied();
    const { unmount } = renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-stage'), {
      target: { value: 'PAR/Pre-Sub' },
    });
    fireEvent.click(screen.getByTestId('mytasks-filter-bydue'));
    // localStorage carries our v2 key.
    const stored = JSON.parse(
      window.localStorage.getItem('mytasks.filters.v2') ?? '{}',
    );
    expect(stored.permitTypes).toEqual(['PAR/Pre-Sub']);
    expect(stored.byDueDate).toBe(false);

    unmount();
    renderIt();
    // After remount the filters re-apply.
    expect(
      screen.getByTestId('mytasks-filter-stage-chip-PAR/Pre-Sub'),
    ).toBeInTheDocument();
    expect(
      screen
        .getByTestId('mytasks-filter-bydue')
        .getAttribute('data-on'),
    ).toBe('false');
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

  it('fix-155: priority tasks sort above non-priority within a sub-column', () => {
    // Both Open + pm → same sub-column. The priority auto-task has a LATER
    // target_date, so under by-due sorting alone it would come second; priority
    // is the top sort key, so it bubbles above the earlier-due non-priority one.
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
    // auto precedes human in document order.
    expect(
      auto.compareDocumentPosition(human) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('fix-156: ENT filter matches a BOT task via DERIVED primary_assignee (assigned_to null)', () => {
    tasksRef.current = [
      task({
        id: 'bot-ent',
        bucket: 'de',
        discipline: 'ent',
        text: 'Enter permit number — was this submitted? — SDOT Tree @ X',
        // derived from permit.ent_lead; fix-156 wrote no static assigned_to.
        primary_assignee: 'Edmund',
        assigned_to: null,
        is_auto_generated: true,
        auto_event: 'number_entry',
      }),
      task({
        id: 'other',
        bucket: 'de',
        discipline: 'ent',
        text: 'human task',
        primary_assignee: 'Bobby',
      }),
    ];
    renderIt();
    // Filter ENT → Edmund. The BOT task matches via its derived primary.
    fireEvent.change(screen.getByTestId('mytasks-filter-role-ent-select'), {
      target: { value: 'Edmund' },
    });
    expect(screen.getByTestId('mytask-card-bot-ent')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-card-other')).toBeNull();
  });

  it('fix-156: editing notes on a BOT task fires the upsert (full parity)', () => {
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
    const notes = screen.getByTestId('task-detail-notes');
    fireEvent.change(notes, {
      target: { value: 'called the city — awaiting number' },
    });
    fireEvent.blur(notes);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'bot-notes',
      notes: 'called the city — awaiting number',
    });
  });
});
