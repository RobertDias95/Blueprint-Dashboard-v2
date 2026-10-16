// fix-249 → ★★★ fix-680: target_submit precedence + the history readout.
//
// This module is the TS mirror of the SQL in
// migrations/fix_680_target_submit_learns.sql. There is no live DB in CI, so
// the SQL's decision logic is regression-tested through this mirror (the
// fix-153 pattern). Keep the two in lockstep — if you change the precedence,
// the "5 most recent" count or the rounding here, change
// bp_learn_target_submit_days / bp_target_submit_benchmark to match, and vice
// versa.
//
// THE RULE (fix-680, reversing fix-249's "policy beats learner"):
//   1. the type has history in this city → the MEDIAN of its 5 most recent
//      submittals (fewer if that is all there is);
//   2. no history → the STARTING NUMBER from Settings (city row, then the
//      type row);
//   3. neither → no automatic target.
// Bobby, 2026-10-15: "lets make it smart, lets see what our average is".

import {
  LEARNER_RECENT_COUNT,
  medianDays,
  mostRecentSamples,
  roundHalfAwayFromZero,
  type TargetSubmitAnchor,
} from './targetSubmitLearner';

/** ★ fix-680: the Settings label for the per-type number (Settings → the
 *  per-type schedule table's column). */
export const STARTING_NUMBER_LABEL =
  'Starting number (days) — used until this type has its own history in this city';

/** Symmetric outlier cap — same |days| <= 730 filter the learner uses. */
export const BENCHMARK_OUTLIER_CAP_DAYS = 730;

/** What `bp_target_submit_benchmark.window_label` says (fix-680):
 *    learned  — median_days is the median of the n most recent submittals
 *    starting — no history; median_days is the Settings starting number
 *    none     — no history and no starting number
 *  `insufficient` is the pre-fix-680 label, read only while an old function
 *  is still deployed. */
export type BenchmarkWindowLabel =
  | 'learned'
  | 'starting'
  | 'none'
  | 'insufficient';

export interface BenchmarkSample {
  /** Permit id — the tie-break when two submittals share a date. */
  permitId: number;
  /** anchor → c0.submitted, in days, held days left out. May be negative. */
  days: number;
  /** ISO date used for ordering — c0.submitted, by spec. */
  recencyDate: string;
}

export interface TargetSubmitBenchmark {
  /** The number the engine uses: learned median, or the starting number.
   *  Null when there is neither. */
  medianDays: number | null;
  /** Submittals the median was taken over (<= 5); 0 for a starting number;
   *  null when there is no number. */
  n: number | null;
  minDays: number | null;
  maxDays: number | null;
  windowLabel: BenchmarkWindowLabel;
  /** Every submittal on record for the cohort. */
  totalSamples: number;
}

export { roundHalfAwayFromZero, medianDays };

/** The TS twin of bp_target_submit_benchmark (fix-680). */
export function computeTargetSubmitBenchmark(
  samples: BenchmarkSample[],
  startingDays: number | null | undefined,
): TargetSubmitBenchmark {
  const usable = samples.filter(
    (s) => Math.abs(s.days) <= BENCHMARK_OUTLIER_CAP_DAYS,
  );
  if (usable.length > 0) {
    const days = mostRecentSamples(usable, LEARNER_RECENT_COUNT).map(
      (s) => s.days,
    );
    return {
      medianDays: medianDays(days),
      n: days.length,
      minDays: Math.min(...days),
      maxDays: Math.max(...days),
      windowLabel: 'learned',
      totalSamples: usable.length,
    };
  }
  if (startingDays != null) {
    return {
      medianDays: startingDays,
      n: 0,
      minDays: null,
      maxDays: null,
      windowLabel: 'starting',
      totalSamples: 0,
    };
  }
  return {
    medianDays: null,
    n: null,
    minDays: null,
    maxDays: null,
    windowLabel: 'none',
    totalSamples: 0,
  };
}

// ---------------------------------------------------------------------------
// Projection flags (1e)
// ---------------------------------------------------------------------------

/** The BP milestones the derived anchors are built from. Null = the event has
 *  not been recorded yet, so anything hanging off it is a projection. */
export interface BpMilestones {
  /** BP cycle 0 intake_accepted. */
  c0Intake: string | null;
  /** BP cycle 1 resubmitted — the bp_c1_resub anchor. */
  c1Resub: string | null;
  /** BP actual_issue — the bp_actual_issue anchor. */
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

/** Whether a target_submit is a projection, given the type's ANCHOR and the
 *  project's BP milestone state. ★ fix-680: keyed by anchor, not by type name
 *  — the engine's `CASE v_permit.ts_anchor`. Anchors on a real recorded date
 *  (GO date, design end, created) are never projected; a permit that has
 *  actually been submitted is never projected either. */
export function isTargetSubmitProjected(
  anchor: TargetSubmitAnchor,
  flags: ProjectionFlags,
  hasOwnSubmitted = false,
): boolean {
  if (hasOwnSubmitted) return false;
  switch (anchor) {
    case 'bp_c0_intake':
      return flags.intakeProjected;
    case 'bp_c1_resub':
      return flags.c1Projected;
    case 'bp_actual_issue':
      return flags.issueProjected;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Which anchor label the UI prints next to the number ("GO+12d"). */
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
    case 'created':
      return 'created';
    case 'mirror_bp':
      return 'BP target';
    case 'none':
      return 'no anchor';
  }
}

/** ★ fix-615: what a type's target submit is measured FROM, in words — the
 *  per-type schedule table and the benchmark note both say it this way. */
export function anchorWords(anchor: TargetSubmitAnchor): string {
  switch (anchor) {
    case 'dd_end':
      return 'after design (DD) ends';
    case 'go_date':
      return 'after the GO date';
    case 'bp_c0_intake':
      return "after the Building Permit's intake";
    case 'bp_c1_resub':
      return "after the Building Permit's cycle-1 resubmit";
    case 'bp_actual_issue':
      return 'after the Building Permit issues';
    case 'created':
      return 'after the permit is added to the Bridge';
    case 'mirror_bp':
      return "uses the Building Permit's date";
    case 'none':
      return 'no anchor — no automatic target';
  }
}

export interface BenchmarkReadout {
  /** learned / starting / none — drives the tone and the tooltip. */
  tier: 'learned' | 'starting' | 'none';
  /** Ready-to-render summary, e.g. "learned: GO+12d (median of last 5)". */
  text: string;
}

/** ★ fix-680: say where the number behind the date came from. Pure
 *  formatting so it can be unit-tested without rendering. */
export function describeBenchmark(
  benchmark: TargetSubmitBenchmark,
  anchor: TargetSubmitAnchor,
): BenchmarkReadout {
  const label = anchorShortLabel(anchor);
  if (benchmark.medianDays == null) {
    return { tier: 'none', text: 'no history and no starting number' };
  }
  const signed =
    benchmark.medianDays < 0
      ? `${label}${benchmark.medianDays}d`
      : `${label}+${benchmark.medianDays}d`;
  if (benchmark.windowLabel === 'starting' || benchmark.n === 0) {
    return {
      tier: 'starting',
      text: `starting number: ${signed} (no history in this city yet)`,
    };
  }
  const n = benchmark.n ?? 0;
  return {
    tier: 'learned',
    text:
      n === 1
        ? `learned: ${signed} (our 1 submittal)`
        : `learned: ${signed} (median of last ${n})`,
  };
}

export type { TargetSubmitAnchor };
