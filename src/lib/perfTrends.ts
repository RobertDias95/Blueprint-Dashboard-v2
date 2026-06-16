import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  ProjectHold,
} from './database.types';
import { extractSample } from './scheduleBenchmarks';
import { formatCompareNumber } from './comparisonCohort';
import { cityCourtTimeDays, responseCourtTimeDays } from './reportMetrics';
import { accountableDays } from './holdOverlap';

// fix-171 (effect B): the Trends turnaround KPI cards + breakdown subtract held
// days. accountableDays === daysBetween with no holds → no-hold cohorts
// byte-identical.
type HoldsMap = Map<string, ProjectHold[]> | undefined;

// fix-25-feat-T: aggregation helpers for the new top-level Trends
// surface. Answers Bobby's three operational questions:
//   1. Are we getting faster? — avg c0.intake_accepted → approval over time
//   2. Where's the time going? — city review vs team turnaround per cycle
//   3. Are we hitting target? — target_submit vs actual c0.submitted variance
//
// Different aggregations from the v1-parity trendsHelpers.ts (which
// does volume time-series + group-by dimensions for the Reports →
// Trends sub-tab). New module to avoid TrendsFilters clash + keep
// concerns separate.
//
// All helpers are pure functions over the in-memory permits cache.
// No new RPCs. NULL / negative deltas are bad-data signals — skip
// silently. Empty cohorts return null / [] cleanly.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PerfTrendsFilters {
  /** Inclusive on both ends. 'YYYY-MM-DD' strings. */
  dateRange: { from: string; to: string };
  /** Project juris match (exact). Undefined = all juris. */
  juris?: string;
  /** Permit type catalog string match (exact). Undefined = all types. */
  permitType?: string;
}

/** Sample-count gate for breakdown table cells. Below this, hide the
 *  derived value and label the row "sparse" — avoids drawing strong
 *  conclusions from 1-2 permits. */
export const SPARSE_GATE = 3;

// ============================================================
// Filter application
// ============================================================

/** Apply the date-range / juris / permit-type filter to the permits
 *  list. Date-range uses each permit's approval_date as the anchor
 *  (matches the "approved in window" semantics Bobby wants). Permits
 *  without approval_date are excluded — they haven't completed the
 *  city clock yet so they don't belong in performance averages.
 *
 *  Variance + breakdown helpers below use this same filtered set so
 *  the table / charts stay consistent with the KPI tile counts. */
export function filterPermits(
  permits: PermitWithCycles[],
  projectsById: Map<string, Project>,
  filters: PerfTrendsFilters,
): PermitWithCycles[] {
  const { from, to } = filters.dateRange;
  return permits.filter((p) => {
    const approval = p.approval_date ?? p.actual_issue ?? null;
    if (!approval) return false;
    if (approval < from || approval > to) return false;
    if (filters.permitType && p.type !== filters.permitType) return false;
    if (filters.juris) {
      const proj = projectsById.get(p.project_id);
      if (proj?.juris !== filters.juris) return false;
    }
    return true;
  });
}

// ============================================================
// KPI aggregations
// ============================================================

export function totalApprovedInWindow(filtered: PermitWithCycles[]): number {
  return filtered.length;
}

// This is the Avg Permit Timeline metric (renamed from "Avg city clock" in
// fix-142 to align with Reports Overview). Formula unchanged: intake →
// approval total elapsed. fix-142 added the two sibling KPIs below
// (avgCityCourtTime / avgResponseCourtTime) so Trends now exposes the same
// City Review / Response Time / Permit Timeline split as Overview.
export function avgIntakeToApproval(
  filtered: PermitWithCycles[],
  holdsByProjectId?: HoldsMap,
): number | null {
  const deltas: number[] = [];
  for (const p of filtered) {
    const intake = cycle0(p)?.intake_accepted ?? null;
    const approval = p.approval_date ?? p.actual_issue ?? null;
    if (!intake || !approval) continue;
    const d = accountableDays(holdsByProjectId?.get(p.project_id), intake, approval);
    if (d !== null && d >= 0) deltas.push(d);
  }
  return deltas.length === 0 ? null : Math.round(avg(deltas));
}

// fix-142: Trends siblings of avgIntakeToApproval. Both reuse the canonical
// per-permit helpers from reportMetrics.ts so the Trends KPIs and the Reports
// Overview tiles compute the identical sum-over-cycles math on the same
// cohort. cityCourtTime = "ball in the city's court"; responseCourtTime =
// "ball in our court". Permits whose cohort gate fails (null) drop out.

/** Avg City Review (city-court time) across the cohort — mean of the
 *  per-permit cityCourtTimeDays, ignoring nulls. Null when no permit
 *  qualifies. */
export function avgCityCourtTime(
  filtered: PermitWithCycles[],
  holdsByProjectId?: HoldsMap,
): number | null {
  const vals: number[] = [];
  for (const p of filtered) {
    const d = cityCourtTimeDays(p, holdsByProjectId?.get(p.project_id));
    if (d !== null) vals.push(d);
  }
  return vals.length === 0 ? null : Math.round(avg(vals));
}

/** Avg Response Time (our-court time) across the cohort — mean of the
 *  per-permit responseCourtTimeDays, ignoring nulls. Null when no permit
 *  has a completed correction round-trip. */
export function avgResponseCourtTime(
  filtered: PermitWithCycles[],
  holdsByProjectId?: HoldsMap,
): number | null {
  const vals: number[] = [];
  for (const p of filtered) {
    const d = responseCourtTimeDays(p, holdsByProjectId?.get(p.project_id));
    if (d !== null) vals.push(d);
  }
  return vals.length === 0 ? null : Math.round(avg(vals));
}

export function avgCyclesPerPermit(
  filtered: PermitWithCycles[],
): number | null {
  if (filtered.length === 0) return null;
  // "Cycles" = count of cycles with at least one populated date —
  // matches the user's mental model (a cycle existed if work happened
  // in it). Cycle 0 alone (design phase) counts as 1.
  const counts = filtered.map((p) => {
    const cycles = p.permit_cycles ?? [];
    return cycles.filter(
      (c) =>
        c.submitted ||
        c.intake_accepted ||
        c.city_target ||
        c.corr_issued ||
        c.resubmitted,
    ).length;
  });
  if (counts.length === 0) return null;
  return Math.round(avg(counts) * 10) / 10;
}

export interface TargetHitRate {
  hit: number;
  total: number;
  avgDaysOff: number; // signed: positive = late, negative = early
}

export function targetSubmitHitRate(
  filtered: PermitWithCycles[],
): TargetHitRate | null {
  let hit = 0;
  let total = 0;
  const offsets: number[] = [];
  for (const p of filtered) {
    if (!p.target_submit) continue;
    const sub = cycle0(p)?.submitted;
    if (!sub) continue;
    total += 1;
    if (sub <= p.target_submit) hit += 1;
    const d = daysBetween(p.target_submit, sub);
    if (d !== null) offsets.push(d);
  }
  if (total === 0) return null;
  return {
    hit,
    total,
    avgDaysOff: Math.round(avg(offsets)),
  };
}

// ============================================================
// Time-series: avg intake → approval by month
// ============================================================

export interface TimeSeriesPoint {
  /** 'YYYY-MM'. */
  month: string;
  /** Average days from c0.intake_accepted → approval for permits
   *  approved in this bucket. Null when no qualifying permits. */
  avgDays: number | null;
  /** Number of permits contributing to avgDays. */
  n: number;
}

export function intakeToApprovalByMonth(
  filtered: PermitWithCycles[],
): TimeSeriesPoint[] {
  const buckets = new Map<string, number[]>();
  for (const p of filtered) {
    const approval = p.approval_date ?? p.actual_issue ?? null;
    const intake = cycle0(p)?.intake_accepted;
    if (!approval || !intake) continue;
    const days = daysBetween(intake, approval);
    if (days === null || days < 0) continue;
    const month = approval.slice(0, 7);
    const arr = buckets.get(month) ?? [];
    arr.push(days);
    buckets.set(month, arr);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, arr]) => ({
      month,
      avgDays: Math.round(avg(arr)),
      n: arr.length,
    }));
}

// ============================================================
// Breakdown: per (juris × type) cohort
// ============================================================

export interface BreakdownRow {
  juris: string;
  type: string;
  n: number;
  avgIntakeToApproval: number | null;
  avgCycles: number | null;
  /** AVG(corr_issued - submitted) across cycle_index >= 1. */
  avgCityReviewPerCycle: number | null;
  /** AVG(resubmitted - corr_issued) across cycle_index >= 1. */
  avgTeamTurnaroundPerCycle: number | null;
  /** Hit-rate fraction (0..1). Null when fewer than SPARSE_GATE samples
   *  with both target_submit + c0.submitted populated. */
  targetHitRate: number | null;
}

export function breakdownByTypeAndJuris(
  filtered: PermitWithCycles[],
  projectsById: Map<string, Project>,
  holdsByProjectId?: HoldsMap,
): BreakdownRow[] {
  const buckets = new Map<string, PermitWithCycles[]>();
  for (const p of filtered) {
    const proj = projectsById.get(p.project_id);
    const juris = proj?.juris ?? 'Unknown';
    const type = p.type ?? 'Unknown';
    const key = `${juris}||${type}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([key, group]) => {
      const [juris, type] = key.split('||');
      const cityReviews: number[] = [];
      const teamTurns: number[] = [];
      for (const p of group) {
        const holds = holdsByProjectId?.get(p.project_id);
        for (const c of (p.permit_cycles ?? []) as PermitCycle[]) {
          if (c.cycle_index < 1) continue;
          const cr = accountableDays(holds, c.submitted, c.corr_issued);
          if (cr !== null && cr >= 0) cityReviews.push(cr);
          const tt = accountableDays(holds, c.corr_issued, c.resubmitted);
          if (tt !== null && tt >= 0) teamTurns.push(tt);
        }
      }
      let hit = 0;
      let total = 0;
      for (const p of group) {
        const sub = cycle0(p)?.submitted;
        if (!sub || !p.target_submit) continue;
        total += 1;
        if (sub <= p.target_submit) hit += 1;
      }
      return {
        juris,
        type,
        n: group.length,
        avgIntakeToApproval: avgIntakeToApproval(group, holdsByProjectId),
        avgCycles: avgCyclesPerPermit(group),
        avgCityReviewPerCycle:
          cityReviews.length === 0 ? null : Math.round(avg(cityReviews)),
        avgTeamTurnaroundPerCycle:
          teamTurns.length === 0 ? null : Math.round(avg(teamTurns)),
        targetHitRate: total < SPARSE_GATE ? null : hit / total,
      };
    })
    .sort((a, b) => b.n - a.n);
}

// ============================================================
// fix-125: per-review-cycle aggregates (cycles 1 through 4)
// ============================================================
//
// Surfaces "we're really slow at cycle 3 vs cycle 2 — why?" on the
// Trends City performance section. The existing breakdownByTypeAndJuris
// rolls per-cycle review timing into one number per type×juris combo;
// the per-cycle helpers below aggregate across the whole filtered
// cohort so the cycle-specific signal isn't lost in the rollup.
//
// Both helpers reuse extractSample (scheduleBenchmarks.ts) for the raw
// per-cycle day counts so the math stays consistent with the
// per-(type, juris) tile in ScheduleBenchmarks. extractSample handles
// the "approval_date or actual_issue" gate AND the intake-anchor gate
// — permits that don't qualify return null and contribute to no cycle.
// 1-decimal-place output via formatCompareNumber so the chart hover
// labels read 7.3d, not 7.333…d (matches fix-124-a's rounding policy).

export interface ByCycleEntry {
  cycle: 1 | 2 | 3 | 4;
  /** 1-decimal-rounded average. Null when n=0 — chart renders the bar
   *  height as 0 and the tooltip discloses "n=0" rather than a
   *  misleading 0d average. */
  avgDays: number | null;
  /** Permits that contributed a non-null, non-negative day value to
   *  this cycle bucket. */
  n: number;
}

type LearnSample = NonNullable<ReturnType<typeof extractSample>>;

function computeByCycle(
  permits: PermitWithCycles[],
  pick: (sample: LearnSample) => Array<number | null>,
): ByCycleEntry[] {
  const sums: [number, number, number, number] = [0, 0, 0, 0];
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const p of permits) {
    // Reuse the canonical sample extractor so the per-cycle day math
    // matches ScheduleBenchmarks exactly. Don't pass go_date — the
    // cycle metrics don't depend on it (only goToSubmitDays does, and
    // we don't read that here).
    const sample = extractSample(p);
    if (!sample) continue;
    const days = pick(sample);
    for (let i = 0; i < 4; i++) {
      const d = days[i];
      if (d === null || d < 0) continue;
      sums[i] += d;
      counts[i] += 1;
    }
  }
  return ([1, 2, 3, 4] as const).map((cycle, i) => ({
    cycle,
    avgDays:
      counts[i] === 0 ? null : formatCompareNumber(sums[i] / counts[i]),
    n: counts[i],
  }));
}

/** fix-125: avg city review days per review cycle across the cohort.
 *  Returns an array [cycle1, cycle2, cycle3, cycle4] each with
 *  { avgDays: number | null, n: number }. Null avg when no samples
 *  contribute to that cycle. Uses extractSample's strict cycle-1 math
 *  (c0.intake_accepted → c1.corr_issued) and bracket-fallback for
 *  cycles 2-4 — the SAME definition the per-(type, juris) ScheduleBenchmarks
 *  surface uses, so cross-checking is meaningful. */
export function cityReviewByCycle(
  permits: PermitWithCycles[],
): ByCycleEntry[] {
  return computeByCycle(permits, (s) => [
    s.cityReview1Days,
    s.cityReview2Days,
    s.cityReview3Days,
    s.cityReview4Days,
  ]);
}

/** fix-125: avg team response days per review cycle across the cohort.
 *  Response = c.corr_issued → c.resubmitted for the given cycle (how
 *  fast the team turned around city corrections). Permits without
 *  a corrections round for cycle N drop out of cycle N. */
export function responseTimeByCycle(
  permits: PermitWithCycles[],
): ByCycleEntry[] {
  return computeByCycle(permits, (s) => [
    s.corrResponse1Days,
    s.corrResponse2Days,
    s.corrResponse3Days,
    s.corrResponse4Days,
  ]);
}

// ============================================================
// Submission → Intake variance (team-side delay signal)
// ============================================================

export interface VarianceRow {
  juris: string;
  type: string;
  n: number;
  /** AVG(c0.intake_accepted - c0.submitted). Positive = city took time
   *  to accept the team's submission. Permits where intake_accepted is
   *  before submitted (bad data) are excluded. */
  avgDaysFromSubmittedToIntakeAccepted: number;
}

export function submissionToIntakeVariance(
  filtered: PermitWithCycles[],
  projectsById: Map<string, Project>,
): VarianceRow[] {
  const buckets = new Map<string, number[]>();
  for (const p of filtered) {
    const c0 = cycle0(p);
    if (!c0?.submitted || !c0.intake_accepted) continue;
    const d = daysBetween(c0.submitted, c0.intake_accepted);
    if (d === null || d < 0) continue;
    const proj = projectsById.get(p.project_id);
    const juris = proj?.juris ?? 'Unknown';
    const type = p.type ?? 'Unknown';
    const key = `${juris}||${type}`;
    const arr = buckets.get(key) ?? [];
    arr.push(d);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([key, arr]) => {
      const [juris, type] = key.split('||');
      return {
        juris,
        type,
        n: arr.length,
        avgDaysFromSubmittedToIntakeAccepted: Math.round(avg(arr)),
      };
    })
    .sort((a, b) => b.n - a.n);
}

// ============================================================
// Utilities
// ============================================================

function cycle0(p: PermitWithCycles): PermitCycle | undefined {
  return (p.permit_cycles ?? []).find((c) => c.cycle_index === 0);
}

function daysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (!a || !b) return null;
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((bMs - aMs) / DAY_MS);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Convenience for the date-range default: last 12 months ending today.
 *  Returns the date strings the filter consumes. */
export function defaultDateRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  return { from: fromDate.toISOString().slice(0, 10), to };
}
