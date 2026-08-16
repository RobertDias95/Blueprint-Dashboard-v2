// fix-326: the collapse-preference MECHANISM, in one place at last.
//
// ★ WHY THIS FILE EXISTS. fix-313 (ribbon), fix-318 (board split) and fix-324
// (Pipeline columns) each wrote the same twenty lines: localStorage, keyed per
// user id, best-effort, null when this person has never chosen so the caller
// applies its own default rather than inheriting a stored non-answer. fix-326
// needed a fourth, and its brief said what should have been said two tickets
// ago — "do not build a third preference store, reuse fix-324b's".
//
// So the mechanism is here and the callers are thin. `pipelinePrefs` keeps its
// own module, its own exported names and — critically — ITS OWN STORAGE KEY, so
// nobody's folded Pipeline columns spring open on deploy. What changed is that
// there is now one implementation of the reading and writing, not three copies
// that can drift on the details (what a corrupt value does, what a missing user
// id does, whether a failed write throws).
//
// ★ Per user, not per browser — fix-176's rule. One login's folded panels must
// never decide what another person sees on a shared machine.
//
// ★ ONE ARRAY PER NAMESPACE, not one key per panel. A new panel is a new string
// in the array: no new storage key, no migration, and an unknown key simply
// never matches.

/** Read the folded keys for `namespace`, or null when never chosen. */
export function loadCollapsedKeys(
  namespace: string,
  userId: string | null | undefined,
): string[] | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${namespace}.${userId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    // Corrupt or unreadable → treat as "never chosen" and let the caller apply
    // its default, rather than throwing on the way to a render.
    return null;
  }
}

/** Write the folded keys for `namespace`. Best-effort by design. */
export function saveCollapsedKeys(
  namespace: string,
  userId: string | null | undefined,
  keys: string[],
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${namespace}.${userId}`, JSON.stringify(keys));
  } catch {
    // localStorage full or disabled. A preference that fails to save is a
    // smaller problem than a render that throws — the same call fix-313 made.
  }
}

/** Toggle one key in a list, returning the new list. Pure, so a caller can use
 *  it inside a state updater without reading state twice. */
export function toggleCollapsedKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}
