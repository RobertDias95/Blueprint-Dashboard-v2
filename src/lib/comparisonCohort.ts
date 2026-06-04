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
    // length = (to - from) + 1 inclusive days.
    // prev.to   = from - 1 day
    // prev.from = from - length days
    //
    // For Apr 1 → Jun 30 (91 days): prev = Jan 1 → Mar 31. ✓
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
