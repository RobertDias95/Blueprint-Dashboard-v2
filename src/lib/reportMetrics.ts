import type {
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
  Project,
  ProjectHold,
} from './database.types';
import { multiMatchAddress } from './drawScheduleHelpers';
import { isPermitInCorrections } from './permitStage';
import { isEffectivelyIssued } from './effectiveIssued';
import { accountableDays } from './holdOverlap';
import { isNotSubPermit } from './subPermit';
import { buildProjectDdStartMap } from './projectDdStart';

// fix-171 (On-Hold Phase 2, effect B): the displayed turnaround tiles subtract
// held days so a parked project doesn't inflate "our time". Each measurement
// swaps daysBetween(a, b) → accountableDays(holds, a, b), where `holds` is the
// permit's project's holds. accountableDays === daysBetween when there are no
// holds, so no-hold projects (the common case) are byte-identical.
type Holds = ProjectHold[] | undefined;
function accDays(holds: Holds, a: string | null, b: string | null): number | null {
  return accountableDays(holds, a, b);
}

// Q7.2.a: pure helpers for the Reports view. Mirrors v1's getRptFiltered
// (index.html 2905-2988) + renderReports metric computations (5499-5540)
// under v2's relational shape (juris on projects, no acq_lead column).

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// Enriched permit shape
// ============================================================

export interface EnrichedPermit {
  permit: PermitWithCycles;
  /** fix-214: the permit's reviewer rows (latest + earlier cycles), indexed in
   *  from useAllPermitCycleReviewers. Feeds the hybrid `isPermitInCorrections`
   *  test so the Reports Overview "In Corrections" count + drill-in agree with
   *  the Dashboard and the weekly report. Empty when enrichPermits is called
   *  without a reviewers map (the count then falls back to the corr_issued half,
   *  byte-identical to the pre-fix behavior). Optional so existing EnrichedPermit
   *  fixtures/literals don't have to enumerate it — isPermitInCorrections treats
   *  an absent value as "no reviewers". */
  reviewers?: PermitCycleReviewer[];
  /** Project address — joined from projects table. */
  address: string;
  /** Jurisdiction — lives on the project, not the permit, in v2. */
  juris: string;
  /** fix-22 Mig 3: project-level product types (moved from permits.*).
   *  fix-91: now an array — a site can carry multiple types. Joined
   *  with ', ' for display + the search haystack. */
  productTypes: string[];
  /** fix-22 Mig 3: project_tags read directly from the joined project. */
  projectTags: string[];
  /** fix-22 Mig 3: go_date moved from permits → projects. */
  goDate: string | null;
  /** fix-22 Mig 3: units moved from permits → projects (no more sibling
   *  scan; the project carries the canonical count). */
  units: number | null;
  /** First cycle with a non-null submitted; null if no cycle has submitted. */
  firstSubmitted: string | null;
  /** intake_accepted from the same first-submitted cycle. */
  firstIntakeAccepted: string | null;
  /** go_date → firstSubmitted in days. */
  goToSubmit: number | null;
  /** go_date → dd_start in days. */
  goToDDStart: number | null;
  /** dd_start → dd_end in days. */
  ddDuration: number | null;
  /** dd_end → firstSubmitted in days. */
  ddEndToSubmit: number | null;
  /** firstSubmitted → firstIntakeAccepted in days (city queue lag). */
  submitToIntake: number | null;
  /** fix-173: approval_date → actual_issue in days (final issuance step). Like
   *  every other tile it's hold-aware (held days subtracted) — this is exactly
   *  where On-Hold applies (e.g. waiting on closing before paying issuance fees),
   *  so parked time shouldn't inflate it. */
  approvalToIssue: number | null;
  /** fix-141: renamed from `cityReviewDays`. This is the Avg Permit
   * Timeline metric — total elapsed (approval_date ?? actual_issue) −
   * c0.intake_accepted. fix-141 split City Review off into a distinct
   * sum-over-cycles ball-in-court measure (computeMetrics.avgCityReview via
   * cityCourtTimeDays); this field keeps the canonical intake → approval
   * clock the csv export / ReportTable / city-review-by-juris bar still
   * read. Formula unchanged from fix-112-b — only the name moved. */
  permitTimelineDays: number | null;
  /** corr_issued → resubmitted on the first cycle that has both, in days. */
  corrResponseDays: number | null;
  /** expected_issue → (approval_date ?? actual_issue) in days. Positive = late. */
  variance: number | null;
}

/** Find the first cycle in `cycles` with a non-null `submitted` date.
 * Sorted by cycle_index. Returns null if none exist. */
export function pickFirstSubmittedCycle(
  cycles: PermitCycle[],
): PermitCycle | null {
  const sorted = [...cycles].sort((a, b) => a.cycle_index - b.cycle_index);
  return sorted.find((c) => c.submitted) ?? null;
}

// fix-171: the local daysBetween was fully replaced by accDays/accountableDays
// (identical when there are no holds; NaN/malformed dates still resolve to null
// via holdOverlap's dayIndex guard).

// ============================================================
// fix-141: City Review redefined + Avg Response Time added.
//
// Cycle indexing: cycle 0 = design phase (carries intake_accepted);
// cycles 1+ = review cycles. Per the auto-derivation rule
// c1.submitted = c0.intake_accepted, so intake → approval (permitTimeline)
// telescopes exactly into city-court + response-court time:
//   permitTimeline = (cityCourtTime) + (responseCourtTime)
// whenever both are non-null. See reportMetrics.test.ts convergence test.
// ============================================================

/** Review cycles (cycle_index >= 1), sorted ascending. Cycle 0 is the
 *  design phase — it carries intake_accepted but no submitted→corr_issued
 *  ball-in-court arc, so it's excluded here. Shared by cityCourtTimeDays +
 *  responseCourtTimeDays (fix-141). */
export function extractReviewCycles(permit: PermitWithCycles): PermitCycle[] {
  return [...(permit.permit_cycles ?? [])]
    .filter((c) => c.cycle_index >= 1)
    .sort((a, b) => a.cycle_index - b.cycle_index);
}

/** fix-141: renamed from the inline `cityReviewDays` computation (fix-112-b).
 *  This is now the Avg Permit Timeline metric — total elapsed, strict
 *  canonical: (approval_date ?? actual_issue) − c0.intake_accepted. Both
 *  anchors required; out-of-order rows (approval < intake) drop to null
 *  rather than contributing negative days. Matches
 *  perfTrends.avgIntakeToApproval exactly. fix-141 split this OFF from Avg
 *  City Review (which is now the sum-over-cycles cityCourtTimeDays below). */
function permitTimelineDays(
  permit: PermitWithCycles,
  holds?: Holds,
): number | null {
  const c0 = (permit.permit_cycles ?? []).find((c) => c.cycle_index === 0);
  const c0IntakeAccepted = c0?.intake_accepted ?? null;
  const approvalPoint = permit.approval_date ?? permit.actual_issue ?? null;
  const raw = accDays(holds, c0IntakeAccepted, approvalPoint);
  return raw !== null && raw >= 0 ? raw : null;
}

/** fix-141: Avg City Review redefined — "time the ball was in the city's
 *  court" summed across review cycles. For each review cycle in order:
 *    - if corr_issued is set:        += days(corr_issued − submitted)
 *    - else if final cycle + approval: += days(approval_date − submitted)
 *    - else (ongoing/incomplete):    exclude the permit → null
 *  A permit with zero review cycles has no city-court time to measure → null. */
export function cityCourtTimeDays(
  permit: PermitWithCycles,
  holds?: Holds,
): number | null {
  const cycles = extractReviewCycles(permit);
  if (cycles.length === 0) return null;
  let cityTime = 0;
  for (let i = 0; i < cycles.length; i++) {
    const c = cycles[i];
    const isFinal = i === cycles.length - 1;
    if (c.corr_issued) {
      const d = accDays(holds, c.submitted, c.corr_issued);
      if (d === null) return null;
      cityTime += d;
    } else if (isFinal && permit.approval_date) {
      const d = accDays(holds, c.submitted, permit.approval_date);
      if (d === null) return null;
      cityTime += d;
    } else {
      // Ongoing cycle (no corr_issued, not closeable via approval) — the
      // ball is still in the city's court, so the sum is incomplete.
      return null;
    }
  }
  return cityTime;
}

/** fix-141: Avg Response Time — "time the ball was in our court" summed
 *  across consecutive review-cycle pairs: days(next.submitted −
 *  this.corr_issued). Requires at least one completed round-trip
 *  (corr_issued on cycle i AND submitted on cycle i+1). A permit approved
 *  on cycle 1 with no second cycle never had a response event → null. */
export function responseCourtTimeDays(
  permit: PermitWithCycles,
  holds?: Holds,
): number | null {
  const cycles = extractReviewCycles(permit);
  if (cycles.length < 2) return null;
  let responseTime = 0;
  for (let i = 0; i < cycles.length - 1; i++) {
    const cur = cycles[i];
    const next = cycles[i + 1];
    if (cur.corr_issued && next.submitted) {
      const d = accDays(holds, cur.corr_issued, next.submitted);
      if (d === null) return null;
      responseTime += d;
    } else {
      // Ongoing or missing data — no completed round-trip on this pair.
      return null;
    }
  }
  return responseTime;
}

// ============================================================
// fix-184b: Avg Permit Timeline COMPOSITION — show HOW the total is built.
//
// The Permit Timeline tile shows one number (intake_accepted → approval). This
// decomposes that number, per permit, into the pieces that add up to it:
//   permitTimeline = cityCourt + ourCourt + residual   (exact, by construction)
//   - cityCourt : Σ(submitted → corr_issued) over review cycles, final cycle
//                 anchored to the approval point. SAME arcs City Review sums.
//   - ourCourt  : Σ(corr_issued → next.submitted) over consecutive review
//                 cycles. SAME arcs Response Time sums.
//   - residual  : the remainder = intake_accepted → first-review-submittal gap,
//                 plus any arc the cycle walk can't attribute (incomplete
//                 cycles, final-corr → approval tail, a permit with zero review
//                 cycles dumping its whole timeline here).
//
// Why this is NOT just the City Review + Response Time card averages: those two
// tiles average a STRICTER cohort — a permit drops out entirely if ANY cycle is
// ongoing (cityCourtTimeDays / responseCourtTimeDays return null), and Response
// Time needs ≥2 review cycles. So their cohorts differ from each other AND from
// the timeline cohort, and their averages do NOT sum to the timeline (e.g. 48 +
// 32 ≠ 70). Here we decompose the SAME cohort the timeline tile averages
// (permitTimelineDays != null) WITHOUT the null gate — a missing arc just
// contributes 0 and rolls into the honest residual — so the per-permit parts
// sum exactly, and therefore so do the cohort means (averaging is linear):
//   avg(cityCourt) + avg(ourCourt) + avg(residual) == avgPermitTimeline.
// ============================================================

/** One permit's intake → approval timeline split into its building blocks.
 *  cityCourt + ourCourt + residual === timeline, always (residual is the
 *  remainder). All values are hold-aware (held days subtracted) — they reuse
 *  the same accDays the timeline + court tiles use, so the windows reconcile. */
export interface TimelineParts {
  /** Total intake_accepted → (approval_date ?? actual_issue), hold-aware.
   *  Identical to EnrichedPermit.permitTimelineDays. */
  timeline: number;
  /** Time the ball was in the city's court (submitted → corr_issued arcs). */
  cityCourt: number;
  /** Time the ball was in our court (corr_issued → next submitted arcs). */
  ourCourt: number;
  /** Everything else: intake → first submittal, plus any unattributable arc. */
  residual: number;
}

/** Decompose one permit's Avg Permit Timeline into city-court / our-court /
 *  residual. Returns null when the permit isn't in the timeline cohort (no
 *  intake_accepted → approval clock). Unlike cityCourtTimeDays /
 *  responseCourtTimeDays, an incomplete/missing arc does NOT drop the permit —
 *  it simply doesn't contribute, and the unattributed time lands in `residual`,
 *  so the three parts always sum back to the timeline. */
export function decomposePermitTimeline(
  permit: PermitWithCycles,
  holds?: Holds,
): TimelineParts | null {
  const timeline = permitTimelineDays(permit, holds);
  if (timeline === null) return null;
  const approvalPoint = permit.approval_date ?? permit.actual_issue ?? null;
  const cycles = extractReviewCycles(permit);

  // City's court: submitted → corr_issued per review cycle; the final review
  // cycle anchors to the approval point when no corr_issued was stamped (mirror
  // of cityCourtTimeDays, but a null arc contributes 0 instead of bailing).
  let cityCourt = 0;
  for (let i = 0; i < cycles.length; i++) {
    const c = cycles[i];
    const isFinal = i === cycles.length - 1;
    if (c.corr_issued) {
      const d = accDays(holds, c.submitted, c.corr_issued);
      if (d !== null) cityCourt += d;
    } else if (isFinal && approvalPoint) {
      const d = accDays(holds, c.submitted, approvalPoint);
      if (d !== null) cityCourt += d;
    }
  }

  // Our court: corr_issued → next cycle's submitted (mirror of
  // responseCourtTimeDays, again non-bailing).
  let ourCourt = 0;
  for (let i = 0; i < cycles.length - 1; i++) {
    const cur = cycles[i];
    const next = cycles[i + 1];
    if (cur.corr_issued && next.submitted) {
      const d = accDays(holds, cur.corr_issued, next.submitted);
      if (d !== null) ourCourt += d;
    }
  }

  return { timeline, cityCourt, ourCourt, residual: timeline - cityCourt - ourCourt };
}

/** Cohort-level composition of the Avg Permit Timeline tile. Aggregates the
 *  per-permit decomposition over the SAME cohort the tile averages, so `timeline`
 *  equals computeMetrics(...).avgPermitTimeline and the three parts add up to it.
 *  `residual` is derived from the rounded means (timeline − city − our) so the
 *  three displayed integers sum to the displayed total exactly — rounding noise
 *  lands in the residual, which is the "everything else" bucket by definition. */
export interface TimelineComposition {
  /** Permits contributing (timeline cohort size). */
  n: number;
  /** avg(timeline) — matches the Avg Permit Timeline tile. Null when n=0. */
  timeline: number | null;
  cityCourt: number | null;
  ourCourt: number | null;
  residual: number | null;
}

export function computeTimelineComposition(
  enriched: EnrichedPermit[],
  holdsByProjectId?: Map<string, ProjectHold[]>,
): TimelineComposition {
  const parts = enriched
    .map((e) =>
      decomposePermitTimeline(
        e.permit,
        holdsByProjectId?.get(e.permit.project_id),
      ),
    )
    .filter((p): p is TimelineParts => p !== null);
  if (parts.length === 0) {
    return { n: 0, timeline: null, cityCourt: null, ourCourt: null, residual: null };
  }
  const timeline = avg(parts.map((p) => p.timeline));
  const cityCourt = avg(parts.map((p) => p.cityCourt));
  const ourCourt = avg(parts.map((p) => p.ourCourt));
  // Derive residual from the rounded means so city + our + residual === timeline
  // exactly at display time (the per-permit raw identity already holds; this
  // just keeps the three rendered integers reconciled).
  const residual = (timeline ?? 0) - (cityCourt ?? 0) - (ourCourt ?? 0);
  return { n: parts.length, timeline, cityCourt, ourCourt, residual };
}

/** Enrich a permit list with per-permit derived metrics + project joins.
 * Mirrors v1's getRptFiltered enrichment pass (index.html 2948-2987).
 *
 * fix-22 Migration 3 sweep: product_types / project_tags / go_date now
 * live on projects (single source of truth). Enrichment reads them off
 * the joined project rather than the permit. */
export function enrichPermits(
  permits: PermitWithCycles[],
  projectsById: Map<string, Project>,
  // fix-171 (effect B): per-project holds. When omitted (or a project has no
  // holds) every measurement equals the raw daysBetween — byte-identical.
  holdsByProjectId?: Map<string, ProjectHold[]>,
  // fix-214: per-permit reviewer rows (from useAllPermitCycleReviewers). When
  // omitted, each EnrichedPermit.reviewers is [] and the "In Corrections" count
  // falls back to the corr_issued half — byte-identical to the pre-fix behavior.
  reviewersByPermitId?: Map<number, PermitCycleReviewer[]>,
): EnrichedPermit[] {
  // fix-194: sub/child placeholder permits are excluded from ALL report metrics
  // (totalUnits, in-corrections, issued count, per-project rollups, permit
  // counts) in one place — every downstream report consumes this enriched list.
  return permits.filter(isNotSubPermit).map<EnrichedPermit>((permit) => {
    const project = projectsById.get(permit.project_id);
    const projectGoDate = project?.go_date ?? null;
    const holds = holdsByProjectId?.get(permit.project_id);

    const firstSub = pickFirstSubmittedCycle(permit.permit_cycles ?? []);
    const firstSubmitted = firstSub?.submitted ?? null;
    const firstIntakeAccepted = firstSub?.intake_accepted ?? null;

    const goToSubmit = accDays(holds, projectGoDate, firstSubmitted);
    const goToDDStart = accDays(holds, projectGoDate, permit.dd_start ?? null);
    const ddDuration = accDays(holds, permit.dd_start ?? null, permit.dd_end ?? null);
    const ddEndToSubmit = accDays(holds, permit.dd_end ?? null, firstSubmitted);
    const submitToIntake = accDays(holds, firstSubmitted, firstIntakeAccepted);
    // fix-173: final issuance step, hold-aware (held days subtracted).
    const approvalToIssue = accDays(
      holds,
      permit.approval_date ?? null,
      permit.actual_issue ?? null,
    );

    // fix-141: the canonical strict intake → approval clock (fix-112-b) is
    // now the Avg Permit Timeline metric, extracted into permitTimelineDays().
    // Avg City Review was redefined as a sum-over-cycles ball-in-court measure
    // (computeMetrics reads cityCourtTimeDays directly off the permit). This
    // field keeps the intake → approval value the csv export / ReportTable /
    // city-review-by-juris bar still consume — formula unchanged from
    // fix-112-b, only the name moved (cityReviewDays → permitTimelineDays).
    const permitTimeline = permitTimelineDays(permit, holds);

    // Variance: expected_issue → (approval_date ?? actual_issue).
    const varianceTarget = permit.approval_date ?? permit.actual_issue ?? null;
    const variance = accDays(holds, permit.expected_issue ?? null, varianceTarget);

    // Correction response: first cycle with BOTH corr_issued + resubmitted.
    const corrCycle = (permit.permit_cycles ?? []).find(
      (c) => c.corr_issued && c.resubmitted,
    );
    const corrResponseDays =
      corrCycle ? accDays(holds, corrCycle.corr_issued, corrCycle.resubmitted) : null;

    const tags = Array.isArray(project?.project_tags)
      ? (project.project_tags as string[]).filter(
          (t): t is string => typeof t === 'string',
        )
      : [];

    return {
      permit,
      reviewers: reviewersByPermitId?.get(permit.id) ?? [],
      address: project?.address ?? '',
      juris: project?.juris ?? '',
      productTypes: Array.isArray(project?.product_types)
        ? project.product_types
        : [],
      projectTags: tags,
      goDate: projectGoDate,
      units: project?.units ?? null,
      firstSubmitted,
      firstIntakeAccepted,
      goToSubmit,
      goToDDStart,
      ddDuration,
      ddEndToSubmit,
      submitToIntake,
      approvalToIssue,
      permitTimelineDays: permitTimeline,
      corrResponseDays,
      variance,
    };
  });
}

// ============================================================
// Filtering
// ============================================================

export type TimeRange = 'all' | '3mo' | '6mo' | '1yr' | '2yr' | 'custom';

export interface ReportFilters {
  /** Multi-select sets; empty set = no filter (matches v1's "all" sentinel
   * pattern, but cleaner: empty = no constraint). */
  types: Set<string>;
  jurisdictions: Set<string>;
  ents: Set<string>;
  productTypes: Set<string>;
  tags: Set<string>;
  range: TimeRange;
  /** Used only when range === 'custom'. */
  dateFrom: string | null;
  dateTo: string | null;
  /** PROJECT-level cohort filter (renamed from "Status" in fix-113-a).
   *  'active' = at least one permit at the address is NOT issued;
   *  'issued' = every permit at the address has actual_issue. */
  status: 'all' | 'active' | 'issued';
  /** fix-113-a: PERMIT-level cohort filter. Empty string = no filter.
   *  When set, drops permits whose `permit.status` doesn't match exactly.
   *  Decoupled from the project-level `status` filter so a user can ask
   *  "show me permits with status=Issued anywhere" (independent of whether
   *  the project they belong to is fully issued). Prod has 24 distinct
   *  `permits.status` values; UI auto-populates from the cohort. */
  permitStatus: string;
  /** Multi-token address/permit search. */
  search: string;
  /** fix-115-c → fix-137: period-comparison range. Null = single-cohort
   *  rendering (default). When set, the page surfaces a comparison
   *  cohort underneath each comparable MetricCard with a signed delta.
   *  Period B is explicit — no derive-from-mode magic. */
  comparisonRange: { from: string; to: string } | null;
}

/** Resolve `range` + custom dates to a [from, to] tuple. Either may be null. */
export function resolveDateRange(
  filters: ReportFilters,
  today: Date = new Date(),
): { from: Date | null; to: Date | null } {
  if (filters.range === 'all') return { from: null, to: null };
  if (filters.range === 'custom') {
    return {
      from: filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null,
      to: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`) : null,
    };
  }
  const days =
    filters.range === '3mo'
      ? 90
      : filters.range === '6mo'
        ? 180
        : filters.range === '1yr'
          ? 365
          : 730;
  return { from: new Date(today.getTime() - days * DAY_MS), to: null };
}

/** fix-115-c: resolve the active filter to a closed 'YYYY-MM-DD' range
 *  suitable for deriveComparisonRange. Returns null when no comparison is
 *  meaningful — `range='all'` (no temporal anchor) or `custom` with at
 *  least one endpoint missing. For relative ranges ('3mo' / '6mo' / etc.)
 *  the upper bound is today, lower bound is today − N days. */
export function resolveClosedStringRange(
  filters: ReportFilters,
  today: Date = new Date(),
): { from: string; to: string } | null {
  function fmt(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
  if (filters.range === 'all') return null;
  if (filters.range === 'custom') {
    if (!filters.dateFrom || !filters.dateTo) return null;
    return { from: filters.dateFrom, to: filters.dateTo };
  }
  const days =
    filters.range === '3mo'
      ? 90
      : filters.range === '6mo'
        ? 180
        : filters.range === '1yr'
          ? 365
          : 730;
  const from = new Date(today.getTime() - days * DAY_MS);
  return { from: fmt(from), to: fmt(today) };
}

// ============================================================
// Q9.5.f-fix-4: project aggregation for the Permit Ledger (v1 parity).
// ReportTable shifts from per-permit to per-project rows; each row holds
// project-level aggregates + a list of contributing permits for the
// expand-on-click detail.
// ============================================================

export interface ProjectRow {
  projectId: string;
  address: string;
  juris: string;
  permits: EnrichedPermit[];
  permitCount: number;
  /** Permits not yet issued or approved (status === 'active' analogue). */
  activeCount: number;
  /** Most-advanced effectiveStage across the project's permits. 'mixed'
   *  when permits span more than one stage. */
  dominantStage: string;
  /** First non-null ent_lead / da / dm across the project's permits. */
  ent: string | null;
  da: string | null;
  dm: string | null;
  /** Earliest go_date across permits — drives the GO sort key. */
  earliestGoDate: string | null;
  // Aggregate day metrics (mean of non-null values across permits).
  avgGoToDDStart: number | null;
  avgDDDuration: number | null;
  avgDDEndToSubmit: number | null;
  avgGoToSubmit: number | null;
  avgSubmitToIntake: number | null;
  avgCityReview: number | null;
  /** Latest expected_issue across permits (acq target proxy until task #63). */
  latestAcqTarget: string | null;
  /** Earliest approval / actual issue across permits. */
  earliestApproval: string | null;
  earliestActualIssue: string | null;
  /** Mean of non-null per-permit variances. */
  variance: number | null;
  /** Q9.5.f-fix-12: max count of cycles with corr_issued set across the
   *  project's permits. Matches v1's actualCorrRounds at index.html:3243.
   *  Previously counted permit_cycles.length which included the cy0
   *  design placeholder and any empty cycles — off by 1+ on every row. */
  maxCorrRounds: number;
  /** Q9.5.f-fix-12: canonical project unit count. v1 treats units as
   *  project-level (every permit at a project shares the same value).
   *  Prefer the BP's units, fall back to max across permits. The prior
   *  `unitsSum` summed across permits — triple-counted a 1-unit project
   *  that had BP + Demo + ULS. */
  units: number | null;
}

/** Mean of a number list, ignoring nulls. Returns null when the list has
 *  no non-null values. Rounds to nearest int (consistent with the per-
 *  permit day metrics in EnrichedPermit which are already integers). */
function meanOrNull(values: (number | null | undefined)[]): number | null {
  const real = values.filter((v): v is number => v !== null && v !== undefined);
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

/** Most-advanced effectiveStage across a permit set. The "advancement"
 *  order matches v1's bucketing: de < pm < co < ap < is. Returns 'mixed'
 *  when permits land in more than one stage AND we want disambiguation —
 *  in practice we return the highest-rank stage (closer to v1 where the
 *  ledger summary shows "most-advanced" rather than warning on disparity). */
const STAGE_RANK: Record<string, number> = { de: 0, pm: 1, co: 2, ap: 3, is: 4 };
function pickDominantStage(permits: EnrichedPermit[]): string {
  // Q9.5.f-fix-14: project stage follows the Building Permit, not the
  // most-advanced permit across all types. Confirmed against 8844 10th
  // Ave SW: BP at 'de' with a PAR/Pre-Sub at 'is' — old logic showed
  // "Issued" which misrepresented the project's actual state. When no BP
  // exists, fall back to most-advanced across all permits (so PAR-only
  // or ROW-only projects still get a meaningful stage).
  const bps = permits.filter((e) => e.permit.type === 'Building Permit');
  const pool = bps.length > 0 ? bps : permits;
  let best = '';
  let bestRank = -1;
  for (const e of pool) {
    const s = e.permit.stage_override ?? e.permit.stage ?? '';
    const rank = STAGE_RANK[s] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = s;
    }
  }
  return best;
}

/** First non-null value of `pick(e)` across permits. v1 uses the first
 *  permit's ent/da/dm; collapsing follows the same heuristic so disparity
 *  doesn't get loud — Bobby asked for "first non-null" not "most-frequent". */
function firstNonNull(
  permits: EnrichedPermit[],
  pick: (e: EnrichedPermit) => string | null | undefined,
): string | null {
  for (const e of permits) {
    const v = pick(e);
    if (v) return v;
  }
  return null;
}

/** Minimum of ISO date strings (lexical compare = chronological for
 *  YYYY-MM-DD). Returns null when no permit has the field set. */
function minDate(values: (string | null | undefined)[]): string | null {
  const real = values.filter((v): v is string => !!v);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a < b ? a : b));
}

function maxDate(values: (string | null | undefined)[]): string | null {
  const real = values.filter((v): v is string => !!v);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a > b ? a : b));
}

export function aggregateByProject(enriched: EnrichedPermit[]): ProjectRow[] {
  const byProject = new Map<string, EnrichedPermit[]>();
  for (const e of enriched) {
    const list = byProject.get(e.permit.project_id) ?? [];
    list.push(e);
    byProject.set(e.permit.project_id, list);
  }
  const rows: ProjectRow[] = [];
  for (const [projectId, permits] of byProject) {
    const activeCount = permits.filter(
      (e) => !e.permit.actual_issue && !e.permit.approval_date,
    ).length;
    // fix-22 Mig 3: units is project-level now — single canonical value
    // shared across all permits at the address.
    const units = permits[0]?.units ?? null;
    rows.push({
      projectId,
      address: permits[0]?.address ?? '',
      juris: permits[0]?.juris ?? '',
      permits,
      permitCount: permits.length,
      activeCount,
      dominantStage: pickDominantStage(permits),
      ent: firstNonNull(permits, (e) => e.permit.ent_lead),
      da: firstNonNull(permits, (e) => e.permit.da),
      dm: firstNonNull(permits, (e) => e.permit.dm),
      // fix-22 Mig 3: go_date is project-level; every enriched permit at
      // the same project carries the same goDate. Just pull from permits[0].
      earliestGoDate: permits[0]?.goDate ?? null,
      avgGoToDDStart: meanOrNull(permits.map((e) => e.goToDDStart)),
      avgDDDuration: meanOrNull(permits.map((e) => e.ddDuration)),
      avgDDEndToSubmit: meanOrNull(permits.map((e) => e.ddEndToSubmit)),
      avgGoToSubmit: meanOrNull(permits.map((e) => e.goToSubmit)),
      avgSubmitToIntake: meanOrNull(permits.map((e) => e.submitToIntake)),
      // fix-141: ProjectRow.avgCityReview still surfaces the intake →
      // approval clock (now permitTimelineDays) for the ReportTable — the
      // per-project ledger keeps its existing column semantics until fix-142
      // reconciles the table with the redefined Overview metric.
      avgCityReview: meanOrNull(permits.map((e) => e.permitTimelineDays)),
      latestAcqTarget: maxDate(permits.map((e) => e.permit.expected_issue)),
      earliestApproval: minDate(permits.map((e) => e.permit.approval_date)),
      earliestActualIssue: minDate(permits.map((e) => e.permit.actual_issue)),
      variance: meanOrNull(permits.map((e) => e.variance)),
      // Q9.5.f-fix-12: v1 actualCorrRounds = count of cycles WITH
      // corr_issued (index.html:3243). Old .length math counted every
      // cycle row including the cy0 placeholder, giving Rounds=2 on a
      // permit that's only seen one correction round.
      maxCorrRounds: permits.reduce(
        (m, e) =>
          Math.max(
            m,
            (e.permit.permit_cycles ?? []).filter((c) => c.corr_issued).length,
          ),
        0,
      ),
      units,
    });
  }
  return rows;
}

// Q9.5.f-fix-5: ledger-local smart search. Splits on whitespace + comma,
// then requires every token to find a match in the project + ANY of its
// permits' searchable fields. Permit-level hits qualify the whole project
// row (matches v1's rt-search behavior at index.html:1158-1196).
export function matchesLedgerSearch(row: ProjectRow, query: string): boolean {
  const tokens = query.toLowerCase().split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const parts: (string | null | undefined)[] = [row.address, row.juris];
  for (const e of row.permits) {
    parts.push(
      e.permit.type,
      e.permit.num,
      e.permit.ent_lead,
      e.permit.da,
      e.permit.dual_da,
      e.permit.dm,
      e.permit.permit_owner,
      e.permit.nickname,
      e.permit.status,
      // fix-22 Mig 3: product types live on the joined project.
      // fix-91: now an array — join for the search haystack.
      e.productTypes.join(' '),
    );
  }
  const haystack = parts
    .filter((p): p is string => Boolean(p))
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

/** Project-level "fully issued" check: every permit at the address has
 * actual_issue set. Used by the status filter. */
function buildFullyIssuedProjectIds(
  enriched: EnrichedPermit[],
): Set<string> {
  const byProject = new Map<string, EnrichedPermit[]>();
  for (const e of enriched) {
    const list = byProject.get(e.permit.project_id) ?? [];
    list.push(e);
    byProject.set(e.permit.project_id, list);
  }
  const out = new Set<string>();
  for (const [pid, list] of byProject) {
    // fix-221: a project is "fully issued" when every permit has effectively
    // issued — actually issued OR approved-awaiting-issuance (counts as done).
    if (list.every((e) => isEffectivelyIssued(e.permit))) out.add(pid);
  }
  return out;
}

export function filterEnrichedPermits(
  enriched: EnrichedPermit[],
  filters: ReportFilters,
  today: Date = new Date(),
): EnrichedPermit[] {
  const { from, to } = resolveDateRange(filters, today);
  const fullyIssued = buildFullyIssuedProjectIds(enriched);
  // fix-204: the windowed cohort anchors on the project's DD start (when it
  // started drawing), shared with Trends via buildProjectDdStartMap.
  const ddStartByProject = buildProjectDdStartMap(enriched.map((e) => e.permit));

  return enriched.filter((e) => {
    const p = e.permit;
    if (filters.types.size > 0 && p.type && !filters.types.has(p.type)) return false;
    if (filters.jurisdictions.size > 0 && !filters.jurisdictions.has(e.juris)) return false;
    if (filters.ents.size > 0 && !filters.ents.has(p.ent_lead ?? '')) return false;

    // fix-204: a windowed cohort is anchored on the PROJECT's DD start (the
    // project's BP dd_start, else its earliest permit dd_start). A permit whose
    // project has NO dd_start is EXCLUDED whenever a date range is applied — so
    // all of a project's permits sit in the same quarter (its dd_start quarter)
    // and a project never splits across windows. When no window is active
    // (range='all' → from/to null) nothing is date-filtered.
    //
    // fix-203 had anchored this on go_date (excluding null go_date under a
    // window); fix-204 moved the anchor to dd_start because the GO→DD-start gap
    // misattributed the quarter. Metric VALUES (incl. the GO→* formulas) still
    // measure from go_date — only cohort membership moved.
    if (from || to) {
      const ddStart = ddStartByProject.get(p.project_id) ?? null;
      if (!ddStart) return false;
      const dd = new Date(`${ddStart}T00:00:00`);
      if (from && dd < from) return false;
      if (to && dd > to) return false;
    }

    if (filters.status === 'active' && fullyIssued.has(p.project_id)) return false;
    if (filters.status === 'issued' && !fullyIssued.has(p.project_id)) return false;

    // fix-113-a: permit-level status filter. Independent from the project
    // rollup above — a project with a mix of statuses can still surface the
    // permits the user is looking for here.
    if (filters.permitStatus && filters.permitStatus !== 'all') {
      if (p.status !== filters.permitStatus) return false;
    }

    if (filters.productTypes.size > 0) {
      // fix-91: product types is multi-valued on the project. Match any-of:
      // a row passes when its productTypes intersect the selected filter
      // set. Rows with no product types fail when the filter is active.
      const hit = e.productTypes.some((t) => filters.productTypes.has(t));
      if (!hit) return false;
    }

    if (filters.tags.size > 0) {
      const hasAny = [...filters.tags].some((t) => e.projectTags.includes(t));
      if (!hasAny) return false;
    }

    if (filters.search.trim()) {
      // Search joins task-style: address, juris, ent_lead, da, dm, type,
      // product_types, permit_num.
      const hay = [
        e.address,
        e.juris,
        p.ent_lead,
        p.da,
        p.dm,
        p.type,
        e.productTypes.join(' '),
        p.num,
      ]
        .filter((s): s is string => Boolean(s))
        .join(' ');
      if (!multiMatchAddress(filters.search, hay)) return false;
    }
    return true;
  });
}

// ============================================================
// Metric computation
// ============================================================

export interface ReportMetrics {
  totalPermits: number;
  /** Sum of bp.units across DISTINCT project addresses (each address
   * counted once even if multiple permits at it). */
  totalUnits: number;
  /** Submit variance: firstSubmitted - target_submit, averaged. */
  avgSubmitVariance: number | null;
  onTimeSubmits: number;
  lateSubmits: number;
  avgGoToSubmit: number | null;
  avgGoToDDStart: number | null;
  /** fix-141: REDEFINED. "Time the ball was in the city's court" — sum of
   *  per-review-cycle durations (cityCourtTimeDays). No longer the
   *  intake → approval clock (that moved to avgPermitTimeline). */
  avgCityReview: number | null;
  /** fix-141: intake → approval total elapsed (permitTimelineDays). This is
   *  what fix-140-b's Avg Permit Timeline tile reads — split off from
   *  avgCityReview so the two tiles can diverge cleanly. */
  avgPermitTimeline: number | null;
  /** fix-141: NEW. "Time the ball was in our court" — sum of
   *  (corr_issued → next cycle submitted) across review cycles
   *  (responseCourtTimeDays). */
  avgResponseTime: number | null;
  avgSubmitToIntake: number | null;
  /** fix-173: avg(actual_issue − approval_date) in days, hold-aware. The final
   *  issuance step — sibling of avgSubmitToIntake. */
  avgApprovalToIssue: number | null;
  /** Average corr_rounds across permits where corr_rounds > 0. */
  avgCorrectionCycles: number | null;
  permitsWithCorrections: number;
  inCorrections: number;
  issuedCount: number;
  /** approval_date ?? actual_issue minus expected_issue, averaged. */
  avgScheduleVariance: number | null;
  avgDDDuration: number | null;
  avgDDEndToSubmit: number | null;
  /** fix-203: per-metric SAMPLE SIZE — the count of permits that actually fed
   *  each number (an average silently drops permits missing its end date, so a
   *  completion metric's n can be far below the cohort). Keyed by the card slug;
   *  the denominator is `totalPermits` (the cohort size). Reconciles with the
   *  fix-184 drill-in row count for the Phase-A metrics. For count metrics
   *  (totalPermits / inCorrections / issuedCount) n == the count itself. */
  sampleSizes: Record<string, number>;
}

function avg(values: (number | null)[]): number | null {
  // fix-140-a: NaN guard. Pre-fix this filtered only on `!== null`, so a
  // single Invalid Date in the cohort (e.g. a six-digit-year typo) leaked
  // a NaN into the reduce and the entire metric rendered as "NaN" / "NaN d".
  // `daysBetween` now returns null on Invalid Dates upstream, but keep the
  // belt-and-suspenders filter here so any future helper that forgets the
  // null-on-NaN convention can't poison the metric.
  const real = values.filter(
    (v): v is number => v !== null && !Number.isNaN(v),
  );
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

/** fix-203: count of non-null (non-NaN) values — the SAME gate `avg()` uses to
 *  pick what feeds an average. So `countSamples(xs)` is the sample size behind
 *  `avg(xs)`. */
function countSamples(values: (number | null)[]): number {
  return values.filter((v): v is number => v !== null && !Number.isNaN(v)).length;
}

/** Compute the 11 v1 metric cards from a filtered, enriched permit set. */
export function computeMetrics(
  enriched: EnrichedPermit[],
  // fix-171 (effect B): per-project holds for the sum-over-cycles court-time
  // tiles (City Review / Response Time). Omitted → raw, byte-identical.
  holdsByProjectId?: Map<string, ProjectHold[]>,
): ReportMetrics {
  // Total units: sum across distinct projects. fix-22 Mig 3: units lives
  // on the project (single canonical value); every enriched permit at the
  // same project carries the same `units`.
  //
  // fix-113-c: dedup by permit.project_id, not by address. Two distinct
  // projects with the same address string (slightly different formatting,
  // abbreviation, trailing whitespace) used to collapse and lose one of
  // the unit counts. Project IDs are guaranteed unique; addresses are not.
  const seenProjects = new Set<string>();
  let totalUnits = 0;
  for (const e of enriched) {
    if (seenProjects.has(e.permit.project_id)) continue;
    seenProjects.add(e.permit.project_id);
    totalUnits += e.units ?? 0;
  }

  // Submit variance breakdown.
  const submitVariances: number[] = [];
  for (const e of enriched) {
    if (e.firstSubmitted && e.permit.target_submit) {
      submitVariances.push(
        Math.round(
          (new Date(`${e.firstSubmitted}T12:00:00Z`).getTime() -
            new Date(`${e.permit.target_submit}T12:00:00Z`).getTime()) /
            DAY_MS,
        ),
      );
    }
  }
  const onTimeSubmits = submitVariances.filter((d) => d <= 0).length;
  const lateSubmits = submitVariances.filter((d) => d > 0).length;
  const avgSubmitVariance =
    submitVariances.length === 0
      ? null
      : Math.round(submitVariances.reduce((a, b) => a + b, 0) / submitVariances.length);

  // Correction-cycles: average across permits where corr_rounds > 0.
  const corrRoundsSet = enriched.filter((e) => (e.permit.corr_rounds ?? 0) > 0);
  const avgCorrectionCycles =
    corrRoundsSet.length === 0
      ? null
      : Math.round(
          (corrRoundsSet.reduce((s, e) => s + (e.permit.corr_rounds ?? 0), 0) /
            corrRoundsSet.length) *
            10,
        ) / 10;

  // fix-214: "In Corrections" now uses the unified hybrid test (corr_issued OR
  // reviewer-rollup == corrections) with the permit's reviewer rows, so this
  // count agrees with the Dashboard bucket + the weekly report. When enrichPermits
  // was called without a reviewers map, e.reviewers is [] and this reduces to the
  // corr_issued half — byte-identical to the prior effectiveStage('co') behavior.
  let inCorrections = 0;
  let issuedCount = 0;
  for (const e of enriched) {
    if (isPermitInCorrections(e.permit, e.permit.permit_cycles ?? [], e.reviewers)) {
      inCorrections++;
    }
    // fix-221: "effective issued" — an approved-not-issued permit (approval_date
    // set, no actual_issue, non-terminal status) counts as issued using its
    // approval_date. Bobby's call: these ARE done for our purposes. Actually-
    // issued permits are unchanged (still counted via actual_issue).
    if (isEffectivelyIssued(e.permit)) issuedCount++;
  }

  // fix-203: build each average metric's value array ONCE so its sample size
  // (countSamples) is the exact set its average (avg) used. The three court-time
  // tiles are per-metric cohorts — a permit can contribute to one and not the
  // others (City Review = sum-over-cycles city-court; Permit Timeline = the
  // intake → approval clock; Response Time = sum-over-cycles our-court).
  const goToSubmit = enriched.map((e) => e.goToSubmit);
  const goToDDStart = enriched.map((e) => e.goToDDStart);
  const cityReview = enriched.map((e) =>
    cityCourtTimeDays(e.permit, holdsByProjectId?.get(e.permit.project_id)),
  );
  const permitTimeline = enriched.map((e) => e.permitTimelineDays);
  const responseTime = enriched.map((e) =>
    responseCourtTimeDays(e.permit, holdsByProjectId?.get(e.permit.project_id)),
  );
  const submitToIntake = enriched.map((e) => e.submitToIntake);
  const approvalToIssue = enriched.map((e) => e.approvalToIssue);
  const scheduleVariance = enriched.map((e) => e.variance);
  const ddDuration = enriched.map((e) => e.ddDuration);
  const ddEndToSubmit = enriched.map((e) => e.ddEndToSubmit);

  // fix-203: per-metric sample sizes. Keys match the MetricCards card slugs +
  // the fix-184 drill-in keys so the n= label reconciles with the drill-in.
  const sampleSizes: Record<string, number> = {
    totalPermits: enriched.length,
    totalUnits: seenProjects.size,
    submitVariance: submitVariances.length,
    avgGoToSubmit: countSamples(goToSubmit),
    avgGoToDDStart: countSamples(goToDDStart),
    avgCityReview: countSamples(cityReview),
    avgPermitTimeline: countSamples(permitTimeline),
    avgResponseTime: countSamples(responseTime),
    avgSubmitToIntake: countSamples(submitToIntake),
    avgApprovalToIssue: countSamples(approvalToIssue),
    avgCorrectionCycles: corrRoundsSet.length,
    inCorrections,
    issuedCount,
    avgScheduleVariance: countSamples(scheduleVariance),
    avgDDDuration: countSamples(ddDuration),
    avgDDEndToSubmit: countSamples(ddEndToSubmit),
  };

  return {
    totalPermits: enriched.length,
    totalUnits,
    avgSubmitVariance,
    onTimeSubmits,
    lateSubmits,
    avgGoToSubmit: avg(goToSubmit),
    avgGoToDDStart: avg(goToDDStart),
    avgCityReview: avg(cityReview),
    avgPermitTimeline: avg(permitTimeline),
    avgResponseTime: avg(responseTime),
    avgSubmitToIntake: avg(submitToIntake),
    // fix-173: held-aware approval→issue (computed per-permit in enrichPermits).
    avgApprovalToIssue: avg(approvalToIssue),
    avgCorrectionCycles,
    permitsWithCorrections: corrRoundsSet.length,
    inCorrections,
    issuedCount,
    avgScheduleVariance: avg(scheduleVariance),
    avgDDDuration: avg(ddDuration),
    avgDDEndToSubmit: avg(ddEndToSubmit),
    sampleSizes,
  };
}
