import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from './database.types';
import { multiMatchAddress } from './drawScheduleHelpers';
import { effectiveStage } from './permitStage';

// Q7.2.a: pure helpers for the Reports view. Mirrors v1's getRptFiltered
// (index.html 2905-2988) + renderReports metric computations (5499-5540)
// under v2's relational shape (juris on projects, no acq_lead column).

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// Enriched permit shape
// ============================================================

export interface EnrichedPermit {
  permit: PermitWithCycles;
  /** Project address — joined from projects table. */
  address: string;
  /** Jurisdiction — lives on the project, not the permit, in v2. */
  juris: string;
  /** Project-level product_type (preferred over permit's own if both set). */
  productType: string;
  /** project_tags merged (preferring any permit at the address that has them set). */
  projectTags: string[];
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
  /** review-start → first corr_issued (or actual_issue if no corrections) in days.
   * review-start prefers intake_accepted, falls back to submitted. */
  cityReviewDays: number | null;
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

/** Days between two ISO dates (b - a). Returns null if either is missing. */
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((bMs - aMs) / DAY_MS);
}

/** Enrich a permit list with per-permit derived metrics + project joins.
 * Mirrors v1's getRptFiltered enrichment pass (index.html 2948-2987). */
export function enrichPermits(
  permits: PermitWithCycles[],
  projectsById: Map<string, Project>,
): EnrichedPermit[] {
  // First pass: build project → permits[] map so we can resolve project-
  // level fields (product_type, project_tags) that may be set on ANY
  // permit at the address. v1 does this lookup per-permit at line 2938.
  const permitsByProjectId = new Map<string, PermitWithCycles[]>();
  for (const p of permits) {
    const list = permitsByProjectId.get(p.project_id) ?? [];
    list.push(p);
    permitsByProjectId.set(p.project_id, list);
  }

  return permits.map<EnrichedPermit>((permit) => {
    const project = projectsById.get(permit.project_id);
    const sibling = permitsByProjectId.get(permit.project_id) ?? [permit];
    const productTypeFromSibling = sibling.find((s) => s.product_type)?.product_type;
    const projectTagsFromSibling = sibling.find((s) => {
      return Array.isArray(s.project_tags) && (s.project_tags as unknown[]).length > 0;
    })?.project_tags as unknown[] | undefined;

    const firstSub = pickFirstSubmittedCycle(permit.permit_cycles ?? []);
    const firstSubmitted = firstSub?.submitted ?? null;
    const firstIntakeAccepted = firstSub?.intake_accepted ?? null;

    const goToSubmit = daysBetween(permit.go_date ?? null, firstSubmitted);
    const goToDDStart = daysBetween(permit.go_date ?? null, permit.dd_start ?? null);
    const ddDuration = daysBetween(permit.dd_start ?? null, permit.dd_end ?? null);
    const ddEndToSubmit = daysBetween(permit.dd_end ?? null, firstSubmitted);
    const submitToIntake = daysBetween(firstSubmitted, firstIntakeAccepted);

    // City review: from review-start to first corr_issued. Review-start
    // prefers intake_accepted (when city actually started reviewing) over
    // submitted (when we hit submit). Falls back to actual_issue when no
    // corrections cycle exists.
    const reviewStart = firstIntakeAccepted ?? firstSubmitted;
    const firstCorrCycle = (permit.permit_cycles ?? []).find((c) => c.corr_issued);
    const cityReviewDays =
      firstCorrCycle && reviewStart
        ? daysBetween(reviewStart, firstCorrCycle.corr_issued)
        : reviewStart && permit.actual_issue
          ? daysBetween(reviewStart, permit.actual_issue)
          : null;

    // Variance: expected_issue → (approval_date ?? actual_issue).
    const varianceTarget = permit.approval_date ?? permit.actual_issue ?? null;
    const variance = daysBetween(permit.expected_issue ?? null, varianceTarget);

    // Correction response: first cycle with BOTH corr_issued + resubmitted.
    const corrCycle = (permit.permit_cycles ?? []).find(
      (c) => c.corr_issued && c.resubmitted,
    );
    const corrResponseDays =
      corrCycle ? daysBetween(corrCycle.corr_issued, corrCycle.resubmitted) : null;

    const tags = Array.isArray(permit.project_tags)
      ? (permit.project_tags as unknown[]).filter(
          (t): t is string => typeof t === 'string',
        )
      : Array.isArray(projectTagsFromSibling)
        ? projectTagsFromSibling.filter((t): t is string => typeof t === 'string')
        : [];

    return {
      permit,
      address: project?.address ?? '',
      juris: project?.juris ?? '',
      productType: permit.product_type ?? productTypeFromSibling ?? '',
      projectTags: tags,
      firstSubmitted,
      firstIntakeAccepted,
      goToSubmit,
      goToDDStart,
      ddDuration,
      ddEndToSubmit,
      submitToIntake,
      cityReviewDays,
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
  /** 'active' = at least one permit at the address is NOT issued;
   *  'issued' = every permit at the address has actual_issue. */
  status: 'all' | 'active' | 'issued';
  /** Multi-token address/permit search. */
  search: string;
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
  let best = '';
  let bestRank = -1;
  for (const e of permits) {
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
    // Q9.5.f-fix-12: canonical units (not summed). v1 treats units as a
    // project-level number; every permit at the address carries it.
    const bp = permits.find((e) => e.permit.type === 'Building Permit');
    const unitsRaw = permits
      .map((e) => e.permit.units)
      .filter((u): u is number => u !== null && u !== undefined);
    const units =
      bp?.permit.units ??
      (unitsRaw.length === 0 ? null : Math.max(...unitsRaw));
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
      earliestGoDate: minDate(permits.map((e) => e.permit.go_date)),
      avgGoToDDStart: meanOrNull(permits.map((e) => e.goToDDStart)),
      avgDDDuration: meanOrNull(permits.map((e) => e.ddDuration)),
      avgDDEndToSubmit: meanOrNull(permits.map((e) => e.ddEndToSubmit)),
      avgGoToSubmit: meanOrNull(permits.map((e) => e.goToSubmit)),
      avgSubmitToIntake: meanOrNull(permits.map((e) => e.submitToIntake)),
      avgCityReview: meanOrNull(permits.map((e) => e.cityReviewDays)),
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
      e.permit.product_type,
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
    if (list.every((e) => e.permit.actual_issue)) out.add(pid);
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

  return enriched.filter((e) => {
    const p = e.permit;
    if (filters.types.size > 0 && p.type && !filters.types.has(p.type)) return false;
    if (filters.jurisdictions.size > 0 && !filters.jurisdictions.has(e.juris)) return false;
    if (filters.ents.size > 0 && !filters.ents.has(p.ent_lead ?? '')) return false;

    if (from && p.go_date) {
      if (new Date(`${p.go_date}T00:00:00`) < from) return false;
    }
    if (to && p.go_date) {
      if (new Date(`${p.go_date}T00:00:00`) > to) return false;
    }

    if (filters.status === 'active' && fullyIssued.has(p.project_id)) return false;
    if (filters.status === 'issued' && !fullyIssued.has(p.project_id)) return false;

    if (filters.productTypes.size > 0 && !filters.productTypes.has(e.productType)) {
      return false;
    }

    if (filters.tags.size > 0) {
      const hasAny = [...filters.tags].some((t) => e.projectTags.includes(t));
      if (!hasAny) return false;
    }

    if (filters.search.trim()) {
      // Search joins task-style: address, juris, ent_lead, da, dm, type,
      // product_type, permit_num.
      const hay = [
        e.address,
        e.juris,
        p.ent_lead,
        p.da,
        p.dm,
        p.type,
        e.productType,
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
  avgCityReview: number | null;
  avgSubmitToIntake: number | null;
  /** Average corr_rounds across permits where corr_rounds > 0. */
  avgCorrectionCycles: number | null;
  permitsWithCorrections: number;
  inCorrections: number;
  issuedCount: number;
  /** approval_date ?? actual_issue minus expected_issue, averaged. */
  avgScheduleVariance: number | null;
  avgDDDuration: number | null;
  avgDDEndToSubmit: number | null;
}

function avg(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

/** Compute the 11 v1 metric cards from a filtered, enriched permit set. */
export function computeMetrics(enriched: EnrichedPermit[]): ReportMetrics {
  // Total units: sum across distinct projects using the highest-units
  // permit at each address (v1 picks .find() — first match; close enough).
  const seenAddrs = new Set<string>();
  let totalUnits = 0;
  for (const e of enriched) {
    if (seenAddrs.has(e.address)) continue;
    seenAddrs.add(e.address);
    totalUnits += e.permit.units ?? 0;
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

  // Stage rollups (uses effectiveStage like v1).
  let inCorrections = 0;
  let issuedCount = 0;
  for (const e of enriched) {
    const stage = effectiveStage(e.permit, e.permit.permit_cycles ?? []);
    if (stage === 'co') inCorrections++;
    if (e.permit.actual_issue) issuedCount++;
  }

  return {
    totalPermits: enriched.length,
    totalUnits,
    avgSubmitVariance,
    onTimeSubmits,
    lateSubmits,
    avgGoToSubmit: avg(enriched.map((e) => e.goToSubmit)),
    avgGoToDDStart: avg(enriched.map((e) => e.goToDDStart)),
    avgCityReview: avg(enriched.map((e) => e.cityReviewDays)),
    avgSubmitToIntake: avg(enriched.map((e) => e.submitToIntake)),
    avgCorrectionCycles,
    permitsWithCorrections: corrRoundsSet.length,
    inCorrections,
    issuedCount,
    avgScheduleVariance: avg(enriched.map((e) => e.variance)),
    avgDDDuration: avg(enriched.map((e) => e.ddDuration)),
    avgDDEndToSubmit: avg(enriched.map((e) => e.ddEndToSubmit)),
  };
}
