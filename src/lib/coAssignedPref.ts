import { loadFilterState, saveFilterState } from './filterPrefs';

// ===========================================================================
// ★★★ fix-445 — "SHOW CO-ASSIGNED WORK", THE SECOND SWITCH ON THE ROW
// ===========================================================================
//
// Bobby, 2026-08-29 (ruling 4 / P-047): *"Design managers want to see the
// tasks they own, then flip co-assigned work on and off on top — so 'mine' and
// 'shared' are distinguishable rather than blended."*
//
// This is fix-409's `heldWorkPref` shape, deliberately: one namespace, a lazy
// per-user cache, a listener set, and the same `filterPrefs` store. A second
// preference mechanism is how two switches on one row start behaving
// differently for no reason a reader could name.
//
// ---------------------------------------------------------------------------
// ★★★ THE DEFAULT IS ON, AND THE MEASUREMENT IS WHY IT HAD TO BE
// ---------------------------------------------------------------------------
//
// Held work defaults OFF: it hides paused work you did not ask about. This one
// is the opposite in every respect. Measured on prod 2026-08-29 over 323 open
// tasks, the share of a person's My Tasks reachable ONLY as a co-assignee:
//
//     Brittani  29 of 30   (97%)
//     Lindsay   19 of 22   (86%)
//     Derry     20 of 25   (80%)
//     Jade       4 of 4   (100%)
//     Keelie     3 of 3   (100%)
//     Miles      2 of 122   (2%)
//
// ★★★ FOR FIVE PEOPLE THE CO-ASSIGNED LIST *IS* THE LIST. Defaulting this off
// would hand Brittani an empty board on the morning it shipped. The brief's
// framing — flip co-assigned work on "on top" of what you own — describes
// Miles's board exactly and inverts everyone else's.
//
// ---------------------------------------------------------------------------
// ★★ AND THAT IS ALSO WHY IT IS sessionStorage, NOT localStorage
// ---------------------------------------------------------------------------
//
// fix-403's line is PREFERENCE vs TRAIN OF THOUGHT. A DM narrowing to "just
// what I own" for ten minutes is a train of thought. If it persisted, the
// dangerous direction persists with it: somebody who flipped it off once in
// August finds a 97%-empty board in December and has no idea a filter is on.
// A switch whose OFF state can silently erase four fifths of your work should
// expire with the tab, and the default should be the state that shows you
// everything.
//
// ★ Per user id (fix-176) through fix-403's `filterPrefs`, and broadcast to
// every mounted reader, for the same reasons fix-409 spells out in
// lib/heldWorkPref.

const NAMESPACE = 'mytasks.coassigned.show';

/** ★ The default, in one place: shared work is VISIBLE until you say otherwise. */
export const SHOW_CO_ASSIGNED_DEFAULT = true;

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** ★★ See lib/heldWorkPref: the VALUE always works, only the PERSISTENCE is
 *  skipped without a user id. A dead control is worse than an unpersisted one. */
const ANON = '\u0000anon';

/** The current value for this user. Safe to call from a `getSnapshot` — it
 *  returns a primitive and the lazy hydration is idempotent. */
export function readShowCoAssigned(userId: string | null | undefined): boolean {
  const key = userId || ANON;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const stored =
    loadFilterState<boolean>(NAMESPACE, userId, (raw) =>
      typeof raw === 'boolean' ? raw : null,
    ) ?? SHOW_CO_ASSIGNED_DEFAULT;
  cache.set(key, stored);
  return stored;
}

/** Set it, persist it when there is somebody to persist it for, and tell every
 *  mounted reader. */
export function writeShowCoAssigned(
  userId: string | null | undefined,
  next: boolean,
): void {
  const key = userId || ANON;
  if (cache.get(key) === next) return;
  cache.set(key, next);
  saveFilterState(NAMESPACE, userId, next);
  for (const l of listeners) l();
}

/** Subscribe to changes; returns the unsubscribe `useSyncExternalStore` wants. */
export function subscribeShowCoAssigned(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** ★★ Test seam, and it is not optional — the cache is MODULE state and
 *  outlives `sessionStorage.clear()`. A suite that flips the switch must call
 *  this in `beforeEach` or it hands the next test a filtered board, and the
 *  failure looks like an ownership bug rather than a leak. */
export function resetShowCoAssignedCache(): void {
  cache.clear();
}
