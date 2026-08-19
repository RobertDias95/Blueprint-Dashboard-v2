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

function renderIt(url = '/board') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {/* ★★ A COLD LOAD: the URL and nothing else. No click, no store, no
          router state object — §2's rule made testable. */}
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<MyTasks />, { wrapper });
}

// ===========================================================================
// fix-362 §2 — a task notification OPENS THE TASK
// ===========================================================================
//
// Bobby: "and same thing, if in the task, does it take me automatically…
// anytime you get a notification, you can click it and go to where that item is
// occurring."
//
// ★★ Before this, a task notification could only take you to the PERMIT that
// holds it — a bar of tasks to read through, which is the work the notification
// was supposed to save.
//
// ★★★ AND A CLOSED TASK IS STILL REACHABLE. fix-355 closed 56 of them, and
// §3 is explicit that completed is not gone. The board's own filters — scope,
// "active only", the role chips — are a VIEW, and a deep link is not bound by
// somebody's view.

const MINE = 'aaaaaaaa-1111-1111-1111-111111111111';
const CLOSED = 'bbbbbbbb-2222-2222-2222-222222222222';
const GONE = 'cccccccc-3333-3333-3333-333333333333';

beforeEach(() => {
  allTasksSpy.mockReset();
  upsertMutate.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
  // ★ Bobby's login is on the roster, so the board resolves an identity and
  // its scope toggle defaults to MINE — which is what makes "a task outside
  // your scope" a real state to test rather than a hypothetical one.
  teamRef.current = [
    member({ name: 'Bobby', role: 'ent_lead', email: 'bobby@x.com' }),
    member({ name: 'Trevor', role: 'da', email: 'trevor@x.com' }),
  ];
  permitsRef.current = [];
  holdsRef.current = [];
  tasksRef.current = [
    task({
      id: MINE,
      text: 'Send corrections to the consultants',
      primary_assignee: 'Bobby',
      co_assignees: ['Bobby'],
      status: 'Open',
    }),
    task({
      id: CLOSED,
      text: 'Confirm the intake was accepted',
      primary_assignee: 'Bobby',
      co_assignees: ['Bobby'],
      status: 'Resolved',
      done_at: '2026-05-20',
    }),
    task({
      id: 'dddddddd-4444-4444-4444-444444444444',
      text: 'Somebody else entirely',
      primary_assignee: 'Trevor',
      status: 'Open',
    }),
  ];
  useAuthStore.setState({
    user: { email: 'bobby@x.com' } as never,
    activeTenantId: 'test-tenant',
  });
  window.localStorage.clear();
});

describe('fix-362 §2: ?task= opens the task', () => {
  it('★★★ the detail pane is showing that task, from a cold load', () => {
    renderIt(`/board?task=${MINE}`);
    const pane = screen.getByTestId('mytasks-detail');
    expect(pane.textContent).toContain('Send corrections to the consultants');
  });

  it('★ …and with no parameter the pane is empty, exactly as before', () => {
    renderIt('/board');
    expect(screen.getByTestId('mytasks-detail-empty')).toBeInTheDocument();
  });
});

describe('fix-362 §3: closed is not gone', () => {
  it('★★★ a RESOLVED task is still reachable', () => {
    // fix-355 closed 56 tasks. "Do not confuse completed with gone."
    renderIt(`/board?task=${CLOSED}`);
    expect(screen.getByTestId('mytasks-detail').textContent).toContain(
      'Confirm the intake was accepted',
    );
    expect(screen.queryByTestId('mytasks-detail-missing')).toBeNull();
  });

  it('★★ …and it says so when the task is outside the columns beside it', () => {
    // A resolved task under "active only" is real, opened, and not on the
    // board. Saying so is the difference between a deep link and a detail pane
    // that appears to be showing a card which is not there.
    renderIt(`/board?task=${CLOSED}`);
    expect(
      screen.getByTestId('mytasks-detail-outside-view').textContent,
    ).toContain('Opened from a notification');
    // ★ And the card really is absent from the columns — the note is not
    // decoration, it describes something a person can see is missing.
    expect(screen.queryByTestId(`mytask-card-${CLOSED}`)).toBeNull();
  });

  it('★★★ a task outside your SCOPE is still reachable', () => {
    // ★ The sharper half of "closed is not gone": the board defaults to MINE,
    // and fix-354 routes an auto-closure by a recipient the DATABASE resolved
    // (bp_auto_close_recipient — assignee, then the role's holder, then the
    // permit's ENT lead). Those two answers can differ, and when they do the
    // notification is about a task the board would not show you. A deep link is
    // not bound by somebody's current view.
    renderIt('/board?task=dddddddd-4444-4444-4444-444444444444');
    expect(screen.getByTestId('mytasks-detail').textContent).toContain(
      'Somebody else entirely',
    );
    expect(screen.queryByTestId('mytasks-detail-missing')).toBeNull();
    expect(
      screen.getByTestId('mytasks-detail-outside-view'),
    ).toBeInTheDocument();
  });

  it('★★★ a DELETED task degrades: it says so, and nothing breaks', () => {
    expect(() => renderIt(`/board?task=${GONE}`)).not.toThrow();
    // ★ Lands on the nearest thing that exists — the board itself, still
    // rendered and still usable.
    expect(screen.getByTestId('mytasks-kanban')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-detail-missing').textContent).toContain(
      'That task has been deleted',
    );
    // ★ No 404, no blank pane, no spinner.
    expect(screen.queryByTestId('mytasks-detail-empty')).toBeNull();
  });

  it('★ a live target says nothing about deletion', () => {
    renderIt(`/board?task=${MINE}`);
    expect(screen.queryByTestId('mytasks-detail-missing')).toBeNull();
  });
});

describe('fix-362: the deep link does not fight the person', () => {
  it('★★ clicking another card afterwards moves the pane', () => {
    // ★ Deep-linked to the CLOSED task — which the board's own filters keep off
    // the columns — then a click on a card that IS there.
    renderIt(`/board?task=${CLOSED}`);
    expect(screen.getByTestId('mytasks-detail').textContent).toContain(
      'Confirm the intake was accepted',
    );
    // ★ Applied ONCE per id (the fix-217 pattern), so the parameter does not
    // re-select on every render and pin somebody to it.
    fireEvent.click(screen.getByTestId(`mytask-card-${MINE}`));
    expect(screen.getByTestId('mytasks-detail').textContent).toContain(
      'Send corrections to the consultants',
    );
    // ★ …and the note about being outside the view goes with it.
    expect(screen.queryByTestId('mytasks-detail-outside-view')).toBeNull();
  });
});
