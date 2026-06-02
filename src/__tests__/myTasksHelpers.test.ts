import { describe, it, expect } from 'vitest';
import {
  assignedToOptions,
  computeStats,
  deriveTaskState,
  effectiveDueDate,
  filterTasks,
  isDueThisWeek,
  isOverdue,
  sortTasksForColumn,
  type FilterContext,
  type TaskFilters,
} from '../lib/myTasksHelpers';
import type { Permit, PermitTask, Project } from '../lib/database.types';

// Q7.1.a: pure-helper tests. v1's logic ported under v2's unified
// assigned_to + completion_status + done schema. Every boundary in the
// derivation tree + the filter stack pins a test case so future
// refactors can't silently regress.

function makeTask(over: Partial<PermitTask> = {}): PermitTask {
  return {
    id: 't1',
    permit_id: 1,
    bucket: 'de',
    legacy_id: null,
    text: 'Some task',
    cat: null,
    is_jurisdiction_specific: false,
    start_date: null,
    due_date: null,
    target_date: null,
    completion_status: 'Open',
    done: false,
    assigned_to: null,
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

function makePermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'proj-1',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: null,
    num: null,
    da: 'Trevor',
    dm: 'Lindsay',
    ent_lead: 'Bobby',
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
    updated_at: '2026-05-01T00:00:00Z',
    ...over,
  };
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...over,
  };
}

function makeCtx(): FilterContext {
  return {
    permitsById: new Map([[1, makePermit({ id: 1, project_id: 'proj-1' })]]),
    projectsById: new Map([['proj-1', makeProject({ id: 'proj-1' })]]),
  };
}

// ============================================================
// deriveTaskState
// ============================================================
describe('deriveTaskState', () => {
  it('done=true → complete', () => {
    expect(deriveTaskState(makeTask({ done: true }))).toBe('complete');
  });

  it("completion_status='Resolved' → complete (even if done=false)", () => {
    expect(
      deriveTaskState(makeTask({ done: false, completion_status: 'Resolved' })),
    ).toBe('complete');
  });

  it("completion_status='In Progress' → in-progress", () => {
    expect(
      deriveTaskState(makeTask({ completion_status: 'In Progress' })),
    ).toBe('in-progress');
  });

  it('start_date set, completion_status="Open" → in-progress', () => {
    expect(
      deriveTaskState(
        makeTask({ start_date: '2026-04-30', completion_status: 'Open' }),
      ),
    ).toBe('in-progress');
  });

  it('default (Open + no start_date) → not-started', () => {
    expect(deriveTaskState(makeTask())).toBe('not-started');
  });

  it('done=true overrides any other signal', () => {
    expect(
      deriveTaskState(
        makeTask({
          done: true,
          completion_status: 'In Progress',
          start_date: '2026-04-30',
        }),
      ),
    ).toBe('complete');
  });
});

// ============================================================
// effectiveDueDate
// ============================================================
describe('effectiveDueDate', () => {
  it('prefers target_date over due_date', () => {
    expect(
      effectiveDueDate(
        makeTask({ target_date: '2026-05-15', due_date: '2026-05-20' }),
      ),
    ).toBe('2026-05-15');
  });

  it('falls back to due_date when target_date is null', () => {
    expect(effectiveDueDate(makeTask({ due_date: '2026-05-20' }))).toBe(
      '2026-05-20',
    );
  });

  it('returns null when both missing', () => {
    expect(effectiveDueDate(makeTask())).toBeNull();
  });
});

// ============================================================
// isOverdue / isDueThisWeek
// ============================================================
describe('isOverdue', () => {
  const today = new Date(2026, 4, 11); // 2026-05-11

  it('returns true for non-complete task with effective due date < today', () => {
    expect(isOverdue(makeTask({ target_date: '2026-05-10' }), today)).toBe(true);
  });

  it('returns false for complete task even if past', () => {
    expect(
      isOverdue(
        makeTask({ target_date: '2026-05-10', done: true }),
        today,
      ),
    ).toBe(false);
  });

  it('returns false for task due today or later', () => {
    expect(isOverdue(makeTask({ target_date: '2026-05-11' }), today)).toBe(false);
    expect(isOverdue(makeTask({ target_date: '2026-05-12' }), today)).toBe(false);
  });

  it('returns false when no due date is set', () => {
    expect(isOverdue(makeTask(), today)).toBe(false);
  });

  it('uses due_date when target_date missing', () => {
    expect(isOverdue(makeTask({ due_date: '2026-05-10' }), today)).toBe(true);
  });
});

describe('isDueThisWeek', () => {
  const today = new Date(2026, 4, 11); // 2026-05-11

  it('returns true for due date today', () => {
    expect(isDueThisWeek(makeTask({ target_date: '2026-05-11' }), today)).toBe(true);
  });

  it('returns true for due date 7 days out (inclusive)', () => {
    expect(isDueThisWeek(makeTask({ target_date: '2026-05-18' }), today)).toBe(true);
  });

  it('returns false for due date 8 days out', () => {
    expect(isDueThisWeek(makeTask({ target_date: '2026-05-19' }), today)).toBe(false);
  });

  it('returns false for already-overdue tasks (they belong to OVERDUE bucket)', () => {
    expect(isDueThisWeek(makeTask({ target_date: '2026-05-10' }), today)).toBe(false);
  });

  it('returns false for complete tasks', () => {
    expect(
      isDueThisWeek(
        makeTask({ target_date: '2026-05-13', done: true }),
        today,
      ),
    ).toBe(false);
  });
});

// ============================================================
// filterTasks
// ============================================================
describe('filterTasks', () => {
  const baseFilters: TaskFilters = {
    stage: 'all',
    status: 'active',
    assignee: '',
    search: '',
    entLeads: new Set<string>(),
    das: new Set<string>(),
    dms: new Set<string>(),
    externalConsultants: new Set<string>(),
  };
  const ctx = makeCtx();
  const tasks = [
    makeTask({ id: 't-de-1', bucket: 'de', assigned_to: 'Bobby', text: 'Submit application' }),
    makeTask({ id: 't-co-1', bucket: 'co', assigned_to: 'Entitlements', text: 'Address corrections' }),
    makeTask({ id: 't-pm-1', bucket: 'pm', assigned_to: 'Bobby', text: 'Wait for issuance' }),
    makeTask({ id: 't-de-done', bucket: 'de', done: true, completion_status: 'Resolved', text: 'Old task' }),
  ];

  it('PM tasks are always excluded', () => {
    const out = filterTasks(tasks, baseFilters, ctx);
    expect(out.some((t) => t.id === 't-pm-1')).toBe(false);
  });

  it('default (active) excludes complete tasks', () => {
    const out = filterTasks(tasks, baseFilters, ctx);
    expect(out.map((t) => t.id).sort()).toEqual(['t-co-1', 't-de-1']);
  });

  it("status='done' returns only complete tasks", () => {
    const out = filterTasks(tasks, { ...baseFilters, status: 'done' }, ctx);
    expect(out.map((t) => t.id)).toEqual(['t-de-done']);
  });

  it("status='all' returns DE + CO regardless of done state", () => {
    const out = filterTasks(tasks, { ...baseFilters, status: 'all' }, ctx);
    expect(out.map((t) => t.id).sort()).toEqual(['t-co-1', 't-de-1', 't-de-done']);
  });

  it("stage='de' narrows to DE bucket", () => {
    const out = filterTasks(tasks, { ...baseFilters, stage: 'de' }, ctx);
    expect(out.map((t) => t.id).sort()).toEqual(['t-de-1']);
  });

  it("stage='co' narrows to CO bucket", () => {
    const out = filterTasks(tasks, { ...baseFilters, stage: 'co' }, ctx);
    expect(out.map((t) => t.id)).toEqual(['t-co-1']);
  });

  it('assignee filter is exact match', () => {
    const out = filterTasks(tasks, { ...baseFilters, assignee: 'Bobby' }, ctx);
    expect(out.map((t) => t.id)).toEqual(['t-de-1']);
  });

  it('search matches task.text', () => {
    const out = filterTasks(tasks, { ...baseFilters, search: 'submit' }, ctx);
    expect(out.map((t) => t.id)).toEqual(['t-de-1']);
  });

  it('search matches permit.type via joined context', () => {
    const out = filterTasks(
      tasks,
      { ...baseFilters, search: 'building' },
      ctx,
    );
    // Both DE + CO tasks share permit 1 (type "Building Permit").
    expect(out.map((t) => t.id).sort()).toEqual(['t-co-1', 't-de-1']);
  });

  it('search matches project.product_type via joined context (e.g. "all SFR tasks")', () => {
    // fix-22 Mig 3: product_type moved permits → projects.
    const projWithProduct = makeProject({
      id: ctx.projectsById.values().next().value!.id,
      product_types: ['SFR + Attached Units'],
    });
    const ctxWithProductType: FilterContext = {
      permitsById: ctx.permitsById,
      projectsById: new Map([[projWithProduct.id, projWithProduct]]),
    };
    const out = filterTasks(
      tasks,
      { ...baseFilters, search: 'SFR' },
      ctxWithProductType,
    );
    expect(out.map((t) => t.id).sort()).toEqual(['t-co-1', 't-de-1']);
  });

  it('search matches project.address via joined context', () => {
    const out = filterTasks(
      tasks,
      { ...baseFilters, search: 'pike' },
      ctx,
    );
    expect(out.map((t) => t.id).sort()).toEqual(['t-co-1', 't-de-1']);
  });

  it('search is multi-token AND (all tokens must match)', () => {
    const out = filterTasks(
      tasks,
      { ...baseFilters, search: 'pike submit' },
      ctx,
    );
    // 'submit' matches t-de-1's text; 'pike' matches the address. Only t-de-1 has both.
    expect(out.map((t) => t.id)).toEqual(['t-de-1']);
  });
});

// ============================================================
// sortTasksForColumn
// ============================================================
describe('sortTasksForColumn', () => {
  it('sorts by effective due date ascending; missing dates go last', () => {
    const tasks = [
      makeTask({ id: 'c', target_date: null, due_date: null, created_at: '2026-05-01T00:00:00Z' }),
      makeTask({ id: 'a', target_date: '2026-05-10', created_at: '2026-05-01T00:00:00Z' }),
      makeTask({ id: 'b', target_date: '2026-05-15', created_at: '2026-05-01T00:00:00Z' }),
    ];
    expect(sortTasksForColumn(tasks).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('tiebreaks by created_at (older first) when due dates match', () => {
    const tasks = [
      makeTask({ id: 'newer', target_date: '2026-05-10', created_at: '2026-05-05T00:00:00Z' }),
      makeTask({ id: 'older', target_date: '2026-05-10', created_at: '2026-05-01T00:00:00Z' }),
    ];
    expect(sortTasksForColumn(tasks).map((t) => t.id)).toEqual(['older', 'newer']);
  });

  it('falls back to due_date when target_date missing', () => {
    const tasks = [
      makeTask({ id: 'a', due_date: '2026-05-15' }),
      makeTask({ id: 'b', due_date: '2026-05-10' }),
    ];
    expect(sortTasksForColumn(tasks).map((t) => t.id)).toEqual(['b', 'a']);
  });
});

// ============================================================
// computeStats
// ============================================================
describe('computeStats', () => {
  const today = new Date(2026, 4, 11);
  const ctx = makeCtx();

  it('counts OPEN / OVERDUE / THIS_WEEK / PROJECTS / done correctly', () => {
    const tasks = [
      // Open, overdue.
      makeTask({ id: 't1', bucket: 'de', target_date: '2026-05-08' }),
      // Open, due this week.
      makeTask({ id: 't2', bucket: 'de', target_date: '2026-05-14' }),
      // Open, far future.
      makeTask({ id: 't3', bucket: 'co', target_date: '2026-08-01' }),
      // Complete.
      makeTask({ id: 't4', bucket: 'de', done: true }),
    ];
    const s = computeStats(tasks, ctx, today);
    expect(s.open).toBe(3);
    expect(s.overdue).toBe(1);
    expect(s.thisWeek).toBe(1);
    expect(s.done).toBe(1);
    expect(s.total).toBe(4);
    expect(s.pct).toBe(25);
    // All open tasks point at permit 1 → project proj-1, so distinct project count = 1.
    expect(s.projects).toBe(1);
  });

  it('zero total → pct 0 (no NaN)', () => {
    const s = computeStats([], ctx, today);
    expect(s.pct).toBe(0);
    expect(s.total).toBe(0);
  });

  it('PROJECTS counts distinct project_ids touched by OPEN tasks (not done ones)', () => {
    const ctx2: FilterContext = {
      permitsById: new Map([
        [1, makePermit({ id: 1, project_id: 'p-A' })],
        [2, makePermit({ id: 2, project_id: 'p-B' })],
      ]),
      projectsById: new Map([
        ['p-A', makeProject({ id: 'p-A' })],
        ['p-B', makeProject({ id: 'p-B' })],
      ]),
    };
    const tasks = [
      makeTask({ id: 't1', permit_id: 1 }), // open, project A
      makeTask({ id: 't2', permit_id: 2, done: true }), // complete, project B — should NOT count
    ];
    const s = computeStats(tasks, ctx2, today);
    expect(s.projects).toBe(1);
  });
});

// ============================================================
// assignedToOptions
// ============================================================
describe('assignedToOptions', () => {
  it('returns distinct non-empty assigned_to values, sorted', () => {
    const tasks = [
      makeTask({ assigned_to: 'Entitlements' }),
      makeTask({ assigned_to: 'Architecture' }),
      makeTask({ assigned_to: 'Entitlements' }), // dup
      makeTask({ assigned_to: 'Bobby' }),
      makeTask({ assigned_to: null }), // skipped
      makeTask({ assigned_to: '' }), // skipped
      makeTask({ assigned_to: '   ' }), // skipped (whitespace-only)
    ];
    expect(assignedToOptions(tasks)).toEqual(['Architecture', 'Bobby', 'Entitlements']);
  });

  it('empty input → []', () => {
    expect(assignedToOptions([])).toEqual([]);
  });
});
