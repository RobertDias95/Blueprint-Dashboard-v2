// ===========================================================================
// ★★★ fix-564 §B (P-269) — A PERMIT THE TOOL WILL NEVER REFRESH SAYS SO
// ===========================================================================
//
// `SPUE-IPR-26-00393` at **2039 N 78th St** reads *Reviews In Process*, last
// touched **19 May** — nearly four months of a hand-typed status the tool will
// never correct, presented on screen as fact. It looks identical to a permit
// the scraper updated this morning, and that is the actual harm in this ticket:
// the notification was merely unreadable, this is *wrong*.
//
// ★★★ DERIVED FROM THE PERMIT TYPE, NEVER A COLUMN. No migration, no backfill,
//     and a permit of one of these types created tomorrow carries the marker
//     the moment it exists. A stored flag would have needed a backfill for 32
//     rows and a writer for every future one, and would have been wrong the
//     first time somebody forgot.
//
// ★★★ THE TYPE IS A SOUND KEY, MEASURED OVER ALL HISTORY (prod 2026-09-14):
//     every `module_unsupported` fetch failure ever recorded is
//     **IPR (267 rows, 9 permits) or TRAO (223 rows, 13 permits)**, one-to-one
//     with the two collections fix-80 deferred, and **no other permit type has
//     ever produced one.** So "which permits are never refreshed" and "which
//     types are these" are the same question, and this file answers it once.
//
// ★★ WHAT THE PERSON READS NEVER SAYS WHY THE MACHINE CANNOT. The reason is a
//    fact about our scraper's internals; the reader needs to know what to DO.
//    Hence *"Not tracked — update manually"* and nothing about how the tool is
//    put together.
//
// ★ 32 permits today: 16 IPR + 16 TRAO. **All 16 IPR are in a non-finished
//   state**, 10 of the 32 have never been touched by the scraper at all, and
//   the rest were last touched between 19 May and 29 Aug.

/**
 * The permit types the scraper does not read and is not meant to.
 *
 * ★ fix-80 deferred the two collections these live in **deliberately**; this is
 *   not a bug list and un-deferring them is a scraper ticket nobody has asked
 *   for. This set exists so the SCREEN can be honest about it meanwhile.
 */
export const NOT_TRACKED_PERMIT_TYPES: ReadonlySet<string> = new Set([
  'IPR',
  'TRAO',
]);

/** What a reader sees. ★ It says what to do, not what broke. */
export const NOT_TRACKED_LABEL = 'Not tracked — update manually';

/** The hover, which may be longer but still explains nothing technical. */
export const NOT_TRACKED_TITLE =
  'This permit type is not read from the portal, so its status is only ever what somebody typed here. Check the portal and update it by hand.';

/**
 * Is this permit one the tool never refreshes?
 *
 * ★ Structural in the argument so a `Permit`, a table row and a fixture all
 *   satisfy it, and tolerant of a missing type: an unknown type is *tracked*,
 *   because claiming "not tracked" about a permit we might be updating is the
 *   worse of the two mistakes.
 */
export function isNotTrackedPermit(
  permit: { type?: string | null } | null | undefined,
): boolean {
  const t = (permit?.type ?? '').trim();
  return t !== '' && NOT_TRACKED_PERMIT_TYPES.has(t);
}
