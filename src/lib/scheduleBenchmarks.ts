import type { PermitWithCycles, Project } from './database.types';

// Q7.2.a: learned schedule benchmarks. Ports v1's computeLearnedSchedule
// (index.html 5349-5370) + _extractSample (5218-5280) + _buildEstimate
// (5286-5347) under v2's cycle_index numbering.
//
// v1 mental model: cycles[0] was design phase, cycles[1] was first city
// review. v2 schema has cycle_index 1-based and cycle_index=1 is the
// first review (no separate design row). Sample extraction iterates
// cycle_index 1..4 directly.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default learning window in days. v1 supports per-juris overrides via
 * appConfig.learnThresholds; v2 starts with a flat 180-day window and
 * exposes the override via getLearnWindow. */
const LEARN_WINDOW_DEFAULT = 180;

/** fix-25-feat-AA: recency cascade tiers (days). The learner walks
 *  fresh→stale and returns the first tier with N ≥ gate. After 365d
 *  the cascade falls through to all-time (no cutoff) so a cohort
 *  with old data still contributes — better than silent fallback to
 *  hardcoded defaults. */
export const WINDOW_TIERS_DAYS = [90, 180, 365] as const;

/** fix-25-feat-AA: tier label surfaced on LearnedEstimate.recencyTier
 *  so UI can show "based on last 90d (n=12)" vs "all-time (n=3)". */
export type RecencyTier =
  | 'last_90d'
  | 'last_180d'
  | 'last_365d'
  | 'all_time'
  | 'default';

function tierLabelFor(windowDays: number | null): RecencyTier {
  if (windowDays === 90) return 'last_90d';
  if (windowDays === 180) return 'last_180d';
  if (windowDays === 365) return 'last_365d';
  return 'all_time';
}

/** Hardcoded fallbacks when no learned data exists (v1's getScheduleDefaults
 * for v2-style cycle numbering). Each value in days. */
export const SCHEDULE_DEFAULTS = {
  cityReview1: 21,
  corrResponse1: 10,
  cityReview2: 21,
  corrResponse2: 10,
  cityReview3: 21,
  corrResponse3: 10,
  cityReview4: 21,
  corrResponse4: 10,
} as const;

/** fix-24h → fix-24i: holistic fallback when (type, juris) and (type, *)
 * learners are both silent AND the permit has no cycle activity yet.
 * Used by the unknown-type fallback in defaultDaysForType() below. Real
 * dispatch goes through PER_TYPE_DEFAULT_DAYS for known types. */
export const DEFAULT_AVG_INTAKE_TO_APPROVAL = 210;

/** fix-24i: per-permit-type baseline durations (intake_accepted → approval).
 *  Used when (type, juris) and (type, *) both have insufficient samples.
 *  Starter values; refine as real samples accumulate or via a future
 *  editable-defaults settings panel. */
export const PER_TYPE_DEFAULT_DAYS: Record<string, number> = {
  'Building Permit': 210,
  'Demolition': 60,
  'ULS': 90,
  'Use Limitation': 90,
  'Land Use': 180,
  LU: 180,
  'Pre-Application': 30,
  PA: 30,
  IPR: 30,
  LBA: 120,
  Condo: 180,
  'Short Plat': 180,
  SIP: 60,
  SDOT: 45,
  TRAO: 30,
};

/** fix-24i: fallback for unknown / custom permit types. Same value as the
 *  historical 210d global default so existing test bobby smoke continues
 *  to land on 2026-12-11 even when permit.type isn't in the table. */
export const PER_TYPE_FALLBACK_DAYS = 210;

/** fix-24i: lookup helper used by the consumer (projectedApproval.ts) when
 *  the learner has no signal and no cycle activity exists.
 *
 *  fix-25-feat-Z: accepts an optional overrides map (typically sourced
 *  from usePermitTypeDefaults / permit_type_defaults table). Resolution
 *  order:
 *    1. overrides[type] — tenant-editable value from the DB table
 *    2. PER_TYPE_DEFAULT_DAYS[type] — hardcoded baseline matching the
 *       seed values in the migration
 *    3. PER_TYPE_FALLBACK_DAYS — ultimate fallback for unknown types
 *
 *  Hardcoded values stay as defense in depth — a tenant with no DB
 *  row (or an unauthenticated context) gets the same number as before
 *  this fix. */
export function defaultDaysForType(
  type: string | null | undefined,
  overrides?: Map<string, number> | Record<string, number>,
): number {
  if (!type) return PER_TYPE_FALLBACK_DAYS;
  if (overrides) {
    const override =
      overrides instanceof Map ? overrides.get(type) : overrides[type];
    if (typeof override === 'number' && override > 0) return override;
  }
  return PER_TYPE_DEFAULT_DAYS[type] ?? PER_TYPE_FALLBACK_DAYS;
}

/** fix-24i: minimum samples before the learner is trusted. fix-25-feat-g
 *  flipped this to 1 — Bobby's stance is "use the data we have." Holding
 *  back a real average for a 210d generic default just because there's
 *  only 1-2 samples is the wrong tradeoff. As real samples accumulate
 *  the recency cap and (eventually) outlier trimming handle noise. */
export const MIN_SAMPLES_FOR_LEARNER = 1;

/** Per-jurisdiction window override hook. v1 reads from appConfig; v2
 * eventually wires this from a tenant-level setting (Q7.3). For now,
 * flat default — `juris` param is accepted by the signature but ignored
 * until a config table lands. */
export function getLearnWindow(juris: string): number {
  void juris;
  return LEARN_WINDOW_DEFAULT;
}

// ============================================================
// Sample extraction
// ============================================================

interface LearnSample {
  cityReview1Days: number | null;
  corrResponse1Days: number | null;
  cityReview2Days: number | null;
  corrResponse2Days: number | null;
  cityReview3Days: number | null;
  corrResponse3Days: number | null;
  cityReview4Days: number | null;
  corrResponse4Days: number | null;
  nCycles: number;
  approvedInCycle: number;
  goToSubmitDays: number | null;
  /** fix-24i: holistic clock — c0.intake_accepted → approval. */
  intakeToApprovalDays: number | null;
  /** fix-24i: c0.intake_accepted, drives the learner anchor AND the
   *  date-range display ("Last 180d · Type · Juris" subtitle). */
  intakeAnchor: string;
  /** First-review submitted date. Preserved for the source-permit modal's
   *  "Submitted" column (team-side submission visibility). Not used by
   *  the learner anymore post-fix-24i. */
  submittedAnchor: string | null;
  /** fix-25-feat-Y: permit's approval timestamp — drives the recency
   *  weight applied to every aggregate derived from this sample.
   *  approval_date preferred, actual_issue fallback (mirrors the
   *  extraction gate at line 131). Null only if neither exists,
   *  which means the sample wouldn't survive extractSample anyway. */
  approvalDate: string | null;
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((bMs - aMs) / DAY_MS);
}

/** Extract a learning sample from one approved/issued permit. Returns null
 * if the permit hasn't reached approval (incomplete lifecycle).
 *
 * fix-22 Mig 3: go_date moved permits → projects. The optional second arg
 * carries the project's go_date so goToSubmitDays still has its anchor. */
export function extractSample(
  permit: PermitWithCycles,
  projectGoDate?: string | null,
): LearnSample | null {
  if (!permit.approval_date && !permit.actual_issue) return null;
  const cycles = (permit.permit_cycles ?? []).slice().sort(
    (a, b) => a.cycle_index - b.cycle_index,
  );
  const c0 = cycles.find((c) => c.cycle_index === 0);
  const c1 = cycles.find((c) => c.cycle_index === 1);
  const c2 = cycles.find((c) => c.cycle_index === 2);
  const c3 = cycles.find((c) => c.cycle_index === 3);
  const c4 = cycles.find((c) => c.cycle_index === 4);

  // fix-24i: anchor is c0.intake_accepted ("city accepted intake → city
  // issued permit" is the canonical learner clock).
  //
  // fix-25-feat-g: fall back to c0.submitted when intake_accepted is null.
  // Pre-fix-26 permits and scraper-captured rows don't carry the separate
  // intake_accepted field, so dropping them entirely was costing the
  // learner ~46 approved permits worth of signal. The submit→intake gap
  // inflates the average slightly on those samples, but that bias shrinks
  // to zero as the team enters real intake_accepted dates going forward.
  // permits.intake_date (top-level scraper field) is the team's submission
  // date and is NOT used — that would erase the team-vs-city signal we
  // preserve at the data layer for future Reports.
  const intakeAnchor = c0?.intake_accepted ?? c0?.submitted ?? null;
  if (!intakeAnchor) return null;

  // submittedAnchor (c1.submitted) is preserved for the source-permit
  // modal's "Submitted" column display only. Nullable now.
  const submittedAnchor = c1?.submitted ?? null;

  // City review N = days from cycle N's submitted to cycle N's corr_issued
  // (or, if approval landed mid-cycle, to approval_date as a fallback).
  const approvalDate = permit.approval_date ?? permit.actual_issue ?? null;
  function reviewEnd(
    thisCyc: { submitted: string | null; corr_issued: string | null } | undefined,
    nextCyc: { submitted: string | null } | undefined,
  ): string | null {
    if (thisCyc?.corr_issued) return thisCyc.corr_issued;
    if (
      approvalDate &&
      thisCyc?.submitted &&
      approvalDate >= thisCyc.submitted &&
      (!nextCyc?.submitted || approvalDate < nextCyc.submitted)
    ) {
      return approvalDate;
    }
    return null;
  }
  const cr1End = reviewEnd(c1, c2);
  const cr2End = reviewEnd(c2, c3);
  const cr3End = reviewEnd(c3, c4);
  const cr4End = reviewEnd(c4, undefined);

  const cityReview1Days = cr1End ? daysBetween(c1?.submitted, cr1End) : null;
  const cityReview2Days = cr2End ? daysBetween(c2?.submitted, cr2End) : null;
  const cityReview3Days = cr3End ? daysBetween(c3?.submitted, cr3End) : null;
  const cityReview4Days = cr4End ? daysBetween(c4?.submitted, cr4End) : null;
  const corrResponse1Days = daysBetween(c1?.corr_issued, c1?.resubmitted);
  const corrResponse2Days = daysBetween(c2?.corr_issued, c2?.resubmitted);
  const corrResponse3Days = daysBetween(c3?.corr_issued, c3?.resubmitted);
  const corrResponse4Days = daysBetween(c4?.corr_issued, c4?.resubmitted);

  // nCycles: how many correction rounds this permit went through.
  const nCycles = cycles.filter((c) => c.corr_issued || c.resubmitted).length;
  const approvedInCycle = Math.min(4, Math.max(1, nCycles + 1));

  return {
    cityReview1Days,
    corrResponse1Days,
    cityReview2Days,
    corrResponse2Days,
    cityReview3Days,
    corrResponse3Days,
    cityReview4Days,
    corrResponse4Days,
    nCycles,
    approvedInCycle,
    goToSubmitDays: daysBetween(projectGoDate, submittedAnchor),
    intakeToApprovalDays: daysBetween(intakeAnchor, approvalDate),
    intakeAnchor,
    submittedAnchor,
    approvalDate,
  };
}

// ============================================================
// Estimate from sample set
// ============================================================

export interface LearnedEstimate {
  source: string;
  sampleCount: number;
  dateRange: string;
  goToSubmit: number | null;
  /** fix-24i: holistic clock — avg(c0.intake_accepted → approval) across
   *  the sample set. Renamed from avgSubmitToIssue (which measured
   *  c1.submitted → approval). */
  avgIntakeToApproval: number | null;
  cityReview1: number;
  corrResponse1: number;
  cityReview2: number;
  corrResponse2: number;
  cityReview3: number;
  corrResponse3: number;
  cityReview4: number;
  corrResponse4: number;
  cr1Count: number;
  cr2Count: number;
  cr3Count: number;
  cr4Count: number;
  co1Count: number;
  co2Count: number;
  co3Count: number;
  co4Count: number;
  avgCycles: number | null;
  /** Which cycle a typical permit gets approved in (1-4); used for
   * "most likely outcome" forecasting. */
  mostLikelyCycle: number;
  /** Distribution of approvedInCycle across the sample set. */
  cycleDist: Record<1 | 2 | 3 | 4, number>;
  /** Source flag — true when only all-time samples were available. */
  isAllTime: boolean;
  /** fix-24i: true when the (type, juris) tier returned no samples and
   *  the (type, *) cross-juris tier was used. Reports / Trends can label
   *  cross-juris-sourced estimates accordingly. */
  isCrossJuris: boolean;
  /** fix-25-feat-W: number of samples the outlier filter dropped from
   *  the headline intake→approval aggregation. Surfaced for diagnostic
   *  UI (e.g., "n=12 (-2 outliers)"). Per-cycle filter counts aren't
   *  exposed individually — each cycle's filter sees a different
   *  distribution and aggregating across them would mislead. */
  filteredCount?: number;
  /** fix-25-feat-AA: which recency tier won the cascade. UI can use this
   *  to surface "based on last 90d" / "all-time" labels. Mirrors the
   *  hierarchy WINDOW_TIERS_DAYS → all_time → default. `isAllTime`
   *  stays in place for backward compat but `recencyTier` is the
   *  authoritative signal. */
  recencyTier: RecencyTier;
}

/** fix-25-feat-W: hard-cap upper bound (days). Any clock > 2 years is
 *  treated as a data error or extreme outlier — drop before IQR. */
export const OUTLIER_HARD_CAP_DAYS = 730;

/** fix-25-feat-W: minimum cohort size before Tukey IQR runs. Below
 *  this, IQR fences are unstable — only the hard caps apply. */
export const IQR_MIN_SAMPLES = 8;

/** fix-25-feat-Y: half-life (months) for the recency-weighting decay.
 *  A sample 18 months old carries half the weight of one approved
 *  today. Chosen as the sweet spot between "let recent dominate"
 *  and "throw away useful history" — the team's last 18 months are
 *  the most predictive of the next quarter without making old
 *  cohorts disappear entirely. */
export const RECENCY_HALF_LIFE_MONTHS = 18;

/** fix-25-feat-Y: minimum weight any sample can fall to. Ancient
 *  samples still carry SOME weight so a single very-old data point
 *  isn't lost in sparse cohorts. 0.05 keeps it visible without
 *  letting it dominate fresh signal. */
const RECENCY_WEIGHT_FLOOR = 0.05;

/** Average days/month for the monthsOld calculation. 30.44 matches
 *  the Gregorian average (365.25/12). */
const DAYS_PER_MONTH = 30.44;

/** fix-25-feat-Y: exponential time-decay weight for a sample whose
 *  approval landed at `approvalDate`. Returns a number in
 *  [RECENCY_WEIGHT_FLOOR, 1].
 *
 *  Semantics:
 *    monthsOld = (now - approvalDate) / 30.44 days
 *    weight = 0.5 ^ (monthsOld / 18)
 *    floor at RECENCY_WEIGHT_FLOOR
 *    future-dated (negative monthsOld) → 1
 *    null / missing date → 1 (can't weight what we can't measure)
 *
 *  `now` is parameterized for test determinism — runtime callers
 *  use the default `new Date()`. */
export function recencyWeight(
  approvalDate: string | Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!approvalDate) return 1;
  const d =
    typeof approvalDate === 'string'
      ? new Date(`${approvalDate}T12:00:00Z`)
      : approvalDate;
  if (isNaN(d.getTime())) return 1;
  const monthsOld =
    (now.getTime() - d.getTime()) / (DAYS_PER_MONTH * DAY_MS);
  if (monthsOld < 0) return 1;
  const w = Math.pow(0.5, monthsOld / RECENCY_HALF_LIFE_MONTHS);
  return Math.max(w, RECENCY_WEIGHT_FLOOR);
}

export interface FilteredMean {
  mean: number;
  n: number;
  filteredCount: number;
}

/** fix-25-feat-W: outlier-resistant mean for learner aggregates.
 *
 *  1. Hard caps: drop samples < 1 (negative / zero-day, impossible)
 *     and > OUTLIER_HARD_CAP_DAYS (multi-year, data error / extreme).
 *  2. Tukey IQR upper fence (when N ≥ IQR_MIN_SAMPLES): drop samples
 *     above Q3 + 1.5×IQR. Lower fence intentionally NOT applied —
 *     fast approvals on simple permits are real and should land in
 *     the average.
 *
 *  fix-25-feat-Y: optional `weights` array — parallel to `samples`.
 *  When provided, returns a WEIGHTED mean instead of straight mean.
 *  Filter operations (hard caps, IQR) drop the value AND its weight
 *  in lockstep. Missing weights default to 1 (so older callers and
 *  weighted callers can coexist). Weights aren't themselves
 *  filtered — only the parallel sample value drives drops.
 *
 *  Returns null when no samples survive filtering. Otherwise returns
 *  the rounded mean of the kept set, the kept count, and the count
 *  dropped (so consumers can surface "n with -k outliers" if desired). */
export function filteredMean(
  samples: (number | null | undefined)[],
  weights?: number[],
): FilteredMean | null {
  // Walk samples + parallel weights, keeping only entries where the
  // sample is numeric. Missing or undefined weight → defaults to 1.
  const numericPairs: Array<{ value: number; weight: number }> = [];
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    if (v === null || v === undefined) continue;
    const w = weights?.[i];
    const weight =
      typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 1;
    numericPairs.push({ value: v, weight });
  }
  if (numericPairs.length === 0) return null;

  // Step 1: hard caps
  const capped = numericPairs.filter(
    (p) => p.value >= 1 && p.value <= OUTLIER_HARD_CAP_DAYS,
  );
  if (capped.length === 0) return null;

  // Step 2: Tukey IQR upper fence — only when distribution is stable.
  let kept = capped;
  if (capped.length >= IQR_MIN_SAMPLES) {
    const sortedValues = capped.map((p) => p.value).sort((a, b) => a - b);
    const q1 = quantile(sortedValues, 0.25);
    const q3 = quantile(sortedValues, 0.75);
    const iqr = q3 - q1;
    if (iqr > 0) {
      const upperFence = q3 + 1.5 * iqr;
      kept = capped.filter((p) => p.value <= upperFence);
    }
  }

  if (kept.length === 0) return null;
  // Weighted mean: SUM(value * weight) / SUM(weight).
  let sumWV = 0;
  let sumW = 0;
  for (const p of kept) {
    sumWV += p.value * p.weight;
    sumW += p.weight;
  }
  // sumW > 0 always — we filter weights ≤ 0 above. Guard anyway.
  const mean = sumW > 0 ? sumWV / sumW : 0;
  return {
    mean: Math.round(mean),
    n: kept.length,
    filteredCount: numericPairs.length - kept.length,
  };
}

/** fix-25-feat-X: cycle extrapolation. Given a 1-indexed cycle, walk
 *  DOWN through the learned per-cycle averages to find the highest
 *  populated cycle ≤ min(cycleIdx, 4) and return its avg. Falls back
 *  to SCHEDULE_DEFAULTS.cityReview1 when no learned cycle in the
 *  cohort has samples (or when estimate is null).
 *
 *  Bobby's spec (2026-05-16): when projecting cycle N+1 but the
 *  learner only has data through cycle N, reuse cycle N's clock
 *  instead of jumping to the historical default. Example: a permit
 *  going into cycle 5 reads cycle 4's learned value, not the
 *  21-day generic default.
 *
 *  Count-gated: a cycle is "populated" iff its crNCount > 0. The
 *  cityReviewN field always carries a number (learned avg OR
 *  SCHEDULE_DEFAULTS.cityReviewN), so we can't rely on `!= null` to
 *  detect "actually learned" — count is the authoritative signal.
 *
 *  cycleIdx coerced to [1, 4]: 0 / negatives → 1; 5+ → 4. */
export function effectiveCityReview(
  estimate: LearnedEstimate | null,
  cycleIdx: number,
): number {
  if (!estimate) return SCHEDULE_DEFAULTS.cityReview1;
  const cap = Math.min(Math.max(cycleIdx, 1), 4);
  for (let i = cap; i >= 1; i--) {
    const countKey = `cr${i}Count` as
      | 'cr1Count'
      | 'cr2Count'
      | 'cr3Count'
      | 'cr4Count';
    const valueKey = `cityReview${i}` as
      | 'cityReview1'
      | 'cityReview2'
      | 'cityReview3'
      | 'cityReview4';
    if ((estimate[countKey] ?? 0) > 0) {
      return estimate[valueKey];
    }
  }
  return SCHEDULE_DEFAULTS.cityReview1;
}

/** fix-25-feat-X: same shape as effectiveCityReview for the team's
 *  corrections-response clock per cycle. Walks down from
 *  min(cycleIdx, 4) → 1, falls back to SCHEDULE_DEFAULTS.corrResponse1. */
export function effectiveCorrResponse(
  estimate: LearnedEstimate | null,
  cycleIdx: number,
): number {
  if (!estimate) return SCHEDULE_DEFAULTS.corrResponse1;
  const cap = Math.min(Math.max(cycleIdx, 1), 4);
  for (let i = cap; i >= 1; i--) {
    const countKey = `co${i}Count` as
      | 'co1Count'
      | 'co2Count'
      | 'co3Count'
      | 'co4Count';
    const valueKey = `corrResponse${i}` as
      | 'corrResponse1'
      | 'corrResponse2'
      | 'corrResponse3'
      | 'corrResponse4';
    if ((estimate[countKey] ?? 0) > 0) {
      return estimate[valueKey];
    }
  }
  return SCHEDULE_DEFAULTS.corrResponse1;
}

/** Linear-interpolation quantile on a pre-sorted ascending array.
 *  Standard percentile algorithm (R type 7 / pandas / NumPy default). */
function quantile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** fix-25-feat-W: thin convenience wrapper for the call sites that only
 *  need the mean (preserves the prior avg() signature). The headline
 *  intake→approval aggregation calls filteredMean directly so it can
 *  surface filteredCount on the LearnedEstimate.
 *
 *  fix-25-feat-Y: accepts optional `weights` parallel to `values` so
 *  per-cycle aggregates can carry recency weighting through to the
 *  weighted mean. Missing weights default to 1 (unweighted). */
function avg(
  values: (number | null | undefined)[],
  weights?: number[],
): number | null {
  const result = filteredMean(values, weights);
  return result === null ? null : result.mean;
}

function buildEstimate(
  samples: LearnSample[],
  source: string,
  isAllTime: boolean,
  isCrossJuris: boolean,
  recencyTier: RecencyTier,
): LearnedEstimate | null {
  if (samples.length === 0) return null;
  const cr1 = samples.map((s) => s.cityReview1Days);
  const co1 = samples.map((s) => s.corrResponse1Days);
  const cr2 = samples.map((s) => s.cityReview2Days);
  const co2 = samples.map((s) => s.corrResponse2Days);
  const cr3 = samples.map((s) => s.cityReview3Days);
  const co3 = samples.map((s) => s.corrResponse3Days);
  const cr4 = samples.map((s) => s.cityReview4Days);
  const co4 = samples.map((s) => s.corrResponse4Days);

  const cycleDist: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const s of samples) {
    const c = Math.min(4, Math.max(1, s.approvedInCycle)) as 1 | 2 | 3 | 4;
    cycleDist[c]++;
  }
  // Most likely cycle = bucket with the highest count. Ties favor the lower
  // (more optimistic about no-corrections approval) per v1.
  let mostLikelyCycle: 1 | 2 | 3 | 4 = 1;
  let topCount = cycleDist[1];
  ([2, 3, 4] as const).forEach((c) => {
    if (cycleDist[c] > topCount) {
      topCount = cycleDist[c];
      mostLikelyCycle = c;
    }
  });

  // fix-24i: date range now reflects the intake-anchored sample window
  // (matches the renamed learner clock). Every surviving sample has
  // intakeAnchor populated thanks to the extractSample gate.
  const intakeAnchors = samples.map((s) => s.intakeAnchor).sort();
  const dateFrom = intakeAnchors[0] ?? '';
  const dateTo = intakeAnchors[intakeAnchors.length - 1] ?? '';
  const dateRange =
    dateFrom && dateTo && dateFrom !== dateTo ? `${dateFrom} – ${dateTo}` : dateFrom;

  const nCycValues = samples.map((s) => s.nCycles).filter((n) => n > 0);
  const avgCycles =
    nCycValues.length === 0
      ? null
      : Math.round(
          (nCycValues.reduce((a, b) => a + b, 0) / nCycValues.length) * 10,
        ) / 10;

  // fix-25-feat-Y: recency weights — one weight per sample derived
  // from the permit's approval timestamp. Parallel to every aggregate
  // array below. Captured at buildEstimate time (not inside avg() or
  // filteredMean) so consumers can rely on a single `now`-relative
  // snapshot across all the per-cycle aggregations.
  const weights = samples.map((s) => recencyWeight(s.approvalDate));

  // fix-25-feat-W: capture filteredCount from the headline aggregation
  // so consumers can surface "n=12 (-2 outliers)" if desired. Per-cycle
  // counts aren't exposed individually — see LearnedEstimate.filteredCount.
  const intakeFiltered = filteredMean(
    samples.map((s) => s.intakeToApprovalDays),
    weights,
  );

  return {
    source,
    sampleCount: samples.length,
    dateRange,
    goToSubmit: avg(samples.map((s) => s.goToSubmitDays), weights),
    avgIntakeToApproval: intakeFiltered === null ? null : intakeFiltered.mean,
    filteredCount: intakeFiltered?.filteredCount ?? 0,
    cityReview1: avg(cr1, weights) ?? SCHEDULE_DEFAULTS.cityReview1,
    corrResponse1: avg(co1, weights) ?? SCHEDULE_DEFAULTS.corrResponse1,
    cityReview2: avg(cr2, weights) ?? SCHEDULE_DEFAULTS.cityReview2,
    corrResponse2: avg(co2, weights) ?? SCHEDULE_DEFAULTS.corrResponse2,
    cityReview3: avg(cr3, weights) ?? SCHEDULE_DEFAULTS.cityReview3,
    corrResponse3: avg(co3, weights) ?? SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: avg(cr4, weights) ?? SCHEDULE_DEFAULTS.cityReview4,
    corrResponse4: avg(co4, weights) ?? SCHEDULE_DEFAULTS.corrResponse4,
    cr1Count: cr1.filter((v) => v !== null && v > 0).length,
    cr2Count: cr2.filter((v) => v !== null && v > 0).length,
    cr3Count: cr3.filter((v) => v !== null && v > 0).length,
    cr4Count: cr4.filter((v) => v !== null && v > 0).length,
    co1Count: co1.filter((v) => v !== null && v > 0).length,
    co2Count: co2.filter((v) => v !== null && v > 0).length,
    co3Count: co3.filter((v) => v !== null && v > 0).length,
    co4Count: co4.filter((v) => v !== null && v > 0).length,
    avgCycles,
    mostLikelyCycle,
    cycleDist,
    isAllTime,
    isCrossJuris,
    recencyTier,
  };
}

/** fix-25-feat-AA: build estimate for a (type, juris | null) scope.
 *  juris=null is the cross-juris path (type, *). Walks the 4-tier
 *  recency cascade: 90d → 180d → 365d → all-time. Returns the first
 *  tier with N ≥ MIN_SAMPLES_FOR_LEARNER. Caller orchestrates the
 *  cross-juris fallback after this returns null.
 *
 *  Recency anchor for the existing learner = approval_date (or
 *  actual_issue fallback). Older fix-24i implementation only had a
 *  single 180d window + all-time; this generalizes to a configurable
 *  cascade so the team can prefer "last quarter" over "old steady
 *  state" without losing the all-time signal as a fallback. */
function computeForFilter(
  permits: PermitWithCycles[],
  projectsById: Map<string, Project>,
  type: string,
  juris: string | null,
  today: Date,
  isCrossJuris: boolean,
): LearnedEstimate | null {
  const jurisLabel = juris ?? '*';

  const matchingApproved = permits.filter((p) => {
    if (p.type !== type) return false;
    if (juris !== null) {
      const project = projectsById.get(p.project_id);
      if (project?.juris !== juris) return false;
    }
    return Boolean(p.approval_date || p.actual_issue);
  });
  if (matchingApproved.length === 0) return null;

  // Walk the recency cascade fresh→stale. Each tier widens the cutoff;
  // first tier with enough samples wins.
  for (const windowDays of WINDOW_TIERS_DAYS) {
    const cutoff = new Date(today.getTime() - windowDays * DAY_MS);
    const recent = matchingApproved.filter((p) => {
      const d = p.approval_date ?? p.actual_issue;
      if (!d) return false;
      return new Date(`${d}T12:00:00Z`).getTime() >= cutoff.getTime();
    });
    const samples = recent
      .map((p) =>
        extractSample(p, projectsById.get(p.project_id)?.go_date ?? null),
      )
      .filter((s): s is LearnSample => s !== null);
    if (samples.length >= MIN_SAMPLES_FOR_LEARNER) {
      return buildEstimate(
        samples,
        `Last ${windowDays}d · ${type} · ${jurisLabel}`,
        false,
        isCrossJuris,
        tierLabelFor(windowDays),
      );
    }
  }
  // Tier 4: all-time within the same scope.
  const allSamples = matchingApproved
    .map((p) => extractSample(p, projectsById.get(p.project_id)?.go_date ?? null))
    .filter((s): s is LearnSample => s !== null);
  if (allSamples.length >= MIN_SAMPLES_FOR_LEARNER) {
    return buildEstimate(
      allSamples,
      `All-time · ${type} · ${jurisLabel}`,
      true,
      isCrossJuris,
      'all_time',
    );
  }
  // Below the min-sample gate at every tier → caller falls through.
  return null;
}

/** fix-25-feat-AA → fix-37: orchestrator. Walks the (type, juris) recency
 *  cascade (90d → 180d → 365d → all-time), then returns null so the caller
 *  falls back to defaultDaysForType(type).
 *
 *  fix-37: the (type, *) cross-juris tier (fix-24i / fix-25-feat-AA) is
 *  removed. A jurisdiction with no own learned data now uses the per-type
 *  default, never another jurisdiction's timeline — Bellevue/Phoenix
 *  processes differ materially from Seattle and cross-juris was polluting
 *  estimates. isCrossJuris therefore never fires (always false); the field
 *  is retained for minimal churn and the fix-35 CROSS-JURIS badge simply
 *  never renders.
 *
 *  getLearnWindow still exists for back-compat callers but no longer
 *  drives this function — the cascade subsumes per-juris window tuning. */
export function computeLearnedSchedule(
  permits: PermitWithCycles[],
  type: string,
  juris: string,
  projectsById: Map<string, Project>,
  today: Date = new Date(),
): LearnedEstimate | null {
  // (type, juris) only. No signal → caller uses defaultDaysForType(type).
  return computeForFilter(permits, projectsById, type, juris, today, false);
}

/** Q9.5.f-fix-3 4.B: one row per contributing permit for the source modal.
 *  Includes the per-cycle CR/CO days that fed the learned averages so the
 *  modal can show the contribution alongside the high-level dates. */
export interface BenchmarkSourcePermit {
  permitId: number;
  projectId: string;
  address: string;
  type: string;
  num: string | null;
  submitted: string | null;
  /** fix-25-feat-U: raw c0.intake_accepted on the source permit. Null
   *  when the permit was anchored via the fix-25-feat-g fallback
   *  (extractSample falls back to c0.submitted when intake_accepted
   *  is missing). Modal renders this so reviewers can see which
   *  anchor the learner used and the submission→intake variance per
   *  sample (Bobby's team-side-delay signal). */
  intakeAccepted: string | null;
  approval: string | null;
  cycleCount: number;
  /** True when this permit's approval/issue fell within the learned window
   *  for the given juris — drives a "recent" pill in the modal. */
  inRecentWindow: boolean;
  /** Per-cycle CR/CO days (parallel to the card tiles). */
  cycles: Array<{ index: number; cr: number | null; co: number | null }>;
}

export function listSourcePermits(
  permits: PermitWithCycles[],
  type: string,
  juris: string,
  projectsById: Map<string, Project>,
  today: Date = new Date(),
): BenchmarkSourcePermit[] {
  const windowDays = getLearnWindow(juris);
  const cutoff = new Date(today.getTime() - windowDays * DAY_MS);
  const out: BenchmarkSourcePermit[] = [];
  for (const p of permits) {
    if (p.type !== type) continue;
    const project = projectsById.get(p.project_id);
    if (project?.juris !== juris) continue;
    if (!p.approval_date && !p.actual_issue) continue;
    const sample = extractSample(p, project?.go_date ?? null);
    if (!sample) continue;
    const approval = p.approval_date ?? p.actual_issue ?? null;
    const inRecentWindow =
      !!approval &&
      new Date(`${approval}T12:00:00Z`).getTime() >= cutoff.getTime();
    // fix-25-feat-U: raw c0.intake_accepted alongside the submittedAnchor.
    // Reading c0 directly (not via sample.intakeAnchor) because
    // intakeAnchor falls back to submitted post-fix-25-feat-g, which would
    // hide the "no intake_accepted recorded" case from the modal.
    const c0Raw = (p.permit_cycles ?? []).find((c) => c.cycle_index === 0);
    const c0IntakeRaw = c0Raw?.intake_accepted ?? null;
    out.push({
      permitId: p.id,
      projectId: p.project_id,
      address: project?.address ?? '—',
      type: p.type ?? '—',
      num: p.num,
      submitted: sample.submittedAnchor,
      intakeAccepted: c0IntakeRaw,
      approval,
      cycleCount: sample.nCycles,
      inRecentWindow,
      cycles: [
        { index: 1, cr: sample.cityReview1Days, co: sample.corrResponse1Days },
        { index: 2, cr: sample.cityReview2Days, co: sample.corrResponse2Days },
        { index: 3, cr: sample.cityReview3Days, co: sample.corrResponse3Days },
        { index: 4, cr: sample.cityReview4Days, co: sample.corrResponse4Days },
      ].filter((c) => c.cr !== null || c.co !== null),
    });
  }
  // Sort recent-first, then approval date desc, then address.
  out.sort((a, b) => {
    if (a.inRecentWindow !== b.inRecentWindow) {
      return a.inRecentWindow ? -1 : 1;
    }
    const ad = a.approval ?? '';
    const bd = b.approval ?? '';
    if (ad !== bd) return ad > bd ? -1 : 1;
    return a.address.localeCompare(b.address);
  });
  return out;
}

/** Enumerate all (type, juris) combos present in a permit set, joined to
 * projects for jurisdiction. Used by the benchmark grid to know which
 * cards to render. */
export function listTypeJurisCombos(
  permits: PermitWithCycles[],
  projectsById: Map<string, Project>,
): { type: string; juris: string; count: number }[] {
  const map = new Map<string, { type: string; juris: string; count: number }>();
  for (const p of permits) {
    const juris = projectsById.get(p.project_id)?.juris ?? '';
    if (!p.type || !juris) continue;
    const key = `${p.type}||${juris}`;
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { type: p.type, juris, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.juris.localeCompare(b.juris);
  });
}
