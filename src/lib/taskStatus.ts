// fix-235: single source of truth for task status transitions, shared by the
// two controls that write permit_tasks.completion_status — the click-to-advance
// CHECKBOX on each task row (permit bar in PermitDetailV2 + the My Tasks rows)
// and the STATUS DROPDOWN in the detail pane (My Tasks TaskDetailEditor + the
// PermitDetailV2 task row). Keeping the transition rules here means both
// controls stay in lockstep — no divergent write paths.
//
// completion_status ∈ {'Open','In Progress','Resolved'}. The write-path
// unification of the sibling `done` boolean + `done_at` timestamp is enforced
// server-side by the bp_trg_task_done_at trigger (see
// migrations/fix_235_task_done_sync.sql); `applyDoneTrigger` below is the pure
// TS mirror of that trigger, used by the tests to prove the contract without a
// live DB.

export type TaskStatus = 'Open' | 'In Progress' | 'Resolved' | 'Cancelled';

/** fix-262: the three statuses a HUMAN drives. 'Cancelled' is deliberately not
 *  here — it is written only by bp_set_project_cancel's sweep and cleared only
 *  by bp_restore_project, so it never appears in the checkbox cycle or the
 *  status dropdown. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  'Open',
  'In Progress',
  'Resolved',
] as const;

/** fix-262: a task parked by a project cancel. Not "done" — the work was never
 *  finished — but not open either: it must not appear in any open-work list,
 *  and it must come BACK to its exact prior state when the project is restored.
 *  Every "is this task live?" predicate should go through {@link isTaskLive}. */
export const TASK_STATUS_CANCELLED = 'Cancelled' as const;

/** fix-262: is this task part of the team's live workload?
 *
 *  Before fix-262 every surface asked `status !== 'Resolved'`, which would have
 *  read a cancelled task as OPEN. This is the single predicate that answers the
 *  question correctly, and the surfaces listed in the fix-262 PR body all route
 *  through it. */
export function isTaskLive(status: string | null | undefined): boolean {
  const s = status ?? 'Open';
  return s !== 'Resolved' && s !== TASK_STATUS_CANCELLED;
}

/** ★ fix-326: is this task overdue?
 *
 *  Lifted out of MyTasks.tsx, unchanged, because the collapsed My Tasks bar on
 *  /board has to say how many are overdue WITHOUT mounting the panel that used
 *  to own the definition. Two places asking the question means one definition,
 *  and this module is where the other status predicates already live.
 *
 *  ★ isTaskLive, not `!== 'Resolved'` — a task parked by a project cancel is not
 *  overdue, it is not in play at all (fix-262). */
export function isTaskOverdue(
  task: { status: string | null | undefined; target_date: string | null | undefined },
  todayIso: string,
): boolean {
  return (
    isTaskLive(task.status) && !!task.target_date && task.target_date < todayIso
  );
}

/** fix-262: true when a project cancel parked this task. */
export function isTaskCancelled(status: string | null | undefined): boolean {
  return status === TASK_STATUS_CANCELLED;
}

/** fix-262: the statuses a HUMAN write path is allowed to send. 'Cancelled' is
 *  excluded by construction — it is set only by bp_set_project_cancel's sweep
 *  and cleared only by bp_restore_project, so no task-edit control may write it
 *  and none may write OVER it (which would strand prior_completion_status and
 *  break the restore). Task controls are disabled while a task is cancelled;
 *  this type is the compiler-level backstop for that rule. */
export type TaskWriteStatus = Exclude<TaskStatus, 'Cancelled'>;

/** Narrow a status for a write path. Callers must already have refused to edit
 *  a cancelled task (see isTaskCancelled); this keeps the types honest and
 *  degrades to 'Open' rather than emitting an unwritable value if one slips
 *  through. */
export function writableStatus(status: TaskStatus): TaskWriteStatus {
  return status === TASK_STATUS_CANCELLED ? 'Open' : status;
}

/**
 * Checkbox click = FORWARD-only advance: Open → In Progress → Resolved.
 * Resolved is terminal on the checkbox — a further click is a no-op (returns
 * null) so a completed task can never be accidentally un-completed by the box.
 * Moving a task backward (Resolved → In Progress / Open) is done exclusively
 * through the status dropdown (see {@link TASK_STATUS_OPTIONS}).
 */
export function nextCheckboxStatus(current: TaskStatus): TaskStatus | null {
  // fix-262: a cancelled task is inert. The checkbox must not move it — the
  // only way out is restoring the project, which returns it to its prior state.
  if (current === TASK_STATUS_CANCELLED) return null;
  if (current === 'Open') return 'In Progress';
  if (current === 'In Progress') return 'Resolved';
  return null; // Resolved → no forward move
}

/** 3-state visual for the checkbox: empty (Open) / partial (In Progress) /
 *  checked (Resolved). fix-262 adds a 4th, 'cancelled' — struck through and
 *  non-interactive, so a parked task never reads as either open or done. */
export type CheckboxVisual = 'empty' | 'partial' | 'checked' | 'cancelled';

export function checkboxVisual(status: TaskStatus): CheckboxVisual {
  if (status === TASK_STATUS_CANCELLED) return 'cancelled';
  if (status === 'Resolved') return 'checked';
  if (status === 'In Progress') return 'partial';
  return 'empty';
}

/**
 * Status dropdown options — the ONLY control that can move a task backward.
 * 'Open' shows as "Not started" per product copy; the stored value stays
 * 'Open'.
 */
export const TASK_STATUS_OPTIONS: readonly { value: TaskWriteStatus; label: string }[] = [
  { value: 'Open', label: 'Not started' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Resolved', label: 'Resolved' },
] as const;

export function statusLabel(status: TaskStatus): string {
  // fix-262: 'Cancelled' is not a dropdown option, so give it a label here.
  if (status === TASK_STATUS_CANCELLED) return 'Cancelled';
  return TASK_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

/**
 * Pure mirror of the bp_trg_task_done_at DB trigger (fix-235). Given the row's
 * previous completion_status + done_at and the incoming status, returns the
 * `done` boolean + `done_at` the write path lands on:
 *   - → 'Resolved' (from a non-Resolved state): done=true, done_at stamped now.
 *   - already 'Resolved' → 'Resolved': done=true, done_at preserved.
 *   - → 'Open' / 'In Progress': done=false, done_at cleared.
 * `now` is injected so tests stay deterministic.
 *
 * fix-262: 'Cancelled' falls through the same non-Resolved branch — done=false,
 * done_at cleared. THIS IS EXACTLY WHY the cancel sweep only ever touches tasks
 * that are 'Open' or 'In Progress': those already carry done=false/done_at=null,
 * so the trigger firing costs nothing. Sweeping a RESOLVED task would run it
 * through this branch and silently destroy its done_at.
 */
export function applyDoneTrigger(input: {
  prevStatus: TaskStatus | null;
  nextStatus: TaskStatus;
  prevDoneAt: string | null;
  now: string;
}): { done: boolean; done_at: string | null } {
  const { prevStatus, nextStatus, prevDoneAt, now } = input;
  if (nextStatus === 'Resolved') {
    const done_at =
      prevStatus === 'Resolved' && prevDoneAt ? prevDoneAt : now;
    return { done: true, done_at };
  }
  return { done: false, done_at: null };
}

/**
 * fix-268: pure mirror of the bp_trg_task_start_date DB trigger (see
 * migrations/fix_268_transmit_state.sql). CI has no live database, so this
 * mirror IS the tested contract — keep the two in lockstep.
 *
 * Gives start_date a consequence so "mark it started" can mean "package sent"
 * for the vendor forecast, where a transmit task's start_date is the sent date.
 *
 * ★ SYSTEM-WIDE: the trigger fires for EVERY task, not just structural ones.
 *
 *   - stamps `today` on the FIRST transition into 'In Progress'
 *   - stamps on a transition straight into 'Resolved' too (a task can go
 *     Open → Resolved directly and was still clearly sent at some point)
 *   - NEVER overwrites an existing start_date — a date a human entered is
 *     theirs, and this must never argue with it
 *   - transition-based: re-saving a row already In Progress does NOT stamp,
 *     which is what makes it idempotent on repeat writes
 *   - 'Cancelled' (the fix-262 sweep) never stamps
 *
 * `prevStatus: null` models an INSERT.
 */
export function applyStartDateTrigger(input: {
  prevStatus: TaskStatus | null;
  nextStatus: TaskStatus;
  prevStartDate: string | null;
  today: string;
}): { start_date: string | null } {
  const { prevStatus, nextStatus, prevStartDate, today } = input;
  if (prevStartDate != null) return { start_date: prevStartDate };
  const isTransition = prevStatus === null || prevStatus !== nextStatus;
  const stamps = nextStatus === 'In Progress' || nextStatus === 'Resolved';
  return { start_date: isTransition && stamps ? today : null };
}
