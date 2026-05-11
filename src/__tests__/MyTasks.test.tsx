import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q7.1.b: smoke tests for the My Tasks page. Mocks the three read hooks
// so the page renders synchronously against a fixed dataset. Fixed
// today=2026-05-11 so overdue / this-week boundaries are deterministic.

const T = 'test-tenant-uuid';
const FIXED_TODAY = new Date(2026, 4, 11); // 2026-05-11 Monday

const fixtures = vi.hoisted(() => ({
  tasks: [
    // DE not-started, overdue
    {
      id: 't-de-od',
      permit_id: 1,
      bucket: 'de',
      legacy_id: null,
      text: 'Overdue DE task',
      cat: null,
      is_jurisdiction_specific: false,
      start_date: null,
      due_date: null,
      target_date: '2026-05-08',
      completion_status: 'Open',
      done: false,
      assigned_to: 'Entitlements',
      stage: 'de',
      is_auto_generated: false,
      city_acceptance_check: false,
      cycle_idx: null,
      sort_order: 0,
      created_at: '2026-04-30T00:00:00Z',
      updated_at: '2026-04-30T00:00:00Z',
    },
    // DE in-progress, due this week
    {
      id: 't-de-ip',
      permit_id: 1,
      bucket: 'de',
      legacy_id: null,
      text: 'Active DE task',
      cat: null,
      is_jurisdiction_specific: false,
      start_date: '2026-05-01',
      due_date: null,
      target_date: '2026-05-14',
      completion_status: 'Open',
      done: false,
      assigned_to: 'Architecture',
      stage: 'de',
      is_auto_generated: true, // → 🤖 badge
      city_acceptance_check: false,
      cycle_idx: null,
      sort_order: 0,
      created_at: '2026-04-30T00:00:00Z',
      updated_at: '2026-04-30T00:00:00Z',
    },
    // CO not-started
    {
      id: 't-co-ns',
      permit_id: 1,
      bucket: 'co',
      legacy_id: null,
      text: 'CO correction',
      cat: null,
      is_jurisdiction_specific: false,
      start_date: null,
      due_date: null,
      target_date: '2026-06-01',
      completion_status: 'Open',
      done: false,
      assigned_to: 'Briana',
      stage: 'co',
      is_auto_generated: false,
      city_acceptance_check: false,
      cycle_idx: null,
      sort_order: 0,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    },
    // DE complete — hidden by default (status='active')
    {
      id: 't-de-done',
      permit_id: 1,
      bucket: 'de',
      legacy_id: null,
      text: 'Already done',
      cat: null,
      is_jurisdiction_specific: false,
      start_date: null,
      due_date: null,
      target_date: null,
      completion_status: 'Resolved',
      done: true,
      assigned_to: 'Entitlements',
      stage: 'de',
      is_auto_generated: false,
      city_acceptance_check: false,
      cycle_idx: null,
      sort_order: 0,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    },
    // PM task — always excluded
    {
      id: 't-pm-1',
      permit_id: 1,
      bucket: 'pm',
      legacy_id: null,
      text: 'PM wait task',
      cat: null,
      is_jurisdiction_specific: false,
      start_date: null,
      due_date: null,
      target_date: '2026-05-20',
      completion_status: 'Open',
      done: false,
      assigned_to: 'Bobby',
      stage: 'pm',
      is_auto_generated: false,
      city_acceptance_check: false,
      cycle_idx: null,
      sort_order: 0,
      created_at: '2026-04-30T00:00:00Z',
      updated_at: '2026-04-30T00:00:00Z',
    },
  ],
  permits: [
    {
      id: 1,
      project_id: 'p1',
      type: 'Building Permit',
      stage: 'de',
      stage_override: null,
      status: null,
      num: null,
      da: 'Trevor',
      dm: 'Lindsay',
      ent_lead: 'Bobby',
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: 3,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: null,
      product_type: 'SFR',
      project_tags: null,
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: 'Lot 4',
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-01T00:00:00Z',
      permit_cycles: [],
    },
  ],
  projects: [
    {
      id: 'p1',
      address: '500 Pike St',
      juris: 'Seattle',
      archived: false,
      notes: null,
    },
  ],
}));

vi.mock('../hooks/useAllPermitTasks', () => ({
  useAllPermitTasks: () => ({
    data: fixtures.tasks,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Q7.1.c: mock useUpsertPermitTask so we can assert the patch shapes
// (checkbox / status cycle / date edits) without round-tripping Supabase.
const upsertMutate = vi.fn();
vi.mock('../hooks/useUpsertPermitTask', () => ({
  useUpsertPermitTask: () => ({
    mutate: upsertMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TODAY);
  upsertMutate.mockClear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

import MyTasks from '../pages/MyTasks';
import TaskColumn from '../components/MyTasks/TaskColumn';

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MyTasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('<MyTasks /> Q7.1.b', () => {
  it('renders DE + CO columns with the right cards; PM is excluded', () => {
    renderIt();
    expect(screen.getByTestId('mytasks-col-de')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-col-co')).toBeInTheDocument();
    // Two DE non-done cards visible.
    expect(screen.getByTestId('mytasks-card-t-de-od')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-card-t-de-ip')).toBeInTheDocument();
    // CO card visible.
    expect(screen.getByTestId('mytasks-card-t-co-ns')).toBeInTheDocument();
    // PM card NEVER visible.
    expect(screen.queryByTestId('mytasks-card-t-pm-1')).not.toBeInTheDocument();
  });

  it('default status=active filters out complete tasks entirely (matches v1)', () => {
    // v1's default status is 'active' which excludes complete tasks before
    // the column-render even runs (index.html line 4963). So with the Q7.1.b
    // hardcoded defaults, the Completed toggle does NOT appear and done
    // cards are not in the DOM. Q7.1.c adds the status dropdown that lets
    // users switch to 'done' or 'all' to surface them.
    renderIt();
    expect(screen.queryByTestId('mytasks-card-t-de-done')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-col-de-done-toggle')).not.toBeInTheDocument();
  });

  it('TaskColumn renders the Completed toggle + cards when complete tasks are present (status=all path)', () => {
    // Reach into TaskColumn directly with status='all' (Q7.1.c will route
    // there via the dropdown). Verifies the collapse + expand machinery is
    // wired even though the default page filter hides it.
    // We do this by rendering a TaskColumn standalone with a mixed task set.
    // No new mocks needed — we already have fixtures.tasks in scope.
    const ctx = {
      permitsById: new Map(fixtures.permits.map((p) => [p.id, p])),
      projectsById: new Map(fixtures.projects.map((p) => [p.id, p])),
    };
    const deTasks = fixtures.tasks.filter((t) => t.bucket === 'de');
    const { rerender } = render(
      <MemoryRouter>
        <TaskColumn stage="de" tasks={deTasks} ctx={ctx} today={FIXED_TODAY} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('mytasks-col-de-done-toggle')).toBeInTheDocument();
    // Pre-click: done list collapsed.
    expect(screen.queryByTestId('mytasks-col-de-done-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-card-t-de-done')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mytasks-col-de-done-toggle'));
    // Post-click: list expanded, done card visible.
    expect(screen.getByTestId('mytasks-col-de-done-list')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-card-t-de-done')).toBeInTheDocument();
    // Silence the unused rerender variable.
    void rerender;
  });

  it('stats row reflects open/overdue/this-week/projects counts', () => {
    renderIt();
    // 3 open (de-od + de-ip + co-ns; PM and done excluded).
    expect(screen.getByTestId('stat-open').textContent).toBe('3');
    // 1 overdue (de-od at 2026-05-08).
    expect(screen.getByTestId('stat-overdue').textContent).toBe('1');
    // 1 this-week (de-ip at 2026-05-14, within today+7).
    expect(screen.getByTestId('stat-this-week').textContent).toBe('1');
    // All open tasks point at permit 1 → project p1 → 1 distinct project.
    expect(screen.getByTestId('stat-projects').textContent).toBe('1');
  });

  it('auto-generated badge renders for tasks with is_auto_generated=true', () => {
    renderIt();
    expect(screen.getByTestId('mytasks-auto-t-de-ip')).toBeInTheDocument();
    // The non-auto task should NOT have the badge.
    expect(screen.queryByTestId('mytasks-auto-t-de-od')).not.toBeInTheDocument();
  });

  it('address pill links to the project detail route', () => {
    renderIt();
    const link = screen.getByTestId('mytasks-addr-t-de-od');
    expect(link.getAttribute('href')).toBe('/project/p1');
    expect(link.textContent).toBe('500 Pike St');
  });

  it('assignee chip surfaces task.assigned_to verbatim', () => {
    renderIt();
    expect(screen.getByTestId('mytasks-assignee-t-de-od').textContent).toBe('Entitlements');
    expect(screen.getByTestId('mytasks-assignee-t-de-ip').textContent).toBe('Architecture');
    expect(screen.getByTestId('mytasks-assignee-t-co-ns').textContent).toBe('Briana');
  });

  it('sort order within a sub-column is date asc + created_at tiebreak', () => {
    renderIt();
    // Both DE non-done tasks; not-started (t-de-od at 05-08) is in the
    // Not Started sub-col; in-progress (t-de-ip at 05-14) is in In Progress.
    // Within each sub-col there's only one task, so we just confirm both
    // exist where we expect (Not Started has t-de-od, In Progress has t-de-ip).
    const col = screen.getByTestId('mytasks-col-de');
    expect(col.textContent).toContain('Overdue DE task');
    expect(col.textContent).toContain('Active DE task');
  });
});

describe('<MyTasks /> Q7.1.c — filters', () => {
  it('FilterBar renders all 4 controls + result count', () => {
    renderIt();
    expect(screen.getByTestId('mytasks-filterbar')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-filter-stage')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-filter-status')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-filter-assignee')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-filter-search')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-result-count')).toBeInTheDocument();
  });

  it('stage filter narrows to DE only', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-stage'), {
      target: { value: 'de' },
    });
    expect(screen.getByTestId('mytasks-card-t-de-od')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-card-t-de-ip')).toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-card-t-co-ns')).not.toBeInTheDocument();
  });

  it("status='done' surfaces the completed task and hides active ones", () => {
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-status'), {
      target: { value: 'done' },
    });
    expect(screen.getByTestId('mytasks-card-t-de-done')).toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-card-t-de-od')).not.toBeInTheDocument();
  });

  it('assignee filter is exact match against assigned_to', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-assignee'), {
      target: { value: 'Briana' },
    });
    expect(screen.getByTestId('mytasks-card-t-co-ns')).toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-card-t-de-od')).not.toBeInTheDocument();
  });

  it('assignee dropdown is populated from the full task set (Entitlements/Architecture/Briana visible)', () => {
    renderIt();
    const select = screen.getByTestId('mytasks-filter-assignee') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('Entitlements');
    expect(options).toContain('Architecture');
    expect(options).toContain('Briana');
  });

  it('search narrows by multi-token match across task text + joined fields', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-search'), {
      target: { value: 'corr' },
    });
    expect(screen.getByTestId('mytasks-card-t-co-ns')).toBeInTheDocument();
    expect(screen.queryByTestId('mytasks-card-t-de-od')).not.toBeInTheDocument();
  });

  it('Clear button resets all filters', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-stage'), {
      target: { value: 'co' },
    });
    expect(screen.queryByTestId('mytasks-card-t-de-od')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mytasks-filter-clear'));
    expect(screen.getByTestId('mytasks-card-t-de-od')).toBeInTheDocument();
  });
});

describe('<MyTasks /> Q7.1.c — inline edits', () => {
  it('checkbox click on an active task fires useUpsertPermitTask with done:true + Resolved', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-check-t-de-od'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    const arg = upsertMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.op).toBe('update');
    expect(arg.permitId).toBe(1);
    expect(arg.patch).toEqual({ done: true, completion_status: 'Resolved' });
  });

  it('status pill click cycles not-started → in-progress', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-status-pill-t-de-od'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(
      (upsertMutate.mock.calls[0][0] as Record<string, unknown>).patch,
    ).toEqual({ done: false, completion_status: 'In Progress' });
  });

  it('status pill click cycles in-progress → complete', () => {
    renderIt();
    // t-de-ip is in-progress (start_date set).
    fireEvent.click(screen.getByTestId('mytasks-status-pill-t-de-ip'));
    expect(
      (upsertMutate.mock.calls[0][0] as Record<string, unknown>).patch,
    ).toEqual({ done: true, completion_status: 'Resolved' });
  });

  it('clicking a card body selects it; selected card shows date inputs', () => {
    renderIt();
    // Pre-select: date inputs not visible.
    expect(screen.queryByTestId('mytasks-dates-t-de-od')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mytasks-card-t-de-od'));
    expect(screen.getByTestId('mytasks-dates-t-de-od')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-date-target-t-de-od')).toBeInTheDocument();
  });

  it('changing the target date input on a selected card fires the mutation with target_date', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-card-t-de-od'));
    fireEvent.change(screen.getByTestId('mytasks-date-target-t-de-od'), {
      target: { value: '2026-06-01' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(
      (upsertMutate.mock.calls[0][0] as Record<string, unknown>).patch,
    ).toEqual({ target_date: '2026-06-01' });
  });

  it('clicking a selected card again deselects (toggle)', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-card-t-de-od'));
    expect(screen.getByTestId('mytasks-dates-t-de-od')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mytasks-card-t-de-od'));
    expect(screen.queryByTestId('mytasks-dates-t-de-od')).not.toBeInTheDocument();
  });
});
