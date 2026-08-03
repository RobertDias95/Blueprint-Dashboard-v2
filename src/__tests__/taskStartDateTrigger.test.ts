import { describe, it, expect } from 'vitest';
import { applyStartDateTrigger } from '../lib/taskStatus';
import type { TaskStatus } from '../lib/taskStatus';

// fix-268: the pure mirror of bp_trg_task_start_date (see
// migrations/fix_268_transmit_state.sql). CI has no live database, so this
// mirror IS the tested contract — the fix-153 pattern. Keep the two in lockstep.
//
// WHY THE TRIGGER EXISTS: start_date was a field with no consequence, so nobody
// filled it in (the same reason reuse provenance sits at 2 of 124 projects).
// The vendor forecast needs a transmit task's start_date to mean "package sent",
// and a DA will mark a task started long before they will type a date.
//
// ★ SYSTEM-WIDE: this fires for EVERY task, not just structural ones.

const TODAY = '2026-08-03';

function run(
  prevStatus: TaskStatus | null,
  nextStatus: TaskStatus,
  prevStartDate: string | null = null,
) {
  return applyStartDateTrigger({ prevStatus, nextStatus, prevStartDate, today: TODAY })
    .start_date;
}

describe('fix-268 start_date auto-stamp', () => {
  it('stamps on the FIRST transition into In Progress', () => {
    expect(run('Open', 'In Progress')).toBe(TODAY);
  });

  it('stamps on a direct Open → Resolved (it was still clearly sent)', () => {
    expect(run('Open', 'Resolved')).toBe(TODAY);
  });

  it('stamps on INSERT straight into In Progress or Resolved', () => {
    expect(run(null, 'In Progress')).toBe(TODAY);
    expect(run(null, 'Resolved')).toBe(TODAY);
  });

  it('NEVER overwrites an existing start_date', () => {
    // A date a human entered is theirs. This must never argue with it.
    expect(run('Open', 'In Progress', '2026-01-15')).toBe('2026-01-15');
    expect(run('In Progress', 'Resolved', '2026-01-15')).toBe('2026-01-15');
    expect(run(null, 'Resolved', '2026-01-15')).toBe('2026-01-15');
  });

  it('is idempotent — re-saving a row already In Progress does not stamp', () => {
    // Transition-based by design: UPDATE OF completion_status fires even when
    // the value is unchanged, and stamping then would move the date around.
    expect(run('In Progress', 'In Progress')).toBeNull();
    expect(run('Resolved', 'Resolved')).toBeNull();
  });

  it('running the same transition twice yields the same date', () => {
    const first = run('Open', 'In Progress');
    const second = applyStartDateTrigger({
      prevStatus: 'In Progress',
      nextStatus: 'In Progress',
      prevStartDate: first,
      today: '2026-09-01',
    }).start_date;
    expect(second).toBe(first);
  });

  it('In Progress → Resolved keeps the ORIGINAL sent date', () => {
    const sent = run('Open', 'In Progress');
    expect(
      applyStartDateTrigger({
        prevStatus: 'In Progress',
        nextStatus: 'Resolved',
        prevStartDate: sent,
        today: '2026-09-01',
      }).start_date,
    ).toBe(TODAY);
  });

  it('does NOT stamp on a move back to Open', () => {
    expect(run('In Progress', 'Open')).toBeNull();
    expect(run('Resolved', 'Open')).toBeNull();
  });

  it('the fix-262 cancel sweep never stamps', () => {
    // bp_set_project_cancel sweeps Open / In Progress tasks to 'Cancelled'.
    expect(run('Open', 'Cancelled')).toBeNull();
    expect(run('In Progress', 'Cancelled')).toBeNull();
  });

  it('a restore from Cancelled stamps a task that has no date — the known edge', () => {
    // bp_restore_project returns a task to its prior status. That is a real
    // transition, so a dateless task picks up the restore date. Documented and
    // accepted in the migration: the task is genuinely being worked again, and
    // the user can still overwrite.
    expect(run('Cancelled', 'In Progress')).toBe(TODAY);
    // ...but a task that already had a date is untouched.
    expect(run('Cancelled', 'In Progress', '2026-01-15')).toBe('2026-01-15');
  });
});
