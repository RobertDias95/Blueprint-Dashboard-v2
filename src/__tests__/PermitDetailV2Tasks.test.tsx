import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  PermitWithCycles,
  TaskNode,
  TeamMember,
} from '../lib/database.types';

// fix-70: v1-parity task editor on the permit detail page. These tests mock the
// task RPCs (via the useTaskTree hooks) + team roster so we can drive the
// editor and assert the mutations it fires.

const upsertMutate = vi.hoisted(() => vi.fn());
const deleteMutate = vi.hoisted(() => vi.fn());
const setAssigneesMutate = vi.hoisted(() => vi.fn());
const treeRef = vi.hoisted(() => ({ current: [] as TaskNode[] }));
const teamRef = vi.hoisted(() => ({ current: [] as Partial<TeamMember>[] }));

vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpsertPermitCycle', () => ({
  useUpsertPermitCycle: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDeletePermitCycle', () => ({
  useDeletePermitCycle: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePermitTasks', () => ({
  usePermitTasks: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../components/ProjectDetail/ScheduleEstimator', () => ({
  default: () => <div data-testid="stub-schedule-estimator" />,
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: teamRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  usePermitTaskTree: () => ({
    data: treeRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertTask: () => ({ mutate: upsertMutate, isPending: false }),
  useDeleteTask: () => ({ mutate: deleteMutate, isPending: false }),
  useSetTaskAssignees: () => ({ mutate: setAssigneesMutate, isPending: false }),
}));

import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';

function makePermit(): PermitWithCycles {
  return {
    id: 10009,
    project_id: 'p-test',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: null,
    num: null,
    da: 'Ainsley',
    dm: null,
    ent_lead: 'Edmund',
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
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
    updated_at: '2026-05-14T12:00:00Z',
    permit_cycles: [],
  };
}

function makeTask(over: Partial<TaskNode> & Pick<TaskNode, 'id'>): TaskNode {
  return {
    permit_id: 10009,
    parent_task_id: null,
    discipline: 'ent',
    bucket: 'de',
    text: 'Submit application',
    status: 'Open',
    start_date: null,
    target_date: null,
    done_at: null,
    sort_order: 0,
    primary_assignee: 'Edmund',
    co_assignees: [],
    subtasks: [],
    ...over,
  };
}

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<PermitDetailV2 permit={makePermit()} />, { wrapper });
}

beforeEach(() => {
  upsertMutate.mockReset();
  deleteMutate.mockReset();
  setAssigneesMutate.mockReset();
  teamRef.current = [
    { name: 'Ainsley', email: 'ainsley@x.com' },
    { name: 'Bobby', email: 'bobby@x.com' },
    { name: 'Carol', email: 'carol@x.com' },
    { name: 'Edmund', email: 'edmund@x.com' },
  ];
  treeRef.current = [
    makeTask({
      id: 'task-1',
      discipline: 'ent',
      co_assignees: ['Bobby'],
      subtasks: [
        makeTask({
          id: 'sub-1',
          parent_task_id: 'task-1',
          text: 'Gather docs',
          co_assignees: [],
          subtasks: undefined,
        }),
      ],
    }),
  ];
});

describe('PermitDetailV2 fix-70 task editor', () => {
  it('renders the task in its discipline column with the derived primary + co-assignee chip', () => {
    renderIt();
    expect(screen.getByTestId('task-row-task-1')).toBeInTheDocument();
    // Primary is derived (ent -> permit.ent_lead = 'Edmund').
    expect(screen.getByTestId('task-primary-task-1').textContent).toBe('Edmund');
    // Explicit co-assignee chip.
    expect(screen.getByTestId('task-assignee-task-1-Bobby')).toBeInTheDocument();
  });

  it('flipping the discipline dropdown moves the task to the other column (upsert with new discipline)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('task-bucket-task-1'), {
      target: { value: 'arch' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    // fix-79: the hook arg renamed bucket → discipline (the OLD `bucket`
    // RPC param meant the discipline axis; the NEW `bucket` is the lifecycle
    // phase de/pm).
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      discipline: 'arch',
    });
  });

  it('changing status fires an upsert with the new status', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('task-status-task-1'), {
      target: { value: 'Resolved' },
    });
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      status: 'Resolved',
    });
  });

  it('adding a co-assignee replaces the assignee set (existing + new)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('task-assign-task-1'), {
      target: { value: 'Carol' },
    });
    expect(setAssigneesMutate).toHaveBeenCalledTimes(1);
    expect(setAssigneesMutate.mock.calls[0][0]).toMatchObject({
      taskId: 'task-1',
      assignees: ['Bobby', 'Carol'],
    });
  });

  it('removing a co-assignee replaces the set without that name', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('task-unassign-task-1-Bobby'));
    expect(setAssigneesMutate.mock.calls[0][0]).toMatchObject({
      taskId: 'task-1',
      assignees: [],
    });
  });

  it('+ subtask creates a child task with the parent id set', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('task-add-subtask-task-1'));
    const input = screen.getByTestId('task-subtask-input-task-1');
    fireEvent.change(input, { target: { value: 'Order survey' } });
    fireEvent.click(screen.getByTestId('task-subtask-add-task-1'));
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      parentTaskId: 'task-1',
      text: 'Order survey',
    });
  });

  it('renders an existing subtask nested under its parent', () => {
    renderIt();
    expect(screen.getByTestId('task-row-sub-1')).toBeInTheDocument();
    // A subtask has no bucket toggle (inherits the parent discipline).
    expect(screen.queryByTestId('task-bucket-sub-1')).toBeNull();
  });

  it('has NO "Waiting on" element (removed in fix-70)', () => {
    renderIt();
    expect(screen.queryByText(/waiting on/i)).toBeNull();
  });

  // fix-79: D&E / Permitting toggle bars are a real filter. Active bar
  // accent-borders + shows counts, only that bucket's tasks render below, and
  // "+ Add task" defaults new rows to the active bucket.
  describe('fix-79 D&E/Permitting bucket toggle', () => {
    it('renders both bars with open/total counts and Permitting hidden by default when no c0.submitted', () => {
      treeRef.current = [
        makeTask({ id: 't-de-open',   bucket: 'de', status: 'Open',     text: 'Pre-submit task' }),
        makeTask({ id: 't-de-resolved', bucket: 'de', status: 'Resolved', text: 'Done D&E task' }),
        makeTask({ id: 't-pm-open',   bucket: 'pm', status: 'Open',     text: 'Permitting task' }),
      ];
      renderIt();
      // D&E bar is active by default (the permit fixture has no c0.submitted).
      const deBar = screen.getByTestId('pd-v2-task-bucket-bar-de');
      const pmBar = screen.getByTestId('pd-v2-task-bucket-bar-pm');
      expect(deBar.getAttribute('data-active')).toBe('true');
      expect(pmBar.getAttribute('data-active')).toBe('false');
      // Counts: D&E has 1 open / 2 total, Permitting 1 / 1.
      expect(screen.getByTestId('pd-v2-task-bucket-count-de').textContent).toBe('1/2');
      expect(screen.getByTestId('pd-v2-task-bucket-count-pm').textContent).toBe('1/1');
      // D&E tasks render; Permitting task hidden.
      expect(screen.getByTestId('task-row-t-de-open')).toBeInTheDocument();
      expect(screen.queryByTestId('task-row-t-pm-open')).toBeNull();
    });

    it('clicking the Permitting bar filters to bucket="pm" tasks', () => {
      treeRef.current = [
        makeTask({ id: 't-de-open', bucket: 'de', text: 'Pre-submit task' }),
        makeTask({ id: 't-pm-open', bucket: 'pm', text: 'Corrections response' }),
      ];
      renderIt();
      fireEvent.click(screen.getByTestId('pd-v2-task-bucket-bar-pm'));
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-pm').getAttribute('data-active'),
      ).toBe('true');
      expect(screen.getByTestId('task-row-t-pm-open')).toBeInTheDocument();
      expect(screen.queryByTestId('task-row-t-de-open')).toBeNull();
    });

    it('"+ Add task" with Permitting active creates the new task with bucket="pm"', () => {
      treeRef.current = [
        makeTask({ id: 't-de-open', bucket: 'de', discipline: 'ent', text: 'existing' }),
      ];
      renderIt();
      fireEvent.click(screen.getByTestId('pd-v2-task-bucket-bar-pm'));
      // The ENT column's add input is visible regardless of the active bucket
      // (the filter just controls which existing rows show + the new row's
      // bucket). Type + Enter to add.
      const input = screen.getByTestId('pd-v2-task-add-ent') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'New corrections task' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(upsertMutate).toHaveBeenCalledTimes(1);
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        permitId: 10009,
        discipline: 'ent',
        bucket: 'pm', // ← key assertion: active bucket flowed into the new task
        text: 'New corrections task',
      });
    });
  });
});
