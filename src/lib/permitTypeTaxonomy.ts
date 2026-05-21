// fix-41 (2026-05-21): permit-type taxonomy for the "does this type ever
// issue a document?" distinction. Mirrors the scraper repo's
// NO_ISSUANCE_PERMIT_TYPES set EXACTLY — keep the two in sync. If a type
// is added/removed here, make the same change in the scraper.
//
// Why this exists: the reviewer-rollup chip's fix-31b terminal-positive
// override (every reviewer collapses to ✓ when permits.status is
// terminal-positive) was built for single-cycle SDOT-style permits where
// "Conceptually Approved" IS the final state and per-reviewer events were
// noise / didn't exist pre-fix-31g. For issuance-bearing types (Building
// Permit, Demolition, etc.) fix-31g now populates real per-reviewer
// current_status, and the blanket override masks it — an Issued BP with
// 14 reviewers (8 approved) wrongly read 14/14 ✓. fix-41 type-scopes the
// override: it fires ONLY for the no-issuance types below; everything
// else shows real current_status counts.

/** Permit types that never produce a separately-issued document — the
 *  city's terminal-positive status (e.g. "Conceptually Approved") IS the
 *  final state. Identical to the scraper repo's NO_ISSUANCE_PERMIT_TYPES.
 *  All other types ("Building Permit", "Demolition", "Condo", "IPR",
 *  "LSM", "Grading / Clearing", "TRAO", ...) are issuance-bearing. */
export const NO_ISSUANCE_PERMIT_TYPES: ReadonlySet<string> = new Set([
  'SDOT Tree',
  'PAR/Pre-Sub',
  'ECA Waiver',
  'ULS',
]);

/** True when the permit type never issues a document (see
 *  NO_ISSUANCE_PERMIT_TYPES). Whitespace-tolerant; null/undefined → false
 *  (unknown types are treated as issuance-bearing, the safer default —
 *  they show real per-reviewer counts rather than a blanket all-✓). */
export function isNoIssuanceType(permitType?: string | null): boolean {
  if (!permitType) return false;
  return NO_ISSUANCE_PERMIT_TYPES.has(permitType.trim());
}
