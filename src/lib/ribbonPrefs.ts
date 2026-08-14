// fix-313: the ribbon's collapsed/expanded choice, remembered across reloads.
//
// ★ NO NEW MECHANISM. This is deliberately a copy of the shape in
// src/lib/selfScope.ts (loadScopeMode / saveScopeMode): localStorage, keyed per
// user id, best-effort, returning null when the user has never chosen so the
// caller applies a default rather than a stored non-answer.
//
// The app's convention for a user preference IS localStorage — selfScope keys
// the Mine/All choice that way, and projectViewHelpers persists Project View's
// filters and sort the same way. Keying per user id is Bobby's explicit ask
// from fix-176: one login's choice must never leak to another on a shared
// browser, and the ribbon is exactly the kind of preference that would.

const KEY_PREFIX = 'ribbon.collapsed';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}.${userId}`;
}

/** The remembered choice, or null when this user has never made one. */
export function loadRibbonCollapsed(
  userId: string | null | undefined,
): boolean | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

export function saveRibbonCollapsed(
  userId: string | null | undefined,
  collapsed: boolean,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), collapsed ? '1' : '0');
  } catch {
    // localStorage full / disabled — persistence is best-effort, exactly as
    // saveScopeMode treats it. A preference that fails to save is a smaller
    // problem than a render that throws.
  }
}

/** Which groups are open, remembered the same way. A group's open/closed state
 *  is INDEPENDENT of the current route (the brief's rule) — opening a report
 *  must not force the Entitlements group shut, and closing Reports while
 *  reading one must not bounce it back open. */
export function loadRibbonOpenGroups(
  userId: string | null | undefined,
): string[] | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}.groups.${userId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((g): g is string => typeof g === 'string');
  } catch {
    return null;
  }
}

export function saveRibbonOpenGroups(
  userId: string | null | undefined,
  groups: string[],
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${KEY_PREFIX}.groups.${userId}`,
      JSON.stringify(groups),
    );
  } catch {
    // best-effort, as above
  }
}
