import {
  DEFAULT_AVG_SUBMIT_TO_ISSUE,
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

/** fix-24e: today as an ISO date string in local tz. Pinned by
 *  vi.useFakeTimers in unit tests via setSystemTime. */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** fix-24e: when an anchor used to project a FUTURE event is itself in
 *  the past, return today instead. Keeps downstream projections
 *  forward-looking (est_approval doesn't drift behind reality just
 *  because city_target / target_submit / cycle dates were set months
 *  ago). Returns null for null/empty input — callers can `?? anchor`
 *  to fall back when they want to display the unfloored value.
 *  Lexical ISO compare works because all anchors are YYYY-MM-DD. */
function flooredAnchor(anchor: string | null | undefined): string | null {
  if (!anchor) return null;
  const today = todayISO();
  return anchor < today ? today : anchor;
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
  /** fix-22 Migration 3: go_date moved permits → projects. Caller passes
   *  the project's go_date so the projection's fallback anchor chain
   *  still works (was previously sourced from permit.go_date). Null/
   *  undefined when the project has no GO date set. */
  projectGoDate?: string | null;
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
  /** fix-22 Mig 3: the BP and ULS share a project, so caller passes the
   *  project's go_date once and we thread it into the BP's recursive call. */
  bpProjectGoDate?: string | null,
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

  // fix-24e: every anchor consumed in an addDays call here is a forecast
  // input — floor at today so past anchors don't drag the projection back.
  // Direct-display values (corrCycle.resubmitted as-is) keep their actual
  // value since we don't transform them.
  let cy1Resub: string;
  if (corrCycle?.resubmitted) {
    cy1Resub = corrCycle.resubmitted;
  } else if (corrCycle?.corr_issued) {
    cy1Resub = addDays(
      flooredAnchor(corrCycle.corr_issued) ?? corrCycle.corr_issued,
      bpCorrResponse1,
    );
  } else if (corrCycle?.city_target) {
    cy1Resub = addDays(
      flooredAnchor(corrCycle.city_target) ?? corrCycle.city_target,
      bpCorrResponse1,
    );
  } else {
    const cy1CorrEnd = addDays(flooredAnchor(sub) ?? sub, bpCityReview1);
    cy1Resub = addDays(
      flooredAnchor(cy1CorrEnd) ?? cy1CorrEnd,
      bpCorrResponse1,
    );
  }

  const ulsTargetSubmit = addDays(
    flooredAnchor(cy1Resub) ?? cy1Resub,
    ULS_TARGET_SUBMIT_BUFFER,
  );
  // Q9.5.f-fix-18 B: prefer the BP's LIVE projection over the stored
  // expected_issue column. The stored column is a snapshot from when the
  // user last saved it (or what the scraper imported); the live projection
  // updates as cycle data changes. Real outcomes (actual_issue / approval_date)
  // still short-circuit because those are facts. The stored expected_issue
  // is only used as a last-ditch fallback when the live projection fails.
  let bpIssueAnchor = '';
  if (bp.actual_issue) {
    bpIssueAnchor = bp.actual_issue;
  } else if (bp.approval_date) {
    bpIssueAnchor = bp.approval_date;
  } else {
    const bpExtras = (bp.extras ?? {}) as Record<string, unknown>;
    const rawBpOv = bpExtras.scheduleCycleOverride;
    const bpOverride =
      typeof rawBpOv === 'number' && rawBpOv >= 1 && rawBpOv <= 8
        ? rawBpOv
        : null;
    // Recursive call — the BP is type 'Building Permit', not 'ULS', so the
    // ULS branch inside computeProjectedApproval will not fire. No infinite
    // loop possible. Siblings intentionally omitted (BP doesn't recurse).
    const bpProjection = computeProjectedApproval({
      permit: bp,
      cycles: bpCycles,
      learnedEstimate: bpLearned,
      // The BP and the ULS share a project, so they share go_date too.
      projectGoDate: bpProjectGoDate,
      targetCycleOverride: bpOverride,
    });
    bpIssueAnchor =
      bpProjection.projection ?? bp.expected_issue ?? '';
  }
  if (!bpIssueAnchor) {
    bpIssueAnchor = addDays(
      flooredAnchor(cy1Resub) ?? cy1Resub,
      bpCityReview2 + FINAL_APPROVAL_BUFFER,
    );
  }
  const estApproval = addDays(
    flooredAnchor(bpIssueAnchor) ?? bpIssueAnchor,
    ULS_BP_LAG_DAYS,
  );
  return { targetSubmit: ulsTargetSubmit, estApproval, bpIssueAnchor, cy1Resub };
}

export function computeProjectedApproval(
  input: ProjectedApprovalInput,
): ProjectedApprovalResult {
  const { permit, cycles, learnedEstimate, projectGoDate } = input;

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
      projectGoDate,
    );
    if (anchors?.estApproval) {
      let proj = anchors.estApproval;
      const ulsBase =
        cycles.find((c) => c.cycle_index === 1)?.submitted ??
        permit.target_submit ??
        anchors.targetSubmit ??
        projectGoDate ??
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
          // fix-24e: floor each step's anchor so a past cursor produces a
          // future corrEnd, and past corrEnd produces a future resub.
          const corrEnd = addDays(flooredAnchor(cursor) ?? cursor, cr);
          const resub = addDays(flooredAnchor(corrEnd) ?? corrEnd, co);
          lastProj = resub;
          cursor = resub;
        }
        if (lastProj && proj <= lastProj) {
          proj = addDays(
            flooredAnchor(lastProj) ?? lastProj,
            FINAL_APPROVAL_BUFFER,
          );
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
  const base = r1?.submitted ?? permit.target_submit ?? projectGoDate ?? null;
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

  // Holistic shortcut (v1 :4442-4446 + fix-24h).
  //
  // Original v1 rule: when we expect approval in the first review with no
  // corrections AND we have a juris-wide submit-to-issue average, trust
  // the average instead of the per-cycle walk.
  //
  // fix-24h extends the "value source" so the same branch can fire even
  // when the learner is silent — IF the permit has no cycle activity at
  // all, fall back to DEFAULT_AVG_SUBMIT_TO_ISSUE (210d). This stops
  // brand-new permits in new (type, juris) combos from defaulting to the
  // optimistic targetCycle=1 path (today + 28d) when the user expects
  // multi-cycle math.
  //
  // The fallback ONLY fires when !hasAnyCycleActivity. Any populated
  // cycle field (submitted / city_target / corr_issued / resubmitted /
  // intake_accepted) means the user has real data to project from, and
  // the cycle walk below takes over.
  const hasAnyCycleActivity = cycles.some(
    (c) =>
      c.submitted ||
      c.city_target ||
      c.corr_issued ||
      c.resubmitted ||
      c.intake_accepted,
  );
  const effectiveAvg: number | null =
    learnedEstimate?.avgSubmitToIssue &&
    learnedEstimate.avgSubmitToIssue > 0
      ? Math.round(learnedEstimate.avgSubmitToIssue)
      : !hasAnyCycleActivity
        ? DEFAULT_AVG_SUBMIT_TO_ISSUE
        : null;
  if (effectiveAvg !== null && actualCorrCycles === 0) {
    // fix-24e: floor base so a past submitted/target_submit still produces a
    // future-looking holistic projection.
    const holistic = addDays(flooredAnchor(base) ?? base, effectiveAvg);
    const projection =
      lastRealDate && holistic < lastRealDate
        ? addDays(
            flooredAnchor(lastRealDate) ?? lastRealDate,
            FINAL_APPROVAL_BUFFER,
          )
        : holistic;
    return {
      projection,
      isActual: false,
      isProjected: true,
      targetCycle: 1,
      rounds: {},
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
    // fix-24e: floor base so projection is forward-looking even when base
    // is months in the past.
    const baseAnchor = flooredAnchor(base) ?? base;
    if (learnedEstimate?.avgSubmitToIssue && learnedEstimate.avgSubmitToIssue > 0) {
      cursor = addDays(baseAnchor, Math.round(learnedEstimate.avgSubmitToIssue));
    } else {
      const cr1Days = durFor(0, 'cr', learnedEstimate, thisPermitDur);
      cursor = addDays(baseAnchor, cr1Days + FINAL_APPROVAL_BUFFER);
    }
  } else {
    const cycleRows = [r1, r2, r3, r4];
    // Q9.5.f-fix-18 C: v1 :4530 cityTarget shortcut for cycle 1 only.
    // If cycle 1 has no actual corr_issued but ANY cycle has a city_target
    // date after `cursor`, use the earliest such date as that round's
    // crEnd. Mirrors v1's projection more closely (accounts for the team
    // entering a city-target date as a city-supplied corrections deadline).
    const earliestCityTargetAfterCursor = cycles
      .map((c) => c.city_target ?? '')
      .filter((t) => t && t > cursor)
      .sort()[0] ?? '';
    for (let i = 0; i < targetCycle - 1; i++) {
      const rd = cycleRows[i];
      const crDays = durFor(i, 'cr', learnedEstimate, thisPermitDur);
      const coDays = durFor(i, 'co', learnedEstimate, thisPermitDur);
      const cityTargetCrEnd =
        i === 0 && !rd?.corr_issued && earliestCityTargetAfterCursor
          ? earliestCityTargetAfterCursor
          : null;
      // fix-24e: rd?.corr_issued / rd?.resubmitted are ACTUAL dates and
      // display as-is even when past. The forecast branches (cityTargetCrEnd
      // assigned directly, addDays projections) and the chained resubEnd
      // anchor floor at today so past anchors don't yield past forecasts.
      const crEnd =
        rd?.corr_issued ??
        flooredAnchor(cityTargetCrEnd) ??
        addDays(flooredAnchor(cursor) ?? cursor, crDays);
      const resubEnd =
        rd?.resubmitted ??
        addDays(flooredAnchor(crEnd) ?? crEnd, coDays);
      rounds[`corrIssued${i + 1}` as keyof ProjectedApprovalRounds] = crEnd;
      rounds[`resubmitted${i + 1}` as keyof ProjectedApprovalRounds] = resubEnd;
      cursor = resubEnd;
    }
    cursor = addDays(flooredAnchor(cursor) ?? cursor, FINAL_APPROVAL_BUFFER);
  }

  let projection = cursor;
  // v1 :4541 floor — never project earlier than the last real date on file.
  // fix-24e: the +buffer also floors lastRealDate at today so the final
  // projection stays forward-looking when lastRealDate itself is past.
  if (lastRealDate && projection < lastRealDate) {
    projection = addDays(
      flooredAnchor(lastRealDate) ?? lastRealDate,
      FINAL_APPROVAL_BUFFER,
    );
  }
  return {
    projection,
    isActual: false,
    isProjected: true,
    targetCycle,
    rounds,
  };
}
