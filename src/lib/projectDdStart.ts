import type { PermitWithCycles } from './database.types';
import { isNotSubPermit } from './subPermit';

// fix-204: re-anchor the reporting cohort from GO date → the project's DD start
// (when it started drawing). The GO→DD-start gap swings from ~2 weeks to ~6
// months with draw-schedule load, so GO date misattributes which quarter a
// project's active life belongs to. Bobby's model: a project's cohort = when it
// started drawing, i.e. its draw-schedule DD start.
//
// "Project DD start" = the project's BUILDING PERMIT dd_start (the BP is the
// schedule's spine); fallback = the earliest dd_start among the project's
// permits; null when no permit carries one.
//
// Both windowed cohort selectors — Trends filterPermits (perfTrends.ts) and
// Overview filterEnrichedPermits (reportMetrics.ts) — window on THIS value, so:
//   • every permit of a project (BP/Demo/ULS) lands in the same quarter — a
//     project never splits across periods; and
//   • a project with no DD start is EXCLUDED from any windowed cohort (the same
//     treatment null go_date got pre-fix-204), but kept when range='all'.
//
// Metric VALUES are unchanged — only cohort membership moves. "Avg GO → Submit"
// etc. still measure FROM go_date in their formulas; just the set of projects
// shown is now the DD-start cohort.

const BUILDING_PERMIT = 'Building Permit';

/** Build a project_id → project_dd_start map from the in-memory permit set.
 *  BP dd_start preferred, earliest-permit dd_start as fallback. Projects with no
 *  dd_start on any permit are absent from the map (callers treat a miss as
 *  "no DD start" → excluded under a window). Sub/child placeholder permits are
 *  ignored (consistent with isNotSubPermit everywhere else — they carry no real
 *  schedule dates). */
export function buildProjectDdStartMap(
  permits: PermitWithCycles[],
): Map<string, string> {
  const bpDdStart = new Map<string, string>();
  const earliest = new Map<string, string>();
  for (const p of permits) {
    if (!isNotSubPermit(p)) continue;
    const dd = p.dd_start ?? null;
    if (!dd) continue;
    const pid = p.project_id;
    const curEarliest = earliest.get(pid);
    if (!curEarliest || dd < curEarliest) earliest.set(pid, dd);
    if (p.type === BUILDING_PERMIT) {
      // Multiple BPs are rare; take the earliest BP dd_start for a stable anchor.
      const curBp = bpDdStart.get(pid);
      if (!curBp || dd < curBp) bpDdStart.set(pid, dd);
    }
  }
  const out = new Map<string, string>();
  for (const pid of new Set([...earliest.keys(), ...bpDdStart.keys()])) {
    const anchor = bpDdStart.get(pid) ?? earliest.get(pid);
    if (anchor) out.set(pid, anchor);
  }
  return out;
}
