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
 *  the learner has no signal and no cycle activity exists. */
export function defaultDaysForType(type: string | null | undefined): number {
  if (!type) return PER_TYPE_FALLBACK_DAYS;
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
}

function avg(values: (number | null | undefined)[]): number | null {
  const real = values.filter((v): v is number => v !== null && v !== undefined && v > 0);
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

function buildEstimate(
  samples: LearnSample[],
  source: string,
  isAllTime: boolean,
  isCrossJuris: boolean,
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

  return {
    source,
    sampleCount: samples.length,
    dateRange,
    goToSubmit: avg(samples.map((s) => s.goToSubmitDays)),
    avgIntakeToApproval: avg(samples.map((s) => s.intakeToApprovalDays)),
    cityReview1: avg(cr1) ?? SCHEDULE_DEFAULTS.cityReview1,
    corrResponse1: avg(co1) ?? SCHEDULE_DEFAULTS.corrResponse1,
    cityReview2: avg(cr2) ?? SCHEDULE_DEFAULTS.cityReview2,
    corrResponse2: avg(co2) ?? SCHEDULE_DEFAULTS.corrResponse2,
    cityReview3: avg(cr3) ?? SCHEDULE_DEFAULTS.cityReview3,
    corrResponse3: avg(co3) ?? SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: avg(cr4) ?? SCHEDULE_DEFAULTS.cityReview4,
    corrResponse4: avg(co4) ?? SCHEDULE_DEFAULTS.corrResponse4,
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
  };
}

/** fix-24i: build estimate for a (type, juris | null) scope. juris=null is
 *  the cross-juris path (type, *). Returns null when the sample count is
 *  below MIN_SAMPLES_FOR_LEARNER. Caller orchestrates the fallback ladder. */
function computeForFilter(
  permits: PermitWithCycles[],
  projectsById: Map<string, Project>,
  type: string,
  juris: string | null,
  windowDays: number,
  today: Date,
  isCrossJuris: boolean,
): LearnedEstimate | null {
  const cutoff = new Date(today.getTime() - windowDays * DAY_MS);
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

  // Tier 1: approvals within the recent window.
  const recent = matchingApproved.filter((p) => {
    const d = p.approval_date ?? p.actual_issue;
    if (!d) return false;
    return new Date(`${d}T12:00:00Z`).getTime() >= cutoff.getTime();
  });
  const recentSamples = recent
    .map((p) => extractSample(p, projectsById.get(p.project_id)?.go_date ?? null))
    .filter((s): s is LearnSample => s !== null);
  if (recentSamples.length >= MIN_SAMPLES_FOR_LEARNER) {
    return buildEstimate(
      recentSamples,
      `Last ${windowDays}d · ${type} · ${jurisLabel}`,
      false,
      isCrossJuris,
    );
  }
  // Tier 2: all-time approved fallback within the same scope.
  const allSamples = matchingApproved
    .map((p) => extractSample(p, projectsById.get(p.project_id)?.go_date ?? null))
    .filter((s): s is LearnSample => s !== null);
  if (allSamples.length >= MIN_SAMPLES_FOR_LEARNER) {
    return buildEstimate(
      allSamples,
      `All-time · ${type} · ${jurisLabel}`,
      true,
      isCrossJuris,
    );
  }
  // Below the min-sample gate → caller falls through.
  return null;
}

/** fix-24i: orchestrator. Tries (type, juris) first, then (type, *), then
 *  returns null so the caller falls back to defaultDaysForType(type).
 *  Each scope respects MIN_SAMPLES_FOR_LEARNER and prefers the 180d
 *  recency window over the all-time pool. */
export function computeLearnedSchedule(
  permits: PermitWithCycles[],
  type: string,
  juris: string,
  projectsById: Map<string, Project>,
  today: Date = new Date(),
): LearnedEstimate | null {
  const windowDays = getLearnWindow(juris);
  // Tier A: (type, juris).
  const scoped = computeForFilter(
    permits,
    projectsById,
    type,
    juris,
    windowDays,
    today,
    false,
  );
  if (scoped) return scoped;
  // Tier B: (type, *) — any jurisdiction.
  const crossJuris = computeForFilter(
    permits,
    projectsById,
    type,
    null,
    windowDays,
    today,
    true,
  );
  if (crossJuris) return crossJuris;
  // No signal anywhere → caller uses defaultDaysForType(type).
  return null;
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
