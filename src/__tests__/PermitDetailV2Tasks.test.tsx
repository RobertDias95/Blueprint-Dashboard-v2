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

// fix-229: the primary shows ONCE (in the select's selected option, e.g.
// "Design Associate · Ainsley"); no separate resolved-person chip in edit mode.
function primarySelText(prefix: string): string {
  const s = screen.getByTestId(`${prefix}-primary-select`) as HTMLSelectElement;
  return s.selectedOptions[0]?.textContent ?? '';
}

describe('PermitDetailV2 fix-70 task editor', () => {
  it('renders the task with the labeled PRIMARY (fix-230 default follows discipline) + co-assignee chip', () => {
    renderIt();
    expect(screen.getByTestId('task-row-task-1')).toBeInTheDocument();
    // fix-230: task-1 is discipline='ent', so an UNSET primary defaults to
    // 'Entitlements' → the permit's ent_lead ('Edmund'), NOT the DA. Shown once
    // in the select ("Entitlements · Edmund").
    expect(primarySelText('pb-task-1')).toContain('Edmund');
    // No duplicate resolved-person chip in edit mode.
    expect(screen.queryByTestId('pb-task-1-primary')).toBeNull();
    // Explicit co-assignee chip (shared CoAssigneeEditor).
    expect(screen.getByTestId('pb-task-1-co-assignee-Bobby')).toBeInTheDocument();
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

  // fix-235: click-to-advance checkbox on the permit task row.
  it('checkbox advances an Open task to "In Progress"', () => {
    treeRef.current = [makeTask({ id: 'task-1', status: 'Open', co_assignees: [] })];
    renderIt();
    fireEvent.click(screen.getByTestId('task-check-task-1'));
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      status: 'In Progress',
    });
  });

  it('checkbox advances an "In Progress" task to Resolved', () => {
    treeRef.current = [
      makeTask({ id: 'task-1', status: 'In Progress', co_assignees: [] }),
    ];
    renderIt();
    fireEvent.click(screen.getByTestId('task-check-task-1'));
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      status: 'Resolved',
    });
  });

  it('checkbox on a Resolved task is terminal — no write fires', () => {
    treeRef.current = [
      makeTask({ id: 'task-1', status: 'Resolved', co_assignees: [] }),
    ];
    renderIt();
    // Resolved tasks live in the collapsed "Completed" section — expand it.
    fireEvent.click(screen.getByText(/Completed \(1\)/));
    const box = screen.getByTestId('task-check-task-1');
    expect(box.getAttribute('data-status-visual')).toBe('checked');
    fireEvent.click(box);
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it('the status dropdown (backward control) labels Open as "Not started"', () => {
    treeRef.current = [makeTask({ id: 'task-1', status: 'Open', co_assignees: [] })];
    renderIt();
    const sel = screen.getByTestId('task-status-task-1') as HTMLSelectElement;
    const openOpt = Array.from(sel.options).find((o) => o.value === 'Open');
    expect(openOpt?.textContent).toBe('Not started');
  });

  it('adding a co-assignee replaces the assignee set (existing + new)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('pb-task-1-co-assignee-add'), {
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
    fireEvent.click(screen.getByTestId('pb-task-1-co-assignee-remove-Bobby'));
    expect(setAssigneesMutate.mock.calls[0][0]).toMatchObject({
      taskId: 'task-1',
      assignees: [],
    });
  });

  // fix-228: PRIMARY owner selector — writes assigned_to (team key / person).
  it('the primary selector offers the fix-222 taxonomy + Design Manager', () => {
    renderIt();
    const opts = Array.from(
      (screen.getByTestId('pb-task-1-primary-select') as HTMLSelectElement).options,
    ).map((o) => o.value);
    for (const k of ['Design Associate', 'Entitlements', 'Schematic Team', 'Design Manager']) {
      expect(opts).toContain(k);
    }
  });

  it('picking "Entitlements" writes assigned_to via upsert (resolves to ent_lead)', () => {
    renderIt();
    // The Entitlements option is labeled with the resolved person (ent_lead).
    fireEvent.change(screen.getByTestId('pb-task-1-primary-select'), {
      target: { value: 'Entitlements' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      assignedTo: 'Entitlements',
    });
  });

  it('picking a specific person writes that person to assigned_to', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('pb-task-1-primary-select'), {
      target: { value: 'Carol' },
    });
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      assignedTo: 'Carol',
    });
  });

  // fix-244: changing the PRIMARY owner to a team/role re-buckets the task's
  // Design-view column live (column = team). A person leaves the column as-is.
  describe('fix-244 live re-bucket on primary-team change', () => {
    it("picking a design role ('Design Associate') moves an ENT task to arch", () => {
      // task-1 is discipline='ent'; picking a design team re-derives → 'arch'.
      treeRef.current = [makeTask({ id: 'task-1', discipline: 'ent', co_assignees: [] })];
      renderIt();
      fireEvent.change(screen.getByTestId('pb-task-1-primary-select'), {
        target: { value: 'Design Associate' },
      });
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        id: 'task-1',
        assignedTo: 'Design Associate',
        discipline: 'arch',
      });
    });

    it("picking 'Schematic Team' also moves the task to arch", () => {
      treeRef.current = [makeTask({ id: 'task-1', discipline: 'ent', co_assignees: [] })];
      renderIt();
      fireEvent.change(screen.getByTestId('pb-task-1-primary-select'), {
        target: { value: 'Schematic Team' },
      });
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        assignedTo: 'Schematic Team',
        discipline: 'arch',
      });
    });

    it("picking 'Entitlements' moves an arch task back to ent", () => {
      treeRef.current = [makeTask({ id: 'task-1', discipline: 'arch', co_assignees: [] })];
      renderIt();
      fireEvent.change(screen.getByTestId('pb-task-1-primary-select'), {
        target: { value: 'Entitlements' },
      });
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        assignedTo: 'Entitlements',
        discipline: 'ent',
      });
    });

    it('picking a specific PERSON leaves the discipline unchanged', () => {
      treeRef.current = [makeTask({ id: 'task-1', discipline: 'arch', co_assignees: [] })];
      renderIt();
      fireEvent.change(screen.getByTestId('pb-task-1-primary-select'), {
        target: { value: 'Carol' },
      });
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        assignedTo: 'Carol',
        discipline: 'arch', // unchanged — a person is not a team
      });
    });

    it('the Discipline dropdown still wins (explicit column pick)', () => {
      treeRef.current = [makeTask({ id: 'task-1', discipline: 'ent', co_assignees: [] })];
      renderIt();
      fireEvent.change(screen.getByTestId('task-bucket-task-1'), {
        target: { value: 'arch' },
      });
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        id: 'task-1',
        discipline: 'arch',
      });
    });
  });

  it('a person who is the PRIMARY is not also rendered as a co-assignee chip', () => {
    // assigned_to='Ainsley' (the DA) + co_assignees=[Ainsley, Bobby] → primary
    // Ainsley, co-assignee Bobby only (Ainsley de-duped).
    treeRef.current = [
      makeTask({ id: 'task-1', discipline: 'ent', assigned_to: 'Ainsley', co_assignees: ['Ainsley', 'Bobby'] }),
    ];
    renderIt();
    expect(primarySelText('pb-task-1')).toContain('Ainsley');
    expect(screen.getByTestId('pb-task-1-co-assignee-Bobby')).toBeInTheDocument();
    expect(screen.queryByTestId('pb-task-1-co-assignee-Ainsley')).toBeNull();
  });

  // fix-230: the UNSET default primary follows the task's column/discipline.
  it('an unset ARCH-discipline task defaults its primary to the DA (not ent_lead)', () => {
    treeRef.current = [makeTask({ id: 'task-1', discipline: 'arch', co_assignees: [] })];
    renderIt();
    // arch column → 'Design Associate' → permit.da ('Ainsley').
    expect(primarySelText('pb-task-1')).toContain('Ainsley');
    expect(primarySelText('pb-task-1')).not.toContain('Edmund');
  });

  it('an unset ENT-discipline task defaults its primary to the ent_lead (not the DA)', () => {
    treeRef.current = [makeTask({ id: 'task-1', discipline: 'ent', co_assignees: [] })];
    renderIt();
    // ent column → 'Entitlements' → permit.ent_lead ('Edmund').
    expect(primarySelText('pb-task-1')).toContain('Edmund');
    expect(primarySelText('pb-task-1')).not.toContain('Ainsley');
  });

  // fix-233: the assignee dropdowns offer CURRENT team members only.
  describe('fix-233 active-only assignee options', () => {
    // Ground-truth shape: Chad ended (active=false); Gena is current (active=true).
    const roster: Partial<TeamMember>[] = [
      { name: 'Ainsley', active: true },
      { name: 'Bobby', active: true },
      { name: 'Chad', active: false },
      { name: 'Gena', active: true },
    ];

    it('an inactive member is absent from the primary + co-assignee pickers; an active one is present', () => {
      teamRef.current = roster;
      treeRef.current = [makeTask({ id: 'task-1', discipline: 'arch', co_assignees: [] })];
      renderIt();
      const primaryOpts = Array.from(
        (screen.getByTestId('pb-task-1-primary-select') as HTMLSelectElement).options,
      ).map((o) => o.value);
      expect(primaryOpts).toContain('Gena');
      expect(primaryOpts).not.toContain('Chad');

      const coOpts = Array.from(
        (screen.getByTestId('pb-task-1-co-assignee-add') as HTMLSelectElement).options,
      ).map((o) => o.value);
      expect(coOpts).toContain('Gena');
      expect(coOpts).not.toContain('Chad');
    });

    it('a task already assigned to a now-inactive person still shows them as the current selection (backward display)', () => {
      teamRef.current = roster;
      treeRef.current = [
        makeTask({ id: 'task-1', discipline: 'arch', assigned_to: 'Chad', co_assignees: [] }),
      ];
      renderIt();
      // The stored inactive owner is still reflected as selected (not blanked)…
      expect(
        (screen.getByTestId('pb-task-1-primary-select') as HTMLSelectElement).value,
      ).toBe('Chad');
      // …but Chad is not offered for a NEW pick in the co-assignee picker.
      expect(
        Array.from(
          (screen.getByTestId('pb-task-1-co-assignee-add') as HTMLSelectElement).options,
        ).map((o) => o.value),
      ).not.toContain('Chad');
    });

    it('an inactive co-assignee already on the task still renders as a chip', () => {
      teamRef.current = roster;
      treeRef.current = [
        makeTask({ id: 'task-1', discipline: 'arch', co_assignees: ['Chad'] }),
      ];
      renderIt();
      // The stored inactive co-assignee still shows (fix-224 chip), not blanked.
      expect(screen.getByTestId('pb-task-1-co-assignee-Chad')).toBeInTheDocument();
    });
  });

  // fix-229: an empty date renders a muted "—" (no loud mm/dd/yyyy), not a
  // native date input, until clicked.
  it('an empty date shows a muted "—" placeholder, not a mm/dd/yyyy input', () => {
    renderIt(); // task-1 has start_date/target_date null
    const startEmpty = screen.getByTestId('task-start-task-1-empty');
    expect(startEmpty.textContent).toBe('—');
    expect(screen.queryByTestId('task-start-task-1')).toBeNull(); // no input yet
    // clicking reveals the date input
    fireEvent.click(startEmpty);
    expect(screen.getByTestId('task-start-task-1')).toBeInTheDocument();
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

  // fix-243: a MANUALLY-created task (the column "Add …" input) pre-fills its
  // Start date with today's LOCAL date. Auto-generated / lifecycle tasks use
  // separate creation paths (bp_create_lifecycle_task, seeding) and are not
  // touched by this — the default lives only in the column add handler.
  describe('fix-243 manual add defaults Start to today', () => {
    function localTodayIso(): string {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    it('adding a task via the D&E (ent) add-box sets startDate = today', () => {
      treeRef.current = [];
      renderIt();
      const input = screen.getByTestId('pd-v2-task-add-ent') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'New D&E task' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(upsertMutate).toHaveBeenCalledTimes(1);
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        permitId: 10009,
        discipline: 'ent',
        text: 'New D&E task',
        startDate: localTodayIso(),
      });
    });

    it('adding a task via the Architecture (arch) add-box also sets startDate = today', () => {
      treeRef.current = [];
      renderIt();
      const input = screen.getByTestId('pd-v2-task-add-arch') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'New arch task' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        discipline: 'arch',
        text: 'New arch task',
        startDate: localTodayIso(),
      });
    });

    it('adding a task while Permitting is active still sets startDate = today (bucket=pm)', () => {
      treeRef.current = [];
      renderIt();
      fireEvent.click(screen.getByTestId('pd-v2-task-bucket-bar-pm'));
      const input = screen.getByTestId('pd-v2-task-add-ent') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'New corrections task' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        bucket: 'pm',
        text: 'New corrections task',
        startDate: localTodayIso(),
      });
    });

    it('a subtask (a different creation path) is NOT given a today Start', () => {
      // Proves the default is scoped to the manual COLUMN add handler, not all
      // client task creation — auto/lifecycle/template paths stay untouched.
      renderIt();
      fireEvent.click(screen.getByTestId('task-add-subtask-task-1'));
      const input = screen.getByTestId('task-subtask-input-task-1');
      fireEvent.change(input, { target: { value: 'Order survey' } });
      fireEvent.click(screen.getByTestId('task-subtask-add-task-1'));
      expect(upsertMutate.mock.calls[0][0]).toMatchObject({
        parentTaskId: 'task-1',
        text: 'Order survey',
      });
      expect(upsertMutate.mock.calls[0][0].startDate).toBeUndefined();
    });
  });

  it('renders an existing subtask nested under its parent', () => {
    renderIt();
    expect(screen.getByTestId('task-row-sub-1')).toBeInTheDocument();
    // A subtask has no bucket toggle (inherits the parent discipline).
    expect(screen.queryByTestId('task-bucket-sub-1')).toBeNull();
  });

  it('exposes the Waiting On affordance on each task (fix-149; fix-229 single select)', () => {
    // fix-149 re-introduces Waiting On; fix-229 makes it ONE consistent inline
    // select (whether set or empty) on the meta line — not a chip-vs-dropdown.
    renderIt();
    const sel = screen.getByTestId('task-waiting-on-task-1') as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    expect(screen.getByTestId('task-waiting-on-task-1-option-Civil')).toBeTruthy();
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
    it('renders a number_entry BOT task (bucket=de, cycle_idx=NULL) on a D&E-default permit, with badge + primary', () => {
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
        }),
      ];
      renderPermit({ id: 199, num: null, permit_cycles: [cycle0(null)] });
      // Visible on the DEFAULT D&E tab (the fix-156 bug: it was bucket=pm, hidden).
      expect(screen.getByTestId('task-row-93c131e3')).toBeInTheDocument();
      expect(screen.getByTestId('bot-badge-93c131e3')).toBeInTheDocument();
      // fix-230: unset primary follows the task's discipline — this ent task
      // defaults to 'Entitlements' → the permit's ent_lead ('Edmund').
      expect(primarySelText('pb-93c131e3')).toContain('Edmund');
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
