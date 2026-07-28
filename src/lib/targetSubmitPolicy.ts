// fix-249: target_submit precedence + the display-only history benchmark.
//
// This module is the TS mirror of the SQL in
// migrations/fix_249_target_submit_policy_beats_learner.sql. There is no live
// DB in CI, so the SQL's decision logic is regression-tested through this
// mirror (the fix-153 pattern). Keep the two in lockstep — if you change the
// precedence order, the window cascade, the minimum sample size, or the
// rounding here, change bp_learn_target_submit_days /
// bp_target_submit_benchmark to match, and vice versa.
//
// THE RULE (fix-249): a configured policy offset ALWAYS wins. The learner
// never decides a date any more — it only produces the benchmark below, which
// is displayed next to the target so the standard can be compared against what
// actually happened.

import { anchorFor, type TargetSubmitAnchor } from './targetSubmitLearner';

/** Minimum permits in a window before its median is trustworthy enough to
 *  show. Below this the UI says "not enough history" rather than printing a
 *  number derived from one or two permits. Mirrors the `>= 3` gate in
 *  bp_target_submit_benchmark. */
export const MIN_BENCHMARK_SAMPLES = 3;

/** Recency cascade, freshest first; null = all-time (no cutoff). Mirrors
 *  v_windows in the SQL. */
export const BENCHMARK_WINDOWS_DAYS: readonly (number | null)[] = [
  90,
  180,
  365,
  null,
];

/** Symmetric outlier cap — same |days| <= 730 filter the learner uses. */
export const BENCHMARK_OUTLIER_CAP_DAYS = 730;

const DAY_MS = 24 * 60 * 60 * 1000;

export type BenchmarkWindowLabel =
  | 'last_90d'
  | 'last_180d'
  | 'last_365d'
  | 'all_time'
  | 'insufficient';

export interface BenchmarkSample {
  /** anchor → c0.submitted, in days. May be negative (submitted early). */
  days: number;
  /** ISO date used for windowing — c0.submitted, by spec. */
  recencyDate: string;
}

export interface TargetSubmitBenchmark {
  /** Median of the winning window, or null when no window reached the gate. */
  medianDays: number | null;
  /** Sample count of the winning window, or null when insufficient. Bobby's
   *  spec: "below that return NULL n so the UI can say 'not enough history'". */
  n: number | null;
  minDays: number | null;
  maxDays: number | null;
  windowLabel: BenchmarkWindowLabel;
  /** All-time sample count regardless of the gate, so the UI can say
   *  "only 2 permits" instead of a bare "not enough history". */
  totalSamples: number;
}

/** Postgres round(numeric) rounds half AWAY FROM ZERO; JS Math.round rounds
 *  half toward +Infinity. They disagree on exactly the case that matters here
 *  — an even-sized sample whose median lands on .5 — and they disagree in
 *  opposite directions for negative values. The TRAO cohort
 *  [8,23,70,75,122,167,191,196] has median 98.5: Postgres gives 99, and
 *  round(double precision) (which uses rint / banker's rounding) gives 98.
 *  The SQL casts to numeric for this reason; this function is the TS twin. */
export function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Median of a sample set, rounded to whole days. MEDIAN, not average —
 *  fix-249's whole point is that a couple of slow permits shouldn't drag the
 *  benchmark the way an average does. */
export function medianDays(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw =
    sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  return roundHalfAwayFromZero(raw);
}

function labelFor(windowDays: number | null): BenchmarkWindowLabel {
  if (windowDays === 90) return 'last_90d';
  if (windowDays === 180) return 'last_180d';
  if (windowDays === 365) return 'last_365d';
  return 'all_time';
}

const INSUFFICIENT = (totalSamples: number): TargetSubmitBenchmark => ({
  medianDays: null,
  n: null,
  minDays: null,
  maxDays: null,
  windowLabel: 'insufficient',
  totalSamples,
});

/** Walk the recency cascade and return the first window with n >= 3.
 *  Display only — this value must never be written to a permit. */
export function computeTargetSubmitBenchmark(
  samples: BenchmarkSample[],
  today: Date = new Date(),
): TargetSubmitBenchmark {
  const usable = samples.filter(
    (s) => Math.abs(s.days) <= BENCHMARK_OUTLIER_CAP_DAYS,
  );
  const total = usable.length;
  if (total === 0) return INSUFFICIENT(0);

  for (const windowDays of BENCHMARK_WINDOWS_DAYS) {
    const inWindow =
      windowDays === null
        ? usable
        : usable.filter((s) => {
            const t = new Date(`${s.recencyDate}T12:00:00Z`).getTime();
            return t >= today.getTime() - windowDays * DAY_MS;
          });
    if (inWindow.length >= MIN_BENCHMARK_SAMPLES) {
      const days = inWindow.map((s) => s.days);
      return {
        medianDays: medianDays(days),
        n: inWindow.length,
        minDays: Math.min(...days),
        maxDays: Math.max(...days),
        windowLabel: labelFor(windowDays),
        totalSamples: total,
      };
    }
  }
  return INSUFFICIENT(total);
}

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

export type TargetSubmitDaysSource = 'policy' | 'learner' | 'hardcoded';

export interface ResolvedTargetSubmitDays {
  days: number | null;
  source: TargetSubmitDaysSource | null;
}

/** fix-249 precedence: POLICY → learner → hardcoded.
 *
 *  Before fix-249 this was learner → policy → hardcoded, and because the
 *  learner returned on the first window containing ANY data, the policy tier
 *  was unreachable for every (type, juris) with even one historical permit.
 *  All 14 offsets Bobby configured on 2026-06-10 were dead on arrival.
 *
 *  The learner tier is kept only to fill gaps where no policy row exists. */
export function resolveTargetSubmitDays(input: {
  policyDays: number | null | undefined;
  learnerDays: number | null | undefined;
  hardcodedDays: number | null | undefined;
}): ResolvedTargetSubmitDays {
  if (input.policyDays != null) return { days: input.policyDays, source: 'policy' };
  if (input.learnerDays != null) return { days: input.learnerDays, source: 'learner' };
  if (input.hardcodedDays != null) {
    return { days: input.hardcodedDays, source: 'hardcoded' };
  }
  return { days: null, source: null };
}

// ---------------------------------------------------------------------------
// Projection flags (1e)
// ---------------------------------------------------------------------------

/** The BP milestones the derived anchors are built from. Null = the event has
 *  not been recorded yet, so anything hanging off it is a projection. */
export interface BpMilestones {
  /** BP cycle 0 intake_accepted. */
  c0Intake: string | null;
  /** BP cycle 1 resubmitted — the IPR / ULS anchor. */
  c1Resub: string | null;
  /** BP actual_issue — the Condo anchor. */
  actualIssue: string | null;
  /** The BP's own target_submit, used as the stand-in when c0Intake is absent. */
  bpTarget: string | null;
}

export interface ProjectionFlags {
  intakeProjected: boolean;
  c1Projected: boolean;
  issueProjected: boolean;
}

/** Mirror of the v_*_projected block in bp_recompute_target_submits.
 *
 *  A derived anchor is "projected" when the real milestone is missing and the
 *  engine substituted an estimate. A projected intake poisons everything
 *  downstream of it, because the c1-resub and issue estimates are both built
 *  by adding an offset to the intake. */
export function deriveProjectionFlags(bp: BpMilestones): ProjectionFlags {
  const projIntake = bp.c0Intake ?? bp.bpTarget;
  const intakeProjected = bp.c0Intake == null && bp.bpTarget != null;

  if (projIntake == null) {
    // No usable intake at all — nothing is derived, so nothing is projected.
    return {
      intakeProjected: false,
      c1Projected: false,
      issueProjected: false,
    };
  }
  return {
    intakeProjected,
    c1Projected: bp.c1Resub == null || intakeProjected,
    issueProjected: bp.actualIssue == null || intakeProjected,
  };
}

/** Whether a given permit type's target_submit is a projection, given the
 *  project's BP milestone state. Mirrors the CASE in the engine. Types
 *  anchored on go_date stand on a real recorded date and are never projected;
 *  a permit that has actually been submitted is never projected either. */
export function isTargetSubmitProjected(
  type: string | null | undefined,
  flags: ProjectionFlags,
  hasOwnSubmitted = false,
): boolean {
  if (hasOwnSubmitted) return false;
  switch (type) {
    case 'Demolition':
      return flags.intakeProjected;
    case 'IPR':
    case 'ULS':
      return flags.c1Projected;
    case 'Condo':
      return flags.issueProjected;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Which anchor label the UI prints next to the benchmark ("hist. GO+99d"). */
export function anchorShortLabel(anchor: TargetSubmitAnchor): string {
  switch (anchor) {
    case 'dd_end':
      return 'DD end';
    case 'go_date':
      return 'GO';
    case 'bp_c0_intake':
      return 'BP intake';
    case 'bp_c1_resub':
      return 'BP c1 resub';
    case 'bp_actual_issue':
      return 'BP issued';
    case 'mirror_bp':
      return 'BP target';
  }
}

export interface BenchmarkGap {
  /** median − policy offset, in days. Positive = history runs slower than the
   *  configured standard. Null when there isn't enough history to say. */
  deltaDays: number | null;
  /** Amber when history exceeds the configured target; neutral otherwise. */
  tone: 'neutral' | 'over';
  /** Ready-to-render summary, e.g. "hist. GO+99d (+96 vs target, n=8)". */
  text: string;
}

/** Build the "± vs the benchmark" string Bobby asked for next to the date.
 *  Pure formatting so it can be unit-tested without rendering. */
export function describeBenchmarkGap(
  benchmark: TargetSubmitBenchmark,
  policyOffsetDays: number | null | undefined,
  anchor: TargetSubmitAnchor,
): BenchmarkGap {
  const anchorLabel = anchorShortLabel(anchor);

  if (benchmark.medianDays == null || benchmark.n == null) {
    return {
      deltaDays: null,
      tone: 'neutral',
      text:
        benchmark.totalSamples > 0
          ? `not enough history (n=${benchmark.totalSamples}, need ${MIN_BENCHMARK_SAMPLES})`
          : 'not enough history',
    };
  }

  const median = benchmark.medianDays;
  const base = `hist. ${anchorLabel}+${median}d`;
  if (policyOffsetDays == null) {
    return {
      deltaDays: null,
      tone: 'neutral',
      text: `${base} (n=${benchmark.n})`,
    };
  }

  const delta = median - policyOffsetDays;
  const signed = delta > 0 ? `+${delta}` : String(delta);
  return {
    deltaDays: delta,
    // Neutral/green when actual median <= target offset; amber when it exceeds.
    tone: delta > 0 ? 'over' : 'neutral',
    text: `${base} (${signed} vs target, n=${benchmark.n})`,
  };
}

/** Convenience re-export so callers don't need two imports to go from a
 *  permit type to its anchor label. */
export { anchorFor };
export type { TargetSubmitAnchor };
