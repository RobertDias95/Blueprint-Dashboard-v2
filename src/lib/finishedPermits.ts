// ===========================================================================
// fix-621 (P-316) — A BLOCK MOVE LEAVES FINISHED PERMITS' DATES ALONE
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-03 (popup): **"Approved/issued keep them"**
//
// ★★★ THE SERVER IS THE RULE; THIS IS ITS MIRROR — fix-620's `finishedBlocks.ts`
//     pattern, applied one level down. The SQL predicate
//     `bp_permit_is_finished(approval_date, actual_issue)` is in the WHERE clause
//     of every permit write in every block path (drag/resize, Push Down, the
//     DD-dates editor, a lane move, the gap compactor, first placement) and in
//     the target-submit engine. Nothing here enforces anything.
//
// It exists for two reasons, and neither is "apply the rule":
//
//   1. ★★ THE OPTIMISTIC CACHE. `useSetBpDdDates` and `useUpdateDrawSchedule`
//      patch the project's permits in the React Query cache before the server
//      answers, so the screen doesn't flash stale dates. Those patches have to
//      skip the same rows the server will, or the UI shows a finished permit's
//      dates changing and then snapping back on refetch — a lie with a delay on
//      it, which is worse than a flash of the truth.
//
//   2. ★★ THE SENTENCE. A move that silently does less than it looks like it
//      does needs to say so, which is what the brief asks for in one plain line.
//
// ★★★ KEEP IN LOCKSTEP with `bp_permit_is_finished`. Same two fields, same
//     "either is enough" rule, no third condition.
//
// ---------------------------------------------------------------------------
// ★★★ THIS IS NOT fix-245's `isPermitDone`, AND NOT BY ACCIDENT
// ---------------------------------------------------------------------------
// `isPermitDone` (lib/projectViewHelpers) answers "is this permit off the live
// board?" and counts the terminal STATUSES too. This answers a different
// question — "did something real happen here, that these dates are now the
// record of?" Measured on prod 2026-10-03, the two disagree in BOTH directions:
//
//   · 63 permits are APPROVED but not `isPermitDone` (no issue date, no terminal
//     status). Those 63 are the heart of Bobby's sentence; reusing `isPermitDone`
//     would have left every one of them getting rewritten by a block move.
//   ·  5 permits are `isPermitDone` but neither approved nor issued — withdrawn
//     or closed with no date. Nothing happened on those, so their DD window is
//     still the plan it always was, and freezing it would freeze a guess.
//
// So this is a second predicate on purpose. Do not "tidy" them together.

/** The two fields the rule reads. Structural so a `Permit`, a `PermitWithCycles`
 *  or a hand-built fixture all fit without importing a row type. */
export interface FinishablePermit {
  approval_date?: string | null;
  actual_issue?: string | null;
}

/** ★ The TS twin of `public.bp_permit_is_finished(approval_date, actual_issue)`. */
export function isFinishedPermit(p: FinishablePermit | null | undefined): boolean {
  if (!p) return false;
  return p.approval_date != null || p.actual_issue != null;
}

/** The inverse, for call sites that mean "this one still syncs". */
export function isOpenPermit(p: FinishablePermit | null | undefined): boolean {
  return !isFinishedPermit(p);
}

export function countFinishedPermits(
  permits: readonly FinishablePermit[] | null | undefined,
): number {
  return (permits ?? []).filter(isFinishedPermit).length;
}

/**
 * ★★★ THE ONE PLAIN LINE, and it names what is actually true of these rows.
 *
 * The brief's example is *"2 approved permits keep their dates."* — so when they
 * are all approved, that is exactly what it says. When they are all issued it
 * says "issued", because calling an issued permit "approved" is a small lie that
 * a reader checking the permit will catch. Mixed says "approved or issued".
 *
 * ★ Returns `null` rather than '' when the rule does not apply, so a caller
 *   renders nothing by testing one value instead of remembering to check a
 *   count as well.
 */
export function finishedPermitsNote(
  permits: readonly FinishablePermit[] | null | undefined,
): string | null {
  const finished = (permits ?? []).filter(isFinishedPermit);
  if (finished.length === 0) return null;
  const issued = finished.filter((p) => p.actual_issue != null).length;
  const word =
    issued === finished.length
      ? 'issued'
      : issued === 0
        ? 'approved'
        : 'approved or issued';
  // ★ Singular reads "1 approved permit keeps its dates." — the plural verb and
  //   "their" are both wrong for one row, and this line is short enough that a
  //   reader notices.
  return finished.length === 1
    ? `1 ${word} permit keeps its dates.`
    : `${finished.length} ${word} permits keep their dates.`;
}

/**
 * ★★ THE SAME SENTENCE FOR A PUSH DOWN, which moves several projects at once.
 *
 * Push Down writes the anchor AND every displaced block, so the count that
 * matters is across all of them — a prompt that counted only the anchor's would
 * understate what it is about to leave alone.
 */
export function finishedPermitsNoteAcross(
  groups: readonly (readonly FinishablePermit[])[],
): string | null {
  return finishedPermitsNote(groups.flat());
}
