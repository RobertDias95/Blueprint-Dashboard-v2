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
  submitToIssueDays: number | null;
  /** The first-review submitted date (anchor for date-range display). */
  submittedAnchor: string;
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((bMs - aMs) / DAY_MS);
}

/** Extract a learning sample from one approved/issued permit. Returns null
 * if the permit hasn't reached approval (incomplete lifecycle). */
export function extractSample(permit: PermitWithCycles): LearnSample | null {
  if (!permit.approval_date && !permit.actual_issue) return null;
  const cycles = (permit.permit_cycles ?? []).slice().sort(
    (a, b) => a.cycle_index - b.cycle_index,
  );
  const c1 = cycles.find((c) => c.cycle_index === 1);
  const c2 = cycles.find((c) => c.cycle_index === 2);
  const c3 = cycles.find((c) => c.cycle_index === 3);
  const c4 = cycles.find((c) => c.cycle_index === 4);

  const submittedAnchor = c1?.submitted ?? null;
  if (!submittedAnchor) return null; // can't compute review math without c1.submitted

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
    goToSubmitDays: daysBetween(permit.go_date, submittedAnchor),
    submitToIssueDays: daysBetween(submittedAnchor, approvalDate),
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
  avgSubmitToIssue: number | null;
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
}

function avg(values: (number | null | undefined)[]): number | null {
  const real = values.filter((v): v is number => v !== null && v !== undefined && v > 0);
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

function buildEstimate(samples: LearnSample[], source: string, isAllTime: boolean): LearnedEstimate | null {
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

  const subAnchors = samples.map((s) => s.submittedAnchor).filter(Boolean).sort();
  const dateFrom = subAnchors[0] ?? '';
  const dateTo = subAnchors[subAnchors.length - 1] ?? '';
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
    avgSubmitToIssue: avg(samples.map((s) => s.submitToIssueDays)),
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
  };
}

/** v1's three-tier learner. Returns null if no approved permits exist
 * for this (type, juris) combo — caller falls back to SCHEDULE_DEFAULTS. */
export function computeLearnedSchedule(
  permits: PermitWithCycles[],
  type: string,
  juris: string,
  projectsById: Map<string, Project>,
  today: Date = new Date(),
): LearnedEstimate | null {
  const windowDays = getLearnWindow(juris);
  const cutoff = new Date(today.getTime() - windowDays * DAY_MS);

  const matchingApproved = permits.filter((p) => {
    if (p.type !== type) return false;
    const project = projectsById.get(p.project_id);
    if (project?.juris !== juris) return false;
    return Boolean(p.approval_date || p.actual_issue);
  });
  if (matchingApproved.length === 0) return null;

  // Tier 1: permits whose approval/issue is within the recent window.
  const recent = matchingApproved.filter((p) => {
    const d = p.approval_date ?? p.actual_issue;
    if (!d) return false;
    return new Date(`${d}T12:00:00Z`).getTime() >= cutoff.getTime();
  });
  const recentSamples = recent.map(extractSample).filter((s): s is LearnSample => s !== null);
  if (recentSamples.length > 0) {
    return buildEstimate(
      recentSamples,
      `Last ${windowDays}d · ${type} · ${juris}`,
      false,
    );
  }
  // Tier 2: all-time approved fallback.
  const allSamples = matchingApproved.map(extractSample).filter((s): s is LearnSample => s !== null);
  if (allSamples.length > 0) {
    return buildEstimate(
      allSamples,
      `All-time · ${type} · ${juris}`,
      true,
    );
  }
  // Tier 3: no samples → caller uses SCHEDULE_DEFAULTS.
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
    const sample = extractSample(p);
    if (!sample) continue;
    const approval = p.approval_date ?? p.actual_issue ?? null;
    const inRecentWindow =
      !!approval &&
      new Date(`${approval}T12:00:00Z`).getTime() >= cutoff.getTime();
    out.push({
      permitId: p.id,
      projectId: p.project_id,
      address: project?.address ?? '—',
      type: p.type ?? '—',
      num: p.num,
      submitted: sample.submittedAnchor,
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
