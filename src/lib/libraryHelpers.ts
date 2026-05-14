import type { PermitWithCycles, Project, Stage } from './database.types';
import { effectiveStage } from './permitStage';
import { multiMatchAddress } from './drawScheduleHelpers';

// Q6.3.a: pure helpers for the Library matrix view (Settings → Library tab).
// Mirrors v1's renderMatrix (index.html lines 5680-5778). The matrix shows
// one row per project, surfacing lot/unit dim data for the "match new lot
// against past projects" workflow. Filters use a min/max + buffer tolerance
// (matchRange) ported from v1 line 5709.

/** One row of the Library matrix, derived from a project + its permits. */
export interface LibraryRow {
  projectId: string;
  address: string;
  juris: string;
  productType: string;
  units: number;
  zone: string;
  lotWidth: number;
  lotDepth: number;
  alley: string;
  tags: string[];
  stage: Stage;
}

/** Q6.3.a-fix: target ± buffer filter. "50 ± 5" matches every value in
 * [45, 55] inclusive. Replaces v1's min/max+buf asymmetric range — the
 * team thinks about lot sizing as "find me similar lots near 50ft", not
 * as "lots between X and Y." Null target → no filter; falsy val with an
 * active filter → fails (filter requires the row to have data). */
export function matchTargetWithBuffer(
  val: number | null | undefined,
  target: number | null,
  bufWidth: number,
): boolean {
  if (target === null) return true;
  if (!val) return false;
  return Math.abs(val - target) <= (bufWidth || 0);
}

/** Pick one permit per project for matrix dim fields. Prefer the project's
 * Building Permit (drives the schedule + carries the dims in Bobby's
 * workflow). Fall back to the first permit so the project still renders if
 * BP data is missing. */
export function pickBpForProject(
  projectPermits: PermitWithCycles[],
): PermitWithCycles | null {
  if (projectPermits.length === 0) return null;
  const bp = projectPermits.find((p) => p.type === 'Building Permit');
  return bp ?? projectPermits[0];
}

/** Worst (latest-stage) of a project's permits. Used by the matrix Stage
 * column. v1's render does the same rollup (line 5690-5695). */
const STAGE_ORDER: Record<Stage, number> = {
  de: 0,
  pm: 1,
  co: 2,
  ap: 3,
  is: 4,
};
export function worstStage(projectPermits: PermitWithCycles[]): Stage {
  let best: Stage = 'de';
  for (const p of projectPermits) {
    const s = effectiveStage(p, p.permit_cycles ?? []) as Stage;
    if ((STAGE_ORDER[s] ?? 0) > (STAGE_ORDER[best] ?? 0)) best = s;
  }
  return best;
}

/** Safely coerce a permit's project_tags (typed `unknown`) into string[]. */
export function extractTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}

/** Build the full matrix row set from projects + permits. Projects with no
 * permits at all are skipped (the matrix is permit-data-driven). */
export function buildLibraryRows(
  projects: Project[],
  permits: PermitWithCycles[],
): LibraryRow[] {
  const permitsByProject = new Map<string, PermitWithCycles[]>();
  for (const p of permits) {
    const list = permitsByProject.get(p.project_id) ?? [];
    list.push(p);
    permitsByProject.set(p.project_id, list);
  }

  const rows: LibraryRow[] = [];
  for (const proj of projects) {
    if (proj.archived) continue;
    const projectPermits = permitsByProject.get(proj.id) ?? [];
    if (projectPermits.length === 0) continue;
    // fix-22 Migration 3 read-surface sweep: matrix rows source the physical
    // fields directly from the project now (they moved off permits.*).
    // BP is still used for the worst-stage rollup below.
    rows.push({
      projectId: proj.id,
      address: proj.address,
      juris: proj.juris ?? '',
      productType: proj.product_type ?? '',
      units: proj.units ?? 0,
      zone: proj.zone ?? '',
      lotWidth: proj.lot_width ?? 0,
      lotDepth: proj.lot_depth ?? 0,
      alley: proj.alley ?? '',
      tags: Array.isArray(proj.project_tags) ? proj.project_tags : [],
      stage: worstStage(projectPermits),
    });
  }
  return rows;
}

export interface LibraryFilters {
  search: string;
  lotwTarget: number | null;
  lotwBuf: number;
  lotdTarget: number | null;
  lotdBuf: number;
  zone: string;
  alley: string;
  productType: string;
  tag: string;
  juris: string;
}

/** Apply the 7 active filters to the matrix rows. */
export function filterLibraryRows(
  rows: LibraryRow[],
  filters: LibraryFilters,
): LibraryRow[] {
  const zoneQ = filters.zone.trim().toLowerCase();
  return rows.filter((r) => {
    if (!matchTargetWithBuffer(r.lotWidth, filters.lotwTarget, filters.lotwBuf)) return false;
    if (!matchTargetWithBuffer(r.lotDepth, filters.lotdTarget, filters.lotdBuf)) return false;
    if (zoneQ && !r.zone.toLowerCase().includes(zoneQ)) return false;
    if (filters.alley && r.alley !== filters.alley) return false;
    if (filters.productType && r.productType !== filters.productType) return false;
    if (filters.tag && !r.tags.includes(filters.tag)) return false;
    if (filters.juris && r.juris !== filters.juris) return false;
    if (filters.search.trim() && !multiMatchAddress(filters.search, r.address)) return false;
    return true;
  });
}

export type SortableColumn =
  | 'address'
  | 'juris'
  | 'productType'
  | 'units'
  | 'zone'
  | 'lotWidth'
  | 'alley'
  | 'stage';

export interface SortState {
  col: SortableColumn;
  asc: boolean;
}

/** Sort rows by the named column. Stage uses the workflow rank
 * (de < pm < co < ap < is); other text columns use locale compare;
 * numeric columns use subtraction. */
export function sortLibraryRows(
  rows: LibraryRow[],
  state: SortState,
): LibraryRow[] {
  const dir = state.asc ? 1 : -1;
  const sorted = [...rows];
  // Local const `col` so TS narrows inside each sort callback. Branching by
  // the column type avoids `(string | number)` widening that breaks
  // `localeCompare` and arithmetic at the same site.
  const col = state.col;
  if (col === 'stage') {
    sorted.sort((a, b) => (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) * dir);
    return sorted;
  }
  if (col === 'units' || col === 'lotWidth') {
    sorted.sort((a, b) => (a[col] - b[col]) * dir);
    return sorted;
  }
  sorted.sort((a, b) => a[col].localeCompare(b[col]) * dir);
  return sorted;
}
