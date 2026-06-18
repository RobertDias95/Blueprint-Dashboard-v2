// Q7.2.b: single metric card primitive. Mirrors v1's .metric-card styling
// (index.html 5519+). One card = a value (typically a large number, sometimes
// with a unit) + small label above + optional sub-text below.
//
// fix-115-c: optional period-comparison row under the subText, using the
// shared ComparisonRow renderer.
//
// fix-129-b: when comparison is active AND a range label pair is
// supplied, the value row swaps to a side-by-side split (current on
// left, comparison on right, equal weight, delta strip below) rendered
// by KpiSplitView. Bobby's complaint: "we draw a little line and it's
// not the most clear." The split uses the otherwise-wasted right side
// of the card and gives both numbers equal visual weight. The legacy
// ComparisonRow path remains for callers that don't pass the range
// labels (e.g., the In Corrections card whose `comparisonLabel` is the
// range stamp but doesn't carry separate current/comparison range
// labels).

import KpiSplitView from '../shared/KpiSplitView';
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
  /** fix-129-b: optional split-view inputs. When all three are present
   *  AND comparison is active, the card renders the horizontal split
   *  layout (KpiSplitView). Otherwise it falls through to the legacy
   *  ComparisonRow underneath the existing big-value row. */
  currentRangeLabel?: string;
  comparisonRangeLabel?: string;
  /** fix-129-b: optional title-row slot (e.g., a MetricInfoTooltip
   *  wrapping the label). Rendered in place of the plain label text
   *  when provided. */
  labelSlot?: React.ReactNode;
  /** fix-129-b: short comparison mode tag ("vs prev period") shown in
   *  the split's delta strip. Omit to skip the suffix. */
  comparisonModeLabel?: string;
  /** fix-142: when set, the card becomes a clickable toggle (pointer
   *  cursor, role=button, keyboard-activatable) and renders a chevron in
   *  the label row. Used by the three timeline tiles to toggle the
   *  per-cycle drawer. */
  onClick?: () => void;
  /** fix-142: drives aria-expanded + the chevron glyph (▾ collapsed,
   *  ▴ expanded). Only meaningful alongside onClick. */
  expanded?: boolean;
  /** fix-184a: when set (alongside onClick), the card is a drill-in trigger
   *  (opens a modal) rather than an expand toggle — it shows a "⤢" glyph and
   *  no aria-expanded, so the affordance reads as "open detail". */
  drill?: boolean;
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
  currentRangeLabel,
  comparisonRangeLabel,
  labelSlot,
  comparisonModeLabel,
  onClick,
  expanded,
  drill,
}: Props) {
  const showComparison = Boolean(comparisonLabel);
  // fix-129-b: switch to split-view when comparison is active AND the
  // caller supplied a range pair. The legacy ComparisonRow remains for
  // cards whose subText already carries n/total formatting (e.g.,
  // In Corrections' "12 of 47 issued") that doesn't split cleanly.
  const useSplit =
    showComparison && !!currentRangeLabel && !!comparisonRangeLabel;
  // fix-142: clickable-toggle affordance for the three timeline tiles.
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={`bg-surface border border-border rounded-lg px-4 py-3 flex flex-col gap-1${
        clickable ? ' cursor-pointer hover:border-dim transition-colors' : ''
      }`}
      data-testid={testId}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-expanded={clickable && !drill ? expanded : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
    >
      <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold flex items-center justify-between gap-1">
        <span>{labelSlot ?? label}</span>
        {clickable && (
          <span aria-hidden="true" className="text-[10px] leading-none">
            {drill ? '⤢' : expanded ? '▴' : '▾'}
          </span>
        )}
      </div>
      {useSplit ? (
        <KpiSplitView
          currentRangeLabel={currentRangeLabel}
          comparisonRangeLabel={comparisonRangeLabel}
          currentValueText={`${value}${unit ?? ''}`}
          comparisonValueText={`${comparisonValueText ?? comparisonNumeric ?? '—'}${
            // Don't double-suffix when comparisonValueText already
            // includes the unit (e.g., callers pass "67%" verbatim).
            comparisonValueText && /[a-zA-Z%]$/.test(comparisonValueText)
              ? ''
              : unit ?? ''
          }`}
          currentNumeric={currentNumeric ?? null}
          comparisonNumeric={comparisonNumeric ?? null}
          direction={comparisonDirection}
          comparisonModeLabel={comparisonModeLabel}
          testId={testId ? `${testId}-split` : undefined}
        />
      ) : (
        <>
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
        </>
      )}
      {/* fix-129-b: when split-view renders, the subText still sits
          below the split rather than being hidden — keeps the "{n} units"
          / "{n} of {n} issued" context attached to the headline. */}
      {useSplit && subText && (
        <div className="text-[10px] text-muted truncate mt-1">{subText}</div>
      )}
    </div>
  );
}
