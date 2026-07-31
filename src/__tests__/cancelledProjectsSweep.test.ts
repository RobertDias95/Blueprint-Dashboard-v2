import { describe, it, expect } from 'vitest';
import { applyDoneTrigger, type TaskStatus } from '../lib/taskStatus';

// fix-262: pure-TS MIRROR of the bp_set_project_cancel task sweep and the
// bp_restore_project restore, following the fix-153 pattern (no live DB in CI,
// so the SQL's logic is regression-tested by a mirror plus a documented
// rolled-back prod probe — see the PR body for that probe's output).
//
// Keep this mirror in LOCKSTEP with migrations/fix_262_project_cancelled.sql.
// The two rules it exists to protect:
//
//   1. Sweep ONLY 'Open' and 'In Progress'. Never a Resolved task — the
//      bp_trg_task_done_at trigger sets done := (status = 'Resolved') and CLEARS
//      done_at on every other status, so sweeping a finished task silently
//      destroys its completion record and there is nothing to resurrect anyway.
//   2. prior_completion_status is the ENTIRE restore mechanism. There is no task
//      history table, and done_at cannot stand in for it (see rule 1).

interface TaskRow {
  id: string;
  completion_status: TaskStatus;
  prior_completion_status: string | null;
  done: boolean;
  done_at: string | null;
}

const NOW = '2026-07-31T12:00:00Z';

/** Mirror of the sweep UPDATE in bp_set_project_cancel, including the DB
 *  trigger that fires on the completion_status write. */
function sweep(rows: TaskRow[]): TaskRow[] {
  return rows.map((t) => {
    if (t.completion_status !== 'Open' && t.completion_status !== 'In Progress') {
      return t; // untouched — no UPDATE, so the trigger never fires
    }
    const trig = applyDoneTrigger({
      prevStatus: t.completion_status,
      nextStatus: 'Cancelled',
      prevDoneAt: t.done_at,
      now: NOW,
    });
    return {
      ...t,
      prior_completion_status: t.completion_status,
      completion_status: 'Cancelled',
      done: trig.done,
      done_at: trig.done_at,
    };
  });
}

/** Mirror of the restore UPDATE in bp_restore_project. */
function restore(rows: TaskRow[]): TaskRow[] {
  return rows.map((t) => {
    if (t.completion_status !== 'Cancelled') return t;
    if (t.prior_completion_status === null) return t; // hand-set, not swept
    const next = t.prior_completion_status as TaskStatus;
    const trig = applyDoneTrigger({
      prevStatus: 'Cancelled',
      nextStatus: next,
      prevDoneAt: t.done_at,
      now: NOW,
    });
    return {
      ...t,
      completion_status: next,
      prior_completion_status: null,
      done: trig.done,
      done_at: trig.done_at,
    };
  });
}

function task(over: Partial<TaskRow> & { id: string }): TaskRow {
  return {
    completion_status: 'Open',
    prior_completion_status: null,
    done: false,
    done_at: null,
    ...over,
  };
}

const BASELINE: TaskRow[] = [
  task({ id: 'open-1' }),
  task({ id: 'open-2' }),
  task({ id: 'ip-1', completion_status: 'In Progress' }),
  task({
    id: 'done-1',
    completion_status: 'Resolved',
    done: true,
    done_at: '2026-05-04T09:00:00Z',
  }),
  task({
    id: 'done-2',
    completion_status: 'Resolved',
    done: true,
    done_at: '2026-06-11T15:30:00Z',
  }),
];

describe('fix-262 cancel sweep', () => {
  it('moves Open and In Progress to Cancelled, storing prior state', () => {
    const after = sweep(BASELINE);
    const byId = new Map(after.map((t) => [t.id, t]));
    expect(byId.get('open-1')!.completion_status).toBe('Cancelled');
    expect(byId.get('open-1')!.prior_completion_status).toBe('Open');
    expect(byId.get('ip-1')!.completion_status).toBe('Cancelled');
    expect(byId.get('ip-1')!.prior_completion_status).toBe('In Progress');
    expect(after.filter((t) => t.completion_status === 'Cancelled')).toHaveLength(3);
  });

  it('THE TRAP: Resolved tasks are UNTOUCHED — done and done_at intact', () => {
    const after = sweep(BASELINE);
    const byId = new Map(after.map((t) => [t.id, t]));
    for (const id of ['done-1', 'done-2']) {
      const before = BASELINE.find((t) => t.id === id)!;
      expect(byId.get(id)).toEqual(before);
      expect(byId.get(id)!.done).toBe(true);
      expect(byId.get(id)!.done_at).toBe(before.done_at);
      expect(byId.get(id)!.prior_completion_status).toBeNull();
    }
  });

  it('swept tasks carry done=false / done_at=null — nothing was lost', () => {
    const after = sweep(BASELINE).filter((t) => t.completion_status === 'Cancelled');
    for (const t of after) {
      expect(t.done).toBe(false);
      expect(t.done_at).toBeNull();
    }
  });

  it('sweeping twice is a no-op (nothing left in Open/In Progress)', () => {
    const once = sweep(BASELINE);
    expect(sweep(once)).toEqual(once);
  });
});

describe('fix-262 restore', () => {
  it('returns every swept task to its EXACT prior state and clears the marker', () => {
    const after = restore(sweep(BASELINE));
    expect(after).toEqual(BASELINE);
    expect(after.every((t) => t.prior_completion_status === null)).toBe(true);
  });

  it('distinguishes Open from In Progress on the way back', () => {
    const after = restore(sweep(BASELINE));
    const byId = new Map(after.map((t) => [t.id, t]));
    expect(byId.get('open-1')!.completion_status).toBe('Open');
    expect(byId.get('ip-1')!.completion_status).toBe('In Progress');
  });

  it('leaves a hand-set Cancelled task alone (no stored prior → never reopened)', () => {
    const handSet = [task({ id: 'manual', completion_status: 'Cancelled' })];
    expect(restore(handSet)).toEqual(handSet);
  });

  it('restoring twice is a no-op', () => {
    const once = restore(sweep(BASELINE));
    expect(restore(once)).toEqual(once);
  });

  it('cancel → restore → cancel → restore is idempotent, no drift', () => {
    let rows = BASELINE;
    for (let i = 0; i < 3; i++) {
      rows = restore(sweep(rows));
      expect(rows).toEqual(BASELINE);
    }
  });

  it('a task RESOLVED while the project was cancelled is not clobbered by restore', () => {
    // Edge: somebody force-resolves a parked task. It is no longer 'Cancelled',
    // so restore skips it — the human's decision wins over the stored prior.
    const swept = sweep(BASELINE).map((t) =>
      t.id === 'open-2'
        ? { ...t, completion_status: 'Resolved' as TaskStatus, done: true, done_at: NOW }
        : t,
    );
    const after = restore(swept);
    const byId = new Map(after.map((t) => [t.id, t]));
    expect(byId.get('open-2')!.completion_status).toBe('Resolved');
    expect(byId.get('open-2')!.done_at).toBe(NOW);
    // everything else still restored normally
    expect(byId.get('open-1')!.completion_status).toBe('Open');
  });
});
