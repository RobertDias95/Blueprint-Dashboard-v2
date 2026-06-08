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
    expect(screen.getByTestId('task-detail-assigned')).toBeInTheDocument();
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

  it('Assigned To change fires the upsert RPC', () => {
    tasksRef.current = [task({ id: 't1', bucket: 'de', assigned_to: null })];
    renderIt();
    fireEvent.click(screen.getByTestId('mytask-card-t1'));
    fireEvent.change(screen.getByTestId('task-detail-assigned'), {
      target: { value: 'Trevor' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 't1',
      assignedTo: 'Trevor',
    });
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
