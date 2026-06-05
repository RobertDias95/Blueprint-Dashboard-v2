// fix-124-b: one-click comparison preset chips above the Trends +
// Reports/Overview filter rows. Setting up "this quarter vs last" used
// to be 4 clicks (Range→Custom, From, To, Compare to→Previous period);
// the chips collapse that to one. Power-user arbitrary slicing still
// works through the underlying Date range + Compare to controls —
// nothing moves or hides.
//
// Active highlight is informational: it flips on when the current
// (range, compareTo) state exactly matches a preset's computed slice.
// If the user then tweaks the date picker manually, no chip matches →
// no highlight. The chips are not a persistent toggle.

import {
  activeComparePreset,
  COMPARE_PRESETS,
  rangeForPreset,
  type ComparePreset,
  type CompareMode,
  type DateRange,
} from '../../lib/comparisonCohort';

export interface ComparePresetChipsProps {
  /** Current { from, to } slice. Null when the user hasn't picked a
   *  range yet — chips still render and click-applies the preset's
   *  slice, but no chip can be highlighted. */
  currentRange: DateRange | null;
  /** Current compare-to mode. Only 'previous_period' can match a preset. */
  compareTo: CompareMode;
  /** Anchor for the preset date math. Passed in (not derived from a
   *  fresh `new Date()`) so tests can pin a deterministic "today". */
  today: Date;
  /** Caller wires this into its own state model (URL params on Trends,
   *  component state on Reports/Overview). Always returns 'previous_period'
   *  — every preset is a previous_period comparison. */
  onApply: (range: DateRange, compareTo: 'previous_period') => void;
  /** Optional testid prefix; defaults to 'compare-preset'. Individual
   *  chips carry `${prefix}-${preset}` so test selectors stay stable. */
  testIdPrefix?: string;
}

export default function ComparePresetChips({
  currentRange,
  compareTo,
  today,
  onApply,
  testIdPrefix = 'compare-preset',
}: ComparePresetChipsProps) {
  const active = activeComparePreset(currentRange, compareTo, today);
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid={`${testIdPrefix}-row`}
    >
      <span className="text-[10px] uppercase tracking-wide text-dim font-display font-bold mr-1">
        Quick compare
      </span>
      {COMPARE_PRESETS.map((spec) => {
        const isActive = active === spec.preset;
        return (
          <button
            key={spec.preset}
            type="button"
            onClick={() => {
              const range = rangeForPreset(spec.preset, today);
              onApply(range, spec.compareTo);
            }}
            className="text-[11px] px-3 py-1 rounded-full border font-display font-bold transition-colors"
            style={{
              // Active = filled phase-blue with white text (the de color
              // matches the rest of the comparison UX accents); inactive
              // = surface bg + muted text + bordered. Same size for both
              // so the only visual delta is fill, not shape.
              background: isActive ? 'var(--color-de)' : 'var(--color-surface)',
              color: isActive ? '#fff' : 'var(--color-muted)',
              borderColor: isActive ? 'var(--color-de)' : 'var(--color-border)',
            }}
            data-testid={`${testIdPrefix}-${spec.preset}`}
            data-active={isActive ? 'true' : 'false'}
            aria-pressed={isActive}
          >
            {spec.label}
          </button>
        );
      })}
    </div>
  );
}

export type { ComparePreset };
