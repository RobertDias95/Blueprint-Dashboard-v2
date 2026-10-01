import type { ProjectMessage } from './database.types';
import { todayIso } from './dateUtils';

// ===========================================================================
// fix-603 (P-172) — a task made from a chat message shows what happened to it
// ===========================================================================
//
// Bobby, 2026-09-08: *"when someone creates a task here, what the status of it
// is (not started, in progress or completed with a date?) … if not started why
// not."*
//
// `bp_list_project_messages` returns five more columns once
// migrations/fix_603_chat_task_status.sql is applied. Until then they are
// ABSENT from the payload, and the row must render exactly as it did — so this
// returns `null` when none of them came back, and the component draws nothing.

/** A blank `assigned_to` — said plainly rather than defaulted to a role. */
export const UNASSIGNED_LABEL = 'Unassigned';

export type ChatTaskStatusWord = 'Not started' | 'In progress' | 'Completed';

export interface ChatTaskStatusView {
  word: ChatTaskStatusWord | string;
  done: boolean;
  /** "9/12" — only when done and the completion is dated. */
  doneOn: string | null;
  /** The stored assignee, trimmed; `null` = nobody. Role resolution is the
   *  caller's (it needs the project context — fix-238's resolver). */
  assignedTo: string | null;
  /** Shown only when the task is open and the date has passed. */
  overdueDue: string | null;
}

/** "2026-09-12" or an ISO timestamp → "9/12", read in LOCAL time (fix-433: a
 *  UTC date is a day off every evening in Seattle). */
export function monthDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = dateOnly ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** The fields exist once the migration is applied — `null` is a real value
 *  then, `undefined` means the old function answered. */
export function hasTaskStatusFields(m: Partial<ProjectMessage>): boolean {
  return (
    m.task_status !== undefined ||
    m.task_done !== undefined ||
    m.task_done_at !== undefined ||
    m.task_assigned_to !== undefined ||
    m.task_due_date !== undefined
  );
}

export function chatTaskStatus(
  m: Pick<
    ProjectMessage,
    'task_id' | 'task_status' | 'task_done' | 'task_done_at' | 'task_assigned_to' | 'task_due_date'
  >,
  now: Date = new Date(),
): ChatTaskStatusView | null {
  if (!m.task_id || !hasTaskStatusFields(m)) return null;

  const status = (m.task_status ?? '').trim();
  const done = m.task_done === true || status === 'Resolved';

  let word: ChatTaskStatusView['word'];
  if (done) word = 'Completed';
  else if (status === 'In Progress') word = 'In progress';
  else if (status === '' || status === 'Open') word = 'Not started';
  // ★ An unrecognised status is shown as stored, not squeezed into a word it
  //   might not mean.
  else word = status;

  const assigned = (m.task_assigned_to ?? '').trim();
  const due = m.task_due_date ?? null;
  const overdueDue = !done && due && due < todayIso(now) ? monthDay(due) : null;

  return {
    word,
    done,
    doneOn: done ? monthDay(m.task_done_at) : null,
    assignedTo: assigned === '' ? null : assigned,
    overdueDue,
  };
}
