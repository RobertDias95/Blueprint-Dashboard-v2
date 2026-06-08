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

/** @deprecated fix-137: replaced by explicit Period B range. Use
 *  {@link PeriodPair} on new code; kept for legacy URL migration via
 *  {@link legacyCompareToRange}. */
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
 *  Inputs are 'YYYY-MM-DD' strings; outputs match.
 *
 *  @deprecated fix-137: callers should use {@link applyComparePreset}
 *  (for preset shortcuts) or pick Period B explicitly. This is kept
 *  exported for use by {@link applyComparePreset} + the legacy URL
 *  migration in {@link legacyCompareToRange}. */
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

// fix-124-b: preset chip row date math. The 6 one-click "this vs last"
// / "last N days vs prior" presets all live above the existing Range +
// Compare to controls; each chip computes its own from/to here and the
// surface wires it into its own state model. compareTo is always
// 'previous_period' — the calendar-snap in deriveComparisonRange handles
// the month/quarter/year boundary alignment automatically (so e.g.
// this_quarter_vs_last just emits the current quarter's start/end and
// lets the snap pick the prior calendar quarter for free).

export type ComparePreset =
  | 'this_month_vs_last'
  | 'this_quarter_vs_last'
  | 'this_year_vs_last'
  | 'last_30d_vs_prior'
  | 'last_60d_vs_prior'
  | 'last_90d_vs_prior';

export interface ComparePresetSpec {
  preset: ComparePreset;
  /** Short label that fits on a chip. */
  label: string;
  /** Always 'previous_period' — see header note. */
  compareTo: 'previous_period';
}

export const COMPARE_PRESETS: readonly ComparePresetSpec[] = [
  { preset: 'this_month_vs_last',   label: 'This month vs last',   compareTo: 'previous_period' },
  { preset: 'this_quarter_vs_last', label: 'This quarter vs last', compareTo: 'previous_period' },
  { preset: 'this_year_vs_last',    label: 'This year vs last',    compareTo: 'previous_period' },
  { preset: 'last_30d_vs_prior',    label: 'Last 30d vs prior',    compareTo: 'previous_period' },
  { preset: 'last_60d_vs_prior',    label: 'Last 60d vs prior',    compareTo: 'previous_period' },
  { preset: 'last_90d_vs_prior',    label: 'Last 90d vs prior',    compareTo: 'previous_period' },
];

/** Compute the {from, to} slice for a preset given a "today" anchor.
 *  All dates are UTC-anchored at midday to dodge DST edges (matches the
 *  same convention as deriveComparisonRange). Inclusive endpoints. */
export function rangeForPreset(preset: ComparePreset, today: Date): DateRange {
  const y = today.getUTCFullYear();
  const m0 = today.getUTCMonth(); // 0-indexed
  const d = today.getUTCDate();
  if (preset === 'this_month_vs_last') {
    return {
      from: fmt(y, m0 + 1, 1),
      to: fmt(y, m0 + 1, lastDayOfMonth(y, m0)),
    };
  }
  if (preset === 'this_quarter_vs_last') {
    const q0 = Math.floor(m0 / 3); // 0..3
    const firstMonth1 = q0 * 3 + 1;       // 1, 4, 7, 10
    const lastMonth1 = firstMonth1 + 2;   // 3, 6, 9, 12
    return {
      from: fmt(y, firstMonth1, 1),
      to: fmt(y, lastMonth1, lastDayOfMonth(y, lastMonth1 - 1)),
    };
  }
  if (preset === 'this_year_vs_last') {
    return { from: fmt(y, 1, 1), to: fmt(y, 12, 31) };
  }
  // last_Nd_vs_prior: to = today, from = today - (N-1) days (N-day inclusive).
  const back = preset === 'last_30d_vs_prior' ? 29
    : preset === 'last_60d_vs_prior' ? 59
    : 89;
  const todayUTC = new Date(Date.UTC(y, m0, d, 12, 0, 0));
  const fromDate = addDays(todayUTC, -back);
  return { from: format(fromDate), to: format(todayUTC) };
}

/** Match the current (range, compareTo) against each preset; first exact
 *  match wins, or null when none match (user is on a custom slice). The
 *  caller uses this to highlight the matching chip. */
export function activeComparePreset(
  range: DateRange | null,
  compareTo: CompareMode,
  today: Date,
): ComparePreset | null {
  if (!range || compareTo !== 'previous_period') return null;
  for (const spec of COMPARE_PRESETS) {
    const candidate = rangeForPreset(spec.preset, today);
    if (candidate.from === range.from && candidate.to === range.to) {
      return spec.preset;
    }
  }
  return null;
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
 *  but the actual range is more informative.
 *
 *  @deprecated fix-137: the new compare-control model has no `mode`
 *  enum — Period B is an explicit range. Use {@link comparisonLabelForRange}
 *  on new code; this is kept so the old call sites keep working until
 *  they're migrated. */
export function comparisonLabelFor(
  mode: CompareMode,
  range: DateRange | null,
): string {
  if (!range || mode === 'off') return '';
  if (mode === 'previous_period') return `vs prev period (${range.from} – ${range.to})`;
  return `vs prev year (${range.from} – ${range.to})`;
}

/** fix-137: range-only comparison label. Replaces comparisonLabelFor
 *  on the new compare-control surfaces — no more "previous period" /
 *  "previous year" enum, just the explicit Period B dates. */
export function comparisonLabelForRange(range: DateRange | null): string {
  if (!range) return '';
  return `vs ${range.from} – ${range.to}`;
}

// ============================================================
// fix-137-a: new explicit-Period-B compare model
// ============================================================
//
// Bobby's framing: "I would almost imagine like compare-to as like a
// couple of boxes if you open it... compare this to this, or these
// dates compared to these dates." The old model derived Period B
// from a `compareTo` enum + Period A. The new model treats Period B
// as a first-class explicit choice (still preset-shortcutable).

export interface PeriodPair {
  periodA: DateRange;
  periodB: DateRange;
}

export type ComparePresetId =
  | 'this_month_vs_last'
  | 'this_quarter_vs_last'
  | 'this_year_vs_last'
  | 'last_30d_vs_prior'
  | 'last_60d_vs_prior'
  | 'last_90d_vs_prior';

export interface ComparePresetSpecV2 {
  preset: ComparePresetId;
  label: string;
}

/** Preset roster. Mirrors the fix-124 chip row 1:1 so users see the
 *  same shortcut names; lives inside the new ComparePanel rather than
 *  on a chip row at the top of the page. */
export const COMPARE_PRESETS_V2: readonly ComparePresetSpecV2[] = [
  { preset: 'this_month_vs_last',   label: 'This month vs last' },
  { preset: 'this_quarter_vs_last', label: 'This quarter vs last' },
  { preset: 'this_year_vs_last',    label: 'This year vs last' },
  { preset: 'last_30d_vs_prior',    label: 'Last 30d vs prior' },
  { preset: 'last_60d_vs_prior',    label: 'Last 60d vs prior' },
  { preset: 'last_90d_vs_prior',    label: 'Last 90d vs prior' },
];

/** fix-137-a: compute BOTH Period A AND Period B for a preset. Each
 *  preset sets both explicitly — no derivation magic at consumption
 *  time. Period A is computed by the legacy `rangeForPreset` helper;
 *  Period B is computed by running A through `deriveComparisonRange`
 *  with mode='previous_period', which preserves the fix-115-a
 *  calendar-snap behavior (this quarter → prior quarter, etc.) for
 *  the named calendar presets and length-mirror for the last-N-day
 *  presets. */
export function applyComparePreset(
  preset: ComparePresetId,
  today: Date,
): PeriodPair {
  const periodA = rangeForPreset(preset, today);
  // Calendar-aligned presets (this month / quarter / year) snap to
  // the calendar-prior; last-Nd presets fall through to the
  // length-mirror. deriveComparisonRange handles both branches.
  const periodB = deriveComparisonRange(periodA, 'previous_period');
  if (!periodB) {
    // This is impossible for valid preset inputs (a valid Period A
    // always derives a valid Period B), but the fallback keeps the
    // signature non-nullable and surfaces a same-range pair if the
    // invariant breaks.
    return { periodA, periodB: periodA };
  }
  return { periodA, periodB };
}

/** fix-137-a: legacy URL-param migration. Old bookmarks carry
 *  `?compare=previous_period` or `?compare=previous_year` which
 *  reference Period B implicitly via Period A. Convert to an
 *  explicit Period B range so the new control can render it. Returns
 *  null when there's nothing to migrate (mode='off' or unknown). */
export function legacyCompareToRange(
  currentRange: DateRange | null,
  compareTo: string | null,
): DateRange | null {
  if (!compareTo || compareTo === 'off') return null;
  if (compareTo !== 'previous_period' && compareTo !== 'previous_year') {
    return null;
  }
  return deriveComparisonRange(currentRange, compareTo);
}
