import type { PermitCycle } from './database.types';
import { extractReviewCycles, type EnrichedPermit } from './reportMetrics';

// fix-142: per-cycle breakdown for the Reports Overview drawer. Surfaces
// Bobby's mental model — "cycle 1, cycle 2, cycle 3 averages feed the total."
//
// The math mirrors reportMetrics.cityCourtTimeDays / responseCourtTimeDays
// EXACTLY, just sliced per review-cycle position instead of summed per
// permit. Because both walk the sorted review cycles positionally, the
// per-cycle buckets telescope back into the per-permit totals:
//   Σ_cycles (city at cycle) = cityCourtTimeDays(permit)
//   Σ_cycles (response at cycle) = responseCourtTimeDays(permit)
// so the cohort bucket averages roll up to the Overview KPI totals (see
// perCycleMetrics.test.ts invariant test).
//
// Buckets are keyed by POSITION in the sorted review-cycle array (cycle 0 /
// design phase excluded), not by raw cycle_index — in normal contiguous data
// position 0 = cycle_index 1, but bucketing by position keeps the telescoping
// identity intact even if an index is skipped in bad data.

const DAY_MS = 24 * 60 * 60 * 1000;

/** NaN-safe day delta (b − a). Mirrors reportMetrics.daysBetween. */
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return null;
  return Math.round((bMs - aMs) / DAY_MS);
}

function avgOrNull(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export interface PerCycleBucket {
  bucketLabel: 'Cycle 1' | 'Cycle 2' | 'Cycle 3' | 'Cycle 4+';
  /** 4 = the "4+" aggregate bucket. */
  cycleBucket: 1 | 2 | 3 | 4;
  /** Avg city-court time (corr_issued − submitted, final anchored to
   *  approval) for this cycle across contributing permits. Null = no
   *  non-null contributions. */
  avgCityCourtTime: number | null;
  /** Avg our-court time (next.submitted − this.corr_issued) for this cycle
   *  across contributing permits. Null = no completed round-trip here. */
  avgResponseTime: number | null;
  /** Permits that reached this cycle (have a review cycle at this position;
   *  for the 4+ bucket, have ≥4 review cycles). */
  permitCount: number;
}

/** City-court time for the review cycle at `pos` (0-based) within the
 *  permit's sorted review cycles. corr_issued − submitted, or
 *  approval_date − submitted when it's the permit's final review cycle and
 *  no corr_issued was stamped. Null when the cycle is ongoing/incomplete. */
function cityAt(
  cycles: PermitCycle[],
  pos: number,
  approvalDate: string | null,
): number | null {
  const c = cycles[pos];
  if (!c) return null;
  const isFinal = pos === cycles.length - 1;
  if (c.corr_issued) return daysBetween(c.submitted, c.corr_issued);
  if (isFinal && approvalDate) return daysBetween(c.submitted, approvalDate);
  return null;
}

/** Response (our-court) time for the cycle at `pos`: the gap from this
 *  cycle's corr_issued to the next cycle's submitted. Null when there's no
 *  next cycle or the round-trip is incomplete. */
function responseAt(cycles: PermitCycle[], pos: number): number | null {
  const cur = cycles[pos];
  const next = cycles[pos + 1];
  if (!cur || !next) return null;
  if (!cur.corr_issued || !next.submitted) return null;
  return daysBetween(cur.corr_issued, next.submitted);
}

/** Always returns exactly 4 buckets in order (Cycle 1, 2, 3, 4+). Empty
 *  buckets carry null averages + permitCount 0. */
export function computePerCycleBuckets(
  enriched: EnrichedPermit[],
): PerCycleBucket[] {
  // Single-cycle buckets (positions 0,1,2 → Cycle 1,2,3).
  const single = [0, 1, 2].map((pos) => {
    const cityVals: number[] = [];
    const responseVals: number[] = [];
    let reached = 0;
    for (const e of enriched) {
      const cycles = extractReviewCycles(e.permit);
      if (cycles.length <= pos) continue; // permit never reached this cycle
      reached += 1;
      const city = cityAt(cycles, pos, e.permit.approval_date ?? null);
      if (city !== null) cityVals.push(city);
      const resp = responseAt(cycles, pos);
      if (resp !== null) responseVals.push(resp);
    }
    return {
      cycleBucket: (pos + 1) as 1 | 2 | 3,
      bucketLabel: `Cycle ${pos + 1}` as 'Cycle 1' | 'Cycle 2' | 'Cycle 3',
      avgCityCourtTime: avgOrNull(cityVals),
      avgResponseTime: avgOrNull(responseVals),
      permitCount: reached,
    } satisfies PerCycleBucket;
  });

  // "Cycle 4+" bucket: sum positions 3.. within each permit, then average
  // across permits with ≥4 review cycles (spec: sum-within-permit then
  // avg-across-permits, matching how the totals aggregate).
  const cityVals4: number[] = [];
  const responseVals4: number[] = [];
  let reached4 = 0;
  for (const e of enriched) {
    const cycles = extractReviewCycles(e.permit);
    if (cycles.length < 4) continue;
    reached4 += 1;
    const approval = e.permit.approval_date ?? null;
    let citySum = 0;
    let cityHits = 0;
    let respSum = 0;
    let respHits = 0;
    for (let pos = 3; pos < cycles.length; pos++) {
      const city = cityAt(cycles, pos, approval);
      if (city !== null) {
        citySum += city;
        cityHits += 1;
      }
      const resp = responseAt(cycles, pos);
      if (resp !== null) {
        respSum += resp;
        respHits += 1;
      }
    }
    if (cityHits > 0) cityVals4.push(citySum);
    if (respHits > 0) responseVals4.push(respSum);
  }

  const fourPlus: PerCycleBucket = {
    cycleBucket: 4,
    bucketLabel: 'Cycle 4+',
    avgCityCourtTime: avgOrNull(cityVals4),
    avgResponseTime: avgOrNull(responseVals4),
    permitCount: reached4,
  };

  return [...single, fourPlus];
}
