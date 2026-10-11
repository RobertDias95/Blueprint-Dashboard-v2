import { roundHalfAwayFromZero } from './targetSubmitPolicy';
import { reviewerDue } from './reviewerRollup';

// ===========================================================================
// ★★★ fix-640 (P-335) — A DUE DATE FOR EVERY OPEN REVIEWER, ESTIMATED WHEN
//     THE CITY GIVES NONE
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-11: *"i want to show due dates. even if past due, this is
// our queue to go follow up with a reviewer. especially in 2+ rounds of
// reviews. if we do not know a review target date, maybe we can think of a
// smart way to create one? average review timeline for that discipline, in that
// jurisdiction, for that permit type, for that review cycle?"*
//
// ★★★ THE REVIEW LENGTH IS LEARNED BY THE ONE LEARNER (fix-585). The brief
//     asked for a new median calculator; fix-585's census forbids a second
//     duration learner. So `bp_duration_stats` learns a new clock —
//     `reviewer_review:<discipline>`, cycle_index = round, plus an any-type
//     ('*') copy — and `bp_reviewer_due_estimates` only READS its cells
//     (migrations/fix_640_estimated_reviewer_due_dates.sql). The popover asks
//     it for its own handful of open reviewers. The functions below marked
//     MIRROR are the same rule in TypeScript so CI can test it without a
//     database (the fix-153 pattern), pinned to the SQL text by
//     `EstimatedReviewerDueFix640.test.tsx`.
//
// ★★★ NO CROSS-JURISDICTION LEVEL. The brief's 4th level ("drop the
//     jurisdiction") is not built: Bobby, 2026-09-29 (fix-585) — "a city never
//     borrows another city's history." It answered 0 of 67 estimates on prod.
//
// ★★ A CITY DATE ALWAYS WINS — unless it is not a deadline at all. Measured on
//    prod 2026-10-11: 120 open reviewers carry a `target_date` equal to their
//    own `last_event_date`, i.e. the day the slot OPENED. That is the portal
//    echoing a date, not promising one, so it is treated as no date.

/** Each cell needs this many finished reviews — fix-585's LEARN_MIN_SAMPLES.
 *  fix-24i's learner used 3; measured on prod 2026-10-11, 3 would add one
 *  estimate out of 121 (the blanks are workflow steps with no history at all),
 *  so the steadier 5 holds. */
export const REVIEWER_ESTIMATE_MIN_SAMPLES = 5;

export type WindowTier = '90d' | '180d' | '365d' | 'all';

/** The learner's recency ladder, newest first (fix-585). `null` = all-time. */
export const REVIEWER_WINDOWS: readonly { tier: WindowTier; days: number | null }[] = [
  { tier: '90d', days: 90 },
  { tier: '180d', days: 180 },
  { tier: '365d', days: 365 },
  { tier: 'all', days: null },
];

/** fix-253's guards: same-day reviews are real and kept; > 730 d is data error. */
export const REVIEW_LENGTH_MAX_DAYS = 730;

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

function isoDay(v: string | null | undefined): string | null {
  const m = ISO.exec(v ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** MM/DD/YYYY — the popover's existing format (fix-638). */
export function usDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * ★★ Is the city's `target_date` a real deadline? Not when it is missing, and
 * not when it equals the slot's own open date (`last_event_date`).
 */
export function usableCityTarget(
  targetDate: string | null | undefined,
  lastEventDate: string | null | undefined,
): string | null {
  const t = isoDay(targetDate);
  if (!t) return null;
  if (t === isoDay(lastEventDate)) return null;
  return t;
}

// ---------------------------------------------------------------------------
// MIRROR of the SQL estimator
// ---------------------------------------------------------------------------

/** MIRROR of `bp_reviewer_discipline_key`: lower-case, trimmed, "_" → " ". */
export function disciplineKey(d: string | null | undefined): string | null {
  const k = (d ?? '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return k === '' ? null : k;
}

/** Round 1 is cycle 1; every later cycle is "round 2+". */
export function roundOf(cycleIndex: number): 1 | 2 {
  return cycleIndex <= 1 ? 1 : 2;
}

export interface ReviewKey {
  discipline: string | null;
  juris: string | null;
  permitType: string | null;
  round: 1 | 2;
}

/** One finished review: its key, its length in days (round start → verdict),
 *  and the day it ended (the verdict), which the recency ladder reads. */
export interface FinishedReview extends ReviewKey {
  days: number;
  endedOn: string;
}

export interface TypicalLength {
  /** 1 = discipline·juris·type·round, 2 = without the round, 3 = any type. */
  level: 1 | 2 | 3;
  window: WindowTier;
  days: number;
  n: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length / 2;
  const v = s.length % 2 ? s[Math.floor(mid)]! : (s[mid - 1]! + s[mid]!) / 2;
  return roundHalfAwayFromZero(v);
}

/**
 * MIRROR: the median at the first cell — level by level, and inside each level
 * newest window first — with enough finished reviews. Never across
 * jurisdictions: every level keeps the target's own.
 */
export function typicalReviewLength(
  target: ReviewKey,
  finished: readonly FinishedReview[],
  today: string,
  min = REVIEWER_ESTIMATE_MIN_SAMPLES,
): TypicalLength | null {
  const dkey = disciplineKey(target.discipline);
  if (!dkey || !target.juris) return null;
  const usable = finished.filter(
    (f) =>
      disciplineKey(f.discipline) === dkey &&
      f.juris === target.juris &&
      f.days >= 0 &&
      f.days <= REVIEW_LENGTH_MAX_DAYS,
  );
  const levels: ((f: FinishedReview) => boolean)[] = [
    (f) => f.permitType === target.permitType && f.round === target.round,
    (f) => f.permitType === target.permitType,
    () => true,
  ];
  for (let i = 0; i < levels.length; i += 1) {
    for (const w of REVIEWER_WINDOWS) {
      const since = w.days == null ? null : addDays(today, -w.days);
      const cohort = usable
        .filter(levels[i]!)
        .filter((f) => since == null || f.endedOn >= since)
        .map((f) => f.days);
      if (cohort.length >= min) {
        return { level: (i + 1) as 1 | 2 | 3, window: w.tier, days: median(cohort), n: cohort.length };
      }
    }
  }
  return null;
}

/** Calendar days added to a YYYY-MM-DD. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// What the database returns, and how the popover says it
// ---------------------------------------------------------------------------

/** One row of `bp_reviewer_due_estimates`. */
export interface ReviewerEstimate {
  reviewer_id: string;
  round_start: string;
  estimated_due: string;
  typical_days: number;
  sample_n: number;
  basis_level: 1 | 2 | 3;
  window_tier: WindowTier;
  juris: string | null;
  discipline: string | null;
  permit_type: string | null;
  round_label: string;
}

const TYPE_SHORT: Readonly<Record<string, string>> = {
  'Building Permit': 'BP',
  Demolition: 'Demo',
};

export function shortPermitType(t: string | null | undefined): string {
  const v = (t ?? '').trim();
  return TYPE_SHORT[v] ?? v;
}

const WINDOW_PHRASE: Readonly<Record<WindowTier, string>> = {
  '90d': ', last 90 days',
  '180d': ', last 180 days',
  '365d': ', last year',
  all: '',
};

type BasisFields = 'basis_level' | 'window_tier' | 'juris' | 'discipline' | 'permit_type' |
  'round_label' | 'typical_days' | 'sample_n';

/**
 * The tooltip: what the estimate is built on, naming only the parts the level
 * actually used, and the window when it is a recent one.
 *   "Typical for Seattle · building · BP · round 2+: 21 days (median of 34 reviews)."
 *   "Typical for Seattle · building: 18 days (median of 9 reviews, last 90 days)."
 */
export function estimateBasisText(e: Pick<ReviewerEstimate, BasisFields>): string {
  const discipline = disciplineKey(e.discipline) ?? 'this discipline';
  const parts: string[] = [];
  if (e.juris) parts.push(e.juris);
  parts.push(discipline);
  if (e.basis_level <= 2 && e.permit_type) parts.push(shortPermitType(e.permit_type));
  if (e.basis_level === 1) parts.push(e.round_label);
  const d = e.typical_days;
  return `Typical for ${parts.join(' · ')}: ${d} day${d === 1 ? '' : 's'} ` +
    `(median of ${e.sample_n} review${e.sample_n === 1 ? '' : 's'}${WINDOW_PHRASE[e.window_tier] ?? ''}).`;
}

export interface ReviewerDueLine {
  text: string;
  pastDue: boolean;
  estimated: boolean;
  /** The basis, for an estimate; null for a city date. */
  title: string | null;
}

/**
 * The due line for one OPEN reviewer, or null.
 *   city date   → "Due 10/14/2026" · "Due 10/09/2026 · past due"
 *   estimate    → "~Due 10/14/2026 (est.)" · "~Due 10/09/2026 (est.) · past due"
 * ★ A past-due ESTIMATE is still flagged — Bobby: "even if past due, this is our
 *   queue to go follow up with a reviewer."
 */
export function dueLine(
  cityTarget: string | null,
  estimate: Pick<ReviewerEstimate, 'estimated_due' | BasisFields> | null | undefined,
  today: string,
): ReviewerDueLine | null {
  if (cityTarget) {
    // ★ fix-638's formatting, reused — one "Due MM/DD/YYYY" in the codebase.
    const city = reviewerDue('in_review', cityTarget, today);
    return city ? { ...city, estimated: false, title: null } : null;
  }
  const est = isoDay(estimate?.estimated_due);
  if (!estimate || !est) return null;
  const pastDue = est < today;
  const base = `~Due ${usDay(est)} (est.)`;
  return {
    text: pastDue ? `${base} · past due` : base,
    pastDue,
    estimated: true,
    title: estimateBasisText(estimate),
  };
}
