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

export type TaskStatus = 'Open' | 'In Progress' | 'Resolved';

/** Forward order the checkbox advances through. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  'Open',
  'In Progress',
  'Resolved',
] as const;

/**
 * Checkbox click = FORWARD-only advance: Open → In Progress → Resolved.
 * Resolved is terminal on the checkbox — a further click is a no-op (returns
 * null) so a completed task can never be accidentally un-completed by the box.
 * Moving a task backward (Resolved → In Progress / Open) is done exclusively
 * through the status dropdown (see {@link TASK_STATUS_OPTIONS}).
 */
export function nextCheckboxStatus(current: TaskStatus): TaskStatus | null {
  if (current === 'Open') return 'In Progress';
  if (current === 'In Progress') return 'Resolved';
  return null; // Resolved → no forward move
}

/** 3-state visual for the checkbox: empty (Open) / partial (In Progress) /
 *  checked (Resolved). */
export type CheckboxVisual = 'empty' | 'partial' | 'checked';

export function checkboxVisual(status: TaskStatus): CheckboxVisual {
  if (status === 'Resolved') return 'checked';
  if (status === 'In Progress') return 'partial';
  return 'empty';
}

/**
 * Status dropdown options — the ONLY control that can move a task backward.
 * 'Open' shows as "Not started" per product copy; the stored value stays
 * 'Open'.
 */
export const TASK_STATUS_OPTIONS: readonly { value: TaskStatus; label: string }[] = [
  { value: 'Open', label: 'Not started' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Resolved', label: 'Resolved' },
] as const;

export function statusLabel(status: TaskStatus): string {
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
