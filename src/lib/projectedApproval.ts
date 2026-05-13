import {
  SCHEDULE_DEFAULTS,
  type LearnedEstimate,
} from './scheduleBenchmarks';
import type { Permit, PermitCycle } from './database.types';

// Q9.5.f-fix-11: full port of v1's projectPermitApproval + getULSAnchorDates
// (index.html:4308-4543). Adds three pieces that fix-10 missed:
//   1. ULS short-circuit — anchors to sibling BP's expected_issue + 120d
//   2. Holistic shortcut — when targetCycle=1 + no corrections + learned
//      avgSubmitToIssue exists, use that instead of the per-cycle walk
//   3. Smart per-cycle durations — blend this permit's actuals with the
//      learned juris-wide data (durFor walks back to find any signal)
// Also returns per-round projected dates so the Schedule Estimator widget
// can render the exact same numbers the headline projection used.

const ULS_BP_LAG_DAYS = 120;
const FINAL_APPROVAL_BUFFER = 7;
const ULS_TARGET_SUBMIT_BUFFER = 14;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** v1 :4455-4459: days between two ISO dates (b - a). Returns null when
 *  either is missing OR when the delta is non-positive (filters out
 *  same-day or backward sequences which usually mean bad data). */
function positiveDaysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (!a || !b) return null;
  const aMs = new Date(`${a}T12:00:00`).getTime();
  const bMs = new Date(`${b}T12:00:00`).getTime();
  const diff = Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
  return diff > 0 ? diff : null;
}

export interface ProjectedApprovalInput {
  permit: Permit;
  /** This permit's cycles, filtered for cycle_index !== 0 and sorted asc. */
  cycles: PermitCycle[];
  learnedEstimate: LearnedEstimate | null;
  /** Q9.5.f-fix-11 A: needed for the ULS BP-anchor lookup. Caller passes
   *  every permit at the same project; this code finds the Building Permit
   *  and walks ITS cycles for the anchor math. */
  siblingPermits?: Permit[];
  siblingCyclesByPermitId?: Map<number, PermitCycle[]>;
  /** Optional per-permit learned data for the sibling BP — drives the
   *  ULS anchor math. When null/missing, BP-anchor walk uses defaults. */
  siblingLearnedByPermitId?: Map<number, LearnedEstimate | null>;
  /** Q9.5.f-fix-16 B: user-supplied target cycle override. Replaces the
   *  learner's `mostLikelyCycle` pick. Floored at currentReviewCycle (can't
   *  target a round earlier than what's already happened) and clamped 1–4.
   *  When set, the holistic shortcut still applies if the resolved target
   *  is 1 + no actual corrections. */
  targetCycleOverride?: number | null;
}

export interface ProjectedApprovalRounds {
  corrIssued1?: string;
  resubmitted1?: string;
  corrIssued2?: string;
  resubmitted2?: string;
  corrIssued3?: string;
  resubmitted3?: string;
  corrIssued4?: string;
  resubmitted4?: string;
  corrIssued5?: string;
  resubmitted5?: string;
  corrIssued6?: string;
  resubmitted6?: string;
  corrIssued7?: string;
  resubmitted7?: string;
  corrIssued8?: string;
  resubmitted8?: string;
}

export interface ProjectedApprovalResult {
  projection: string | null;
  isActual: boolean;
  isProjected: boolean;
  /** Number of cycles the walk targeted. 1 = first-review approval; 2 =
   *  one correction round; etc. 0 for ULS (uses BP anchor directly). */
  targetCycle?: number;
  /** Per-round projected dates so the widget can render them inline. */
  rounds?: ProjectedApprovalRounds;
  /** ULS-specific anchor data (rendered in the widget when the permit is ULS). */
  ulsAnchors?: {
    bpIssueAnchor: string;
    cy1Resub: string;
    targetSubmit: string;
    estApproval: string;
  };
}

/** v1 :4474-4506 durFor: smart per-cycle duration lookup. Blends THIS
 *  permit's actuals (when complete data exists for that round) with the
 *  juris-wide learned average. Falls back through earlier cycles, then
 *  decomposes avgSubmitToIssue, then to hardcoded defaults. */
function durFor(
  cycleIdx: number,
  kind: 'cr' | 'co',
  learned: LearnedEstimate | null,
  thisPermitDur: ({ cr: number | null; co: number | null } | null)[],
): number {
  const defaultVal =
    kind === 'cr'
      ? cycleIdx === 0
        ? SCHEDULE_DEFAULTS.cityReview1
        : cycleIdx === 1
          ? SCHEDULE_DEFAULTS.cityReview2
          : SCHEDULE_DEFAULTS.cityReview3
      : cycleIdx === 0
        ? SCHEDULE_DEFAULTS.corrResponse1
        : cycleIdx === 1
          ? SCHEDULE_DEFAULTS.corrResponse2
          : SCHEDULE_DEFAULTS.corrResponse3;

  function jurisVal(ci: number): number | null {
    if (!learned) return null;
    const cIdx1 = ci + 1;
    const countKey = `${kind}${cIdx1}Count` as
      | 'cr1Count'
      | 'cr2Count'
      | 'cr3Count'
      | 'cr4Count'
      | 'co1Count'
      | 'co2Count'
      | 'co3Count'
      | 'co4Count';
    const valueKey =
      kind === 'cr'
        ? (`cityReview${cIdx1}` as 'cityReview1' | 'cityReview2' | 'cityReview3' | 'cityReview4')
        : (`corrResponse${cIdx1}` as 'corrResponse1' | 'corrResponse2' | 'corrResponse3' | 'corrResponse4');
    return (learned[countKey] ?? 0) > 0 ? (learned[valueKey] ?? null) : null;
  }
  function selfVal(ci: number): number | null {
    if (ci < 0 || ci >= thisPermitDur.length) return null;
    const d = thisPermitDur[ci];
    return d ? d[kind] : null;
  }
  // Walk backwards: prefer per-cycle data at the target index; fall back
  // to earlier cycles when this one has no signal.
  for (let ci = cycleIdx; ci >= 0; ci--) {
    const jv = jurisVal(ci);
    const sv = selfVal(ci);
    if (jv != null && sv != null) return Math.round((jv + sv) / 2);
    if (jv != null) return jv;
    if (sv != null) return sv;
  }
  // Holistic decomposition (v1 :4501-4504): when no per-cycle signal
  // exists at all, derive from avgSubmitToIssue using a 70/30 split.
  if (learned?.avgSubmitToIssue && learned.avgSubmitToIssue > 0) {
    const s2i = learned.avgSubmitToIssue;
    return kind === 'cr'
      ? Math.max(7, Math.round(s2i * 0.7))
      : Math.max(5, Math.round(s2i * 0.3));
  }
  return defaultVal;
}

/** v1 :4308-4358 getULSAnchorDates — projects ULS target submit + approval
 *  from sibling BP at the same project. Returns null when no BP exists. */
function getULSAnchorDates(
  permit: Permit,
  siblingPermits: Permit[],
  siblingCyclesByPermitId: Map<number, PermitCycle[]>,
  siblingLearnedByPermitId: Map<number, LearnedEstimate | null>,
): { targetSubmit: string; estApproval: string; bpIssueAnchor: string; cy1Resub: string } | null {
  const bp = siblingPermits.find(
    (p) => p.project_id === permit.project_id && p.type === 'Building Permit',
  );
  if (!bp) return null;
  const bpCycles = (siblingCyclesByPermitId.get(bp.id) ?? [])
    .filter((c) => c.cycle_index !== 0)
    .sort((a, b) => a.cycle_index - b.cycle_index);
  const bpLearned = siblingLearnedByPermitId.get(bp.id) ?? null;
  const bpCy1 = bpCycles.find((c) => c.cycle_index === 1) ?? null;
  const sub = bpCy1?.submitted ?? bp.target_submit ?? null;
  if (!sub) return null;

  // Find first BP review cycle with any corrections signal (cy1 onward).
  const corrCycle =
    bpCycles.find((c) => c.corr_issued || c.city_target || c.resubmitted) ?? null;

  const bpCorrResponse1 =
    bpLearned?.corrResponse1 ?? SCHEDULE_DEFAULTS.corrResponse1;
  const bpCityReview1 =
    bpLearned?.cityReview1 ?? SCHEDULE_DEFAULTS.cityReview1;
  const bpCityReview2 =
    bpLearned?.cityReview2 ?? SCHEDULE_DEFAULTS.cityReview2;

  let cy1Resub: string;
  if (corrCycle?.resubmitted) {
    cy1Resub = corrCycle.resubmitted;
  } else if (corrCycle?.corr_issued) {
    cy1Resub = addDays(corrCycle.corr_issued, bpCorrResponse1);
  } else if (corrCycle?.city_target) {
    cy1Resub = addDays(corrCycle.city_target, bpCorrResponse1);
  } else {
    const cy1CorrEnd = addDays(sub, bpCityReview1);
    cy1Resub = addDays(cy1CorrEnd, bpCorrResponse1);
  }

  const ulsTargetSubmit = addDays(cy1Resub, ULS_TARGET_SUBMIT_BUFFER);
  let bpIssueAnchor = bp.expected_issue ?? bp.actual_issue ?? bp.approval_date ?? '';
  if (!bpIssueAnchor) {
    bpIssueAnchor = addDays(cy1Resub, bpCityReview2 + FINAL_APPROVAL_BUFFER);
  }
  const estApproval = addDays(bpIssueAnchor, ULS_BP_LAG_DAYS);
  return { targetSubmit: ulsTargetSubmit, estApproval, bpIssueAnchor, cy1Resub };
}

export function computeProjectedApproval(
  input: ProjectedApprovalInput,
): ProjectedApprovalResult {
  const { permit, cycles, learnedEstimate } = input;

  // Real outcomes short-circuit.
  if (permit.actual_issue) {
    return { projection: permit.actual_issue, isActual: true, isProjected: false };
  }
  if (permit.approval_date) {
    return { projection: permit.approval_date, isActual: true, isProjected: false };
  }

  // Q9.5.f-fix-11 A: ULS branch. Anchors to sibling BP's projected
  // approval + 120 days. Sanity floor: if this ULS's own cycle walk would
  // project later, use that + 7 to avoid optimistic-by-formula dates.
  if (permit.type === 'ULS' && input.siblingPermits && input.siblingCyclesByPermitId) {
    const anchors = getULSAnchorDates(
      permit,
      input.siblingPermits,
      input.siblingCyclesByPermitId,
      input.siblingLearnedByPermitId ?? new Map(),
    );
    if (anchors?.estApproval) {
      let proj = anchors.estApproval;
      const ulsBase =
        cycles.find((c) => c.cycle_index === 1)?.submitted ??
        permit.target_submit ??
        anchors.targetSubmit ??
        permit.go_date ??
        '';
      if (ulsBase) {
        const ulsCycles = Math.max(
          1,
          Math.min(
            3,
            learnedEstimate?.avgCycles != null
              ? Math.ceil(learnedEstimate.avgCycles)
              : 2,
          ),
        );
        const thisPermitDur: ({ cr: number | null; co: number | null } | null)[] =
          [null, null, null, null];
        let cursor = ulsBase;
        let lastProj = '';
        for (let i = 0; i < ulsCycles; i++) {
          const cr = durFor(i, 'cr', learnedEstimate, thisPermitDur);
          const co = durFor(i, 'co', learnedEstimate, thisPermitDur);
          const corrEnd = addDays(cursor, cr);
          const resub = addDays(corrEnd, co);
          lastProj = resub;
          cursor = resub;
        }
        if (lastProj && proj <= lastProj) {
          proj = addDays(lastProj, FINAL_APPROVAL_BUFFER);
        }
      }
      return {
        projection: proj,
        isActual: false,
        isProjected: true,
        targetCycle: 0,
        ulsAnchors: anchors,
      };
    }
    // No BP sibling → fall through to the non-ULS walk below.
  }

  // Non-ULS branch (v1 :4394-4542).
  const r1 = cycles.find((c) => c.cycle_index === 1) ?? null;
  const r2 = cycles.find((c) => c.cycle_index === 2) ?? null;
  const r3 = cycles.find((c) => c.cycle_index === 3) ?? null;
  const r4 = cycles.find((c) => c.cycle_index === 4) ?? null;
  const base = r1?.submitted ?? permit.target_submit ?? permit.go_date ?? null;
  if (!base) {
    return { projection: null, isActual: false, isProjected: false };
  }

  const actualCorrCycles = [r1, r2, r3, r4].filter((c) => c?.corr_issued).length;
  const lastRealDate = [
    r1?.submitted,
    r1?.corr_issued,
    r1?.resubmitted,
    r2?.corr_issued,
    r2?.resubmitted,
    r3?.corr_issued,
    r3?.resubmitted,
    r4?.corr_issued,
    r4?.resubmitted,
  ]
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop() ?? '';

  // Target cycle selection (v1 :4429-4438). Use learned.mostLikelyCycle
  // when available, but never target a cycle EARLIER than what's already
  // happened on this permit (currentReviewCycle).
  const currentReviewCycle = Math.max(1, actualCorrCycles + 1);
  let targetCycle: number;
  if (typeof input.targetCycleOverride === 'number') {
    targetCycle = Math.max(currentReviewCycle, input.targetCycleOverride);
  } else if (learnedEstimate && typeof learnedEstimate.mostLikelyCycle === 'number') {
    targetCycle = Math.max(currentReviewCycle, learnedEstimate.mostLikelyCycle);
  } else {
    targetCycle = currentReviewCycle;
  }
  // Q9.5.f-fix-17.5 B: ceiling lifted from 4 → 8 for edge cases (complex
  // permits that hit 5+ correction rounds). The learner's mostLikelyCycle
  // still caps at 4 (real-world historical max); the manual override is
  // the only path to 5–8. durFor's walk-back handles missing data at
  // those depths gracefully (falls back to earlier-cycle signal or
  // default).
  targetCycle = Math.max(1, Math.min(targetCycle, 8));

  // Holistic shortcut (v1 :4442-4446). When we expect approval in the
  // first review with no corrections AND we have a juris-wide
  // submit-to-issue average, trust it instead of the per-cycle walk.
  if (
    targetCycle === 1 &&
    actualCorrCycles === 0 &&
    learnedEstimate?.avgSubmitToIssue &&
    learnedEstimate.avgSubmitToIssue > 0
  ) {
    const holistic = addDays(base, Math.round(learnedEstimate.avgSubmitToIssue));
    const projection =
      lastRealDate && holistic < lastRealDate
        ? addDays(lastRealDate, FINAL_APPROVAL_BUFFER)
        : holistic;
    return {
      projection,
      isActual: false,
      isProjected: true,
      targetCycle: 1,
    };
  }

  // Per-permit actual durations.
  const thisPermitDur: ({ cr: number | null; co: number | null } | null)[] = [
    { cr: positiveDaysBetween(r1?.submitted, r1?.corr_issued), co: positiveDaysBetween(r1?.corr_issued, r1?.resubmitted) },
    { cr: positiveDaysBetween(r1?.resubmitted, r2?.corr_issued), co: positiveDaysBetween(r2?.corr_issued, r2?.resubmitted) },
    { cr: positiveDaysBetween(r2?.resubmitted, r3?.corr_issued), co: positiveDaysBetween(r3?.corr_issued, r3?.resubmitted) },
    { cr: positiveDaysBetween(r3?.resubmitted, r4?.corr_issued), co: positiveDaysBetween(r4?.corr_issued, r4?.resubmitted) },
  ];

  // Cycle-by-cycle walk.
  const rounds: ProjectedApprovalRounds = {};
  let cursor = base;
  if (targetCycle === 1) {
    // Approving in first review without corrections. v1 :4515-4523:
    // prefer avgSubmitToIssue, else cityReview1 + 7-day approval buffer.
    if (learnedEstimate?.avgSubmitToIssue && learnedEstimate.avgSubmitToIssue > 0) {
      cursor = addDays(base, Math.round(learnedEstimate.avgSubmitToIssue));
    } else {
      const cr1Days = durFor(0, 'cr', learnedEstimate, thisPermitDur);
      cursor = addDays(base, cr1Days + FINAL_APPROVAL_BUFFER);
    }
  } else {
    const cycleRows = [r1, r2, r3, r4];
    for (let i = 0; i < targetCycle - 1; i++) {
      const rd = cycleRows[i];
      const crDays = durFor(i, 'cr', learnedEstimate, thisPermitDur);
      const coDays = durFor(i, 'co', learnedEstimate, thisPermitDur);
      const crEnd = rd?.corr_issued ?? addDays(cursor, crDays);
      const resubEnd = rd?.resubmitted ?? addDays(crEnd, coDays);
      rounds[`corrIssued${i + 1}` as keyof ProjectedApprovalRounds] = crEnd;
      rounds[`resubmitted${i + 1}` as keyof ProjectedApprovalRounds] = resubEnd;
      cursor = resubEnd;
    }
    cursor = addDays(cursor, FINAL_APPROVAL_BUFFER);
  }

  let projection = cursor;
  // v1 :4541 floor — never project earlier than the last real date on file.
  if (lastRealDate && projection < lastRealDate) {
    projection = addDays(lastRealDate, FINAL_APPROVAL_BUFFER);
  }
  return {
    projection,
    isActual: false,
    isProjected: true,
    targetCycle,
    rounds,
  };
}
