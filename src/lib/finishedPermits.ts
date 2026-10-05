// ===========================================================================
// fix-621 (P-316) → fix-624 (P-320) — WHAT A BLOCK MOVE MAY DO TO A FINISHED
//                                      PERMIT'S DATES
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-05: **"Fill blanks, never overwrite."**
//
// fix-621 left a finished permit's four date fields ALONE. That was right about
// recorded dates and wrong about blank ones: 193 of 592 finished permits had no
// DD window at all (38 created in the last 30 days), and placing their block
// left them blank forever. fix-624 narrows the rule to what Bobby actually
// meant — a recorded value is history and never changes; a BLANK one is not a
// record of anything and gets filled.
//
// ---------------------------------------------------------------------------
// fix-621 (P-316) — A BLOCK MOVE LEAVES FINISHED PERMITS' DATES ALONE
// ---------------------------------------------------------------------------
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
 * ★★★ THE FILL RULE — the TS twin of
 *     `public.bp_fill_if_blank(approval_date, actual_issue, current, next)`.
 *
 * ⚖️ Bobby, 2026-10-05: **"Fill blanks, never overwrite."**
 *
 *   open permit      → `next`, always (unchanged behaviour)
 *   finished, blank  → `next`. **This is fix-624.**
 *   finished, filled → `current`, untouched.
 *
 * ★★ PER FIELD. The caller passes one field's current value, so a blank
 *    `dd_end` beside a filled `dd_start` fills only `dd_end`. Measured on prod
 *    2026-10-05 no permit is half-blank (all 193 have both NULL), so that case
 *    is latent — implemented because it was ruled, not because it fires.
 *
 * ★ Used by the OPTIMISTIC CACHE patches in `useUpdateDrawSchedule` and
 *   `useSetBpDdDates`. They used to return a finished row untouched (fix-621);
 *   now they must fill its blanks, or a fill the server performs would not
 *   appear until the refetch — the same "lie with a delay on it" in reverse.
 */
export function fillIfBlank<T extends string | null | undefined>(
  permit: FinishablePermit | null | undefined,
  current: T,
  next: T,
): T {
  if (!isFinishedPermit(permit)) return next;
  return (current ?? next) as T;
}

/**
 * ★★★ §B — IS THIS FIELD NOW A RECORD RATHER THAN AN INPUT?
 *
 * A finished permit's FILLED date is history: the server will not change it, so
 * an input bound to it takes typing, the block moves, and the field snaps back
 * to the recorded value. That reads like a failed save, which is why Bobby
 * ruled it read-only. A BLANK one stays editable — it is the one case where
 * typing still reaches the database.
 */
export function isDateFieldHistory(
  permit: FinishablePermit | null | undefined,
  current: string | null | undefined,
): boolean {
  return isFinishedPermit(permit) && current != null && current !== '';
}

/** 'Issued' when there is an issue date, else 'Approved', else null.
 *
 *  ★ ISSUED WINS when both dates are present: it is the later state, and a
 *    reader who opens the permit will see "Issued". fix-621's count sentence
 *    makes the same choice for the same reason. */
export function finishedPermitWord(
  p: FinishablePermit | null | undefined,
): 'Approved' | 'Issued' | null {
  if (!isFinishedPermit(p)) return null;
  return p?.actual_issue != null ? 'Issued' : 'Approved';
}

/**
 * ★★★ §B's ONE LINE, in Bobby's words (2026-10-05):
 *
 *   *"Approved — these are the Building Permit's design dates. Move the block on
 *     the Draw Schedule to change the lane."*
 *
 * ★ It says where to go instead. A read-only field that only says "read-only"
 *   leaves somebody stuck; the Draw Schedule is the answer and naming it is the
 *   difference between an explanation and a refusal.
 *
 * ★ `null` when the rule does not apply, so the caller renders nothing by
 *   testing one value.
 */
export function ddHistoryNote(
  bp: FinishablePermit | null | undefined,
  ddStart: string | null | undefined,
  ddEnd: string | null | undefined,
): string | null {
  const word = finishedPermitWord(bp);
  if (word === null) return null;
  // Only once something is recorded. While both are blank the fields are live.
  if (!isDateFieldHistory(bp, ddStart) && !isDateFieldHistory(bp, ddEnd)) return null;
  return (
    `${word} — these are the Building Permit's design dates. ` +
    'Move the block on the Draw Schedule to change the lane.'
  );
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
