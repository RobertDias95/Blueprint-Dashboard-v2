// ===========================================================================
// ★★★ fix-532 §C (P-247) — AN ARCHIVED PLAN OF RECORD MUST LOOK ARCHIVED
// ===========================================================================
//
// Measured on prod 2026-09-12, after fix-529's first full run:
//
//     current sets                         336 → **415**
//     rows with `is_archived_fallback`            **69**
//     projects holding one                        **60**
//     projects with a plan of record       163 → **196** of 220
//     plan-of-record rows whose OWN set is a fallback  **50**
//
// ★★★ SO 60 PROJECTS NOW SHOW A SUPERSEDED DRAWING AS THEIR PLAN OF RECORD AND
//     NOTHING ON SCREEN SAYS SO. The fallback is deliberate — a superseded set
//     is better than a blank card, and fix-529 ranked it in on purpose — but a
//     reader who is not told is reading an old drawing as a current one.
//
// ★★★ WORDS, NOT ONLY A COLOUR. §C is explicit, and the reason is the audience:
//     the `/s/` share page is read by a BUILDER who has never seen the legend,
//     will never see it, and has no way to ask what a tint means. The same
//     sentence goes on every surface, which is why it is a constant rather than
//     four pieces of copy.
//
// ⚠️ THE SET IS NOT HIDDEN AND THE RANKING DOES NOT MOVE. §C: *"It is shown
//    deliberately; the marker is the whole change."*

/** What every surface says about a fallback set. ★ ONE string: four surfaces
 *  wording this differently is four chances for one of them to sound optional.
 *  "Nothing current on file" is the actionable half — it tells whoever can fix
 *  it what is missing, which a bare "Archived" does not. */
export const ARCHIVED_FALLBACK_LABEL = 'Archived — nothing current on file.';

/** The short form, for a table cell that has no room for a sentence. ★ The
 *  long one is its `title`, so the short form is never the only thing said. */
export const ARCHIVED_FALLBACK_SHORT = 'ARCHIVED';

/**
 * Is this set a fallback to an archived drawing?
 *
 * ★★★ READ, NEVER RECOMPUTED. §C: *"The column is already on
 *     `project_plan_of_record_sets` — read it, do not recompute it."* The
 *     indexer decides what "archived" means by where the file sits on the
 *     share; a second definition here would be a second answer waiting to
 *     disagree with fix-529's.
 *
 * ★★ AND `undefined` IS NOT TRUE. The flag is optional on the shapes that
 *    reach the `/s/` page, because `bp_resolve_plan_share` does not return it
 *    yet — so an unknown reads as "not a fallback", which is the direction that
 *    does not put a warning on a set that may be perfectly current. **A marker
 *    that cries wolf is worse than one that is late**, and the migration that
 *    makes it knowable is staged for Cowork.
 */
export function isArchivedFallback(
  row: { is_archived_fallback?: boolean | null } | null | undefined,
): boolean {
  return row?.is_archived_fallback === true;
}
