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

/** v1's matchRange (line 5709). Both bounds null → no filter. One bound +
 * buffer expands around the unset side. Falsy val + any active bound →
 * fails (filter requires the row to have data). */
export function matchRange(
  val: number | null | undefined,
  minV: number | null,
  maxV: number | null,
  buf: number,
): boolean {
  if (minV === null && maxV === null) return true;
  if (!val) return false;
  const lo = (minV !== null ? minV : val) - (buf || 0);
  const hi = (maxV !== null ? maxV : val) + (buf || 0);
  return val >= lo && val <= hi;
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
    const bp = pickBpForProject(projectPermits);
    if (!bp) continue;
    rows.push({
      projectId: proj.id,
      address: proj.address,
      juris: proj.juris ?? '',
      productType: bp.product_type ?? '',
      units: bp.units ?? 0,
      zone: bp.zone ?? '',
      lotWidth: bp.lot_width ?? 0,
      lotDepth: bp.lot_depth ?? 0,
      alley: bp.alley ?? '',
      tags: extractTags(bp.project_tags),
      stage: worstStage(projectPermits),
    });
  }
  return rows;
}

export interface LibraryFilters {
  search: string;
  lotwMin: number | null;
  lotwMax: number | null;
  lotwBuf: number;
  lotdMin: number | null;
  lotdMax: number | null;
  lotdBuf: number;
  zone: string;
  alley: string;
  productType: string;
  tag: string;
  juris: string;
}

/** Apply the 7 active filters to the matrix rows. Mirrors v1's filter
 * predicate stack in renderMatrix (lines 5732-5743). */
export function filterLibraryRows(
  rows: LibraryRow[],
  filters: LibraryFilters,
): LibraryRow[] {
  const zoneQ = filters.zone.trim().toLowerCase();
  return rows.filter((r) => {
    if (!matchRange(r.lotWidth, filters.lotwMin, filters.lotwMax, filters.lotwBuf)) return false;
    if (!matchRange(r.lotDepth, filters.lotdMin, filters.lotdMax, filters.lotdBuf)) return false;
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
