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

/** The link §H's Library rows carry. */
export function projectDataHref(projectId: string, tab: ProjectDataTab): string {
  return `/project/${projectId}?${PARAM_DATA}=${tab}`;
}
