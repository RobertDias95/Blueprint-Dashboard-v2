import type {
  PermitCycleReviewer,
  ReviewerStatus,
} from './database.types';

// fix-31: pure helpers for the reviewer rollup. Given the per-reviewer
// rows the scraper captures, compute the chip-friendly counts the
// Schedule Health column displays: "9 reviewers · 3 approved · 2
// corrections · 4 pending". Pure functions only — testable without DOM.

export interface ReviewerCounts {
  total: number;
  approved: number;
  correctionsRequired: number;
  inReview: number;
  pending: number;
  notRequired: number;
}

/** Pick the latest cycle_index in the row set. Used by the Project
 *  Overview rollup which displays "current cycle" reviewer status. */
export function latestCycleIndex(rows: PermitCycleReviewer[]): number | null {
  if (rows.length === 0) return null;
  let max = rows[0].cycle_index;
  for (const r of rows) {
    if (r.cycle_index > max) max = r.cycle_index;
  }
  return max;
}

/** Filter rows down to a single cycle. */
export function rowsForCycle(
  rows: PermitCycleReviewer[],
  cycleIndex: number,
): PermitCycleReviewer[] {
  return rows.filter((r) => r.cycle_index === cycleIndex);
}

// fix-186: the single source of truth for "this discipline has NOT finished
// its review" — the round is still in flight. Any reviewer at one of these on
// the current cycle keeps the permit UNDER REVIEW (verdict 'in_review'), even
// when other disciplines have already returned corrections. The complement —
// 'approved' / 'corrections_required' — is "acted"; 'not_required' is N/A. This
// set is what makes the verdict precedence in-progress > corrections > approved
// (reviewerVerdictForLatestCycle below) explicit and regression-safe.
export const OUTSTANDING_REVIEWER_STATUSES: ReadonlySet<ReviewerStatus> =
  new Set(['in_review', 'in_process', 'assigned', 'pending']);

/** fix-186: true when a reviewer is still in progress (not yet acted) — see
 *  OUTSTANDING_REVIEWER_STATUSES. */
export function isOutstandingReviewerStatus(status: ReviewerStatus): boolean {
  return OUTSTANDING_REVIEWER_STATUSES.has(status);
}

/** Bucket statuses for the chip. "in_process", "in_review", "assigned"
 *  collapse into a single "in review" bucket since they all signal
 *  "actively under review." "pending" + "not_required" stay separate
 *  so users can see the distinction. */
export function bucketStatus(
  status: ReviewerStatus,
): 'approved' | 'corrections' | 'in_review' | 'pending' | 'not_required' {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'corrections_required':
      return 'corrections';
    case 'in_process':
    case 'in_review':
    case 'assigned':
      return 'in_review';
    case 'pending':
      return 'pending';
    case 'not_required':
      return 'not_required';
  }
}

// fix-31b: the terminal-positive override (chip rolls every reviewer
// up to "approved" when permit.status is a terminal-positive value).
// fix-31c (2026-05-19) moved the constant + helper to
// ./permitTerminalStatus.ts so permitStatus.ts + permitStage.ts can
// apply the same override without pulling reviewer-rollup-specific
// imports. Re-exported here for backwards compatibility with any
// fix-31b consumer that imported from this module.
import {
  TERMINAL_POSITIVE_STATUSES,
  isTerminalPositiveStatus,
} from './permitTerminalStatus';
import { isNoIssuanceType } from './permitTypeTaxonomy';
export { TERMINAL_POSITIVE_STATUSES, isTerminalPositiveStatus };

/** Roll up a list of reviewer rows into chip counts. Each reviewer is
 *  counted exactly once; the per-reviewer current_status determines
 *  which bucket they land in. fix-31b: when permitStatus is a
 *  terminal-positive value, every reviewer collapses to the approved
 *  bucket regardless of their last event — the permit's own status
 *  is the authoritative ceiling.
 *
 *  fix-41 (2026-05-21): the terminal-positive override is now
 *  type-scoped. It fires ONLY for no-issuance permit types (SDOT Tree,
 *  PAR/Pre-Sub, ECA Waiver, ULS) where terminal-positive IS the final
 *  state and per-reviewer events are noise. For issuance-bearing types
 *  (Building Permit, Demolition, etc.) fix-31g populates real
 *  per-reviewer current_status, so we show those real counts — an
 *  Issued BP with 8/14 reviewers approved must read 8, not 14. The gate
 *  lives here (single source of truth), not at the call site. */
export function rollupCounts(
  rows: PermitCycleReviewer[],
  permitStatus?: string | null,
  permitType?: string | null,
): ReviewerCounts {
  const overrideAllApproved =
    isTerminalPositiveStatus(permitStatus) && isNoIssuanceType(permitType);
  const counts: ReviewerCounts = {
    total: rows.length,
    approved: 0,
    correctionsRequired: 0,
    inReview: 0,
    pending: 0,
    notRequired: 0,
  };
  for (const r of rows) {
    if (overrideAllApproved) {
      counts.approved += 1;
      continue;
    }
    const bucket = bucketStatus(r.current_status);
    if (bucket === 'approved') counts.approved += 1;
    else if (bucket === 'corrections') counts.correctionsRequired += 1;
    else if (bucket === 'in_review') counts.inReview += 1;
    else if (bucket === 'pending') counts.pending += 1;
    else if (bucket === 'not_required') counts.notRequired += 1;
  }
  return counts;
}

// fix-54 (2026-05-26): wholistic per-permit verdict for MPB (MyBuildingPermit:
// Bellevue / Edmonds / Kirkland). MPB reviewers issue corrections one
// discipline at a time, but Blueprint reports the permit-level rollup
// wholistically — the permit only reads "corrections required" once the
// city's whole round is complete (every discipline has acted). Until then
// the permit is "in review" even when some disciplines have already issued
// corrections individually. The chip/popover (above) keeps showing real
// per-discipline counts; this verdict drives the single rolled-up
// status/stage in the Dashboard matrix + Schedule Health row.

export type ReviewerVerdict = 'in_review' | 'corrections_required' | 'approved';

// MPB portal coarse-status values. The MyBuildingPermit portal doesn't carry
// a wholistic per-permit status the way Accela does — its public string is
// just "Pending" until the city's whole record closes out. Seattle's Accela
// permits carry wholistic strings ("Reviews In Process", "Corrections
// Required", "Ready for Issuance", etc.) and don't fall into this set, so
// the rollup-driven override never fires for them.
const REVIEWER_ROLLUP_DRIVEN_STATUSES: ReadonlySet<string> = new Set([
  'Pending',
  'Applied',
]);

/** True iff this permit's display rollup should be driven by per-discipline
 *  reviewer rows rather than the stored permits.status. Gates the
 *  fix-54 wholistic override in effectiveStage + derivePermitStatus. */
export function isReviewerRollupDriven(
  permitStatus: string | null | undefined,
): boolean {
  if (!permitStatus) return false;
  return REVIEWER_ROLLUP_DRIVEN_STATUSES.has(permitStatus.trim());
}

/** Wholistic rollup verdict from the latest cycle's reviewer rows.
 *
 *  Rule (Bobby, 2026-05-26; fix-186 centralized the status set):
 *    - OUTSTANDING = any reviewer at one of OUTSTANDING_REVIEWER_STATUSES
 *      (in_review / in_process / assigned / pending). ACTED =
 *      corrections_required / approved.
 *    - any outstanding → 'in_review' (even if some disciplines have already
 *      issued corrections individually — the round isn't done). An in-progress
 *      reviewer ALWAYS keeps the permit under review; corrections only wins once
 *      every reviewer has acted.
 *    - else, any corrections_required → 'corrections_required'.
 *    - else (all approved) → 'approved'.
 *
 *  `not_required` rows don't count toward either bucket — that discipline
 *  is explicitly N/A. Returns null when there are no reviewer rows at all
 *  (or only not_required rows), so the caller falls back to its existing
 *  cycle-state-based logic.
 *
 *  Filters to the LATEST cycle index seen in the rows (mirrors the chip's
 *  latestCycleIndex/rowsForCycle slice — one consistent definition). */
export function reviewerVerdictForLatestCycle(
  rows: PermitCycleReviewer[],
): ReviewerVerdict | null {
  if (rows.length === 0) return null;
  const latest = latestCycleIndex(rows);
  if (latest === null) return null;
  const cycleRows = rowsForCycle(rows, latest).filter(
    (r) => r.current_status !== 'not_required',
  );
  if (cycleRows.length === 0) return null;

  let outstanding = false;
  let corrections = false;
  for (const r of cycleRows) {
    // fix-186: use the centralized in-progress set so the precedence is
    // explicit. An in-progress reviewer makes the round outstanding; a
    // corrections_required reviewer only counts once nobody is still in flight.
    if (isOutstandingReviewerStatus(r.current_status)) outstanding = true;
    else if (r.current_status === 'corrections_required') corrections = true;
  }
  if (outstanding) return 'in_review';
  if (corrections) return 'corrections_required';
  return 'approved';
}

/** fix-185: wholistic verdict scoped to a SPECIFIC cycle index — the permit's
 *  current (latest) review cycle, taken from permit_cycles, NOT inferred from
 *  the reviewer rows. Earlier-cycle reviewer rows that were never pruned after a
 *  resubmittal (e.g. a resubmitted cycle 1 still carrying corrections_required
 *  rows) are historical and must not drive the live status. Returns null when
 *  the current cycle has no actionable reviewer rows, so the caller falls back
 *  to the cycle-date state (submitted + no corr_issued → under review).
 *
 *  Reuses the canonical reviewerVerdictForLatestCycle rule on the cycle-scoped
 *  slice — identical outstanding/corrections/approved logic, just pinned to one
 *  cycle index instead of the max seen among the rows. */
export function reviewerVerdictForCycle(
  rows: PermitCycleReviewer[],
  cycleIndex: number,
): ReviewerVerdict | null {
  return reviewerVerdictForLatestCycle(rowsForCycle(rows, cycleIndex));
}

/** fix-185: the permit's current (latest) review cycle index, read from its
 *  cycles — the canonical "which cycle is live." This is what scopes the
 *  reviewer rollup (reviewerVerdictForCycle) so stale earlier-cycle reviewer
 *  rows can't drive the status/bucket. Falls back to the latest reviewer-row
 *  cycle only when no cycles are available (defensive — the status/bucket call
 *  sites always pass cycles). Returns null when neither is available. */
export function currentCycleIndex(
  cycles: ReadonlyArray<{ cycle_index: number }>,
  reviewers: PermitCycleReviewer[],
): number | null {
  if (cycles.length > 0) {
    return cycles.reduce(
      (max, c) => (c.cycle_index > max ? c.cycle_index : max),
      cycles[0].cycle_index,
    );
  }
  return latestCycleIndex(reviewers);
}

/** Compact human-readable label for a single status. Used in the
 *  popover detail list. */
export function statusLabel(status: ReviewerStatus): string {
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'corrections_required':
      return 'Corrections';
    case 'in_process':
      return 'In Process';
    case 'in_review':
      return 'In Review';
    case 'assigned':
      return 'Assigned';
    case 'pending':
      return 'Pending';
    case 'not_required':
      return 'Not Required';
  }
}
