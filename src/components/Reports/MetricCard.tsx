// Q7.2.b: single metric card primitive. Mirrors v1's .metric-card styling
// (index.html 5519+). One card = a value (typically a large number, sometimes
// with a unit) + small label above + optional sub-text below.
//
// fix-115-c: optional period-comparison row under the subText, using the
// shared ComparisonRow renderer. Caller passes raw numerics + a direction;
// the card renders the delta only when both `currentNumeric` and
// `comparisonLabel` are present. When `comparisonNumeric` is null the row
// surfaces "no comparison data · {label}" instead of a misleading delta.

import {
  ComparisonRow,
  type ComparisonDirection,
} from '../shared/ComparisonRow';

type Tone = 'default' | 'de' | 'pm' | 'co' | 'jv' | 'is' | 'overdue';

const TONE_CLASS: Record<Tone, string> = {
  default: 'text-text',
  de: 'text-de',
  pm: 'text-pm',
  co: 'text-co',
  jv: 'text-jv',
  is: 'text-is',
  overdue: 'text-[#dc2626]',
};

interface Props {
  label: string;
  /** The headline value. Pass a number for the common case; pass a string
   * for "—" placeholders or formatted strings ("+5d", "67%"). */
  value: number | string;
  /** Unit suffix appended in muted color (e.g. "d" for days). */
  unit?: string;
  /** Small text under the value. */
  subText?: string;
  /** Color tone for the value. */
  tone?: Tone;
  /** Test ID for assertions. */
  testId?: string;
  // fix-115-c: optional period-comparison wiring. All four together or none.
  /** Numeric form of the current value for delta math (matches `value`
   *  when value is a number; pass the raw metric when value is a formatted
   *  string like "+5d"). */
  currentNumeric?: number | null;
  /** Comparison cohort's value for the same metric. */
  comparisonNumeric?: number | null;
  /** Display string for the comparison value (matches `value` formatting). */
  comparisonValueText?: string;
  /** Range-stamped label e.g. "vs prev period (Jan 1 – Mar 31)". When
   *  empty/undefined the comparison row does not render. */
  comparisonLabel?: string;
  /** Sign-color semantic for the delta. */
  comparisonDirection?: ComparisonDirection;
}

export default function MetricCard({
  label,
  value,
  unit,
  subText,
  tone = 'default',
  testId,
  currentNumeric,
  comparisonNumeric,
  comparisonValueText,
  comparisonLabel,
  comparisonDirection,
}: Props) {
  const showComparison = Boolean(comparisonLabel);
  return (
    <div
      className="bg-surface border border-border rounded-lg px-4 py-3 flex flex-col gap-1"
      data-testid={testId}
    >
      <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
        {label}
      </div>
      <div className="flex items-baseline gap-0.5">
        <span
          className={`text-2xl font-display font-extrabold ${TONE_CLASS[tone]}`}
        >
          {value}
        </span>
        {unit && (
          <span className="text-sm font-display font-normal text-muted">
            {unit}
          </span>
        )}
      </div>
      {subText && (
        <div className="text-[10px] text-muted truncate">{subText}</div>
      )}
      {showComparison && (
        <ComparisonRow
          testId={testId ? `${testId}-cmp` : undefined}
          comparisonLabel={comparisonLabel}
          comparisonValueText={comparisonValueText}
          currentNumeric={currentNumeric ?? null}
          comparisonNumeric={comparisonNumeric ?? null}
          direction={comparisonDirection}
        />
      )}
    </div>
  );
}
