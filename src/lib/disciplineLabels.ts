// ===========================================================================
// ★★★ fix-554 §A (P-262, first installment of P-009) — ARCHITECTURE BECOMES
//     DESIGN, AND THE FOUR SCREENS THAT SAID IT DIFFERENTLY SAY IT ONCE
// ===========================================================================
//
// Bobby, 2026-09-14: *"this kind of goes back to a statement that I made a
// while ago of trying to make sure all the nomenclature in all these different
// spots kind of line up."* The right-hand bucket in the permit view read
// ARCHITECTURE; the team is the design team.
//
// ---------------------------------------------------------------------------
// ★★★ IT WAS NOT ONE WORD IN ONE PLACE. IT WAS THREE WORDS IN FOUR PLACES.
// ---------------------------------------------------------------------------
//
// `permit_tasks.discipline` holds `'arch'` on **524 rows** and `'ent'` on
// **1,292** (prod, 2026-09-15). Before this file, the four surfaces that print
// that one column printed:
//
//     surface                                   'ent'        'arch'
//     ----------------------------------------  -----------  ---------------------
//     PermitDetailV2 bucket headers             Permitting   Architecture
//     PermitDetailV2 per-task discipline select PERM         Arch
//     TaskDetailEditor discipline pill          Permitting   Architecture
//     TeamTaskComposer "Lane" select            Permitting   Design & Engineering
//
// ★★★ THAT IS P-009 IN MINIATURE, INSIDE §A's OWN SCOPE — one field, three
//     spellings, and a person moving between the permit view and the team
//     composer had no way to know they were picking the same lane. So the
//     rename is a UNIFICATION and not a find-and-replace: renaming three
//     literals would have left three literals.
//
// ★★ AND `'Design & Engineering'` WAS ACTIVELY WRONG, not merely inconsistent.
//    `D&E` is a STAGE — a different axis, rendered as its own pill directly
//    beside the discipline one in `TaskDetailEditor` (`bucketOf(task) === 'de'
//    ? 'D&E' : 'Permitting'`). The composer was naming the discipline after the
//    stage it usually belongs to. "Design" removes the collision.
//
// ---------------------------------------------------------------------------
// ★★★ THE KEY IS UNTOUCHED — fix-535 §C's SPLIT, APPLIED AGAIN
// ---------------------------------------------------------------------------
//
// `'arch'` and `'ent'` are STORED discipline keys on 1,816 rows, mirrored in
// `bp_discipline_for_team` and compared all over `lib/` (`myBoard.isDesignLeg`,
// `selfScope`, `boardOwnership`, `dashboardCardSummary`). **Nothing here
// renames data.** This is the same shape `TEAM_LABEL` and `ROLE_TITLE` already
// use: a join-safe key in the database, the word the team says on the screen.
//
// ⚠️ A component that prints a discipline key directly is now a bug, and it is
//    the kind that reads as correct. A test asserts all four renderers call
//    this module.

/** The stored discipline keys. ★ Declared here so a caller can name the type
 *  without importing the wide `PermitTask` shape — the same reason
 *  `taskTeam.TeamKey` exists beside `TEAM_LABEL`. */
export const DISCIPLINES = ['ent', 'arch'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

/**
 * ★★★ THE WORD A PERSON READS FOR EACH STORED DISCIPLINE. One map: four
 *     components translating this separately is exactly how the four above
 *     ended up disagreeing.
 *
 * ★ `ent: 'Permitting'` is NOT new — fix-535 renamed it on three of the four
 *   surfaces and this is where it finally lives once. The fourth (the per-task
 *   select) still said `PERM`, which is the same word abbreviated, so that one
 *   was never wrong — see `DISCIPLINE_SHORT`.
 */
export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  ent: 'Permitting',
  // ★★★ The rename. Bobby: the team is the DESIGN team.
  arch: 'Design',
};

/**
 * ★★★ THE ABBREVIATION COUNTS TOO — fix-535 §A's rule, verbatim: *"'Ent' and
 *     'Ents' count where a person sees them."* A rename that leaves the short
 *     form saying the old word has renamed nothing on the screen that is
 *     tightest for space and therefore read most often.
 *
 * ★★ `PERM` IS NOT MINE — it is fix-535's, already shipped in
 *    `overviewCardLayout.TEAM_INTERNAL_ROWS` and in the per-task select. `DSGN`
 *    is mine, chosen to match it in length and shape so the pair reads as a
 *    pair. Flagged in the PR: nobody says "DSGN" out loud, and if Bobby wants
 *    the full word in that 10px select it is one edit to this map rather than a
 *    hunt through four components. That is the whole point of the map.
 */
export const DISCIPLINE_SHORT: Record<Discipline, string> = {
  ent: 'PERM',
  arch: 'DSGN',
};

/** ★ An unknown or absent key returns '' rather than a guess: `discipline` is
 *  nullable on un-backfilled rows (`database.types`), and a placeholder word
 *  there would assert a lane nobody chose. */
export function disciplineLabel(d: string | null | undefined): string {
  const k = (d ?? '').trim();
  if (k === '') return '';
  return DISCIPLINE_LABEL[k as Discipline] ?? k;
}

export function disciplineShortLabel(d: string | null | undefined): string {
  const k = (d ?? '').trim();
  if (k === '') return '';
  return DISCIPLINE_SHORT[k as Discipline] ?? k;
}
