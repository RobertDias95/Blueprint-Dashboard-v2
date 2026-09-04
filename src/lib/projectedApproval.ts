import {
  cityReview1Start,
  defaultDaysForType,
  SCHEDULE_DEFAULTS,
  type LearnedEstimate,
  type RecencyTier,
} from './scheduleBenchmarks';
import type {
  Permit,
  PermitCycle,
  PermitCycleReviewer,
  ProjectHold,
} from './database.types';
import { activeHoldElapsedDays, type HoldWindow } from './holdOverlap';

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
  /** fix-53: cycle 0's intake_accepted (the design/intake cycle is filtered
   *  out of `cycles` before this fn, so it's threaded in separately). Used to
   *  anchor cycle-1 city review at intake — matching the learner's
   *  cityReview1Start — so the projection's decomposition lines up with the
   *  intake-anchored learned clock. When null (no intake recorded yet) the
   *  projection falls back to cycle-1 submitted exactly as before. */
  cycle0IntakeAccepted?: string | null;
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
   *  target a round earlier than what's already happened) and clamped 1–8.
   *
   *  ★★★ fix-493 (P-152): **SETTING THIS ALWAYS PRODUCES A ROUND-BY-ROUND
   *  WALK.** The holistic shortcut is skipped outright when it is a number.
   *
   *  ★★ THE OLD SENTENCE HERE WAS WRONG, not merely stale: it claimed *"the
   *  holistic shortcut still applies if the resolved target is 1 + no actual
   *  corrections"*, and the gate never looked at the resolved target — or at
   *  this field at all. The override was stored and ignored on every permit
   *  without corrections. Recorded rather than quietly deleted, because a
   *  comment that describes a check nobody wrote is how the bug survived. */
  targetCycleOverride?: number | null;
  /** fix-25-feat-Z: tenant-scoped per-type default overrides. When the
   *  learner is silent and the holistic fallback fires, prefer this map
   *  over the hardcoded PER_TYPE_DEFAULT_DAYS table. Map<type, intake_to_approval_days>. */
  typeDefaultsOverride?: Map<string, number>;
  /** fix-32: per-reviewer state for THIS permit (cycle 1+; cycle 0
   *  rows are ignored). When any reviewer on the permit's LATEST cycle
   *  has current_status === 'corrections_required' AND no newer cycle
   *  row exists, the projection bumps targetCycle by one to account
   *  for the not-yet-issued correction round the reviewer is signaling.
   *  Caller passes the slice for this permit from
   *  useAllPermitCycleReviewers; leave undefined when reviewer data
   *  isn't available (the projection falls back to the pre-fix-32
   *  cycle-walk behavior unchanged). */
  permitReviewers?: PermitCycleReviewer[];
  /** fix-262 (fix-170 effect C, completed): the PROJECT's holds. An actively-held
   *  project's clock is paused, so a PROJECTED approval date is pushed out by the
   *  days already parked under the open hold (activeHoldElapsedDays). A CLOSED
   *  hold does not shift a future date — its days already elapsed and are credited
   *  on the measured side by accountableDays, so shifting here would double-count.
   *  An ACTUAL date (approval_date / actual_issue) is never shifted: the event
   *  happened. Omitted / no holds → shift is 0 and every projection is byte-
   *  identical to pre-fix-262 behaviour.
   *
   *  fix-171 wired this arithmetic through every other duration module but never
   *  through this one; the shift lived only in ScheduleEstimator's presentation
   *  layer, so the draw-schedule block date and Schedule Health's date ignored
   *  holds entirely. It now lives here, once, for every caller. */
  holds?:
    | ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>
    | ReadonlyArray<HoldWindow>
    | null;
  /** Injected "today" for deterministic tests; forwarded to activeHoldElapsedDays. */
  today?: Date | string;
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

/**
 * ★★★ fix-491 (P-117) — WHICH BRANCH PRODUCED THE DATE.
 *
 * Bobby, on `554 N 75th St`: *"I don't see how our historical permit data shows
 * we're going to get through without any corrections."* He was right about the
 * SENTENCE and the date was right too — the widget was reading
 * `targetCycle === 1` as "approved in the first review", when on the holistic
 * branch that 1 is a CODE-PATH MARKER, not a prediction. The projection there
 * is `intake + avgIntakeToApproval`, an average that already contains every
 * correction round those historical permits went through.
 *
 * ★★ SO THE RESULT NOW SAYS WHICH ROUTE IT TOOK, and the copy reads that
 *    instead of inferring it from a number that means something else. Nothing
 *    about the maths moves — this is a label on a road already taken.
 */
export type ProjectedApprovalRoute =
  /** Holistic average from the learner: `intake + avgIntakeToApproval`. */
  | 'holistic_learned'
  /** Holistic average from `defaultDaysForType` — no learner for this cohort. */
  | 'holistic_default'
  /** Round-by-round walk, target cycle from `learnedEstimate.mostLikelyCycle`. */
  | 'walk_learned'
  /** Round-by-round walk with no learner — default durations. */
  | 'walk_default'
  /** Round-by-round walk, target cycle set by hand. */
  | 'walk_override'
  /** ULS, anchored to the sibling Building Permit. */
  | 'uls_anchor'
  /** A real recorded date — nothing is projected. */
  | 'actual'
  /** Not projectable. */
  | 'none';

/**
 * ★★ ONLY WHAT THE COPY PRINTS. Every field is optional because every route
 * uses a different handful, and a required field would make each `return` site
 * carry values its sentence never mentions.
 */
export interface ProjectedApprovalRouteFacts {
  /** "30 Seattle Building Permits" — the cohort, in words. */
  cohortLabel?: string;
  sampleCount?: number;
  recencyTier?: RecencyTier;
  avgIntakeToApproval?: number;
  filteredCount?: number;
  mostLikelyCycle?: number;
  cycleDist?: Record<1 | 2 | 3 | 4, number>;
  /** The per-type default used when there is no learner. */
  defaultDays?: number;
  /** `targetCycle - 1` on the walk routes. */
  correctionRounds?: number;
  /** The hand-set target, on `walk_override`. */
  overrideCycle?: number;
  /** fix-32's bump: reviewers flagged corrections on this cycle. */
  reviewerBumpCycle?: number;
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
  /** fix-262: days the headline projection was pushed out because the project is
   *  under an ACTIVE hold. 0 when not held (or when the date is actual). Exposed
   *  so a surface can annotate the date ("+34d on hold") without recomputing. */
  heldShiftDays?: number;
  /** ★ fix-491: which branch produced `projection`. See the type above. */
  route?: ProjectedApprovalRoute;
  /** ★ fix-491: the numbers the footnote prints, and nothing else. */
  routeFacts?: ProjectedApprovalRouteFacts;
  /** ULS-specific anchor data (rendered in the widget when the permit is ULS). */
  ulsAnchors?: {
    bpApprovalAnchor: string;
    cy1Resub: string;
    targetSubmit: string;
    estApproval: string;
  };
}

/**
 * ★★ fix-491 — THE COHORT, IN WORDS: "30 Seattle Building Permits".
 *
 * `LearnedEstimate.source` is a DIAGNOSTIC string built as
 * `"Last 90d · Building Permit · Seattle"` (or `"All-time · …"`) by
 * `buildEstimate`. The window is already carried separately as `recencyTier`,
 * so what is wanted here is the last two segments, in reading order, with the
 * sample count in front.
 *
 * ★★★ AND IT REFUSES TO GUESS. Parsing a producer's diagnostic string is
 * fragile by nature, so an unexpected shape falls back to the raw `source`
 * rather than to a confidently-wrong phrase — the rule this whole ticket
 * enforces (a fallback must not borrow the confident voice). The projection
 * module cannot do better: it is handed `permit.type` but never the project's
 * juris, and `source` is the only place the pair travels together.
 */
export function cohortLabelFrom(
  source: string | null | undefined,
  sampleCount: number,
): string {
  const raw = (source ?? '').trim();
  const parts = raw.split('·').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return raw;
  const type = parts[parts.length - 2]!;
  const juris = parts[parts.length - 1]!;
  // ★ "Permits" not "Permit s" — the type is a noun phrase, so the plural goes
  //   on the end of it. `1` keeps the singular so a one-permit cohort reads.
  const plural = sampleCount === 1 ? type : `${type}s`;
  return `${sampleCount} ${juris} ${plural}`;
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
  // exists at all, derive from avgIntakeToApproval using a 70/30 split.
  if (learned?.avgIntakeToApproval && learned.avgIntakeToApproval > 0) {
    const s2i = learned.avgIntakeToApproval;
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
): { targetSubmit: string; estApproval: string; bpApprovalAnchor: string; cy1Resub: string } | null {
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
  // fix-39 Track A: anchor the ULS to the sibling BP's APPROVAL milestone,
  // not its issuance. When BP.approval_date is set, use it directly; otherwise
  // use the BP's LIVE projected approval (the recursive projection returns the
  // BP's est_approval), so the ULS tracks the BP forecast until the BP actually
  // approves and then auto-re-anchors to the real approval date with no manual
  // step. Previously this preferred BP.actual_issue, which anchored to the
  // wrong milestone (issuance lags approval) and made the ULS read early.
  // The stored expected_issue stays a last-ditch fallback when the live
  // projection yields nothing.
  // eslint-disable-next-line no-useless-assignment
  let bpApprovalAnchor = '';
  if (bp.approval_date) {
    bpApprovalAnchor = bp.approval_date;
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
    // fix-53: thread the BP's cycle-0 intake_accepted so its recursive
    // projection anchors cycle-1 review at intake, same as the top-level call.
    const bpCycle0Intake =
      (siblingCyclesByPermitId.get(bp.id) ?? []).find(
        (c) => c.cycle_index === 0,
      )?.intake_accepted ?? null;
    // fix-262: core (unshifted) on purpose — the outer wrapper shifts the ULS
    // result once; shifting the BP anchor here too would double-count the hold.
    const bpProjection = computeProjectedApprovalCore({
      permit: bp,
      cycles: bpCycles,
      learnedEstimate: bpLearned,
      // The BP and the ULS share a project, so they share go_date too.
      projectGoDate: bpProjectGoDate,
      targetCycleOverride: bpOverride,
      cycle0IntakeAccepted: bpCycle0Intake,
    });
    bpApprovalAnchor =
      bpProjection.projection ?? bp.expected_issue ?? '';
  }
  if (!bpApprovalAnchor) {
    bpApprovalAnchor = addDays(
      flooredAnchor(cy1Resub) ?? cy1Resub,
      bpCityReview2 + FINAL_APPROVAL_BUFFER,
    );
  }
  const estApproval = addDays(
    flooredAnchor(bpApprovalAnchor) ?? bpApprovalAnchor,
    ULS_BP_LAG_DAYS,
  );
  return { targetSubmit: ulsTargetSubmit, estApproval, bpApprovalAnchor, cy1Resub };
}

/** fix-262: the unshifted projection walk. Everything that was
 *  `computeProjectedApproval` before fix-262 lives here, byte-for-byte. The
 *  exported wrapper below applies the active-hold shift EXACTLY ONCE, at the
 *  outer boundary — the ULS branch recurses into this core so a BP anchor is
 *  never shifted twice on its way into the ULS date. */
function computeProjectedApprovalCore(
  input: ProjectedApprovalInput,
): ProjectedApprovalResult {
  const { permit, cycles, learnedEstimate, projectGoDate } = input;

  // Real outcomes short-circuit.
  if (permit.actual_issue) {
    return {
      projection: permit.actual_issue,
      isActual: true,
      isProjected: false,
      route: 'actual',
    };
  }
  if (permit.approval_date) {
    return {
      projection: permit.approval_date,
      isActual: true,
      isProjected: false,
      route: 'actual',
    };
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
        route: 'uls_anchor',
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
    return {
      projection: null,
      isActual: false,
      isProjected: false,
      route: 'none',
    };
  }

  // fix-53: cycle-1 city review starts at intake_accepted (matches the
  // learner's cityReview1Start), falling back to cycle-1 submitted when intake
  // hasn't been recorded. This anchors a PROJECTED cycle-1 review only — when
  // cycle 1 already has an actual corr_issued the walk uses that date directly,
  // so projections for intake-known, already-in-corrections permits are
  // unchanged (decomposition only). `base` (the first-review-approval /
  // holistic-shortcut anchor) intentionally stays at submitted so that
  // projection is preserved.
  const firstReviewStart = cityReview1Start(
    { intake_accepted: input.cycle0IntakeAccepted ?? null },
    r1,
  );

  const actualCorrCycles = [r1, r2, r3, r4].filter((c) => c?.corr_issued).length;
  // fix-32 (2026-05-19): "reviewer signaled corrections on the
  // latest cycle, but no corr_issued or next-cycle row has been
  // written yet" — predict one more correction round. Computed
  // once here so both the holistic shortcut gate (below) and the
  // targetCycle bump (further down) consult the same signal.
  // latestCycleIdx is the highest cycle_index that actually has a
  // row; the rule fires only when reviewer corrections are
  // attributed to THAT cycle (guard against double-counting an
  // already-progressed permit where a newer cycle exists).
  // fix-32a: order-independent — callers pass sorted lists today but
  // future refactors shouldn't be a silent failure mode here. Math.max
  // is O(n) over a tiny array (<=4 review cycles in practice).
  const latestCycleIdx =
    cycles.length > 0 ? Math.max(...cycles.map((c) => c.cycle_index)) : 0;
  const hasReviewerCorrectionsOnLatestCycle =
    latestCycleIdx >= 1 &&
    !!input.permitReviewers &&
    input.permitReviewers.some(
      (r) =>
        r.cycle_index === latestCycleIdx &&
        r.current_status === 'corrections_required',
    );
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
  // ★ fix-491: recorded here rather than re-derived below, because the three
  //   branches are distinguishable now and not afterwards.
  let walkRoute: ProjectedApprovalRoute;
  if (typeof input.targetCycleOverride === 'number') {
    targetCycle = Math.max(currentReviewCycle, input.targetCycleOverride);
    walkRoute = 'walk_override';
  } else if (learnedEstimate && typeof learnedEstimate.mostLikelyCycle === 'number') {
    targetCycle = Math.max(currentReviewCycle, learnedEstimate.mostLikelyCycle);
    walkRoute = 'walk_learned';
  } else {
    targetCycle = currentReviewCycle;
    walkRoute = 'walk_default';
  }
  // fix-32 (2026-05-19): a reviewer flagged corrections_required on
  // the LATEST cycle is the city signaling "another corr_issued is
  // coming on this cycle." Bump targetCycle so the projection adds
  // one more cycle's worth of duration (cityReview + corrResponse).
  // Guard against double-counting: only fire when the corrections-
  // flagged cycle is still the highest cycle_index in the list. If a
  // new cycle row already exists beyond it, the correction is already
  // represented in the cycle walk and adding +1 here would push the
  // projection too far. (hasReviewerCorrectionsOnLatestCycle is
  // computed above so the holistic shortcut gate uses the same signal.)
  // ★ fix-491: remembered so the footnote can say *why* a round was added.
  let reviewerBumpCycle: number | undefined;
  if (hasReviewerCorrectionsOnLatestCycle) {
    targetCycle = Math.max(targetCycle, latestCycleIdx + 1);
    reviewerBumpCycle = latestCycleIdx;
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
  // fix-24i: the no-learner default now dispatches per permit type via
  // defaultDaysForType (Building Permit=210d, Demolition=60d, ULS=90d,
  // etc.) instead of a single global 210d. Unknown types still fall back
  // to PER_TYPE_FALLBACK_DAYS=210 so the test bobby smoke pins.
  const effectiveAvg: number | null =
    learnedEstimate?.avgIntakeToApproval &&
    learnedEstimate.avgIntakeToApproval > 0
      ? Math.round(learnedEstimate.avgIntakeToApproval)
      : !hasAnyCycleActivity
        ? defaultDaysForType(permit.type, input.typeDefaultsOverride)
        : null;
  // ★★★ fix-491: WHICH of the two sources `effectiveAvg` came from. The
  //     expression above is a chain of ternaries and the branch it took is not
  //     recoverable afterwards — the value alone cannot say whether 210 is a
  //     learned average that happens to be 210 or the per-type default.
  const holisticFromLearner =
    !!learnedEstimate?.avgIntakeToApproval &&
    learnedEstimate.avgIntakeToApproval > 0;
  // fix-32: when reviewers have flagged corrections on the latest
  // cycle, we already know a correction round is incoming. Skip the
  // first-review-approval shortcut and let the cycle walk produce a
  // multi-cycle projection so the +1-cycle bump above can take effect.
  //
  // ★★★ fix-493 §A (P-152) — AN EXPLICIT OVERRIDE BYPASSES THE SHORTCUT.
  //
  // v1's gate included `targetCycle === 1 &&`. fix-24h (681a53f) dropped it so
  // the branch could also fire when the learner was silent — and in doing so
  // made a hand-set `targetCycleOverride` **stored and ignored**: the widget
  // wrote `extras.scheduleCycleOverride`, the projection took the shortcut
  // anyway, and `targetCycle` still read 1. Somebody pressed the button and
  // nothing happened.
  //
  // ★★ THE CHECK IS ON THE INPUT, NOT ON THE RESOLVED TARGET. Testing
  //    `targetCycle === 1` would restore v1's gate and change behaviour for
  //    permits with NO override (a learner picking cycle 1 would stop taking
  //    the shortcut). Testing the input moves only the permits where somebody
  //    actually asked for a cycle — measured on prod 2026-09-04: **3 of 667
  //    permits carry an override, and exactly ONE of them changes.** The other
  //    two are already elsewhere: 4563 34th Ave W is issued (returns `actual`
  //    before this line) and 2812 32nd Ave W has a correction round, so
  //    `actualCorrCycles === 0` already excluded it.
  //
  // ★ Bobby, 2026-09-04: **an override always walks.**
  if (
    effectiveAvg !== null &&
    actualCorrCycles === 0 &&
    !hasReviewerCorrectionsOnLatestCycle &&
    typeof input.targetCycleOverride !== 'number'
  ) {
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
      // ★★★ THE `1` THAT STARTED THIS TICKET. It is a code-path marker — this
      //     branch does not walk cycles at all — and the widget used to read it
      //     as "approved in the first review". `route` is what the copy reads
      //     now; `targetCycle` keeps its value because `CycleAdjuster` and the
      //     projection tests both depend on it (see the fix-491 PR: the stepper
      //     showing 1 on a holistic date is reported, not fixed).
      targetCycle: 1,
      rounds: {},
      route: holisticFromLearner ? 'holistic_learned' : 'holistic_default',
      routeFacts: holisticFromLearner
        ? {
            cohortLabel: cohortLabelFrom(
              learnedEstimate!.source,
              learnedEstimate!.sampleCount,
            ),
            sampleCount: learnedEstimate!.sampleCount,
            recencyTier: learnedEstimate!.recencyTier,
            avgIntakeToApproval: effectiveAvg,
            filteredCount: learnedEstimate!.filteredCount,
            mostLikelyCycle: learnedEstimate!.mostLikelyCycle,
            cycleDist: learnedEstimate!.cycleDist,
          }
        : { defaultDays: effectiveAvg },
    };
  }

  // Per-permit actual durations.
  const thisPermitDur: ({ cr: number | null; co: number | null } | null)[] = [
    // NB: cycle-1's self cr stays submitted-anchored here ON PURPOSE. It only
    // feeds durFor as a per-permit signal; re-anchoring it at intake would
    // ripple through durFor's walk-back into cycles 2+ and shift projections
    // for permits with ACTUAL corrections. fix-53 re-anchors only the cycle-1
    // PROJECTED review (reviewAnchor below), keeping the change decomposition-
    // only for intake-known, already-in-corrections permits.
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
    if (learnedEstimate?.avgIntakeToApproval && learnedEstimate.avgIntakeToApproval > 0) {
      cursor = addDays(baseAnchor, Math.round(learnedEstimate.avgIntakeToApproval));
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
      // fix-53: a PROJECTED cycle-1 review (no actual corr_issued) is anchored
      // at intake_accepted (firstReviewStart) instead of cursor=base=submitted,
      // so its decomposition matches the intake-anchored learner. Cycles 2+
      // keep anchoring on cursor (the prior resubmit), unchanged. When cycle 1
      // has an actual corr_issued the `rd?.corr_issued ??` short-circuit wins,
      // so already-in-corrections permits are unaffected.
      const reviewAnchor = i === 0 ? (firstReviewStart ?? cursor) : cursor;
      // fix-24e: rd?.corr_issued / rd?.resubmitted are ACTUAL dates and
      // display as-is even when past. The forecast branches (cityTargetCrEnd
      // assigned directly, addDays projections) and the chained resubEnd
      // anchor floor at today so past anchors don't yield past forecasts.
      const crEnd =
        rd?.corr_issued ??
        flooredAnchor(cityTargetCrEnd) ??
        addDays(flooredAnchor(reviewAnchor) ?? reviewAnchor, crDays);
      const resubEnd =
        rd?.resubmitted ??
        addDays(flooredAnchor(crEnd) ?? crEnd, coDays);
      rounds[`corrIssued${i + 1}` as keyof ProjectedApprovalRounds] = crEnd;
      rounds[`resubmitted${i + 1}` as keyof ProjectedApprovalRounds] = resubEnd;
      cursor = resubEnd;
    }
    // fix-25-HH-redux: project the FINAL review cycle's city review.
    // After the N-1 correction-round loop, `cursor` sits at cycle
    // `targetCycle`'s submission point (the resubmit of cycle N-1, or a
    // projected value). Cycle `targetCycle` is the approval review — the
    // city still has to review THAT submission before approving. Pre-redux
    // the walk jumped straight to + FINAL_APPROVAL_BUFFER, collapsing the
    // projection to "submission + 7" — the in-flight +7 under-count
    // (3056 48th Ave SW BP projected ~late-May instead of ~mid-July).
    //
    // Composes with fix-32: when fix-32 bumped targetCycle past the
    // highest actual cycle (a reviewer flagged corrections on the latest
    // cycle), `finalCycle` is null and we project the bumped cycle's
    // city review from `cursor` (the projected resubmit of the prior
    // round). When the target cycle is a real in-flight row we read its
    // actual anchors.
    const finalCycle = cycleRows[targetCycle - 1] ?? null;
    const finalCrDays = durFor(targetCycle - 1, 'cr', learnedEstimate, thisPermitDur);
    if (finalCycle?.corr_issued && !finalCycle.resubmitted) {
      // Target cycle already received corrections but hasn't been
      // resubmitted yet: project team turnaround (co) → resubmit, then
      // the next city review (cr) → approval.
      const finalCoDays = durFor(targetCycle - 1, 'co', learnedEstimate, thisPermitDur);
      const projResub = addDays(
        flooredAnchor(finalCycle.corr_issued) ?? finalCycle.corr_issued,
        finalCoDays,
      );
      rounds[`corrIssued${targetCycle}` as keyof ProjectedApprovalRounds] =
        finalCycle.corr_issued;
      rounds[`resubmitted${targetCycle}` as keyof ProjectedApprovalRounds] =
        projResub;
      cursor = addDays(flooredAnchor(projResub) ?? projResub, finalCrDays);
    } else {
      // Target cycle submitted (real in-flight row awaiting city review)
      // OR fully projected by the round loop (fix-32 / learner bump):
      // its city review hasn't been added yet. Add it from `cursor`.
      // An actual city_target on the final cycle, when later than the
      // cursor, is the city's stated review-completion date — prefer it.
      const finalCityTarget =
        finalCycle?.city_target && finalCycle.city_target > cursor
          ? finalCycle.city_target
          : null;
      cursor =
        flooredAnchor(finalCityTarget) ??
        addDays(flooredAnchor(cursor) ?? cursor, finalCrDays);
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
    route: walkRoute,
    routeFacts: {
      // ★ The walk targets cycle N, so it projects N−1 correction rounds and
      //   then a final review. That subtraction is the sentence's number.
      correctionRounds: Math.max(0, targetCycle - 1),
      ...(walkRoute === 'walk_override'
        ? { overrideCycle: targetCycle }
        : {}),
      ...(learnedEstimate
        ? {
            cohortLabel: cohortLabelFrom(
              learnedEstimate.source,
              learnedEstimate.sampleCount,
            ),
            sampleCount: learnedEstimate.sampleCount,
            recencyTier: learnedEstimate.recencyTier,
            mostLikelyCycle: learnedEstimate.mostLikelyCycle,
            cycleDist: learnedEstimate.cycleDist,
            filteredCount: learnedEstimate.filteredCount,
          }
        : {}),
      ...(reviewerBumpCycle !== undefined ? { reviewerBumpCycle } : {}),
    },
  };
}

/**
 * Projected approval for a permit, hold-aware.
 *
 * fix-262 completes fix-170's "effect C" for this module. The projection walk is
 * unchanged (see {@link computeProjectedApprovalCore}); this wrapper pushes the
 * HEADLINE date out by the days the project has already spent under an ACTIVE
 * hold, using the canonical {@link activeHoldElapsedDays} — the same helper the
 * Schedule Estimator has used since fix-170. Rules:
 *
 *   - ACTUAL dates (approval_date / actual_issue) never shift. The event
 *     happened; a hold cannot move it.
 *   - Only the headline `projection` shifts. Intermediate `rounds` dates are
 *     left alone, preserving the behaviour ScheduleEstimator shipped with.
 *   - A CLOSED hold contributes nothing (activeHoldElapsedDays only reads open
 *     holds), so its days aren't double-counted against accountableDays.
 *   - No holds passed, or none active → shift 0 → byte-identical to pre-fix-262.
 */
export function computeProjectedApproval(
  input: ProjectedApprovalInput,
): ProjectedApprovalResult {
  const result = computeProjectedApprovalCore(input);
  const shiftDays = activeHoldElapsedDays(input.holds, input.today);
  if (result.isActual || !result.projection || shiftDays <= 0) {
    return { ...result, heldShiftDays: 0 };
  }
  return {
    ...result,
    projection: addDays(result.projection, shiftDays),
    heldShiftDays: shiftDays,
  };
}
