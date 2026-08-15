// fix-318: how much of /board goes to My Board vs My Tasks.
//
// ★ WHY THIS EXISTS RATHER THAN A 50/50 SPLIT. The brief's standing size
// contract is 1440x900 and it asks for the split to be MEASURED, not
// eyeballed. Measured in headless Chrome against the real shell box model
// (ribbon 248 + header 56 + <main> p-6), at the default 45/55:
//
//   window       usable H   top / bottom   forecast   task     page      tasks
//                                          cards      cards    scrolls   scroll-x
//   1280x800        601      270 / 322        2         2        no        YES
//   1440x900        701      315 / 377        3         3        no        no
//   1600x1000       801      360 / 432        4         4        no        no
//
// So it FITS at 1440x900 — the page never scrolls at any of the three — but
// three cards per half is tight, and it is tight in BOTH halves at once, which
// an even split makes worse rather than better: My Board's three panels sit in
// a grid that degrades gracefully, while My Tasks stacks counters + filter row
// + column header (122px of furniture) before its first card. Giving the
// bottom the larger share is what keeps their visible-card counts equal.
//
// Hence: an asymmetric default AND a draggable divider remembered per user —
// the option the brief offered for exactly this case. Nobody is stuck with my
// arithmetic.
//
// ★ The 1280 row is the one worth keeping: the bottom region scrolls
// HORIZONTALLY there while the page does not. That is Bobby's "fixed
// vertically and horizontally", confirmed rather than assumed.
//
// Persistence is deliberately the same shape as ribbonPrefs.ts (fix-313):
// localStorage, keyed per user id, best-effort, returning null when the user
// has never chosen so the caller applies the default rather than a stored
// non-answer. Per user because of fix-176's rule — one login's choice must not
// leak to another on a shared browser.

const KEY_PREFIX = 'board.splitPct';

/** Percentage of the available height given to the TOP region (My Board). */
export const DEFAULT_SPLIT_PCT = 45;

/** Clamps that keep both halves usable no matter how hard the divider is
 *  dragged. Against the 701px measured at 1440x900: 25% leaves the board 175px
 *  (its title row plus one card) and 70% leaves My Tasks 210px (its 122px of
 *  furniture plus a card). Past either end a half stops showing anything and
 *  becomes a scrollbar, which is worse than a small panel. */
export const MIN_SPLIT_PCT = 25;
export const MAX_SPLIT_PCT = 70;

export function clampSplit(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_SPLIT_PCT;
  return Math.min(MAX_SPLIT_PCT, Math.max(MIN_SPLIT_PCT, Math.round(pct)));
}

export function loadBoardSplit(userId: string | null | undefined): number | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}.${userId}`);
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return clampSplit(n);
  } catch {
    return null;
  }
}

export function saveBoardSplit(
  userId: string | null | undefined,
  pct: number,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}.${userId}`, String(clampSplit(pct)));
  } catch {
    // localStorage full / disabled — persistence is best-effort, exactly as
    // saveRibbonCollapsed treats it.
  }
}
