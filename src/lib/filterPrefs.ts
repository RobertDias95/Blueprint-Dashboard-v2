// ===========================================================================
// ★★★ fix-403 — THE SEARCH YOU WERE MID-THOUGHT IN
// ===========================================================================
//
// Bobby, 2026-08-25:
//
//   "Say I'm in the library and I put in all these filter parameters … and then
//    I click the project and I go into Project Overview and then I realize, ah,
//    I'm going to keep searching. I would like to click the previous button. It
//    takes me back to the library and then it still has all of my saved
//    parameters. Same thing when I'm in Pipeline … maybe I was only looking at
//    a type of permit or a certain person."
//
// ★★★ THE BUTTON IS THE SMALL HALF. A Previous button that returned you to an
// EMPTY Library would be worse than no button — it would look like it worked
// and quietly cost you the search you were in the middle of. The memory is what
// makes the button worth having.
//
// ★★★ AND THE MEMORY IS DELIBERATELY NOT IN ROUTER STATE. Carrying filters in
// `navigate(..., { state })` restores them for the Previous button and forgets
// them for every OTHER way back: the browser's back button, the ribbon's
// Library entry, a middle-click. The state has to live somewhere the DESTINATION
// reads on mount, independently of how you arrived — so it lives here.
//
// ---------------------------------------------------------------------------
// ★★ SESSION SCOPE, AND WHY IT IS sessionStorage AND NOT localStorage
// ---------------------------------------------------------------------------
//
// `collapsePrefs` is a PREFERENCE — how you like your panels, remembered
// forever. This is a TRAIN OF THOUGHT. Coming back to work tomorrow and finding
// yesterday's half-finished filter still applied is a bug, not a feature: you
// would not remember setting it, and the Library would silently be lying about
// how many projects exist.
//
// sessionStorage draws exactly the right line — it survives navigation and
// reload WITHIN a tab, and dies when the tab does. Bobby's ask is "I was
// mid-search"; a mid-search does not outlive the tab.
//
// ★ SAME DISCIPLINE AS collapsePrefs OTHERWISE, on purpose (fix-326's rule: do
// not build another preference store). Per user id — fix-176 — so one login's
// half-typed search never decides what another person sees on a shared machine.
// Best-effort: a corrupt or unreadable value reads as "never stored" and the
// caller applies its own default, rather than throwing on the way to a render.

/**
 * Read this surface's stored filter state for `userId`, or null when there is
 * none — never a partially-applied object.
 *
 * ★ The caller supplies the shape and validates it. This module knows about
 * storage, not about what a Library filter looks like; a Set, a tri-state and a
 * number array all round-trip through the caller's own encode/decode, which is
 * why `T` is opaque here.
 */
export function loadFilterState<T>(
  namespace: string,
  userId: string | null | undefined,
  decode: (raw: unknown) => T | null,
): T | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${namespace}.${userId}`);
    if (!raw) return null;
    return decode(JSON.parse(raw) as unknown);
  } catch {
    // Corrupt, unreadable, or a decode that threw → "never stored". The caller
    // applies its own defaults; a filter panel must never fail to render
    // because of what is in storage.
    return null;
  }
}

/** Write this surface's filter state. Best-effort by design — a private window
 *  or a full storage quota must not break filtering. */
export function saveFilterState(
  namespace: string,
  userId: string | null | undefined,
  value: unknown,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${namespace}.${userId}`, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — filtering still works, it just forgets */
  }
}

/**
 * ★★ Forget this surface's state entirely.
 *
 * ★ THE CLEAR BUTTON MUST CALL THIS, not merely reset the React state. Clearing
 * the panel while leaving the stored copy would put the filters back the next
 * time you navigated away and returned — a Clear button that un-clears itself
 * is the most confusing possible outcome of this ticket.
 */
export function clearFilterState(
  namespace: string,
  userId: string | null | undefined,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(`${namespace}.${userId}`);
  } catch {
    /* best-effort, as above */
  }
}

// ---------------------------------------------------------------------------
// Shared coercions — the two shapes both surfaces need
// ---------------------------------------------------------------------------

/** ★ A stored value that must come back as a string, or the fallback. Used for
 *  every free-text and enum field: an enum that stored a value no longer in its
 *  set falls back rather than poisoning the filter. */
export function str(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback;
}

/** ★ A stored value that must come back a number, or null. `0` survives —
 *  fix-402's rule, and a lot-width target of 0 is a legitimate stored value. */
export function numOrNull(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** ★ A stored array of strings, filtered to the strings. */
export function strArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/** ★ One member of a closed set, or the fallback — so a filter value retired
 *  by a later ticket cannot come back from storage and match nothing forever. */
export function oneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}
