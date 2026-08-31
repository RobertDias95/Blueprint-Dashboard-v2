import { isTaskLive } from './taskStatus';
import type { MyTaskNode } from './database.types';

// ===========================================================================
// ★★★ fix-462 §C2 (P-045) — ONE RUNNING LIST, SHOWN AS TWO
// ===========================================================================
//
// Bobby, 2026-08-26: **open/active above, closed/completed below. NOT
// per-meeting.** No meeting-date grouping, no per-meeting archive, no minutes,
// no attendance — one list that keeps running, which is the whole point:
// *"nothing agreed in the meeting dies in a list nobody reopens."*
//
// ★★★ AND THE SPLIT IS THE TASK'S OWN STATUS, NOT AN AGENDA CONCEPT. Bobby,
// 2026-08-30, choosing the task statuses over meeting-shaped words: **no second
// vocabulary enters the app.** So "open" is `isTaskLive` — the same predicate
// the board, My Tasks and every counter already use — and "closed" is its
// complement. There is no agenda status column and there must never be one.

/** The two halves of the one list. */
export interface AgendaLists {
  /** Not done: Open, In Progress — anything still live. */
  open: MyTaskNode[];
  /** Done: Resolved or Cancelled. */
  closed: MyTaskNode[];
}

/**
 * ★★ Split the agenda items out of the task list `bp_list_tasks` already
 * returns.
 *
 * ★★★ NOTE WHAT THIS FUNCTION DOES NOT DO: it does not fetch anything. Agenda
 * items arrive in the SAME payload as every other task, because fix-460's union
 * put team tasks inside `bp_list_tasks` and this ticket only added a flag to
 * them. That is why an agenda item reaches its assignee's board and their My
 * Tasks with NO BOARD CODE EDITED — the integration is that there is nothing to
 * integrate.
 */
export function splitAgenda(tasks: readonly MyTaskNode[]): AgendaLists {
  const open: MyTaskNode[] = [];
  const closed: MyTaskNode[] = [];
  for (const t of tasks) {
    if (t.agenda !== true) continue;
    (isTaskLive(t.status) ? open : closed).push(t);
  }
  // ★ Priority first, then the oldest — the order a meeting works through a
  //   list. Within the closed half the most recently finished reads first,
  //   because that is the half you scan for "what did we settle".
  open.sort(
    (a, b) =>
      Number(b.priority ?? false) - Number(a.priority ?? false) ||
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  );
  closed.sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
  return { open, closed };
}
