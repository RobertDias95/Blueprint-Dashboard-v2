// ===========================================================================
// ★★★ fix-506 §G/§H (P-140, P-167) — THE PROJECT DATA TABS, DECLARED ONCE
// ===========================================================================
//
// The tab strip renders from this list, the URL parameter is validated against
// it, and §H's Library links are built from it. One list, three readers — so a
// renamed tab cannot leave a dead link behind in the Library.
//
// ★ IN lib, NOT IN THE COMPONENT FILE. `react-refresh/only-export-components`
//   is an ERROR in this repo, so a component file may export components and
//   types and nothing else — the rule that moved a helper in fix-403, fix-408
//   and fix-499, and only LINT catches it (tsc is happy either way).

/** The query parameter that opens the modal on a tab: `?data=units`. */
export const PARAM_DATA = 'data';

export type ProjectDataTab =
  | 'site'
  | 'dates'
  | 'units'
  | 'permits'
  | 'builder'
  | 'team'
  | 'consultants'
  | 'plan'
  | 'actions';

export const PROJECT_DATA_TABS: ReadonlyArray<{ key: ProjectDataTab; label: string }> = [
  { key: 'site', label: 'Site data' },
  { key: 'dates', label: 'Dates' },
  { key: 'units', label: 'Units' },
  // ★★★ fix-514 §A0 — THE NINTH TAB, PROPOSED RATHER THAN INVENTED.
  //
  // §A0 required the leftover set to be reported before §A was built, and to
  // say so if the tabs could not absorb it. Everything Project Settings still
  // owned fits an existing tab EXCEPT the permit rows: six fields per row, N
  // rows, plus add and remove. Folding those into Site data or Units would
  // put a repeating sub-form inside a list of scalars.
  //
  // ★★ AND §G LANDS HERE TOO, which is what settles it. fix-513 refused to
  //    move `PermitDetailV2`'s ACQ editor because Project Data could only
  //    reach the Building Permit; the answer is a surface that addresses
  //    permits individually, and that is this tab. The leftover and the new
  //    requirement are the same tab, so it earns its place twice.
  { key: 'permits', label: 'Permits' },
  { key: 'builder', label: 'Builder / Owner' },
  { key: 'team', label: 'Internal team' },
  { key: 'consultants', label: 'Consultants' },
  { key: 'plan', label: 'Plan of record' },
  { key: 'actions', label: 'Actions' },
];

/**
 * ★★ AN UNKNOWN VALUE IS NOT AN ERROR, IT IS `site`.
 *
 * fix-406's lesson: removing a value from a union does not stop a stored
 * string arriving — `sortLibraryRows` threw on any unrecognised column for
 * exactly that reason. A stale bookmark to a retired tab opens the modal on its
 * first tab rather than on nothing.
 */
export function isProjectDataTab(v: string | null | undefined): v is ProjectDataTab {
  return PROJECT_DATA_TABS.some((t) => t.key === v);
}

/**
 * ★★★ fix-517 §E — THE SECOND PARAMETER, AND WHY IT IS NOT `permit`.
 *
 * The PERMITS table's row edit affordance opens Project Details on the Permits
 * tab **focused on one permit**, which needs the permit's id in the URL.
 *
 * ★★★ IT CANNOT BE `?permit=`. That parameter already exists and means
 *     something else: ProjectDetail reads it to SELECT a permit and swap the
 *     overview pane for the Permit View (fix-217/218/219). Reusing it would
 *     open the modal over a page that had silently navigated away underneath
 *     it, and closing the modal would leave you somewhere you never asked to
 *     be. Two meanings, one parameter, is exactly what fix-179 is about.
 */
export const PARAM_DATA_FOCUS = 'focus';

/**
 * The link §H's Library rows carry — and, with `focusPermitId`, the link
 * fix-517 §E's row edit affordance carries.
 */
export function projectDataHref(
  projectId: string,
  tab: ProjectDataTab,
  focusPermitId?: number | null,
): string {
  const base = `/project/${projectId}?${PARAM_DATA}=${tab}`;
  return focusPermitId == null
    ? base
    : `${base}&${PARAM_DATA_FOCUS}=${focusPermitId}`;
}

// ===========================================================================
// ★★★ fix-572 §B (P-277) — THE MODAL STOPS RESIZING
// ===========================================================================
//
// Bobby: the box changed size as he moved between tabs. It already SCROLLED —
// `max-h-[90vh]` with a `flex-1 overflow-y-auto` body — and the defect was that
// there was no MINIMUM, so a short tab collapsed the shell and Units stretched
// it.
//
// ---------------------------------------------------------------------------
// ★★★ MEASURED IN CHROME, NOT PICKED. Every tab rendered at 760px through
//     `harness/project-data-height-572.html`, body `scrollHeight` with the
//     shell unconstrained, AFTER §C's restack:
//
//       permits        781px   ← tallest, and UNBOUNDED (3 permits in the fixture)
//       units          638px   ← 3 unit types; grows 133px per type
//       dates          429px   ← tallest BOUNDED tab
//       team           373px
//       site           355px
//       actions        330px
//       builder        226px
//       consultants    153px
//       plan            64px
//       header+tabs+footer  132px of chrome
//
// ★★★ THE TALLEST TAB IS THE WRONG TARGET, AND THAT IS THE ONE JUDGEMENT HERE.
//     `permits` is a repeating sub-form: its height is a function of how many
//     permits a project has, so **no fixed height can contain it** and sizing
//     to my fixture's three would be picking a number and calling it a
//     measurement. Same for `units` beyond a point — 133px per type, and prod's
//     deepest project carries six.
//
// ★★ SO THE RULE IS: fit every BOUNDED tab, plus a Units tab at more types than
//    the average project has (prod: 2.28 where present, max 6), and let the two
//    unbounded tabs scroll — which they would at any real size anyway.
//    **638 + 132 = 770.** That clears the tallest bounded tab (429 + 132 = 561)
//    by 209px of deliberate headroom for Units.
//
// ★ AND IT FITS A LAPTOP. 90vh on a 1080p screen is ~820px, so the cap below
//   does not bind on the common machine — the box is the same size everywhere
//   most of the time, which is the entire point of fixing it. A flat `90vh`
//   would have made the `plan` tab a 64px sliver in an 820px box, which §B
//   names as a different bad thing.

/** The shell's fixed height, px. See the measurement table above. */
export const PROJECT_DATA_MODAL_HEIGHT_PX = 770;

/** ★ The cap, so a short screen never gets a modal taller than the window.
 *  `min(770px, 90vh)` — a HEIGHT, not a max-height: a max-height is what let
 *  the box collapse to its content and resize per tab. */
export const PROJECT_DATA_MODAL_MAX_VH = 90;

/** The CSS the shell renders. ★ One string, so the number and the cap cannot
 *  drift apart across a class list and a style object. */
export const PROJECT_DATA_MODAL_HEIGHT = `min(${PROJECT_DATA_MODAL_HEIGHT_PX}px, ${PROJECT_DATA_MODAL_MAX_VH}vh)`;
