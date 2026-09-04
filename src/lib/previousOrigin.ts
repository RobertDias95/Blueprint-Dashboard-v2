// ===========================================================================
// ★★★ fix-403 / fix-408 — WHERE "PREVIOUS" GOES BACK TO
// ===========================================================================
//
// Bobby, 2026-08-25 (fix-403): *"Right now, say I'm in Project Overview and
// there's that search button. I think instead of us having a search button, if
// there was a go back or a previous button."*
//
// Bobby, 2026-08-25 (fix-408, register P-041): **"Previous is a site-wide smart
// function. Whenever you enter a page from another page, Previous takes you
// back to that page in the state you left it, and is labelled with that page's
// name."**
//
// ---------------------------------------------------------------------------
// ★★★ WHAT fix-408 CHANGED, AND WHY THE OLD SHAPE COULD NOT SCALE
// ---------------------------------------------------------------------------
//
// fix-403 shipped a CLOSED SET of two origins — Library and Pipeline — with a
// hand-written label per member. That was right for a ticket about two lists,
// and it is exactly why the reproduction below happened: every OTHER way into a
// project fell through to the no-origin case.
//
//   Reproduced 2026-08-25: My Board → Notifications → click a notification →
//   land in a project chat → the button reads "← Search". You came from
//   Notifications; the button offers you Project View. That is an extra click
//   and a lie about where you were.
//
// ★★ SO THE SET IS OPEN NOW — but the VALIDATION is not. An origin is honoured
// only when its path resolves to a page this app actually has (`PAGE_LABELS`
// below). An unrecognised, off-site or hand-edited value still falls through to
// the no-origin case rather than navigating somewhere arbitrary, which is the
// property fix-403's closed set existed to guarantee. What changed is how the
// set is expressed: a route table instead of a two-member enum.
//
// ★★★ fix-387's SAFE-URL RULE APPLIES AND IS NOT "STARTS WITH /". `//evil.com`
// starts with a slash and is a protocol-relative URL to somebody else's site.
// `isInAppPath` rejects it explicitly, and the label lookup would reject it
// again — belt and braces, because this value can come out of router state that
// a link on any of thirty-odd surfaces wrote.
//
// ---------------------------------------------------------------------------
// ★★★ THE ORIGIN TRAVELS IN ROUTER STATE; THE FILTERS DO NOT. (fix-403, KEPT)
// ---------------------------------------------------------------------------
//
// ★ The fix-408 brief said fix-403 "used sessionStorage" for the origin. It did
// not, and the distinction is load-bearing enough to restate rather than
// quietly correct:
//
//   · THE ORIGIN is in ROUTER STATE. "Which page did this click come from" is
//     something only the click knows, and it must differ per click — two links
//     on two surfaces to the same project have two different answers.
//   · THE FILTERS are in sessionStorage (see `filterPrefs`), precisely so they
//     come back through the browser's back button and the ribbon too. Router
//     state would restore them for this button alone.
//
// fix-408 keeps both halves exactly where fix-403 put them.

/** ★ fix-403's two named origins, KEPT — they are still the two list surfaces
 *  the button was built for, and naming them keeps those call sites reading as
 *  intent rather than as a string. They are no longer the whole set. */
export const PREVIOUS_ORIGINS = {
  library: '/library',
  pipeline: '/dashboard',
} as const;

export type PreviousOrigin =
  (typeof PREVIOUS_ORIGINS)[keyof typeof PREVIOUS_ORIGINS];

/**
 * ★★★ THE ORIGIN RECORD — what one click writes into router state.
 *
 * `from` is the FULL in-app location, path AND query. That single decision is
 * what delivers most of the brief's "in the state you left it":
 *
 *   · `/board?tab=tasks` comes back on My Tasks, not My Board.
 *   · `/notifications?kind=suppressed` comes back on the suppressed list.
 *   · `/reports?tab=trends` comes back on Trends.
 *
 * The tab IS the URL on every tabbed surface in this app (fix-385 made sure of
 * it), so no tab-restoring machinery had to be invented — capturing the query
 * string was the whole of it.
 */
export interface OriginState {
  /** In-app path including the query string, e.g. `/notifications?kind=x`. */
  from: string;
  /** ★ An override for pages whose NAME IS DATA rather than a route — a
   *  project is "4137 S Junction St", not "Project". Optional: every fixed
   *  page gets its name from `PAGE_LABELS` and passes nothing. */
  label?: string;
}

// ---------------------------------------------------------------------------
// ★★★ fix-408 §4 — WHERE YOU WERE READING
// ---------------------------------------------------------------------------
//
// ★★★ THE OFFSET IS NOT IN THE ORIGIN RECORD, and the reason is worth writing
// down because the obvious design does not survive React's rules.
//
// The obvious design is to stamp the pane's scrollTop into the state the
// outbound <Link> carries. It cannot be done in RENDER — a long list renders
// once at the top and is clicked after you have scrolled to the bottom, so a
// render-time read records 0 every time — and mutating the render-created state
// object from the click handler is exactly what the React Compiler's
// "cannot modify local variables after render completes" rule forbids. (It was
// written that way first; the lint is what caught it.)
//
// ★★ So the offset goes where a click-time side effect belongs: a module map,
// keyed by the location it belongs to. The ROUTER STATE carries a one-bit
// instruction — "this navigation is a Previous, restore if you have something"
// — and the number is looked up on arrival.
//
// ★ IN MEMORY, NOT sessionStorage. A pixel offset is the shortest-lived thing
// in this app: it is meaningless after a reload (the list may be a different
// length) and it must not outlive the tab. A module-level Map dies with the
// page, which is precisely the lifetime wanted, and needs no per-user key
// because it never touches disk. fix-403's rule — a train of thought is not a
// preference — taken one step further.
const PANE_SCROLL = new Map<string, number>();

/** ★ Bounded so a long session cannot grow it without limit. Oldest first —
 *  `Map` preserves insertion order, and the pages you left longest ago are the
 *  ones you are least likely to be sent back to. */
const PANE_SCROLL_MAX = 50;

/** Record the pane offset for a location. Called from a click handler, never
 *  from render. */
export function rememberPaneScroll(path: string, y: number | undefined): void {
  if (typeof y !== 'number' || !Number.isFinite(y) || y <= 0) {
    PANE_SCROLL.delete(path);
    return;
  }
  PANE_SCROLL.delete(path);
  PANE_SCROLL.set(path, Math.round(y));
  while (PANE_SCROLL.size > PANE_SCROLL_MAX) {
    const oldest = PANE_SCROLL.keys().next().value;
    if (oldest === undefined) break;
    PANE_SCROLL.delete(oldest);
  }
}

/** The offset recorded for a location, or null. */
export function recallPaneScroll(path: string): number | null {
  return PANE_SCROLL.get(path) ?? null;
}

/** Test seam — the map is module state, so a test that asserts one behaviour
 *  must not leak into the next. */
export function clearPaneScroll(): void {
  PANE_SCROLL.clear();
}

// ---------------------------------------------------------------------------
// ★★★ THE PAGE NAMES — one row per route this app has
// ---------------------------------------------------------------------------
//
// ★★ THIS IS A COVERAGE-GUARDED LIST, in the fix-315 shape. A test walks
// `allRibbonRoutes()` + `ribbonExemptPaths()` — the same union that already
// guarantees every route is reachable — and fails if any of them has no name
// here. Adding a route to router.tsx without naming it would otherwise ship a
// page that silently reports itself as "Search", which is the exact defect
// fix-408 exists to remove; a hand-written list with nothing checking it is how
// fix-313 lost two screens.
//
// ★ THE NAME IS THE USER-FACING ONE, taken from the ribbon where the page has a
// ribbon entry (Pipeline, My Board, Library, Project View, Saved reports) and
// from the page's own heading where it does not (Notifications, Activity,
// What's New, Error triage, Recurring corrections). A label nobody recognises
// is not better than no label.
//
// ★ ORDER MATTERS: first match wins, so the more specific pattern is listed
// first — `/reports/corrections/patterns` before `/reports/corrections`, and
// `/board?tab=tasks` before `/board`. This is fix-335's longest-match rule for
// the ribbon, applied to the same problem in a different place.
const PAGE_LABELS: ReadonlyArray<{ match: RegExp; label: string }> = [
  // — the daily destinations —
  { match: /^\/dashboard(?:\?|$)/, label: 'Pipeline' },
  { match: /^\/draw-schedule(?:\?|$)/, label: 'Draw Schedule' },
  // ★ The board's three tabs read as three pages, because that is what they are
  //   to the person clicking. `?tab=tasks` and `/notifications` are separate
  //   addresses (fix-385) and each carries its own tab's label.
  { match: /^\/board\?(?:.*&)?tab=tasks(?:&|$)/, label: 'My Tasks' },
  { match: /^\/board(?:\?|$)/, label: 'My Board' },
  // ★★ fix-462: the Agenda names itself like any other destination. A ribbon
  //    route with no page name is one fix-408's guard fails on — and rightly:
  //    a Previous button that navigates somewhere it cannot name is the bug
  //    that ticket exists to prevent. Every row on the agenda links into a
  //    project, so this is a real origin, not a formality.
  { match: /^\/agenda(?:\?|$)/, label: 'Agenda' },
  { match: /^\/notifications(?:\?|$)/, label: 'Notifications' },
  { match: /^\/my-tasks(?:\?|$)/, label: 'My Tasks' },
  { match: /^\/waiting-on(?:\?|$)/, label: 'Waiting On' },
  { match: /^\/library(?:\?|$)/, label: 'Library' },
  { match: /^\/activity(?:\?|$)/, label: 'Activity' },
  { match: /^\/whats-new(?:\?|$)/, label: "What's New" },
  // — project surfaces —
  { match: /^\/projects(?:\?|$)/, label: 'Project View' },
  // ★ A project's real name is its address, which only the linking surface
  //   knows. This is the generic fallback for a link that supplies none.
  { match: /^\/project\/[^/?#]+(?:\?|$)/, label: 'Project' },
  // — reports —
  { match: /^\/reports\/corrections\/patterns(?:\?|$)/, label: 'Recurring corrections' },
  { match: /^\/reports\/corrections(?:\?|$)/, label: 'Corrections' },
  { match: /^\/reports\/saved(?:\?|$)/, label: 'Saved reports' },
  { match: /^\/reports\/team\/[^/?#]+(?:\?|$)/, label: 'Team' },
  { match: /^\/reports\/weekly-da(?:\?|$)/, label: 'Weekly DA Update' },
  { match: /^\/reports\/weekly-updates(?:\?|$)/, label: 'Weekly Updates' },
  { match: /^\/reports\/approved-awaiting(?:\?|$)/, label: 'Awaiting Issuance' },
  // ★★ fix-499: ONE ROUTE, SEVEN REPORTS. The label was "Structural Forecast",
  //   which is now a lie on six of them — and this list maps a path to a fixed
  //   string, so it cannot read the `?discipline` back out. Generalised rather
  //   than left wrong: "Schedule Forecast" is true of all seven, and a Previous
  //   link that under-specifies is far better than one that misnames.
  {
    match: /^\/reports\/vendor-forecast(?:\?|$)/,
    label: 'Schedule Forecast',
  },
  { match: /^\/reports\/waiting-on(?:\?|$)/, label: 'Waiting On' },
  { match: /^\/reports\/phase-durations(?:\?|$)/, label: 'Phase durations' },
  { match: /^\/reports\/builder(?:\/[^/?#]+)?(?:\?|$)/, label: 'Report builder' },
  { match: /^\/reports\/custom\/[^/?#]+(?:\?|$)/, label: 'Report' },
  { match: /^\/reports(?:\?|$)/, label: 'Reports' },
  { match: /^\/trends(?:\?|$)/, label: 'Reports' },
  // — administrative —
  { match: /^\/settings\/errors(?:\?|$)/, label: 'Error triage' },
  { match: /^\/settings(?:\/[^/?#]+)?(?:\?|$)/, label: 'Settings' },
];

/** ★★★ fix-387's rule, restated because "starts with /" is NOT it: `//evil.com`
 *  is a protocol-relative URL to somebody else's origin and passes that test.
 *  A backslash is rejected too — some browsers normalise `/\evil.com` the same
 *  way. */
export function isInAppPath(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    raw.startsWith('/') &&
    !raw.startsWith('//') &&
    !raw.startsWith('/\\')
  );
}

/**
 * The page name for an in-app location, or null when this app has no such page.
 *
 * ★ Null is the SAFE answer, and the only one that reaches a navigation: an
 * unnamed path is a path we cannot vouch for, so `previousTarget` declines it.
 */
export function originLabelForPath(raw: unknown): string | null {
  if (!isInAppPath(raw)) return null;
  // ★ The hash is irrelevant to which page you are on and must not defeat a
  //   `$`-anchored pattern.
  const path = raw.split('#')[0];
  for (const row of PAGE_LABELS) if (row.match.test(path)) return row.label;
  return null;
}

/**
 * ★★★ THE ONE HELPER EVERY ENTRY PATH CALLS (through `<OriginLink>`).
 *
 * Build the origin record for the location the user is standing on right now.
 * Every link into a project passes the result straight to `<Link state>`, which
 * is why "the origin is the IMMEDIATE previous page" is true by construction
 * rather than by discipline: chaining project → chat → another project records
 * the chat, because the chat is what `useLocation()` returned at the moment its
 * link was clicked. There is no stack to keep and nothing to pop.
 */
export function makeOriginState(
  loc: { pathname: string; search?: string },
  opts?: { label?: string },
): OriginState | undefined {
  const from = `${loc.pathname}${loc.search ?? ''}`;
  // ★ A location with no page name is not recorded at all — better a "← Search"
  //   fallback than a button that navigates somewhere we cannot name.
  if (!originLabelForPath(from)) return undefined;
  const label = opts?.label?.trim();
  return { from, ...(label ? { label: label.slice(0, 60) } : {}) };
}

/**
 * ★★ THE PROJECT ID INSIDE AN ORIGIN PATH, or null when the origin is not a
 * project page.
 *
 * ★★★ WHY THIS EXISTS RATHER THAN A `originLabel` PROP ON FIVE MORE LINKS.
 * A project's name is its ADDRESS, and the surfaces that link project → project
 * (the "Redesign of" badge, the redesigns sidebar, the Reuse editor, a permit
 * chip inside a chat message) sit three and four components deep inside
 * ProjectDetail and know only an id. Threading the current address down four
 * prop boundaries would put the same string in four places and let it rot in
 * all of them.
 *
 * ★ The READING side already has what it needs: ProjectDetail holds the cached
 * project list (fix-126 put it there for exactly this class of lookup), and the
 * origin path names the project. So the label is resolved where the data is,
 * and a link that knows nothing keeps working.
 */
export function projectIdFromPath(raw: unknown): string | null {
  if (!isInAppPath(raw)) return null;
  const m = /^\/project\/([^/?#]+)/.exec(raw);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * ★★★ THE NO-ORIGIN CASE, AND THE CHOICE MADE HERE. (fix-403, UNCHANGED)
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
 * loses a destination they had yesterday, and fix-408 widening the set of
 * origins cannot take one away either.
 *
 * @param currentPath the location the button is being rendered ON. An origin
 *        identical to it is declined: a Previous that reloads the page you are
 *        already looking at reads as broken.
 */
export function previousTarget(
  raw: unknown,
  currentPath?: string,
  opts?: {
    /** ★ Resolve a project id to its address, for origins whose name is data.
     *  Consulted ONLY when the link recorded no explicit label; returning null
     *  (an unknown or uncached project) falls back to the generic route name
     *  rather than to nothing. */
    labelForProject?: (id: string) => string | null | undefined;
  },
): { to: string; label: string; state?: { restoreScroll: true } } {
  const o =
    raw && typeof raw === 'object' ? (raw as Partial<OriginState>) : null;
  const from = o?.from;
  const routeLabel = originLabelForPath(from);
  if (from && routeLabel && from !== currentPath) {
    // ★ The override is trusted for its TEXT only, never for the destination —
    //   `to` always comes from `from`, which has already been validated as a
    //   page this app has. A label cannot navigate.
    const projectId = opts?.labelForProject ? projectIdFromPath(from) : null;
    const label =
      (typeof o?.label === 'string' && o.label.trim()
        ? o.label.trim()
        : projectId
          ? (opts?.labelForProject?.(projectId) ?? '').trim() || routeLabel
          : routeLabel
      ).slice(0, 60);
    return {
      to: from,
      label: `← ${label}`,
      // ★ One bit: "this navigation is a Previous." Whether there is anything
      //   to restore is the arriving page's question, not this one's.
      ...(recallPaneScroll(from) != null
        ? { state: { restoreScroll: true as const } }
        : {}),
    };
  }
  return { to: '/projects', label: '← Search' };
}

/** ★ The one-shot scroll instruction Previous hands to the page it returns to,
 *  resolved against what was recorded for that page.
 *
 *  ★★ ONLY A PREVIOUS CLICK SETS THE FLAG. A ribbon click, the browser's back
 *  button and an ordinary link all arrive with other state or none, read as
 *  "no instruction", and land at the top exactly as they always have. That is
 *  the whole reason this is a flag on one navigation rather than a general
 *  scroll-restoration store, which would also fire for somebody starting
 *  fresh from the ribbon. */
export function restoreScrollFrom(raw: unknown, path: string): number | null {
  if (!raw || typeof raw !== 'object') return null;
  if ((raw as { restoreScroll?: unknown }).restoreScroll !== true) return null;
  return recallPaneScroll(path);
}

/** ★ The shell's single scroll container (Chrome's `<main>`). Named here so the
 *  capture side and the restore side cannot drift apart. */
export const SCROLL_PANE_SELECTOR = '[data-testid="bridge-pane"]';

/** Current scroll offset of that pane, or undefined outside a browser. */
export function currentPaneScroll(): number | undefined {
  if (typeof document === 'undefined') return undefined;
  const el = document.querySelector(SCROLL_PANE_SELECTOR);
  return el instanceof HTMLElement ? el.scrollTop : undefined;
}
