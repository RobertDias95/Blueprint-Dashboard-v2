// fix-253: the phase-duration model — READ-ONLY. Nothing here feeds a date.
//
// TS mirror of migrations/fix_253_phase_duration_model.sql. There is no live DB
// in CI, so the SQL's statistics are regression-tested through this mirror (the
// fix-153 pattern). Keep the two in lockstep: the sample gate, the outlier
// guards, the median rounding and the recent-window rule all have SQL twins.
//
// THE MODEL
// A permit's schedule is a chain of alternating phases, each with an OWNER,
// measured per cycle:
//
//   target_submit --[CITY: review]--> corr_issued
//                 --[OURS: turnaround]--> resubmitted --> ...
//
// Both sides compress sharply each round (Seattle BP: city 72/25/19, ours
// 24/13/5 for cycles 1/2/3), which a single flat per-type offset cannot
// represent.
//
// THE TWO RULES, kept strictly separate:
//   CITY-owned phases -> observed reality (published city_target, else this
//     learned median, else a per-type default). We do not control the city, so
//     a "policy" would be meaningless.
//   OURS-owned phases -> policy (the fix-249 rule, unchanged), with this median
//     displayed alongside as the +/- benchmark.
// Consuming those rules is fix-254's job; this module only supplies numbers.

import { roundHalfAwayFromZero } from './targetSubmitPolicy';

/** Who owns the phase. 'city' = submitted -> corr_issued (they review us).
 *  'ours' = corr_issued -> resubmitted (we turn corrections around). */
export type PhaseSide = 'city' | 'ours';

/** Minimum cohort size before a median is trustworthy enough to show. Below
 *  this the median is null but `n` is still reported, so the UI can say "not
 *  enough history (n=2)" rather than printing a figure built on one permit. */
export const MIN_PHASE_SAMPLES = 3;

/** Symmetric-ish guard. Negative spans are data errors (exactly one exists on
 *  prod today); >730d is absurd. Zero-day phases are REAL and common — 25/305
 *  city and 15/250 ours are same-day — and are deliberately kept. */
export const PHASE_MAX_DAYS = 730;

/** Trailing window for the trend figure. */
export const PHASE_RECENT_WINDOW_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PhaseSample {
  /** Duration of the phase in days. */
  days: number;
  /** ISO date the phase ENDED — corr_issued for 'city', resubmitted for
   *  'ours'. This is what the recent window is measured against. */
  endedOn: string;
}

export interface PhaseDuration {
  medianDays: number | null;
  n: number;
  minDays: number | null;
  maxDays: number | null;
  recentMedianDays: number | null;
  recentN: number;
}

/** One cell of the grid: a (type, jurisdiction, cycle, side) cohort. */
export interface PhaseDurationRow extends PhaseDuration {
  type: string;
  juris: string;
  cycleIndex: number;
  side: PhaseSide;
}

export function isUsablePhaseSample(days: number | null | undefined): boolean {
  if (days == null || !Number.isFinite(days)) return false;
  return days >= 0 && days <= PHASE_MAX_DAYS;
}

/** Median in whole days, rounding half away from zero to match Postgres
 *  round(numeric). The SQL casts percentile_cont to numeric for exactly this
 *  reason — round(double precision) is banker's rounding, which fix-249 hit
 *  when it silently turned a median of 99 into 98. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return roundHalfAwayFromZero(raw);
}

/** Compute one cohort's stats. Mirrors bp_phase_durations exactly. */
export function computePhaseDuration(
  samples: PhaseSample[],
  recentDays: number = PHASE_RECENT_WINDOW_DAYS,
  today: Date = new Date(),
): PhaseDuration {
  const usable = samples.filter((s) => isUsablePhaseSample(s.days));
  const n = usable.length;

  const cutoff = today.getTime() - recentDays * DAY_MS;
  const recent = usable.filter(
    (s) => new Date(`${s.endedOn}T12:00:00Z`).getTime() >= cutoff,
  );
  const recentN = recent.length;

  const gated = n >= MIN_PHASE_SAMPLES;
  const days = usable.map((s) => s.days);

  return {
    medianDays: gated ? medianOf(days) : null,
    n,
    minDays: gated ? Math.min(...days) : null,
    maxDays: gated ? Math.max(...days) : null,
    recentMedianDays:
      recentN >= MIN_PHASE_SAMPLES ? medianOf(recent.map((s) => s.days)) : null,
    recentN,
  };
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export type TrendDirection = 'slower' | 'faster' | 'flat' | 'unknown';

export interface PhaseTrend {
  /** recent median − all-time median. Positive = the phase got LONGER. */
  deltaDays: number | null;
  direction: TrendDirection;
}

/** "Which phase got longer, and was it us or the city?" — the question the
 *  recent window exists to answer. Unknown when either side is under the gate;
 *  a trend drawn from one or two permits is not a trend. */
export function phaseTrend(row: PhaseDuration): PhaseTrend {
  if (row.medianDays == null || row.recentMedianDays == null) {
    return { deltaDays: null, direction: 'unknown' };
  }
  const delta = row.recentMedianDays - row.medianDays;
  return {
    deltaDays: delta,
    direction: delta > 0 ? 'slower' : delta < 0 ? 'faster' : 'flat',
  };
}

/** Whether a trend is bad news, which depends on who owns the phase only in
 *  the sense that a longer phase is always worse — but the ACTOR differs, and
 *  that is the point of the report: a slower 'ours' phase is ours to fix. */
export function trendTone(t: PhaseTrend): 'bad' | 'good' | 'neutral' {
  if (t.direction === 'slower') return 'bad';
  if (t.direction === 'faster') return 'good';
  return 'neutral';
}

export const SIDE_LABEL: Record<PhaseSide, string> = {
  city: 'City review',
  ours: 'Our turnaround',
};

/** Group a flat grid into type × juris × cycle rows carrying both sides, which
 *  is how the report renders (city and ours side by side per cycle). */
export interface PhaseCyclePair {
  type: string;
  juris: string;
  cycleIndex: number;
  city: PhaseDurationRow | null;
  ours: PhaseDurationRow | null;
}

export function pairSidesByCycle(rows: PhaseDurationRow[]): PhaseCyclePair[] {
  const byKey = new Map<string, PhaseCyclePair>();
  for (const r of rows) {
    const key = `${r.type}||${r.juris}||${r.cycleIndex}`;
    let pair = byKey.get(key);
    if (!pair) {
      pair = {
        type: r.type,
        juris: r.juris,
        cycleIndex: r.cycleIndex,
        city: null,
        ours: null,
      };
      byKey.set(key, pair);
    }
    if (r.side === 'city') pair.city = r;
    else pair.ours = r;
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.juris.localeCompare(b.juris) ||
      a.type.localeCompare(b.type) ||
      a.cycleIndex - b.cycleIndex,
  );
}
