import { loadFilterState, saveFilterState } from './filterPrefs';

// ===========================================================================
// ★★★ fix-458 §B — "UNCLAIMED", THE THIRD SWITCH ON THE ROW
// ===========================================================================
//
// STEP 0e asked whether this should be a third SCOPE MODE or a filter-row
// control. It is a filter-row control, for two reasons:
//
// ★★★ 1. SCOPE IS "WHOSE WORK"; UNCLAIMED IS "NOBODY'S WORK". Those are
//    different questions on different axes — the same argument §B2 makes about
//    date bands. `loadScopeMode` hard-validates `raw === 'mine' || raw === 'all'`
//    and returns null otherwise, so a third stored value could not corrupt a
//    saved choice — but widening `ScopeMode` would ripple through useScopeMode,
//    deriveSelfScope, fix-428's default-view logic and its pinned suites, to
//    express something that is not a scope.
//
// ★★ 2. THE HOUSE PATTERN EXISTS TWICE ALREADY — fix-409's ShowHeldWorkToggle
//    and fix-445's CoAssignedToggle, both filter-row switches reading their own
//    preference hook. This is the third, in the same shape, sharing fix-403's
//    `filterPrefs` store. A second preference mechanism is how three switches
//    on one row start behaving differently for no reason a reader could name.
//
// ---------------------------------------------------------------------------
// ★★★ AND IT IS NOT SUBTRACTIVE, WHICH MAKES IT UNLIKE ITS TWO NEIGHBOURS
// ---------------------------------------------------------------------------
//
// Held work and Co-assigned both REMOVE rows from a list you can already see.
// This one ADDS a list you cannot see at all: the 17 unclaimed tasks are, by
// definition, in nobody's "mine". So it switches the list to the queue rather
// than narrowing it — see MyTasks' `scopedTasks`.
//
// ★★ THEREFORE THE DEFAULT IS OFF. It is a queue you go and clear, not your
// board. Defaulting it on would replace everybody's My Tasks with 17 rows of
// other people's problem on the morning it shipped.
//
// ★ sessionStorage via filterPrefs, per user id — fix-403's PREFERENCE vs
//   TRAIN OF THOUGHT line. "I am clearing the unclaimed queue" is a train of
//   thought and should expire with the tab.

const NAMESPACE = 'mytasks.unclaimed.show';

/** ★ The default, in one place: your own board, until you ask for the queue. */
export const SHOW_UNCLAIMED_DEFAULT = false;

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** ★★ See lib/coAssignedPref: the VALUE always works, only the PERSISTENCE is
 *  skipped without a user id. A dead control is worse than an unpersisted one. */
const ANON = '\u0000anon';

/** The current value for this user. Safe from a `getSnapshot` — returns a
 *  primitive and the lazy hydration is idempotent. */
export function readShowUnclaimed(userId: string | null | undefined): boolean {
  const key = userId || ANON;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const stored =
    loadFilterState<boolean>(NAMESPACE, userId, (raw) =>
      typeof raw === 'boolean' ? raw : null,
    ) ?? SHOW_UNCLAIMED_DEFAULT;
  cache.set(key, stored);
  return stored;
}

/** Set it, persist it when there is somebody to persist it for, and tell every
 *  mounted reader. */
export function writeShowUnclaimed(
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
export function subscribeShowUnclaimed(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** ★★ Test seam, and it is not optional — the cache is MODULE state and
 *  outlives `sessionStorage.clear()`. A suite that flips the switch must call
 *  this in `beforeEach` or it hands the next test the unclaimed queue instead
 *  of a board, and the failure looks like an ownership bug rather than a leak. */
export function resetShowUnclaimedCache(): void {
  cache.clear();
}
