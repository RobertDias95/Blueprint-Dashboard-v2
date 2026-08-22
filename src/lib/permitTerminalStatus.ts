// fix-31c: extracted from reviewerRollup.ts so permitStatus.ts +
// permitStage.ts can apply the same terminal-positive override
// without pulling in the reviewer-rollup module (which has its own
// transitive dependencies on PermitCycleReviewer types). One source
// of truth for "what does it mean for a permit to be terminally
// positive at the portal-status level?"
//
// Terminal-positive = the city has finished its part. Per-cycle and
// per-reviewer state observed before this point is known-stale by
// definition: the permit moved past those interim states at the
// workflow / record-status level even when individual event streams
// still end at an earlier interim status.
//
// Motivating example (SDOTTRLA0002310 at 4506 14th Ave SW, 2026-05-19):
//   permits.status        = 'Conceptually Approved'
//   cycle 1.corr_issued   = 2026-05-06   (historical; resolved at parent level)
//   reviewer last event   = "Additional Info Requested"
//   STAGE column          rendered "CORRECTIONS" (wrong) — should be "PERMITTING"
//   PERMIT STATUS         rendered "Corr Required (Cycle 1)" — should mirror permit.status
//
// Callers: derivePermitStatus (permitStatus.ts), effectiveStage
// (permitStage.ts), rollupCounts (reviewerRollup.ts re-exports the
// constant + helper for backwards compat with fix-31b consumers).

// fix-31d (2026-05-19): split into two sub-sets based on which Stage
// the status maps to. The union (TERMINAL_POSITIVE_STATUSES below)
// keeps fix-31b's reviewer-rollup semantic — both sub-sets are
// "everyone done" from the chip's perspective. effectiveStage in
// permitStage.ts is the only caller that cares about the distinction.

// City has terminally signed off; permit is effectively issued even
// when no actual_issue date is recorded. Most common for SDOT permit
// types where the city's portal never issues a separate document —
// Conceptually Approved IS the final state, no further paperwork
// happens. effectiveStage routes these to 'is'.
export const TERMINAL_ISSUED_STATUSES: ReadonlySet<string> = new Set([
  'Conceptually Approved',
  'Approved',
  'Issued',
  'Completed',
  'Closed',
]);

// City has approved but issuance is still pending (typically fees +
// formal stamp). effectiveStage routes these to 'ap' (Approved), not
// 'is'. Only one value today; kept as a Set for symmetry with the
// issued-sub-set and easy expansion.
export const TERMINAL_APPROVED_STATUSES: ReadonlySet<string> = new Set([
  'Ready for Issuance',
]);

// ===========================================================================
// ★★★ fix-388 — THE MISSING HALF: TERMINALLY NEGATIVE
// ===========================================================================
//
// Everything above is terminal-POSITIVE: the city finished and said yes. This
// file called itself "one source of truth for what it means for a permit to be
// terminally positive", and the negative half had no home — so a Withdrawn
// permit was, to the board, simply a permit that had never been submitted, and
// it went on raising "submit the set" prompts forever.
//
// ★★ It is added HERE rather than in a new module on purpose. Three status sets
// already exist with deliberately DIFFERENT meanings —
// TERMINAL_POSITIVE_STATUSES above, APPROVED_NOT_ISSUED_TERMINAL_STATUSES
// (fix-221, effectiveIssued.ts) and PROJECT_DONE_STATUSES (fix-245,
// projectViewHelpers.ts) — and each says in its own comment why it is not the
// others. A fourth module would have been a rival concept; this is the
// completion of an existing one.
//
// ★★★ ENUMERATED, NEVER MATCHED. Status vocabulary is scraper output and
// jurisdiction-specific. A substring test for /withdraw|cancel/ is how a future
// status like "Withdrawal Requested" — which is not withdrawn — quietly kills
// every prompt on a live permit.
//
// ★ ONE VALUE TODAY. Measured across every permit on prod 2026-08-22, the only
// negative-terminal status in the vocabulary is 'Withdrawn' (3 permits, 2 of
// them unissued). 'Closed' also exists (2 permits, both issued) but is already
// terminal-POSITIVE above, where it belongs: closed is finished, not abandoned.
// A future 'Cancelled' or 'Void' is added here, by hand, after it is seen.
export const TERMINAL_NEGATIVE_STATUSES: ReadonlySet<string> = new Set([
  'Withdrawn',
]);

/** ★★★ fix-388: the permit is DEAD — abandoned at the portal, not finished.
 *  Nothing is expected of anybody, so nothing should be prompted: it is not
 *  late, it is over. Distinct from every set above, all of which describe a
 *  permit that SUCCEEDED. Whitespace-tolerant, like its siblings. */
export function isTerminalNegativeStatus(
  permitStatus: string | null | undefined,
): boolean {
  if (!permitStatus) return false;
  return TERMINAL_NEGATIVE_STATUSES.has(permitStatus.trim());
}

// Union of both — reviewer-rollup and any other caller that treats
// the whole "city's done their part" bucket uniformly. Don't add
// values here directly; add to one of the sub-sets above.
export const TERMINAL_POSITIVE_STATUSES: ReadonlySet<string> = new Set([
  ...TERMINAL_ISSUED_STATUSES,
  ...TERMINAL_APPROVED_STATUSES,
]);

/** Returns true when the given permits.status string indicates the
 *  permit has moved past per-cycle / per-reviewer-level concerns at
 *  ANY terminal-positive level (issued OR approved-pending-issuance).
 *  Whitespace-tolerant. */
export function isTerminalPositiveStatus(
  permitStatus: string | null | undefined,
): boolean {
  if (!permitStatus) return false;
  return TERMINAL_POSITIVE_STATUSES.has(permitStatus.trim());
}

/** fix-31d: returns true iff the status indicates the city has done
 *  everything it intends to do for this permit (Conceptually Approved /
 *  Approved / Issued / Completed / Closed). effectiveStage uses this
 *  to route to 'is' when no actual_issue date has been recorded yet. */
export function isTerminalIssuedStatus(
  permitStatus: string | null | undefined,
): boolean {
  if (!permitStatus) return false;
  return TERMINAL_ISSUED_STATUSES.has(permitStatus.trim());
}

/** fix-31d: returns true iff the status is approved-but-not-yet-issued
 *  (currently only "Ready for Issuance"). effectiveStage uses this to
 *  route to 'ap' rather than 'is'. */
export function isTerminalApprovedStatus(
  permitStatus: string | null | undefined,
): boolean {
  if (!permitStatus) return false;
  return TERMINAL_APPROVED_STATUSES.has(permitStatus.trim());
}
