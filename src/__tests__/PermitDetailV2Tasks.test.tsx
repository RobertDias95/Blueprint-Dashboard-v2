import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  PermitCycle,
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

  it('exposes the Waiting On affordance on each task (fix-149, was removed in fix-70)', () => {
    // fix-149 re-introduces Waiting On to the permit-detail task editor (as an
    // inline chip resolving the project's External Team firm). Flipped from the
    // old fix-70 assertion that it was absent.
    renderIt();
    expect(screen.getAllByText(/\+ Waiting On/i).length).toBeGreaterThan(0);
  });

  // fix-79: D&E / Permitting toggle bars are a real filter. Active bar
  // accent-borders + shows counts, only that bucket's tasks render below, and
  // "+ Add task" defaults new rows to the active bucket.
  describe('fix-79 D&E/Permitting bucket toggle', () => {
    it('renders both bars with done/total counts and Permitting hidden by default when no c0.intake_accepted', () => {
      treeRef.current = [
        makeTask({ id: 't-de-open',   bucket: 'de', status: 'Open',     text: 'Pre-submit task' }),
        makeTask({ id: 't-de-resolved', bucket: 'de', status: 'Resolved', text: 'Done D&E task' }),
        makeTask({ id: 't-pm-open',   bucket: 'pm', status: 'Open',     text: 'Permitting task' }),
      ];
      renderIt();
      // D&E bar is active by default (the permit fixture has no c0.intake_accepted).
      const deBar = screen.getByTestId('pd-v2-task-bucket-bar-de');
      const pmBar = screen.getByTestId('pd-v2-task-bucket-bar-pm');
      expect(deBar.getAttribute('data-active')).toBe('true');
      expect(pmBar.getAttribute('data-active')).toBe('false');
      // fix-123: chip is {done}/{total} per Bobby's spec (was open/total
      // pre-fix-123). D&E has 1 resolved / 2 total, Permitting 0 / 1.
      expect(screen.getByTestId('pd-v2-task-bucket-count-de').textContent).toBe('1/2');
      expect(screen.getByTestId('pd-v2-task-bucket-count-pm').textContent).toBe('0/1');
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

  // ============================================================
  // fix-123: phase tabs snap on c0.intake_accepted null↔non-null
  // ============================================================
  describe('fix-123 phase tabs auto-snap + v1 visual hierarchy', () => {
    function makeCycle(
      over: Omit<Partial<PermitCycle>, 'cycle_index'> & { cycle_index: number },
    ): PermitCycle {
      const { cycle_index, ...rest } = over;
      return {
        id: `cy-${cycle_index}`,
        permit_id: 10009,
        cycle_index,
        submitted: null,
        city_target: null,
        corr_issued: null,
        resubmitted: null,
        intake_accepted: null,
        created_at: '2026-05-14T12:00:00Z',
        updated_at: '2026-05-14T12:00:00Z',
        ...rest,
      };
    }

    function renderWithCycles(cycles: PermitCycle[]) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      return render(
        <PermitDetailV2 permit={{ ...makePermit(), permit_cycles: cycles }} />,
        { wrapper },
      );
    }

    it('mounts on D&E when c0.intake_accepted is null', () => {
      renderWithCycles([makeCycle({ cycle_index: 0 })]);
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-de').getAttribute('data-active'),
      ).toBe('true');
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-pm').getAttribute('data-active'),
      ).toBe('false');
    });

    it('mounts on Permitting when c0.intake_accepted is set', () => {
      renderWithCycles([
        makeCycle({
          cycle_index: 0,
          submitted: '2026-05-20',
          intake_accepted: '2026-05-22',
        }),
      ]);
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-pm').getAttribute('data-active'),
      ).toBe('true');
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-de').getAttribute('data-active'),
      ).toBe('false');
    });

    it('manual click on D&E when mounted on Permitting swaps the active tab (manual toggle, no snap)', () => {
      renderWithCycles([
        makeCycle({
          cycle_index: 0,
          submitted: '2026-05-20',
          intake_accepted: '2026-05-22',
        }),
      ]);
      fireEvent.click(screen.getByTestId('pd-v2-task-bucket-bar-de'));
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-de').getAttribute('data-active'),
      ).toBe('true');
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-pm').getAttribute('data-active'),
      ).toBe('false');
    });

    // Auto-snap: a controlled host flips c0.intake_accepted in place
    // (mirrors what React Query does after a cache write). The snap
    // useEffect should fire on the null → non-null transition even if
    // the user had manually toggled to D&E in the meantime — the moment
    // intake_accepted actually changes wins.
    it('snaps from D&E → Permitting when c0.intake_accepted goes null → date', () => {
      function Host() {
        const [accepted, setAccepted] = useState<string | null>(null);
        const cycles: PermitCycle[] = [
          makeCycle({ cycle_index: 0, intake_accepted: accepted }),
        ];
        return (
          <>
            <button
              type="button"
              data-testid="host-accept"
              onClick={() => setAccepted('2026-05-22')}
            />
            <PermitDetailV2 permit={{ ...makePermit(), permit_cycles: cycles }} />
          </>
        );
      }
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      render(<Host />, { wrapper });
      // Mount: D&E active.
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-de').getAttribute('data-active'),
      ).toBe('true');
      // Flip c0.intake_accepted → snap fires.
      fireEvent.click(screen.getByTestId('host-accept'));
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-pm').getAttribute('data-active'),
      ).toBe('true');
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-de').getAttribute('data-active'),
      ).toBe('false');
    });

    it('snaps Permitting → D&E when c0.intake_accepted goes date → null (rare clear)', () => {
      function Host() {
        const [accepted, setAccepted] = useState<string | null>('2026-05-22');
        const cycles: PermitCycle[] = [
          makeCycle({ cycle_index: 0, intake_accepted: accepted }),
        ];
        return (
          <>
            <button
              type="button"
              data-testid="host-clear"
              onClick={() => setAccepted(null)}
            />
            <PermitDetailV2 permit={{ ...makePermit(), permit_cycles: cycles }} />
          </>
        );
      }
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      render(<Host />, { wrapper });
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-pm').getAttribute('data-active'),
      ).toBe('true');
      fireEvent.click(screen.getByTestId('host-clear'));
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-de').getAttribute('data-active'),
      ).toBe('true');
    });

    // The snap is strictly gated on the null↔non-null transition: if the
    // user manually toggles to D&E on a post-intake permit AND intake_accepted
    // doesn't change, they stay on D&E. Pin this so a future refactor
    // doesn't re-introduce the "every render snaps" footgun.
    it('does NOT snap back to Permitting when user manually toggles D&E on a post-intake permit', () => {
      renderWithCycles([
        makeCycle({
          cycle_index: 0,
          intake_accepted: '2026-05-22',
        }),
      ]);
      // Mounts on Permitting; user clicks D&E.
      fireEvent.click(screen.getByTestId('pd-v2-task-bucket-bar-de'));
      // No intake_accepted change — the next render must NOT undo the toggle.
      // (Trigger a render by clicking the same tab again; it's a no-op for
      // state but a real render cycle.)
      fireEvent.click(screen.getByTestId('pd-v2-task-bucket-bar-de'));
      expect(
        screen.getByTestId('pd-v2-task-bucket-bar-de').getAttribute('data-active'),
      ).toBe('true');
    });

    it('Add input placeholder on D&E phase says "Add D&E task…"', () => {
      renderWithCycles([makeCycle({ cycle_index: 0 })]);
      const input = screen.getByTestId('pd-v2-task-add-ent') as HTMLInputElement;
      expect(input.placeholder).toBe('Add D&E task…');
    });

    it('Add input placeholder on Permitting + open corrections cycle says "Add correction…"', () => {
      renderWithCycles([
        makeCycle({
          cycle_index: 0,
          submitted: '2026-05-20',
          intake_accepted: '2026-05-22',
        }),
        // Open corrections: corr_issued set, no resubmitted.
        makeCycle({
          cycle_index: 1,
          submitted: '2026-05-22',
          city_target: '2026-06-15',
          corr_issued: '2026-06-10',
          resubmitted: null,
        }),
      ]);
      const input = screen.getByTestId('pd-v2-task-add-ent') as HTMLInputElement;
      expect(input.placeholder).toBe('Add correction…');
    });

    it('Add input placeholder on Permitting WITHOUT corrections says "Add permitting task…"', () => {
      renderWithCycles([
        makeCycle({
          cycle_index: 0,
          submitted: '2026-05-20',
          intake_accepted: '2026-05-22',
        }),
        // Plain in-review cycle: no corr_issued yet.
        makeCycle({
          cycle_index: 1,
          submitted: '2026-05-22',
          city_target: '2026-06-15',
        }),
      ]);
      const input = screen.getByTestId('pd-v2-task-add-ent') as HTMLInputElement;
      expect(input.placeholder).toBe('Add permitting task…');
    });

    it('Add button color matches the active phase (blue on D&E, orange on Permitting)', () => {
      renderWithCycles([makeCycle({ cycle_index: 0 })]);
      const btn = screen.getByTestId('pd-v2-task-add-btn-ent');
      // D&E phase → blue (var(--color-de)).
      expect((btn as HTMLElement).style.background).toContain('--color-de');
      // Toggle to Permitting → orange (var(--color-co)).
      fireEvent.click(screen.getByTestId('pd-v2-task-bucket-bar-pm'));
      expect((btn as HTMLElement).style.background).toContain('--color-co');
    });

    it('active phase tab carries the v1 visual treatment (solid color background + white text)', () => {
      renderWithCycles([makeCycle({ cycle_index: 0 })]);
      const deBar = screen.getByTestId('pd-v2-task-bucket-bar-de') as HTMLElement;
      const pmBar = screen.getByTestId('pd-v2-task-bucket-bar-pm') as HTMLElement;
      // D&E active: solid blue background, white text.
      expect(deBar.style.background).toContain('--color-de');
      expect(deBar.style.background).not.toContain('--color-de-bg');
      expect(deBar.style.color).toBe('rgb(255, 255, 255)');
      // Permitting inactive: washed orange background, muted text.
      expect(pmBar.style.background).toContain('--color-co-bg');
      expect(pmBar.style.color).toContain('--color-muted');
    });
  });

  // ============================================================
  // fix-156: BOT task parity — Permit Detail render + derived assignment
  // ============================================================
  describe('fix-156 BOT task parity', () => {
    function cycle0(intakeAccepted: string | null): PermitCycle {
      return {
        id: 'cy-0', permit_id: 10009, cycle_index: 0, submitted: null,
        city_target: null, corr_issued: null, resubmitted: null,
        intake_accepted: intakeAccepted, created_at: '2026-05-14T12:00:00Z',
        updated_at: '2026-05-14T12:00:00Z',
      } as PermitCycle;
    }
    function renderPermit(over: Partial<PermitWithCycles>) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      return render(
        <PermitDetailV2 permit={{ ...makePermit(), ...over }} />,
        { wrapper },
      );
    }

    // Prod shape A: permit 199 — number_entry, bucket=de (fix-156), cycle_idx=NULL,
    // on a numberless permit whose tab defaults to D&E.
    it('renders a number_entry BOT task (bucket=de, cycle_idx=NULL) on a D&E-default permit, with badge + DERIVED primary', () => {
      treeRef.current = [
        makeTask({
          id: '93c131e3',
          bucket: 'de',
          discipline: 'ent',
          // (cycle_idx is a permit_tasks column but not part of the TaskNode
          // read shape — the RPCs don't return it and the row render never
          // reads it; the render difference is bucket + the permit's tab.)
          is_auto_generated: true,
          auto_event: 'number_entry',
          text: 'Enter permit number — was this submitted? — SDOT Tree @ 4506 14th Ave SW',
          // derived from permit.ent_lead ('Edmund'); no static assigned_to.
          primary_assignee: 'Edmund',
        }),
      ];
      renderPermit({ id: 199, num: null, permit_cycles: [cycle0(null)] });
      // Visible on the DEFAULT D&E tab (the fix-156 bug: it was bucket=pm, hidden).
      expect(screen.getByTestId('task-row-93c131e3')).toBeInTheDocument();
      expect(screen.getByTestId('bot-badge-93c131e3')).toBeInTheDocument();
      // Assignment is derived (shown as the primary chip), follows permit.ent_lead.
      expect(screen.getByTestId('task-primary-93c131e3').textContent).toBe('Edmund');
      expect(
        (screen.getByTestId('task-text-93c131e3') as HTMLInputElement).value,
      ).toBe('Enter permit number — was this submitted? — SDOT Tree @ 4506 14th Ave SW');
    });

    // Prod shape B: permit 240 — resubmitted, bucket=pm, cycle_idx=1, on a permit
    // whose tab defaults to Permitting (c0.intake_accepted set). Already rendered
    // correctly pre-fix-156; this guards the parity.
    it('renders a resubmitted BOT task (bucket=pm, cycle_idx=1) on a Permitting-default permit', () => {
      treeRef.current = [
        makeTask({
          id: '176a6005',
          bucket: 'pm',
          discipline: 'ent',
          is_auto_generated: true,
          auto_event: 'resubmitted',
          text: 'Verify: city accepted resubmission (cycle 1) — 7125875-CN',
          primary_assignee: 'Edmund',
        }),
      ];
      renderPermit({ id: 240, num: '7125875-CN', permit_cycles: [cycle0('2026-03-13')] });
      expect(screen.getByTestId('task-row-176a6005')).toBeInTheDocument();
      expect(screen.getByTestId('bot-badge-176a6005')).toBeInTheDocument();
      expect(
        (screen.getByTestId('task-text-176a6005') as HTMLInputElement).value,
      ).toBe('Verify: city accepted resubmission (cycle 1) — 7125875-CN');
    });

    it('completing a BOT task fires the upsert with status="Resolved" (full parity action)', () => {
      treeRef.current = [
        makeTask({
          id: 'bot-c', bucket: 'de', discipline: 'ent', is_auto_generated: true,
          auto_event: 'number_entry', text: 'Enter permit number…', primary_assignee: 'Edmund',
        }),
      ];
      renderPermit({ id: 199, permit_cycles: [cycle0(null)] });
      fireEvent.change(screen.getByTestId('task-status-bot-c'), {
        target: { value: 'Resolved' },
      });
      expect(upsertMutate).toHaveBeenCalledTimes(1);
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        id: 'bot-c',
        status: 'Resolved',
      });
    });

    it('priority BOT task (corr_issued) sorts above a non-priority task in the same column', () => {
      treeRef.current = [
        makeTask({ id: 'plain', bucket: 'pm', discipline: 'ent', text: 'plain', sort_order: 0 }),
        makeTask({
          id: 'bot-prio', bucket: 'pm', discipline: 'ent', text: 'corr', sort_order: 1,
          priority: true, is_auto_generated: true, auto_event: 'corr_issued',
        }),
      ];
      renderPermit({ id: 240, permit_cycles: [cycle0('2026-03-13')] }); // pm default
      const prio = screen.getByTestId('task-row-bot-prio');
      const plain = screen.getByTestId('task-row-plain');
      // priority task precedes the plain one despite a higher sort_order.
      expect(
        prio.compareDocumentPosition(plain) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });
});
