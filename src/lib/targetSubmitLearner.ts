import type { PermitWithCycles, Project, ProjectHold } from './database.types';
import {
  WINDOW_TIERS_DAYS,
  MIN_SAMPLES_FOR_LEARNER,
  OUTLIER_HARD_CAP_DAYS,
  recencyWeight,
  type RecencyTier,
} from './scheduleBenchmarks';
import { intervalOverlapsHold } from './holdOverlap';

// fix-25-feat-AA: target_submit learner. Replaces fix-25-feat-J's
// hardcoded offsets (BP=+21d, Demo=+37d, ECA=+10d, etc.) with an
// average of the team's actual anchor→submitted clock for each
// (type, juris) cohort. Cascade mirrors the intake→approval learner:
// (type, juris) 90d → 180d → 365d → all-time, then hardcoded default.
//
// fix-37: the (type, *) cross-juris tier is removed — jurisdictions
// without own data fall straight to the hardcoded per-type offset
// rather than borrowing another jurisdiction's timeline.
//
// "Open sample gate" — any permit with both anchor dates contributes,
// regardless of approval status. Negative samples (team submitted
// BEFORE anchor) are valid signal and pass the filter; the outlier
// cap is symmetric (|days| ≤ OUTLIER_HARD_CAP_DAYS).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which anchor a permit type's target_submit is computed against.
 *  `mirror_bp` is the inert case (G&C / LSM mirror BP.target_submit
 *  directly — no learner involved). */
export type TargetSubmitAnchor =
  | 'dd_end'
  | 'go_date'
  | 'bp_c0_intake'
  | 'bp_c1_resub'
  | 'bp_actual_issue'
  | 'mirror_bp';

/** fix-25-feat-J's offset table — surfaces as tier-5 fallback when no
 *  cohort signal exists at any window or jurisdiction scope. Mirrors
 *  the WHEN branches in bp_recompute_target_submits pre-feat-AA. */
export const HARDCODED_TARGET_SUBMIT_OFFSETS: Record<string, number> = {
  'Building Permit': 21,
  Demolition: 37,
  'ECA Waiver': 10,
  IPR: 7,
  ULS: 7,
  LBA: 37,
  'Short Plat': 37,
  SIP: 37,
  'PAR/Pre-Sub': 10,
  'SDOT Tree': 10,
  TRAO: 10,
  // Condo's hardcoded was "BP actual_issue + 4mo + 7d" — encoded as
  // approximate days (4 months ≈ 122 days, +7d = 129d). The engine
  // formerly used INTERVAL '4 months' but for the learner default a
  // day-count is fine since the anchor is bp_actual_issue.
  Condo: 129,
};

export function anchorFor(type: string | null | undefined): TargetSubmitAnchor {
  switch (type) {
    case 'Building Permit':
      return 'dd_end';
    case 'Demolition':
      return 'bp_c0_intake';
    case 'IPR':
    case 'ULS':
      return 'bp_c1_resub';
    case 'Condo':
      return 'bp_actual_issue';
    case 'ECA Waiver':
    case 'PAR/Pre-Sub':
    case 'SDOT Tree':
    case 'TRAO':
    case 'LBA':
    case 'Short Plat':
    case 'SIP':
      return 'go_date';
    case 'Grading / Clearing':
    case 'LSM':
      return 'mirror_bp';
    default:
      return 'mirror_bp';
  }
}

export interface TargetSubmitSample {
  permitId: number;
  type: string;
  juris: string;
  anchor: TargetSubmitAnchor;
  anchorDate: string;
  submittedAt: string;
  daysAnchorToSubmit: number;
  /** Used for windowing — equals submittedAt by spec. Kept separate so
   *  callers don't have to remember the convention. */
  recencyDate: string;
}

export interface CascadeResult {
  /** Average days from anchor → c0.submitted, or null when every tier
   *  was empty (caller falls back to hardcoded default). */
  value: number | null;
  source: RecencyTier;
  sampleCount: number;
  /** True if the winning tier was the cross-juris (type, *) scope. */
  isCrossJuris: boolean;
}

function daysBetween(a: string, b: string): number {
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((bMs - aMs) / DAY_MS);
}

function tierLabelFor(windowDays: number | null): RecencyTier {
  if (windowDays === 90) return 'last_90d';
  if (windowDays === 180) return 'last_180d';
  if (windowDays === 365) return 'last_365d';
  return 'all_time';
}

/** Pull the relevant anchor date for one permit, given its project +
 *  any same-project BP sibling. Returns null when the anchor is
 *  unavailable (e.g., Demo with no BP yet, or BP without dd_end). */
function getAnchorDate(
  permit: PermitWithCycles,
  project: Project | undefined,
  bpSibling: PermitWithCycles | undefined,
  anchor: TargetSubmitAnchor,
): string | null {
  switch (anchor) {
    case 'dd_end':
      return permit.dd_end ?? null;
    case 'go_date':
      return project?.go_date ?? null;
    case 'bp_c0_intake':
      if (!bpSibling) return null;
      return (
        (bpSibling.permit_cycles ?? []).find((c) => c.cycle_index === 0)
          ?.intake_accepted ?? null
      );
    case 'bp_c1_resub':
      if (!bpSibling) return null;
      return (
        (bpSibling.permit_cycles ?? []).find((c) => c.cycle_index === 1)
          ?.resubmitted ?? null
      );
    case 'bp_actual_issue':
      return bpSibling?.actual_issue ?? null;
    case 'mirror_bp':
      return null;
  }
}

/** Extract one sample from a permit. Returns null when either anchor
 *  or c0.submitted is missing — those permits don't contribute. */
export function extractTargetSubmitSample(
  permit: PermitWithCycles,
  project: Project | undefined,
  bpSibling: PermitWithCycles | undefined,
  // fix-171 (effect E for target_submit): the project's holds. A sample whose
  // anchor→submit span overlapped a hold is dropped so a parked clock doesn't
  // skew the learned offset (mirrors filterHeldLearningSamples). Omitted / no
  // holds → kept, so the common case is unchanged.
  holds?: ProjectHold[],
): TargetSubmitSample | null {
  if (!permit.type) return null;
  const anchor = anchorFor(permit.type);
  if (anchor === 'mirror_bp') return null;
  const anchorDate = getAnchorDate(permit, project, bpSibling, anchor);
  if (!anchorDate) return null;
  const c0 = (permit.permit_cycles ?? []).find((c) => c.cycle_index === 0);
  const submittedAt = c0?.submitted ?? null;
  if (!submittedAt) return null;
  if (intervalOverlapsHold(holds, anchorDate, submittedAt)) return null;
  const days = daysBetween(anchorDate, submittedAt);
  // Symmetric hard cap — drop extreme outliers (data errors) on both
  // sides. Negative values within the cap are real signal (team
  // submitted before the anchor, e.g., PAR/Pre-Sub before go_date).
  if (Math.abs(days) > OUTLIER_HARD_CAP_DAYS) return null;
  return {
    permitId: permit.id,
    type: permit.type,
    juris: project?.juris ?? '',
    anchor,
    anchorDate,
    submittedAt,
    daysAnchorToSubmit: days,
    recencyDate: submittedAt,
  };
}

interface CohortFilter {
  type: string;
  juris: string | null;
}

/** Build all available samples for the (type, juris | *) cohort by
 *  walking every permit; pairs each candidate with its same-project
 *  BP sibling (needed for the BP-anchored learners). */
function collectSamples(
  permits: PermitWithCycles[],
  projects: Map<string, Project>,
  filter: CohortFilter,
  holdsByProjectId?: Map<string, ProjectHold[]>,
): TargetSubmitSample[] {
  // Index BPs by project_id once for the bp_c0_intake / bp_c1_resub /
  // bp_actual_issue anchors. ORDER BY id ASC matches the engine's
  // "first BP wins" tiebreak.
  const bpByProject = new Map<string, PermitWithCycles>();
  for (const p of permits) {
    if (p.type !== 'Building Permit') continue;
    const existing = bpByProject.get(p.project_id);
    if (!existing || p.id < existing.id) bpByProject.set(p.project_id, p);
  }

  const out: TargetSubmitSample[] = [];
  for (const p of permits) {
    if (p.type !== filter.type) continue;
    const project = projects.get(p.project_id);
    if (filter.juris !== null && (project?.juris ?? '') !== filter.juris) continue;
    const bp = bpByProject.get(p.project_id);
    const sample = extractTargetSubmitSample(
      p,
      project,
      bp,
      holdsByProjectId?.get(p.project_id),
    );
    if (sample) out.push(sample);
  }
  return out;
}

/** Run a single cohort through the 4-tier window cascade + all-time
 *  pool. Returns the first tier with N ≥ gate. */
function cascadeForCohort(
  samples: TargetSubmitSample[],
  isCrossJuris: boolean,
  today: Date,
): CascadeResult | null {
  if (samples.length === 0) return null;

  for (const windowDays of WINDOW_TIERS_DAYS) {
    const cutoff = today.getTime() - windowDays * DAY_MS;
    const window = samples.filter(
      (s) =>
        new Date(`${s.recencyDate}T12:00:00Z`).getTime() >= cutoff,
    );
    if (window.length >= MIN_SAMPLES_FOR_LEARNER) {
      return {
        value: weightedMean(window, today),
        source: tierLabelFor(windowDays),
        sampleCount: window.length,
        isCrossJuris,
      };
    }
  }
  // All-time fallback within the same cohort.
  if (samples.length >= MIN_SAMPLES_FOR_LEARNER) {
    return {
      value: weightedMean(samples, today),
      source: 'all_time',
      sampleCount: samples.length,
      isCrossJuris,
    };
  }
  return null;
}

/** Weighted mean over a sample set. Each sample's weight comes from
 *  the existing recencyWeight() (half-life 18mo, floor 0.05) keyed
 *  on submittedAt. Within a 90d window the weights are near-uniform;
 *  in wider/all-time windows recency still wins on the margin. */
function weightedMean(samples: TargetSubmitSample[], now: Date): number {
  let sumWV = 0;
  let sumW = 0;
  for (const s of samples) {
    const w = recencyWeight(s.recencyDate, now);
    sumWV += s.daysAnchorToSubmit * w;
    sumW += w;
  }
  return sumW > 0 ? Math.round(sumWV / sumW) : 0;
}

/** Top-level entry point: target_submit days for (type, juris).
 *  Walks the (type, juris) cascade, then returns the hardcoded per-type
 *  offset + 'default' source when it misses.
 *
 *  fix-37: the (type, *) cross-juris tier is removed. A jurisdiction with
 *  no own learned anchor→submit signal now falls straight through to the
 *  hardcoded per-type offset, never borrowing another jurisdiction's
 *  timeline. isCrossJuris is always false now (retained for minimal churn).
 *
 *  Mirror types (G&C, LSM) return null with source='default' — the
 *  engine handles those via direct copy of BP.target_submit; the
 *  learner isn't a meaningful path for them. */
export function computeLearnedTargetSubmit(
  permits: PermitWithCycles[],
  projects: Map<string, Project>,
  filter: { type: string; juris: string },
  today: Date = new Date(),
  // fix-171: per-project holds — held samples are dropped from the offset
  // average. Omitted → unchanged.
  holdsByProjectId?: Map<string, ProjectHold[]>,
): CascadeResult {
  const anchor = anchorFor(filter.type);
  if (anchor === 'mirror_bp') {
    return { value: null, source: 'default', sampleCount: 0, isCrossJuris: false };
  }
  // (type, juris) only.
  const scoped = collectSamples(
    permits,
    projects,
    { type: filter.type, juris: filter.juris },
    holdsByProjectId,
  );
  const scopedResult = cascadeForCohort(scoped, false, today);
  if (scopedResult) return scopedResult;
  // Hardcoded per-type default — no cross-juris borrowing.
  const fallback = HARDCODED_TARGET_SUBMIT_OFFSETS[filter.type] ?? null;
  return {
    value: fallback,
    source: 'default',
    sampleCount: 0,
    isCrossJuris: false,
  };
}
