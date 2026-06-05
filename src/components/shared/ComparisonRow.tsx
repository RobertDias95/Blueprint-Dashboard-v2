// fix-115-b: shared ComparisonRow + ComparisonDirection extracted from
// Trends.tsx. Reports/Overview MetricCards (fix-115-c) and any future KPI
// surface consume this directly instead of duplicating the delta math /
// color-sign rendering.
//
// Behavior is preserved from fix-114's inline implementation — no styling
// or color-sign logic changes in this commit. The extract is intentionally
// move-only so 115-b's diff stays mechanical and 115-c can build on top
// without worrying about regression risk on the Trends surface.

import type { ReactNode } from 'react';
import { formatCompareNumber } from '../../lib/comparisonCohort';

/** Sign-color semantic for a comparison delta:
 *  - higher_better: positive delta is good (green), negative is bad (red).
 *  - lower_better:  inverted.
 *  - neutral:       muted color regardless of sign (use for metrics like
 *                   "Submit variance" where early vs late doesn't cleanly
 *                   map to good/bad).
 */
export type ComparisonDirection = 'higher_better' | 'lower_better' | 'neutral';

export interface ComparisonRowProps {
  /** Stable testid root; the row carries `${testId}`, the delta span
   *  carries `${testId}-delta` (used by tests pinning the color/style). */
  testId?: string;
  /** Range-stamped label e.g. "vs prev period (Jan 1 – Mar 31)". When
   *  empty/undefined the row does not render (caller can gate or pass
   *  through unconditionally). */
  comparisonLabel?: string;
  /** Display string for the comparison value (matches the tile's main
   *  value formatting — e.g. "8d", "12 of 20 (60%)"). */
  comparisonValueText?: string;
  /** Raw numeric value from the current cohort for delta math. */
  currentNumeric: number | null;
  /** Raw numeric value from the comparison cohort. Null → "no comparison
   *  data" affordance rather than a misleading delta against missing
   *  denominator. */
  comparisonNumeric: number | null;
  /** Sign-color semantic for the delta arrow + percentage. */
  direction?: ComparisonDirection;
}

export function ComparisonRow({
  testId,
  comparisonLabel,
  comparisonValueText,
  currentNumeric,
  comparisonNumeric,
  direction = 'neutral',
}: ComparisonRowProps): ReactNode {
  const hasNumbers =
    typeof currentNumeric === 'number' && typeof comparisonNumeric === 'number';

  // No comparison data in the prior period — surface that explicitly
  // instead of a "vs —" line that looks like a bug.
  if (!hasNumbers) {
    return (
      <div
        className="mt-1.5 text-[10px] text-dim italic border-t pt-1"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid={testId}
      >
        no comparison data · {comparisonLabel}
      </div>
    );
  }

  const delta = (currentNumeric ?? 0) - (comparisonNumeric ?? 0);
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  // fix-124-a: 1-decimal-place rounding via formatCompareNumber. The
  // raw subtraction above can produce 0.19999999 trash; the percentage
  // math below amplifies it. Both go through the helper before display.
  // pct stays integer-clean for round numbers (25 stays "25", not
  // "25.0") and gains a decimal when there's actually one to show.
  const pct =
    comparisonNumeric === 0
      ? null
      : formatCompareNumber(
          (delta / Math.abs(comparisonNumeric ?? 1)) * 100,
        );
  const deltaDisplay = formatCompareNumber(delta);

  // Color: green when the change is in the "good" direction for this
  // metric, red when bad, muted when zero or neutral.
  const goodSign =
    direction === 'higher_better'
      ? Math.sign(delta) > 0
      : direction === 'lower_better'
        ? Math.sign(delta) < 0
        : false;
  const badSign =
    direction === 'higher_better'
      ? Math.sign(delta) < 0
      : direction === 'lower_better'
        ? Math.sign(delta) > 0
        : false;
  const color = goodSign
    ? 'var(--color-pm)'
    : badSign
      ? 'var(--color-co)'
      : 'var(--color-muted)';

  const deltaSign = delta > 0 ? '+' : '';
  const pctStr = pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`;

  return (
    <div
      className="mt-1.5 text-[10px] border-t pt-1 leading-tight"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid={testId}
    >
      <div className="text-muted">
        vs {comparisonValueText ?? comparisonNumeric}
      </div>
      <div
        className="font-bold"
        style={{ color }}
        data-testid={testId ? `${testId}-delta` : undefined}
      >
        {arrow} {deltaSign}
        {deltaDisplay} ({pctStr})
      </div>
      <div className="text-dim text-[9px] mt-0.5">{comparisonLabel}</div>
    </div>
  );
}
