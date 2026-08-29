import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

// ===========================================================================
// ★★★ fix-434 §B (cause 2) — ONE refetch for a burst, not one per click
// ===========================================================================
//
// MEASURED ON PROD 2026-08-29, before anything was written:
//
//     permit_tasks rows                                     1,643
//     what `bp_list_tasks()` returns   EVERY one of them, as a single jsonb
//                                      aggregate — no LIMIT, no pagination
//     payload                                             ~1,134 kB
//     server time                                            6.1 ms
//
// And every task write invalidated `queryKeys.permitTasksAll`, the BARE prefix,
// so each click cost a full 1.1 MB round trip. Ten rapid clicks measured ten of
// them: ~11 MB of JSON parsed on the main thread, which is the freeze Miles
// reported. Somebody clearing twenty rows down a queue paid it twenty times.
//
// ★★★ THE FIX IS NOT "INVALIDATE LESS ACCURATELY", IT IS "INVALIDATE ONCE".
// The row is already correct on screen (the optimistic overlay), so the refetch
// is no longer what MOVES the row — it is only what CONFIRMS it. A confirmation
// can wait for the person to stop clicking. So a status write schedules a
// single trailing invalidation and every further write inside the window
// reschedules it, collapsing a burst of N writes into exactly one refetch.
//
// ★★ NARROWING THE KEY WAS CONSIDERED AND REJECTED. `bp_list_tasks` is one RPC
// returning one aggregate; there is no per-row query to invalidate. Making one
// would mean a second read path for the same rows — the divergence this ticket
// exists to avoid — for a saving the coalescing already delivers.
//
// ★★★ FAILURE IS NEVER COALESCED. An error invalidates immediately (see
// hooks/useTaskTree) because a row showing something the database refused must
// be corrected now, not in a second.

/** How long after the last status write to reconcile. Long enough that a
 *  person clicking down a queue pays for one refetch rather than twenty; short
 *  enough that a single tick is confirmed before they look away. */
export const TASK_RECONCILE_DELAY_MS = 900;

let timer: ReturnType<typeof setTimeout> | null = null;
let target: QueryClient | null = null;

/** Schedule the single trailing refetch, replacing any already pending. */
export function scheduleTaskReconcile(
  queryClient: QueryClient,
  delayMs: number = TASK_RECONCILE_DELAY_MS,
): void {
  target = queryClient;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const qc = target;
    target = null;
    if (!qc) return;
    void qc.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
  }, delayMs);
}

/** Run any pending reconciliation now. */
export function flushTaskReconcile(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  const qc = target;
  target = null;
  if (!qc) return;
  void qc.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
}

/** Drop a pending reconciliation without running it — used when something
 *  stronger (an error's immediate invalidation) has already happened, and by
 *  tests so a timer cannot leak into the next one. */
export function cancelTaskReconcile(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  target = null;
}

/** Tests: is one pending? */
export function taskReconcilePending(): boolean {
  return timer !== null;
}
