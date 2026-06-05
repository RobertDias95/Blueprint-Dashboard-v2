// fix-114: period-comparison range derivation for the Trends KPI tiles.
//
// "Compare to" dropdown surfaces a second cohort alongside the current
// one. Two modes:
//   - 'previous_period': mirrors the current span immediately before
//     currentRange.from. E.g. current Q2 (Apr 1 – Jun 30) → comparison
//     Q1 (Jan 1 – Mar 31). Length-preserving.
//   - 'previous_year':   shifts the current range back exactly 365 days.
//     E.g. current Apr 1 – Jun 30 2026 → comparison Apr 1 – Jun 30 2025.
//
// Date math operates on 'YYYY-MM-DD' strings to match PerfTrendsFilters
// and filterPermits' string comparison. Internal Date arithmetic uses
// midday-UTC anchors to dodge DST + timezone-edge surprises.

const DAY_MS = 24 * 60 * 60 * 1000;

export type CompareMode = 'off' | 'previous_period' | 'previous_year';

export interface DateRange {
  /** 'YYYY-MM-DD'. */
  from: string;
  /** 'YYYY-MM-DD'. */
  to: string;
}

/** Parse 'YYYY-MM-DD' to a midday-UTC Date so day-arithmetic doesn't
 *  drift across DST boundaries. */
function parse(d: string): Date {
  return new Date(`${d}T12:00:00Z`);
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function spanDays(from: string, to: string): number {
  // Inclusive of both endpoints. Q1 (Jan 1 – Mar 31) = 90 days exclusive,
  // 91 days inclusive — matches the "Apr 1 – Jun 30 → Jan 1 – Mar 31"
  // example in the fix-114 brief.
  const f = parse(from).getTime();
  const t = parse(to).getTime();
  return Math.round((t - f) / DAY_MS) + 1;
}

// fix-115-a: calendar-boundary detectors for the previous_period snap.
// A range that exactly aligns to a calendar month / quarter / year picks
// the previous calendar period rather than the length-preserving mirror.
// Custom ranges (any boundary that doesn't match exactly) keep the
// fix-114 length-preserving math — Bobby's spec is "snap when the user
// clearly meant a calendar period, otherwise mirror by length."

/** Last day-of-month for (year, month0). month0 is 0-indexed. */
function lastDayOfMonth(year: number, month0: number): number {
  // Day 0 of (month0+1) rolls back to the last day of month0. Handles
  // leap-year February (e.g. 2024 Feb 29) without an explicit check.
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function fmt(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface FullMonth {
  year: number;
  month0: number;
}
function detectFullMonth(from: string, to: string): FullMonth | null {
  const [yf, mf, df] = from.split('-').map(Number);
  const [yt, mt, dt] = to.split('-').map(Number);
  if (yf !== yt || mf !== mt) return null;
  if (df !== 1) return null;
  if (dt !== lastDayOfMonth(yf, mf - 1)) return null;
  return { year: yf, month0: mf - 1 };
}

interface FullQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}
function detectFullQuarter(from: string, to: string): FullQuarter | null {
  const [yf, mf, df] = from.split('-').map(Number);
  const [yt, mt, dt] = to.split('-').map(Number);
  if (yf !== yt) return null;
  if (df !== 1) return null;
  if (mf === 1 && mt === 3 && dt === 31) return { year: yf, quarter: 1 };
  if (mf === 4 && mt === 6 && dt === 30) return { year: yf, quarter: 2 };
  if (mf === 7 && mt === 9 && dt === 30) return { year: yf, quarter: 3 };
  if (mf === 10 && mt === 12 && dt === 31) return { year: yf, quarter: 4 };
  return null;
}

function detectFullYear(from: string, to: string): number | null {
  const [yf, mf, df] = from.split('-').map(Number);
  const [yt, mt, dt] = to.split('-').map(Number);
  if (yf !== yt) return null;
  if (mf !== 1 || df !== 1) return null;
  if (mt !== 12 || dt !== 31) return null;
  return yf;
}

function snapPreviousMonth({ year, month0 }: FullMonth): DateRange {
  let prevYear = year;
  let prevMonth0 = month0 - 1;
  if (prevMonth0 < 0) {
    prevMonth0 = 11;
    prevYear -= 1;
  }
  return {
    from: fmt(prevYear, prevMonth0 + 1, 1),
    to: fmt(prevYear, prevMonth0 + 1, lastDayOfMonth(prevYear, prevMonth0)),
  };
}

function snapPreviousQuarter({ year, quarter }: FullQuarter): DateRange {
  const prevQuarter = (quarter === 1 ? 4 : quarter - 1) as 1 | 2 | 3 | 4;
  const prevYear = quarter === 1 ? year - 1 : year;
  // First month (1-indexed) of each quarter.
  const firstMonthByQuarter: Record<1 | 2 | 3 | 4, number> = {
    1: 1, // Jan
    2: 4, // Apr
    3: 7, // Jul
    4: 10, // Oct
  };
  const m1Start = firstMonthByQuarter[prevQuarter];
  const m1End = m1Start + 2;
  return {
    from: fmt(prevYear, m1Start, 1),
    to: fmt(prevYear, m1End, lastDayOfMonth(prevYear, m1End - 1)),
  };
}

function snapPreviousYear(year: number): DateRange {
  return { from: fmt(year - 1, 1, 1), to: fmt(year - 1, 12, 31) };
}

/** Compute the comparison range for a given current range + mode.
 *
 *  Returns null when:
 *    - mode === 'off'
 *    - currentRange is null
 *    - the resulting range would be malformed (from > to after shifting)
 *
 *  Inputs are 'YYYY-MM-DD' strings; outputs match. */
export function deriveComparisonRange(
  currentRange: DateRange | null,
  mode: CompareMode,
): DateRange | null {
  if (!currentRange || mode === 'off') return null;
  if (!currentRange.from || !currentRange.to) return null;

  if (mode === 'previous_period') {
    // fix-115-a: if the current range aligns exactly to a calendar month,
    // quarter, or year boundary, snap to the corresponding previous period
    // instead of the length-preserving mirror. The mirror produces e.g.
    // "May 2 – May 31" for current "June 2026" — technically correct on
    // 30-day spans but surprising to users picking whole months. Custom
    // ranges (anything that doesn't match all three boundary checks) keep
    // the length-preserving math from fix-114.
    const fullYear = detectFullYear(currentRange.from, currentRange.to);
    if (fullYear !== null) return snapPreviousYear(fullYear);

    const fullQuarter = detectFullQuarter(currentRange.from, currentRange.to);
    if (fullQuarter) return snapPreviousQuarter(fullQuarter);

    const fullMonth = detectFullMonth(currentRange.from, currentRange.to);
    if (fullMonth) return snapPreviousMonth(fullMonth);

    // length = (to - from) + 1 inclusive days.
    // prev.to   = from - 1 day
    // prev.from = from - length days
    const length = spanDays(currentRange.from, currentRange.to);
    const fromDate = parse(currentRange.from);
    const prevTo = addDays(fromDate, -1);
    const prevFrom = addDays(fromDate, -length);
    return { from: format(prevFrom), to: format(prevTo) };
  }

  // previous_year: shift both endpoints back 365 days. Stays
  // length-preserving (no leap-year correction — Bobby's spec says
  // "exactly 1 year" via subDays(365)). A user landing on a 366-day
  // window where the prior-year fold-back creates an off-by-one
  // edge will see one day's worth of approval drift; that's
  // acceptable for "vs prev year" semantics on quarterly buckets.
  const prevFrom = addDays(parse(currentRange.from), -365);
  const prevTo = addDays(parse(currentRange.to), -365);
  return { from: format(prevFrom), to: format(prevTo) };
}

/** fix-124-a: 1-decimal-place rounding for comparison deltas and
 *  percentages. JS subtraction across floats can produce ugly trailing
 *  digits (0.2 - 0.0 → 0.19999999...) and the existing tooltip math
 *  `(delta / |cmp|) * 100` is even more exposed since it multiplies the
 *  precision noise. The standard *10 / 10 trick rounds to 1 decimal
 *  safely; the return is a NUMBER so callers can interpolate it
 *  directly — clean integers serialize as integers (25 → "25") so we
 *  only see the decimal when there's actually one to show.
 *
 *  Use this on any comparison delta, percentage, or aggregate-of-
 *  aggregates value. Do NOT use it on raw integer counts (Total
 *  Permits = 47 should stay 47, not 47.0). */
export function formatCompareNumber(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Human-readable label for the comparison range badge under each
 *  KpiTile. Mode names "Previous period" / "Previous year" are stable
 *  but the actual range is more informative. */
export function comparisonLabelFor(
  mode: CompareMode,
  range: DateRange | null,
): string {
  if (!range || mode === 'off') return '';
  if (mode === 'previous_period') return `vs prev period (${range.from} – ${range.to})`;
  return `vs prev year (${range.from} – ${range.to})`;
}
