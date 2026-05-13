import {
  SCHEDULE_DEFAULTS,
  type LearnedEstimate,
} from './scheduleBenchmarks';
import type { Permit, PermitCycle } from './database.types';

// Q9.5.f-fix-10: smart projected-approval estimator. Walks the cycle
// structure forward using learned (type, juris) benchmarks per v1's
// renderDrawSchedule projApproval at index.html:8068-8092. Returns the
// real approval/issue date when known (short-circuit), the projected
// walk-forward date when in progress, or null when there's no anchor.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Add `days` calendar days to a YYYY-MM-DD string. Anchors to local noon
 *  to avoid timezone drift, then re-serializes to ISO date. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ProjectedApprovalInput {
  permit: Permit;
  /** Cycles for THIS permit. Caller should filter cycle_index=0 if any and
   *  sort ascending — the algorithm assumes cycles[i].cycle_index === i+1. */
  cycles: PermitCycle[];
  /** Learned (type, juris) baseline. May be null if no historical data —
   *  algorithm falls back to SCHEDULE_DEFAULTS. */
  learnedEstimate: LearnedEstimate | null;
}

export interface ProjectedApprovalResult {
  /** YYYY-MM-DD projection, or null when no anchor is available. */
  projection: string | null;
  /** True when sourced from actual_issue / approval_date — i.e., this is
   *  a real date, not a forecast. */
  isActual: boolean;
  /** True when walked forward from cycle data. False when isActual is
   *  true, or when no anchor → projection: null. */
  isProjected: boolean;
}

/** Pick the first defined day-count, falling back through the chain. */
function dayOrDefault(
  learned: number | null | undefined,
  fallback: number,
): number {
  return learned ?? fallback;
}

export function computeProjectedApproval(
  input: ProjectedApprovalInput,
): ProjectedApprovalResult {
  const { permit, cycles, learnedEstimate } = input;

  // Short-circuit: known outcomes win over estimates.
  if (permit.actual_issue) {
    return {
      projection: permit.actual_issue,
      isActual: true,
      isProjected: false,
    };
  }
  if (permit.approval_date) {
    return {
      projection: permit.approval_date,
      isActual: true,
      isProjected: false,
    };
  }

  // Anchor: first cycle's submitted (the actual filing date), falling back
  // to the team's planned target, then GO date. v1 also folds in
  // entry.endWeek + 14 days as a draw-schedule-aware estimate; v2 doesn't
  // have that handle here, so we drop straight to permit-level fields.
  const c1 = cycles.find((c) => c.cycle_index === 1) ?? null;
  const anchor =
    c1?.submitted ?? permit.target_submit ?? permit.go_date ?? null;
  if (!anchor) {
    return { projection: null, isActual: false, isProjected: false };
  }

  // Day counts — learned values when present, hardcoded SCHEDULE_DEFAULTS
  // when not. Cycle 3+ falls back to cycle 2's benchmarks (mirrors v1
  // :8088-8089 where cy3 uses cityReview2/corrResponse2).
  const cr1 = dayOrDefault(
    learnedEstimate?.cityReview1,
    SCHEDULE_DEFAULTS.cityReview1,
  );
  const co1 = dayOrDefault(
    learnedEstimate?.corrResponse1,
    SCHEDULE_DEFAULTS.corrResponse1,
  );
  const cr2 = dayOrDefault(
    learnedEstimate?.cityReview2,
    SCHEDULE_DEFAULTS.cityReview2,
  );
  const co2 = dayOrDefault(
    learnedEstimate?.corrResponse2,
    SCHEDULE_DEFAULTS.corrResponse2,
  );

  // How many review cycles a typical permit walks through. Round
  // learnedEstimate.avgCycles to the nearest int; default 2 when no
  // learned data.
  const nCycles = Math.max(
    1,
    Math.min(
      4,
      learnedEstimate?.avgCycles != null
        ? Math.round(learnedEstimate.avgCycles)
        : 2,
    ),
  );

  // Walk forward. For each cycle, advance the cursor to the cycle's
  // corr_issued (real data) or anchor+cityReview (learned estimate), then
  // to its resubmitted (real) or +corrResponse (learned).
  let cursor = anchor;

  // Cycle 1
  const cyc1 = c1;
  const cr1End = cyc1?.corr_issued ?? addDays(cursor, cr1);
  cursor = cyc1?.resubmitted ?? addDays(cr1End, co1);

  if (nCycles >= 2) {
    const cyc2 = cycles.find((c) => c.cycle_index === 2) ?? null;
    const cr2End = cyc2?.corr_issued ?? addDays(cursor, cr2);
    cursor = cyc2?.resubmitted ?? addDays(cr2End, co2);
  }
  if (nCycles >= 3) {
    const cyc3 = cycles.find((c) => c.cycle_index === 3) ?? null;
    const cr3End = cyc3?.corr_issued ?? addDays(cursor, cr2);
    cursor = cyc3?.resubmitted ?? addDays(cr3End, co2);
  }
  if (nCycles >= 4) {
    const cyc4 = cycles.find((c) => c.cycle_index === 4) ?? null;
    const cr4End = cyc4?.corr_issued ?? addDays(cursor, cr2);
    cursor = cyc4?.resubmitted ?? addDays(cr4End, co2);
  }

  // Final issuance buffer: city takes ~7 days after the last resubmittal
  // to issue the approval. Matches v1 :8091.
  void DAY_MS;
  const projection = addDays(cursor, 7);
  return { projection, isActual: false, isProjected: true };
}
