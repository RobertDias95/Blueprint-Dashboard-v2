import type { Permit } from './database.types';
import { isSubPermit } from './subPermit';

// fix-221: "approved but not yet issued" + the "effective issued" concept.
//
// When Seattle finishes review and approves a BP/Demo, the permit sits in
// Accela "Issuance Prep" — it has an approval_date but no actual_issue, and its
// status often stays "Awaiting Information" / "Ready for Issuance". These
// permits are neither "in review" nor "issued", so they fell in a gap:
// throughput/issued counts ran LOW (they weren't counted) and the weekly report
// silently dropped them. Bobby's call (fix-221): for our purposes these ARE
// done, so they count as issued/complete using their approval_date.
//
// This is THE single source of truth. Its SQL twin is the `apr` CTE predicate
// in bp_get_weekly_da_report (migrations/fix_221_*.sql) — keep the two in
// lockstep, exactly like the fix-214 isPermitInCorrections ⇄ bp_permit_in_corrections
// pair.

/** Statuses that mean a permit is already resolved (issued/withdrawn/finished),
 *  so it is NOT "approved awaiting issuance" even if approval_date is set and
 *  actual_issue happens to be null. Kept deliberately narrow per the fix-221
 *  definition — note this is NOT the same list as TERMINAL_ISSUED_STATUSES
 *  (which includes 'Approved'/'Conceptually Approved' and omits 'Withdrawn').
 *  A permit at status 'Approved' or 'Ready for Issuance' IS awaiting issuance. */
export const APPROVED_NOT_ISSUED_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'Issued',
  'Withdrawn',
  'Completed',
  'Closed',
]);

/** fix-221: the canonical "approved-not-issued" predicate.
 *  approval_date IS NOT NULL AND actual_issue IS NULL AND status NOT IN
 *  ('Issued','Withdrawn','Completed','Closed') AND parent_permit_id IS NULL
 *  (sub-permits excluded per fix-194). */
export function isApprovedNotIssued(
  p: Pick<Permit, 'approval_date' | 'actual_issue' | 'status' | 'parent_permit_id'>,
): boolean {
  if (isSubPermit(p)) return false;
  if (p.approval_date == null) return false;
  if (p.actual_issue != null) return false;
  if (p.status != null && APPROVED_NOT_ISSUED_TERMINAL_STATUSES.has(p.status)) {
    return false;
  }
  return true;
}

/** fix-221: the date a permit "effectively issued" for period/year bucketing:
 *   - actually issued        -> actual_issue     (unchanged existing behavior)
 *   - approved-not-issued     -> approval_date    (counts as done, per Bobby)
 *   - otherwise (in flight)   -> null
 *  This strictly ADDS the approved-not-issued cohort to "issued"; it never
 *  reclassifies an already-issued permit (those keep bucketing by actual_issue). */
export function effectiveIssuedDate(
  p: Pick<Permit, 'approval_date' | 'actual_issue' | 'status' | 'parent_permit_id'>,
): string | null {
  if (p.actual_issue != null) return p.actual_issue;
  if (isApprovedNotIssued(p)) return p.approval_date ?? null;
  return null;
}

/** fix-221: has the permit effectively issued (really issued OR approved-not-
 *  issued, which we treat as done)? The predicate every issued/throughput/
 *  completed count should use so all surfaces agree. */
export function isEffectivelyIssued(
  p: Pick<Permit, 'approval_date' | 'actual_issue' | 'status' | 'parent_permit_id'>,
): boolean {
  return effectiveIssuedDate(p) != null;
}
