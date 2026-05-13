import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Permit, PermitTask, Project } from '../lib/database.types';
import type { FilterContext } from '../lib/myTasksHelpers';

// Q9.5.f-fix-2 B: TaskDetailPanel editable form tests. Mocks the
// useUpsertPermitTask hook so we can assert that text/status/date edits
// dispatch the right patch shape, without hitting Supabase.

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

import TaskDetailPanel from '../components/MyTasks/TaskDetailPanel';

beforeEach(() => {
  upsertMutate.mockClear();
});

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 11,
    project_id: 'p1',
    type: 'Building Permit',
    stage: null,
    stage_override: null,
    status: null,
    num: 'BP-2026-1',
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    go_date: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    units: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    zone: null,
    product_type: null,
    project_tags: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '100 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...over,
  };
}

function task(over: Partial<PermitTask> = {}): PermitTask {
  return {
    id: 't1',
    permit_id: 11,
    bucket: 'de',
    legacy_id: null,
    text: 'Submit zoning review',
    cat: null,
    is_jurisdiction_specific: false,
    start_date: null,
    due_date: null,
    target_date: null,
    completion_status: 'Open',
    done: false,
    assigned_to: 'Entitlements',
    stage: 'de',
    is_auto_generated: false,
    city_acceptance_check: false,
    cycle_idx: null,
    sort_order: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...over,
  };
}

function ctx(): FilterContext {
  return {
    permitsById: new Map([[11, permit()]]),
    projectsById: new Map([['p1', project()]]),
  };
}

function renderPanel(t: PermitTask | null = task()) {
  return render(
    <MemoryRouter>
      <TaskDetailPanel
        task={t}
        ctx={ctx()}
        assigneeOptions={['Bobby', 'Briana']}
      />
    </MemoryRouter>,
  );
}

describe('<TaskDetailPanel />', () => {
  it('renders empty state when no task is selected', () => {
    renderPanel(null);
    expect(screen.getByTestId('mt-task-detail-empty')).toBeTruthy();
  });

  it('renders the address + permit + status when a task is selected', () => {
    renderPanel();
    expect(screen.getByText('100 Pike St')).toBeTruthy();
    expect(screen.getByText(/Building Permit/)).toBeTruthy();
    const statusSel = screen.getByTestId('mt-detail-status') as HTMLSelectElement;
    expect(statusSel.value).toBe('Open');
  });

  it('changing task text dispatches an update patch on blur', () => {
    renderPanel();
    const textarea = screen.getByTestId('mt-detail-text') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'New task text' } });
    fireEvent.blur(textarea);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      op: 'update',
      permitId: 11,
      patch: { text: 'New task text' },
    });
  });

  it('changing status dispatches a completion_status patch immediately', () => {
    renderPanel();
    const sel = screen.getByTestId('mt-detail-status') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'Resolved' } });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      op: 'update',
      permitId: 11,
      patch: { completion_status: 'Resolved' },
    });
  });

  it('changing the target date dispatches a target_date patch immediately', () => {
    renderPanel();
    const dateInp = screen.getByTestId('mt-detail-target') as HTMLInputElement;
    fireEvent.change(dateInp, { target: { value: '2026-06-15' } });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      op: 'update',
      permitId: 11,
      patch: { target_date: '2026-06-15' },
    });
  });

  it('blurring text with an unchanged value does NOT fire the mutation', () => {
    renderPanel();
    const textarea = screen.getByTestId('mt-detail-text') as HTMLTextAreaElement;
    fireEvent.blur(textarea);
    expect(upsertMutate).not.toHaveBeenCalled();
  });
});
