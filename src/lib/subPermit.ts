import type { Permit } from './database.types';

// fix-194: the ONE canonical sub/child-permit predicate. A permit with
// parent_permit_id set is a placeholder reviewed under its parent sibling — it
// has no independent review stage/status and must be EXCLUDED from every
// dashboard metric/rollup (Schedule Health, corrections counts, reviewer
// rollups, on-track %, permit-count + volume attribution). Apply this one
// predicate everywhere so no surface is left counting children (bidirectional
// principle). The scraper is unchanged; a child's scraped data is just ignored.

/** True when this permit is a sub/child placeholder (has a parent permit). */
export function isSubPermit(
  permit: Pick<Permit, 'parent_permit_id'> | null | undefined,
): boolean {
  return permit?.parent_permit_id != null;
}

/** Inverse of isSubPermit — convenient as an array `.filter` predicate that
 *  keeps only the real (standalone/parent) permits a metric should count. */
export function isNotSubPermit(
  permit: Pick<Permit, 'parent_permit_id'> | null | undefined,
): boolean {
  return !isSubPermit(permit);
}

/** fix-194: badge text for a child permit — "Sub-permit · reviewed under
 *  <parent #>". Falls back to a generic label when the parent has no number
 *  yet (or can't be resolved). */
export function subPermitBadgeLabel(parentNum: string | null | undefined): string {
  const num = (parentNum ?? '').trim();
  return num ? `Sub-permit · reviewed under ${num}` : 'Sub-permit · reviewed under parent';
}
