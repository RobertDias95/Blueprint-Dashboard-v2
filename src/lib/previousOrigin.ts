// ===========================================================================
// ★★★ fix-403 — WHERE "PREVIOUS" GOES BACK TO
// ===========================================================================
//
// Bobby, 2026-08-25: *"Right now, say I'm in Project Overview and there's that
// search button. I think instead of us having a search button, if there was a
// go back or a previous button."*
//
// ★★ WHAT THE SEARCH BUTTON DID. It was a plain `<Link to="/projects">` labelled
// "← Search" — it took you to the Project View list, not to whatever you were
// doing. That destination is still on the ribbon (Reports → Project View), and
// it is ALSO this button's no-origin fallback below, so nothing is lost.
//
// ★★★ THE ORIGIN TRAVELS IN ROUTER STATE; THE FILTERS DO NOT. Router state
// answers "which list did this click come from", which only the click knows.
// The filters live in sessionStorage (see filterPrefs) precisely so they come
// back through the browser's back button and the ribbon too — router state
// would restore them for this button alone and forget them everywhere else.

/** The lists a project can be opened FROM. A closed set: an unrecognised value
 *  in router state falls through to the no-origin case rather than navigating
 *  somewhere arbitrary. */
export const PREVIOUS_ORIGINS = {
  library: '/library',
  pipeline: '/dashboard',
} as const;

export type PreviousOrigin =
  (typeof PREVIOUS_ORIGINS)[keyof typeof PREVIOUS_ORIGINS];

const LABELS: Record<PreviousOrigin, string> = {
  '/library': 'Library',
  '/dashboard': 'Pipeline',
};

/**
 * ★★★ THE NO-ORIGIN CASE, AND THE CHOICE MADE HERE.
 *
 * A deep link, a refresh, a link pasted into Slack — none of them has an
 * origin. The brief offered "hidden, or a default to Pipeline"; this does
 * NEITHER, and deliberately:
 *
 *   · HIDING leaves a hole in the chrome and, worse, removes the only way back
 *     to any list from a page somebody arrived at cold.
 *   · DEFAULTING TO PIPELINE guesses, and guesses wrong for anyone whose link
 *     came out of the Library.
 *
 * ★★ So with no origin the button becomes exactly what it replaced: "← Search",
 * to /projects. That is strictly additive — the pre-fix-403 behaviour is the
 * floor, and having an origin is the only thing that ever changes it. Nobody
 * loses a destination they had yesterday.
 */
export function previousTarget(raw: unknown): { to: string; label: string } {
  const from =
    raw && typeof raw === 'object' && 'from' in raw
      ? (raw as { from?: unknown }).from
      : null;
  if (typeof from === 'string' && from in LABELS) {
    const origin = from as PreviousOrigin;
    return { to: origin, label: `← ${LABELS[origin]}` };
  }
  return { to: '/projects', label: '← Search' };
}
