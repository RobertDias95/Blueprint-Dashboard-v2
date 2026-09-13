// ===========================================================================
// fix-541 (P-236) — `Lots` stops being a question, without becoming a lie
// ===========================================================================
//
// Bobby, 2026-09-10: *"moving forward, every project we enter will be one lot,
// so idk if we still need it in the project details/add a project screen?"*
//
// ★★★ THE RULE IS TRUE GOING FORWARD AND FALSE ABOUT THE BOOK WE HAVE.
//     Measured on prod 2026-09-13: 202 projects hold 1 lot, **15 hold more**
//     (12 × 2, and one each of 3, 4, 5) and 3 hold NULL. A project showing
//     `Lots 1` when it has 5 is the app lying — the class P-230 cost a day —
//     so the field is hidden, never overwritten and never assumed.
//
// ★★ And the forward rule is not yet the observed past: of the 93 projects
//    created in the last 90 days that were NOT backfills, **11 are not 1**.
//    About one in eight of what people actually enter today.

/**
 * Should Project Details render the Lots field?
 *
 * ★★★ THE PREDICATE IS "IS IT NOT ONE", NOT "IS IT MORE THAN ONE", and the
 *     difference is the three NULLs. A NULL is not a 1 — nobody recorded an
 *     answer — so it stays VISIBLE and empty rather than being hidden behind
 *     an assumption. Hiding it would render a blank as agreement.
 *
 * ★ `0` cannot occur (the `num_lots_positive` CHECK rejects it) but it is
 *   not 1 either, so it shows — which is the right answer for a value that
 *   should not exist.
 */
export function shouldShowLotsField(numLots: number | null | undefined): boolean {
  return numLots !== 1;
}

/**
 * ★★ THE ROUTE BACK. A project entered as 1 that turns out to be 2 must have
 *    a way to the field, or hiding it is a one-way door. Project Details
 *    offers this under the Site rows whenever the field is hidden; clicking it
 *    reveals the ordinary editor for the rest of the visit, and committing a 2
 *    makes it visible permanently by the predicate above.
 */
export const ADD_LOTS_LABEL = 'More than one lot?';

/**
 * ⚠️ WHERE THIS MUST **NOT** BE USED — a hidden 1 is fine in a form and wrong
 *    in a table. The number keeps rendering for all 220 projects everywhere
 *    projects are compared side by side:
 *
 *      · `libraryHelpers` → the Library's `numLots` column
 *      · `correctionsSegments` → the "Lots" report segment (1 / 2–3 / 4+)
 *      · `teamPerformance` → lot counts summed per bucket
 *
 *    A blank cell next to a neighbour reading 5 is a worse lie than the
 *    question this ticket removed.
 */
export const LOTS_COMPARISON_SURFACES = [
  'libraryHelpers',
  'correctionsSegments',
  'teamPerformance',
] as const;
