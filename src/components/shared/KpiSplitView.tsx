import { formatCompareNumber } from '../../lib/comparisonCohort';
import type { ComparisonDirection } from './ComparisonRow';

// fix-129-b: side-by-side comparison renderer for KpiTile + MetricCard.
//
// Pre-fix the comparison story was a thin row under the headline
// value — "vs 67 · ↓ -3 (-4%)" in a small font, easy to miss. Bobby's
// words: "we draw a little line and it's not the most clear." This
// component splits the value row into two equal-width cells with a
// thin divider, each labeled with its date range, and a delta strip
// below that runs the full width.
//
// Layout:
//   ┌───────────────────────────────────────────────────────────────┐
//   │ AVG CITY REVIEW                                          ⓘ    │   ← rendered by parent
//   ├──────────────────────────────┬────────────────────────────────┤
//   │ 2026-06-01 – 2026-06-30      │ 2026-05-01 – 2026-05-31        │
//   │ 64d                          │ 67d                            │
//   ├──────────────────────────────┴────────────────────────────────┤
//   │ ↓ -3d (-4.5%) vs prev period                                  │
//   └───────────────────────────────────────────────────────────────┘
//
// Parent (KpiTile/MetricCard) keeps owning the title row + the outer
// card chrome — this component only renders the value-cells + delta
// strip. Single-cohort (no comparison) callers don't render this at
// all; they render their existing pre-fix-129 layout.

export interface KpiSplitViewProps {
  /** Range stamp for the current value, e.g. "Jun 1 – Jun 30". */
  currentRangeLabel: string;
  /** Range stamp for the comparison value. */
  comparisonRangeLabel: string;
  /** Formatted display value for the current cohort (e.g. "64d", "67%", "—"). */
  currentValueText: string;
  /** Formatted display value for the comparison cohort. */
  comparisonValueText: string;
  /** Raw numeric for delta math. Null = no comparison data → "no
   *  comparison data" affordance instead of a misleading 0d delta. */
  currentNumeric: number | null;
  comparisonNumeric: number | null;
  /** Sign-color semantic for the delta. */
  direction?: ComparisonDirection;
  /** Short "vs prev period" / "vs prev year" tag appended to the delta
   *  strip. Omit to skip the suffix. */
  comparisonModeLabel?: string;
  /** Stable testid root: split renders `${testId}-current` and
   *  `${testId}-comparison` value cells plus `${testId}-delta`. */
  testId?: string;
}

export default function KpiSplitView({
  currentRangeLabel,
  comparisonRangeLabel,
  currentValueText,
  comparisonValueText,
  currentNumeric,
  comparisonNumeric,
  direction = 'neutral',
  comparisonModeLabel,
  testId,
}: KpiSplitViewProps) {
  const hasBothNumbers =
    typeof currentNumeric === 'number' && typeof comparisonNumeric === 'number';

  const delta = hasBothNumbers
    ? formatCompareNumber(currentNumeric - comparisonNumeric)
    : null;
  const pct =
    hasBothNumbers && comparisonNumeric !== 0
      ? formatCompareNumber(
          ((currentNumeric - comparisonNumeric) /
            Math.abs(comparisonNumeric)) *
            100,
        )
      : null;

  // Color: green when the delta points in the "good" direction for this
  // metric, red when bad, muted when neutral (or zero, or the direction
  // semantic is neutral).
  const goodSign =
    delta === null
      ? false
      : direction === 'higher_better'
        ? delta > 0
        : direction === 'lower_better'
          ? delta < 0
          : false;
  const badSign =
    delta === null
      ? false
      : direction === 'higher_better'
        ? delta < 0
        : direction === 'lower_better'
          ? delta > 0
          : false;
  const color = goodSign
    ? 'var(--color-pm)'
    : badSign
      ? 'var(--color-co)'
      : 'var(--color-muted)';
  const arrow =
    delta === null ? '→' : delta > 0 ? '↑' : delta < 0 ? '↓' : '→';

  return (
    <div className="mt-2" data-testid={testId}>
      <div
        className="grid border rounded-md overflow-hidden"
        style={{
          gridTemplateColumns: '1fr 1fr',
          borderColor: 'var(--color-border)',
        }}
      >
        <ValueCell
          rangeLabel={currentRangeLabel}
          valueText={currentValueText}
          rightBorder
          testId={testId ? `${testId}-current` : undefined}
        />
        <ValueCell
          rangeLabel={comparisonRangeLabel}
          valueText={comparisonValueText}
          dim
          testId={testId ? `${testId}-comparison` : undefined}
        />
      </div>
      <div
        className="mt-1.5 text-[11px] font-bold flex items-baseline gap-1.5"
        style={{ color }}
        data-testid={testId ? `${testId}-delta` : undefined}
      >
        <span aria-hidden="true">{arrow}</span>
        {delta === null ? (
          <span className="font-display italic text-dim">
            no comparison data
          </span>
        ) : (
          <>
            <span>
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
            {pct !== null && (
              <span className="text-muted font-display font-normal">
                ({pct > 0 ? '+' : ''}
                {pct}%)
              </span>
            )}
          </>
        )}
        {comparisonModeLabel && (
          <span className="text-dim font-display font-normal ml-1">
            {comparisonModeLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function ValueCell({
  rangeLabel,
  valueText,
  rightBorder,
  dim,
  testId,
}: {
  rangeLabel: string;
  valueText: string;
  rightBorder?: boolean;
  dim?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="px-2.5 py-2 flex flex-col gap-0.5"
      style={
        rightBorder
          ? { borderRight: '1px solid var(--color-border)' }
          : undefined
      }
      data-testid={testId}
    >
      <span
        className="text-[9px] uppercase tracking-wide text-dim font-display font-bold truncate"
        title={rangeLabel}
      >
        {rangeLabel}
      </span>
      <span
        className={`text-lg font-display font-extrabold ${
          dim ? 'text-muted' : 'text-text'
        }`}
      >
        {valueText}
      </span>
    </div>
  );
}
