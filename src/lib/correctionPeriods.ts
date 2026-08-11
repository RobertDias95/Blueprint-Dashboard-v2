import type { CorrectionReportRow } from './correctionsReport';
import { correctionThemeLabel } from './correctionsReport';
import { LOW_CONFIDENCE_N, type PrevalenceLevel } from './correctionsPrevalence';

// fix-281: time. Period presets, the preceding-period comparison, and the
// handful of dates that are not real.
//
// ── THE QUESTION THIS EXISTS TO ANSWER ──────────────────────────────────────
// "Is this correction becoming more or less common?" Prevalence alone says
// where to look; prevalence against the previous window of equal length says
// whether the template work is landing.
//
// ── WHY DATES NEED POLICING FIRST ───────────────────────────────────────────
// letter_date is populated on every row, and 10 of the 2,194 are impossible:
// five dated 2026-12-24 (all from one letter, `5603 - Zoning Corr 1.pdf`) and
// five dated 2022-06-04 (all from `SFR 2 - LU Corr 1 - SUMMARY.pdf`). Left in,
// a single future-dated letter drags a "last 90 days" window forward and a 2022
// one stretches "all time" across four years of nothing.
//
// They are EXCLUDED from period maths and COUNTED on screen. They are never
// corrected: a wrong date guessed into a plausible one is worse than a visible
// outlier, because the outlier can still be chased back to its letter.

/** Nothing in this corpus predates the indexer's own cutoff by much; a letter
 *  dated before this is a parse artefact, not a 2022 correction. */
export const PLAUSIBLE_FROM = '2025-01-01';

export interface DateSanity {
  total: number;
  plausible: number;
  future: number;
  tooOld: number;
  get implausible(): number;
}

/** `today` is injected rather than read from the clock so the tests are not
 *  time bombs and the whole page shares one notion of "now". */
export function isPlausibleLetterDate(
  date: string | null,
  today: string,
): boolean {
  if (!date) return false;
  return date >= PLAUSIBLE_FROM && date <= today;
}

export function dateSanity(
  rows: readonly CorrectionReportRow[],
  today: string,
): DateSanity {
  let future = 0;
  let tooOld = 0;
  let plausible = 0;
  for (const r of rows) {
    const d = r.letter_date;
    if (!d) {
      tooOld += 1; // no date at all cannot sit in a window either
      continue;
    }
    if (d > today) future += 1;
    else if (d < PLAUSIBLE_FROM) tooOld += 1;
    else plausible += 1;
  }
  return {
    total: rows.length,
    plausible,
    future,
    tooOld,
    get implausible() {
      return this.future + this.tooOld;
    },
  };
}

/** Rows whose date can be placed in a window. */
export function plausibleRows(
  rows: readonly CorrectionReportRow[],
  today: string,
): CorrectionReportRow[] {
  return rows.filter((r) => isPlausibleLetterDate(r.letter_date, today));
}

// ------------------------------------------------------------------ periods --

export type PeriodPreset = 'ytd2026' | 'last90' | 'last12m' | 'all' | 'custom';

export interface Period {
  /** Inclusive ISO bounds. `from` empty on 'all'. */
  from: string;
  to: string;
  label: string;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export const PERIOD_PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  // 2026 YTD leads: it is the window the business is actually trying to improve.
  { key: 'ytd2026', label: '2026 YTD' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'last12m', label: 'Last 12 months' },
  { key: 'all', label: 'All time' },
];

/**
 * Resolve a preset to real bounds.
 *
 * Every preset ends at `today`, never later — a window that runs into the
 * future would quietly include the five 2026-12-24 rows and nothing else, which
 * is exactly the distortion the date policy exists to prevent.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  today: string,
  custom?: { from: string; to: string },
): Period {
  switch (preset) {
    case 'ytd2026': {
      const from = `${today.slice(0, 4)}-01-01`;
      return { from, to: today, label: `${today.slice(0, 4)} YTD` };
    }
    case 'last90':
      return { from: addDays(today, -89), to: today, label: 'Last 90 days' };
    case 'last12m':
      return { from: addDays(today, -364), to: today, label: 'Last 12 months' };
    case 'all':
      return { from: '', to: today, label: 'All time' };
    case 'custom':
    default:
      return {
        from: custom?.from ?? '',
        to: custom?.to || today,
        label:
          custom?.from || custom?.to
            ? `${custom?.from || 'any'} to ${custom?.to || today}`
            : 'All time',
      };
  }
}

/**
 * The window of equal length immediately before `period`.
 *
 * Returns null for an unbounded period — "all time" has no previous, and
 * inventing one would put a number on screen that means nothing.
 */
export function precedingPeriod(period: Period): Period | null {
  if (!period.from) return null;
  const span = daysBetween(period.from, period.to); // inclusive length - 1
  const to = addDays(period.from, -1);
  const from = addDays(to, -span);
  return { from, to, label: `${from} to ${to}` };
}

export function rowsInPeriod(
  rows: readonly CorrectionReportRow[],
  period: Period,
  today: string,
): CorrectionReportRow[] {
  return rows.filter((r) => {
    const d = r.letter_date;
    if (!isPlausibleLetterDate(d, today)) return false;
    if (period.from && d! < period.from) return false;
    if (period.to && d! > period.to) return false;
    return true;
  });
}

// --------------------------------------------------------------- comparison --

export interface PeriodSide {
  /** Projects with any correction in this window — the denominator. */
  denominator: number;
  /** Projects hitting this category in this window. */
  projects: number;
  pct: number;
  items: number;
  /** Under LOW_CONFIDENCE_N projects: the percentage is not worth reading. */
  lowConfidence: boolean;
}

export interface PrevalenceComparisonRow {
  label: string;
  current: PeriodSide;
  previous: PeriodSide;
  /** Percentage-POINT change, or null when either side is too small.
   *  Null is a decision, not a missing value — see the note below. */
  deltaPoints: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
}

function side(
  rows: readonly CorrectionReportRow[],
  level: PrevalenceLevel,
  label: string,
): PeriodSide {
  const denom = new Set(rows.map((r) => r.project_id));
  const hit = new Set<string>();
  let items = 0;
  for (const r of rows) {
    const rowLabel =
      level === 'theme'
        ? correctionThemeLabel(r.theme)
        : (r.category ?? '').trim() || 'Unclassified';
    if (rowLabel === label) {
      hit.add(r.project_id);
      items += 1;
    }
  }
  const denominator = denom.size;
  return {
    denominator,
    projects: hit.size,
    pct: denominator === 0 ? 0 : Math.round((1000 * hit.size) / denominator) / 10,
    items,
    lowConfidence: denominator < LOW_CONFIDENCE_N,
  };
}

/**
 * Prevalence in the selected period against the preceding one of equal length.
 *
 * ★ THE DELTA IS SUPPRESSED WHEN EITHER SIDE HAS FEWER THAN 10 PROJECTS. A
 * swing from 1-of-3 to 2-of-4 is +16.7 points and means nothing; printed next
 * to a real movement it reads identically. Both underlying counts are always
 * returned, so the reader can see what was suppressed and why — a delta with no
 * counts behind it is the thing this design refuses to produce.
 */
export function comparePrevalence(
  currentRows: readonly CorrectionReportRow[],
  previousRows: readonly CorrectionReportRow[],
  level: PrevalenceLevel,
  labels: readonly string[],
): PrevalenceComparisonRow[] {
  return labels.map((label) => {
    const current = side(currentRows, level, label);
    const previous = side(previousRows, level, label);
    const comparable = !current.lowConfidence && !previous.lowConfidence;
    const deltaPoints = comparable
      ? Math.round((current.pct - previous.pct) * 10) / 10
      : null;
    let direction: PrevalenceComparisonRow['direction'] = 'unknown';
    if (deltaPoints != null) {
      direction = deltaPoints > 0 ? 'up' : deltaPoints < 0 ? 'down' : 'flat';
    }
    return { label, current, previous, deltaPoints, direction };
  });
}

// ------------------------------------------------------------ the drill-down --

export interface CommentGroup {
  projectId: string;
  address: string;
  juris: string;
  /** Newest letter date in the group — what the groups are ordered by. */
  latest: string;
  comments: CorrectionReportRow[];
}

export type CommentSort = 'newest' | 'oldest';

/**
 * The comments behind one prevalence row, grouped by project.
 *
 * Grouped rather than flat because the whole point is spotting the same wording
 * recurring across projects: reading down a project's comments and then the
 * next project's is what makes a repeated phrase visible.
 *
 * Rows with an implausible date are NOT dropped here — the drill-down is about
 * reading the words, and a letter with a bad date still says something. They
 * sort to the end so they cannot masquerade as the newest thing on the page.
 */
export function commentsForLabel(
  rows: readonly CorrectionReportRow[],
  level: PrevalenceLevel,
  label: string,
  sort: CommentSort,
  today: string,
): CommentGroup[] {
  const matching = rows.filter((r) => {
    const rowLabel =
      level === 'theme'
        ? correctionThemeLabel(r.theme)
        : (r.category ?? '').trim() || 'Unclassified';
    return rowLabel === label;
  });

  const byProject = new Map<string, CommentGroup>();
  for (const r of matching) {
    const g = byProject.get(r.project_id);
    if (g) {
      g.comments.push(r);
      if ((r.letter_date ?? '') > g.latest) g.latest = r.letter_date ?? '';
    } else {
      byProject.set(r.project_id, {
        projectId: r.project_id,
        address: r.address,
        juris: r.juris,
        latest: r.letter_date ?? '',
        comments: [r],
      });
    }
  }

  const dir = sort === 'newest' ? -1 : 1;
  const rank = (d: string | null) =>
    // An implausible date always sorts last, whichever way the list is facing.
    isPlausibleLetterDate(d, today) ? 0 : 1;

  const groups = [...byProject.values()];
  for (const g of groups) {
    g.comments.sort(
      (a, b) =>
        rank(a.letter_date) - rank(b.letter_date) ||
        dir * (a.letter_date ?? '').localeCompare(b.letter_date ?? '') ||
        // Stable for comments sharing a date: same letter, then item order.
        a.source_file.localeCompare(b.source_file) ||
        a.item_no - b.item_no,
    );
  }
  groups.sort(
    (a, b) =>
      rank(a.latest) - rank(b.latest) ||
      dir * a.latest.localeCompare(b.latest) ||
      a.address.localeCompare(b.address),
  );
  return groups;
}

export function countComments(groups: readonly CommentGroup[]): number {
  return groups.reduce((n, g) => n + g.comments.length, 0);
}
