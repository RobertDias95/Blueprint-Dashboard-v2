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
