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

// fix-31b: when a permit's portal-side Record Status reaches a
// terminal-positive value (Conceptually Approved / Approved / Issued
// / Completed / Ready for Issuance / Closed), per-reviewer state is
// known-stale by definition — every reviewer's contribution is
// effectively closed even when their individual event stream's last
// entry was "Additional Info Requested" or similar. Without this
// override the chip surfaces a misleading ⚠ corrections pill on
// permits that already approved past it.
//
// Example that motivated fix-31b: SDOTTRLA0002310 at 4506 14th Ave SW.
// Anne-Marie Freudenthal's last event was Additional Info Requested
// (cycle 1). The parent TBD row marked the cycle Completed on 5/7 and
// the permit's Record Status is "Conceptually Approved" — the chip
// should show all reviewers green, not a warning.
const TERMINAL_POSITIVE_STATUSES: ReadonlySet<string> = new Set([
  'Conceptually Approved',
  'Approved',
  'Issued',
  'Completed',
  'Ready for Issuance',
  'Closed',
]);

/** Returns true when the given permits.status string indicates the
 *  permit has moved past per-reviewer-level review concerns. Exported
 *  so callers can decide whether to render review-level UI at all
 *  (e.g., skip per-reviewer detail entirely on Closed permits). */
export function isTerminalPositiveStatus(
  permitStatus: string | null | undefined,
): boolean {
  if (!permitStatus) return false;
  return TERMINAL_POSITIVE_STATUSES.has(permitStatus.trim());
}

/** Roll up a list of reviewer rows into chip counts. Each reviewer is
 *  counted exactly once; the per-reviewer current_status determines
 *  which bucket they land in. fix-31b: when permitStatus is a
 *  terminal-positive value, every reviewer collapses to the approved
 *  bucket regardless of their last event — the permit's own status
 *  is the authoritative ceiling. */
export function rollupCounts(
  rows: PermitCycleReviewer[],
  permitStatus?: string | null,
): ReviewerCounts {
  const overrideAllApproved = isTerminalPositiveStatus(permitStatus);
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
