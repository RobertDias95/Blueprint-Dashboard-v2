import type { PermitWithCycles, Project, ProjectHold } from './database.types';
import { OUTLIER_HARD_CAP_DAYS } from './scheduleBenchmarks';
import { heldOverlapDays, holdsForPermit } from './holdOverlap';
import { pacificToday } from './intakeWarning';

// fix-25-feat-AA: target_submit learner — the team's actual anchor→submitted
// clock for each (type, juris) cohort.
//
// fix-37: no cross-juris borrowing — a jurisdiction without its own data never
// takes another jurisdiction's timeline.
//
// ★★★ fix-680 (P-318 #7): THE MEDIAN OF THE 5 MOST RECENT SUBMITTALS.
//   Bobby, 2026-10-15: "lets make it smart, lets see what our average is ...
//   using a rolling average i.e only take the data within the last quarter or
//   the 5 most recent data points or whatever we have". Shown that most types
//   have 0–1 submittals a quarter and one odd project swings an average, he
//   chose the median of the last 5 (fewer if that is all there is). The
//   Settings number is only the STARTING NUMBER, used until a type has its own
//   history in that city. This reverses fix-249 ("policy beats learner") and
//   retires the 90/180/365-day windows and recency weights here.
//   This module is the TS twin of bp_learn_target_submit_days /
//   bp_target_submit_observations — keep them in lockstep.
//
// "Open sample gate" — any permit with both anchor dates contributes,
// regardless of approval status. Negative samples (team submitted
// BEFORE anchor) are valid signal and pass the filter; the outlier
// cap is symmetric (|days| ≤ OUTLIER_HARD_CAP_DAYS).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which anchor a permit type's target_submit is computed against.
 *  `mirror_bp` is the inert case (G&C / LSM mirror BP.target_submit
 *  directly — no learner involved).
 *
 *  ★★★ fix-680: this is a COLUMN now — `permit_types.ts_anchor` — read by
 *  `bp_recompute_target_submits` and by every screen through
 *  `anchorForType()`. The old type switch (a copy of the server's hard-coded
 *  CASE) is gone, so a type added in Settings gets an anchor (GO date by
 *  default) without a code change. */
export type TargetSubmitAnchor =
  | 'dd_end'
  | 'go_date'
  | 'bp_c0_intake'
  | 'bp_c1_resub'
  | 'bp_actual_issue'
  | 'mirror_bp'
  /** ★ fix-680: the day the permit row was created in the Bridge. */
  | 'created'
  /** ★ fix-615 (gap 6): a type the server gives NO automatic target to. */
  | 'none';

/** Every value `permit_types_ts_anchor_check` allows, in the SQL's order. */
export const TARGET_SUBMIT_ANCHORS: readonly TargetSubmitAnchor[] = [
  'dd_end',
  'go_date',
  'bp_c0_intake',
  'bp_c1_resub',
  'bp_actual_issue',
  'mirror_bp',
  'created',
  'none',
];

/** The anchors the learner measures from (everything but mirror_bp / none).
 *  Mirrors the `p_anchor NOT IN (...)` guard in bp_learn_target_submit_days. */
export function isLearnableAnchor(anchor: TargetSubmitAnchor): boolean {
  return anchor !== 'mirror_bp' && anchor !== 'none';
}

/** A stored ts_anchor, checked. Anything unknown (or a row read before the
 *  column existed) is `none` — no automatic target, never a guess. */
export function parseTargetSubmitAnchor(raw: unknown): TargetSubmitAnchor {
  return typeof raw === 'string' &&
    (TARGET_SUBMIT_ANCHORS as readonly string[]).includes(raw)
    ? (raw as TargetSubmitAnchor)
    : 'none';
}

/** ★ fix-680: a type's anchor, read from the catalogue rows
 *  (`usePermitTypes().data`). A type with no catalogue row gets `none`, as
 *  the server's `COALESCE(pt.ts_anchor, 'none')` does. */
export function anchorForType(
  type: string | null | undefined,
  permitTypes:
    | ReadonlyArray<{ name: string; ts_anchor?: string | null }>
    | undefined,
): TargetSubmitAnchor {
  if (!type) return 'none';
  const row = (permitTypes ?? []).find((t) => t.name === type);
  return parseTargetSubmitAnchor(row?.ts_anchor);
}

/** ★ fix-680: Bobby's ruling — the median of the 5 MOST RECENT submittals
 *  (fewer if that is all there is). Mirrors `LIMIT 5` in the SQL. */
export const LEARNER_RECENT_COUNT = 5;

/** Postgres round(numeric) rounds half AWAY FROM ZERO; JS Math.round rounds
 *  half toward +Infinity. They disagree on exactly the case that matters here
 *  — an even-sized sample whose median lands on .5 — and they disagree in
 *  opposite directions for negative values. The TRAO cohort
 *  [8,23,70,75,122,167,191,196] has median 98.5: Postgres gives 99, and
 *  round(double precision) (which uses rint / banker's rounding) gives 98.
 *  The SQL casts to numeric for this reason; this function is the TS twin. */
export function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Median of a sample set, rounded to whole days. MEDIAN, not average — a
 *  couple of slow permits shouldn't drag the number the way an average does.
 *  The SQL's `round(percentile_cont(0.5) ... ::numeric)`. */
export function medianDays(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw =
    sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  return roundHalfAwayFromZero(raw);
}

export interface TargetSubmitSample {
  permitId: number;
  type: string;
  juris: string;
  anchor: TargetSubmitAnchor;
  anchorDate: string;
  submittedAt: string;
  daysAnchorToSubmit: number;
  /** Used for ordering — equals submittedAt by spec. Kept separate so
   *  callers don't have to remember the convention. */
  recencyDate: string;
}

/** Where a target-submit number came from (fix-680). */
export type TargetSubmitLearnSource = 'learned' | 'starting' | 'none';

export interface LearnResult {
  /** Days from the anchor, or null when there is no history and no
   *  starting number (no automatic target). */
  value: number | null;
  source: TargetSubmitLearnSource;
  /** Submittals the median was taken over (<= LEARNER_RECENT_COUNT). */
  sampleCount: number;
  /** Every usable submittal on record for the cohort. */
  totalSamples: number;
}

function daysBetween(a: string, b: string): number {
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((bMs - aMs) / DAY_MS);
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
    case 'created':
      // The SQL's `(created_at AT TIME ZONE 'America/Los_Angeles')::date`.
      return permit.created_at
        ? pacificToday(new Date(permit.created_at))
        : null;
    case 'mirror_bp':
    case 'none':
      return null;
  }
}

/** Extract one sample from a permit. Returns null when either anchor
 *  or c0.submitted is missing — those permits don't contribute. */
export function extractTargetSubmitSample(
  permit: PermitWithCycles,
  project: Project | undefined,
  bpSibling: PermitWithCycles | undefined,
  /** fix-680: the type's anchor (anchorForType) — no longer derived here. */
  anchor: TargetSubmitAnchor,
  // fix-171 / ★ fix-680: the permit's hold windows (project + permit holds).
  // The held days inside the anchor→submit span are SUBTRACTED — fix-668's
  // "hold time never counts", exactly as the SQL's bp_held_days term does.
  // (fix-171 used to DROP the whole sample; the server has subtracted since
  // fix-668, so the two disagreed.) Omitted / no holds → unchanged.
  holds?: ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>,
): TargetSubmitSample | null {
  if (!permit.type) return null;
  if (!isLearnableAnchor(anchor)) return null;
  const anchorDate = getAnchorDate(permit, project, bpSibling, anchor);
  if (!anchorDate) return null;
  const c0 = (permit.permit_cycles ?? []).find((c) => c.cycle_index === 0);
  const submittedAt = c0?.submitted ?? null;
  if (!submittedAt) return null;
  const rawDays = daysBetween(anchorDate, submittedAt);
  // Symmetric hard cap — drop extreme outliers (data errors) on both
  // sides. Negative values within the cap are real signal (team
  // submitted before the anchor, e.g., PAR/Pre-Sub before go_date).
  // Applied to the RAW span, as the SQL's ABS(sub_on - anchor_on) is.
  if (Math.abs(rawDays) > OUTLIER_HARD_CAP_DAYS) return null;
  // ★ fix-680: for `created`, a permit submitted BEFORE its row existed was
  //   entered after the fact (a backfill) — its gap says nothing about lead
  //   time. Mirrors `(p_anchor <> 'created' OR s.sub_on >= s.anchor_on)`.
  if (anchor === 'created' && rawDays < 0) return null;
  const days = rawDays - heldOverlapDays(holds, anchorDate, submittedAt);
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

/** The BP that anchors a project's BP-derived anchors. ORDER BY id ASC
 *  matches the engine's "first BP wins" tiebreak. ANCHOR-ONLY: the Building
 *  Permit is the project's anchor permit here, not a per-type rule. */
function firstBpByProject(
  permits: PermitWithCycles[],
): Map<string, PermitWithCycles> {
  const bpByProject = new Map<string, PermitWithCycles>();
  for (const p of permits) {
    if (p.type !== 'Building Permit') continue;
    const existing = bpByProject.get(p.project_id);
    if (!existing || p.id < existing.id) bpByProject.set(p.project_id, p);
  }
  return bpByProject;
}

/** Every usable sample for the (type, juris) cohort. */
export function collectTargetSubmitSamples(
  permits: PermitWithCycles[],
  projects: Map<string, Project>,
  filter: { type: string; juris: string; anchor: TargetSubmitAnchor },
  holdsByProjectId?: Map<string, ProjectHold[]>,
): TargetSubmitSample[] {
  const bpByProject = firstBpByProject(permits);
  const out: TargetSubmitSample[] = [];
  for (const p of permits) {
    if (p.type !== filter.type) continue;
    const project = projects.get(p.project_id);
    if ((project?.juris ?? '') !== filter.juris) continue;
    const sample = extractTargetSubmitSample(
      p,
      project,
      bpByProject.get(p.project_id),
      filter.anchor,
      holdsForPermit(holdsByProjectId, p),
    );
    if (sample) out.push(sample);
  }
  return out;
}

/** ★ fix-680: the n most recent samples, newest first — by submitted date,
 *  ties by permit id (the SQL's `ORDER BY submitted DESC, permit_id DESC`). */
export function mostRecentSamples<
  T extends { recencyDate: string; permitId: number },
>(samples: readonly T[], n: number = LEARNER_RECENT_COUNT): T[] {
  return [...samples]
    .sort((a, b) => {
      if (a.recencyDate !== b.recencyDate) {
        return a.recencyDate < b.recencyDate ? 1 : -1;
      }
      return b.permitId - a.permitId;
    })
    .slice(0, n);
}

/** The learner over samples already collected: median of the 5 most recent,
 *  else the starting number, else null. */
export function learnFromSamples(
  samples: readonly TargetSubmitSample[],
  startingDays: number | null | undefined,
): LearnResult {
  const recent = mostRecentSamples(samples);
  const learned = medianDays(recent.map((s) => s.daysAnchorToSubmit));
  if (learned !== null) {
    return {
      value: learned,
      source: 'learned',
      sampleCount: recent.length,
      totalSamples: samples.length,
    };
  }
  const starting = startingDays ?? null;
  return {
    value: starting,
    source: starting === null ? 'none' : 'starting',
    sampleCount: 0,
    totalSamples: 0,
  };
}

/** Top-level entry point: target_submit days for (type, juris). The TS twin
 *  of `bp_learn_target_submit_days` (fix-680):
 *    1. history → the MEDIAN of the 5 most recent submittals;
 *    2. none → the starting number from Settings (the caller resolves it:
 *       city row, then the type row — `resolveTargetSubmitOffset`);
 *    3. neither → null (no automatic target).
 *  Mirror / none anchors have no learner and return source 'none'. */
export function computeLearnedTargetSubmit(
  permits: PermitWithCycles[],
  projects: Map<string, Project>,
  filter: {
    type: string;
    juris: string;
    anchor: TargetSubmitAnchor;
    startingDays?: number | null;
  },
  // fix-171: per-project holds — held samples are dropped. Omitted → unchanged.
  holdsByProjectId?: Map<string, ProjectHold[]>,
): LearnResult {
  if (!isLearnableAnchor(filter.anchor)) {
    return { value: null, source: 'none', sampleCount: 0, totalSamples: 0 };
  }
  const samples = collectTargetSubmitSamples(
    permits,
    projects,
    { type: filter.type, juris: filter.juris, anchor: filter.anchor },
    holdsByProjectId,
  );
  return learnFromSamples(samples, filter.startingDays);
}
