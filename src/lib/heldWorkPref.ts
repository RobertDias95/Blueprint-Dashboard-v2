import { loadFilterState, saveFilterState } from './filterPrefs';

// ===========================================================================
// ★★★ fix-409 — ONE SWITCH, TWO SCREENS
// ===========================================================================
//
// Bobby, 2026-08-25 (register P-039): *"maybe when you turn it on in my tasks
// or my board, it will turn them on together — that way they live together in
// display."*
//
// ★★★ SO IT IS ONE PREFERENCE, NOT TWO CONTROLS THAT HAPPEN TO AGREE. Two
// stored booleans that each page wrote would be two things to keep in step, and
// they would drift the first time somebody added a third surface. There is one
// value; both pages read it and both pages write it.
//
// ---------------------------------------------------------------------------
// ★★ WHY sessionStorage (fix-403's store) AND NOT localStorage (collapsePrefs)
// ---------------------------------------------------------------------------
//
// The line fix-403 drew is PREFERENCE vs TRAIN OF THOUGHT: how you like your
// panels is remembered forever; a half-finished search is not.
//
// This is the second kind, and Bobby's own words settle it — *"the default is
// you show all active projects/permits. anything with a hold gets auto turned
// off"*. That is a statement about what you should find when you sit down. A
// stored-forever "show held" would quietly make the default something else for
// whoever last flipped it, months ago, and the board would be showing paused
// work to somebody who does not remember asking for it.
//
// sessionStorage draws exactly the right line: it survives navigation between
// the two tabs and a reload (both of which this ticket's tests require), and it
// dies with the tab, so tomorrow starts at the default again.
//
// ★ Per user id — fix-176's rule — through the same `filterPrefs` mechanism
// fix-403 built, for the same reason fix-326 gave: do not build another
// preference store.
//
// ---------------------------------------------------------------------------
// ★★★ THE LISTENER SET, AND WHY IT IS NOT OPTIONAL
// ---------------------------------------------------------------------------
//
// My Tasks and My Board are TABS of /board today (fix-385), so they are never
// mounted at once and a plain read-on-mount would look like it worked. It would
// stop working the moment they shared a screen again — which is not a
// hypothetical: fix-318 stacked exactly these two panels vertically, and
// fix-385 unstacked them one ticket later.
//
// So the value is broadcast. `useShowHeldWork` subscribes through
// `useSyncExternalStore`, and every mounted reader re-renders on a write
// whatever the layout is. "They live together in display" is then true by
// construction rather than by the current tab arrangement.

const NAMESPACE = 'heldwork.show';

/** ★ The default, in one place. Bobby: held work is OFF until you ask for it. */
export const SHOW_HELD_WORK_DEFAULT = false;

/** userId → value. Populated lazily on first read so the hook's snapshot is a
 *  cheap map lookup rather than a JSON parse on every render. */
const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

/**
 * ★★★ THE ANONYMOUS KEY, AND WHY THE SWITCH STILL WORKS WITHOUT A USER ID.
 *
 * `filterPrefs` refuses to read or write for a null user id — fix-176's rule,
 * so one login's state can never leak to another on a shared machine — and the
 * first version of this file simply returned the default in that case. That
 * made the control INERT: click it, nothing happens, no error. A dead control
 * is the defect this codebase has shipped several times, and it is worse than
 * an unpersisted one.
 *
 * ★★ So the split is: the VALUE always works (in memory, under this key), and
 * only the PERSISTENCE is skipped. Nothing reaches storage without a user id,
 * so fix-176 is untouched; what changes is that a session with no resolved user
 * still gets a switch that switches.
 */
const ANON = '\u0000anon';

/**
 * The current value for this user.
 *
 * ★ Safe to call from a `getSnapshot`: it returns a primitive, and the lazy
 * hydration is idempotent — the second call returns the cached answer, so React
 * never sees the value change without a notification.
 */
export function readShowHeldWork(userId: string | null | undefined): boolean {
  const key = userId || ANON;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const stored =
    loadFilterState<boolean>(NAMESPACE, userId, (raw) =>
      typeof raw === 'boolean' ? raw : null,
    ) ?? SHOW_HELD_WORK_DEFAULT;
  cache.set(key, stored);
  return stored;
}

/** Set it, persist it (when there is somebody to persist it for), and tell
 *  every mounted reader. */
export function writeShowHeldWork(
  userId: string | null | undefined,
  next: boolean,
): void {
  const key = userId || ANON;
  if (cache.get(key) === next) return;
  cache.set(key, next);
  // ★ A no-op for a null user id — see the ANON note above.
  saveFilterState(NAMESPACE, userId, next);
  for (const l of listeners) l();
}

/** Subscribe to changes. Returns the unsubscribe, as `useSyncExternalStore`
 *  requires. */
export function subscribeShowHeldWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** ★★ Test seam, and it is not optional.
 *
 *  The cache is MODULE state, so it outlives `sessionStorage.clear()` and every
 *  `render()` in a file — a test that flips the switch would hand the next test
 *  a board with held work already on, and the failure would look like a
 *  filtering bug rather than a leak. Any suite that touches the switch must
 *  call this in `beforeEach`. Also what a sign-out would want, if one ever
 *  needed to forget this. */
export function resetShowHeldWorkCache(): void {
  cache.clear();
}
