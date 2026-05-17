import type { PermitCycle, PermitWithCycles, Project } from './database.types';

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

export function avgIntakeToApproval(
  filtered: PermitWithCycles[],
): number | null {
  const deltas: number[] = [];
  for (const p of filtered) {
    const intake = cycle0(p)?.intake_accepted;
    const approval = p.approval_date ?? p.actual_issue ?? null;
    if (!intake || !approval) continue;
    const d = daysBetween(intake, approval);
    if (d !== null && d >= 0) deltas.push(d);
  }
  return deltas.length === 0 ? null : Math.round(avg(deltas));
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
        for (const c of (p.permit_cycles ?? []) as PermitCycle[]) {
          if (c.cycle_index < 1) continue;
          const cr = daysBetween(c.submitted, c.corr_issued);
          if (cr !== null && cr >= 0) cityReviews.push(cr);
          const tt = daysBetween(c.corr_issued, c.resubmitted);
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
        avgIntakeToApproval: avgIntakeToApproval(group),
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
