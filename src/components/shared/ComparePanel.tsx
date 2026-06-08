import { useEffect, useRef, useState } from 'react';
import {
  applyComparePreset,
  COMPARE_PRESETS_V2,
  type DateRange,
} from '../../lib/comparisonCohort';

// fix-137-b: inline compare panel. Sits below the AddComparisonButton
// in the page filter row (NOT a modal — keeps the visual placement
// predictable and stays out of the user's way when they already know
// what they want).
//
// Layout:
//   - Header: "Compare periods"
//   - Preset row: 6 buttons (one per ComparePresetId) that fill BOTH
//     Period A and Period B inputs at once.
//   - "Or pick manually:" divider
//   - Period A pickers (pre-filled from the page's current Range filter)
//   - "vs"
//   - Period B pickers (empty when first opening unless already set)
//   - Footer: [Cancel] [Apply]
//
// On Apply: calls onApply(periodA, periodB). Parent threads periodA
// into the page's Range filter AND periodB into the page's
// comparisonRange state. Apply is disabled when either period has an
// incomplete date pair.
//
// Keyboard: Escape closes (calls onCancel). Enter triggers Apply
// when both periods are valid.

export interface ComparePanelProps {
  open: boolean;
  primaryRange: DateRange | null;
  comparisonRange: DateRange | null;
  today: Date;
  onApply: (periodA: DateRange, periodB: DateRange) => void;
  onCancel: () => void;
  testIdPrefix?: string;
}

function rangeOrEmpty(r: DateRange | null): DateRange {
  return r ?? { from: '', to: '' };
}

export default function ComparePanel({
  open,
  primaryRange,
  comparisonRange,
  today,
  onApply,
  onCancel,
  testIdPrefix = 'compare-panel',
}: ComparePanelProps) {
  if (!open) return null;
  // The panel only mounts when open transitions false → true. Returning
  // null above means the component fully unmounts on close; the next
  // open remounts with fresh useState initializers, which seeds local
  // state from the current props without needing a useEffect re-seed.
  return (
    <OpenedPanel
      primaryRange={primaryRange}
      comparisonRange={comparisonRange}
      today={today}
      onApply={onApply}
      onCancel={onCancel}
      testIdPrefix={testIdPrefix}
    />
  );
}

function OpenedPanel({
  primaryRange,
  comparisonRange,
  today,
  onApply,
  onCancel,
  testIdPrefix,
}: Omit<ComparePanelProps, 'open'> & { testIdPrefix: string }) {
  const [periodA, setPeriodA] = useState<DateRange>(rangeOrEmpty(primaryRange));
  const [periodB, setPeriodB] = useState<DateRange>(rangeOrEmpty(comparisonRange));
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Escape dismisses. Attached to the container so the keyboard handler
  // runs regardless of which input has focus inside the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const isValid =
    !!periodA.from && !!periodA.to && !!periodB.from && !!periodB.to;

  function applyPreset(presetId: typeof COMPARE_PRESETS_V2[number]['preset']) {
    const pair = applyComparePreset(presetId, today);
    setPeriodA(pair.periodA);
    setPeriodB(pair.periodB);
  }

  function handleApply() {
    if (!isValid) return;
    onApply(periodA, periodB);
  }

  function handleEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleApply();
  }

  return (
    <div
      ref={containerRef}
      className="bg-surface border border-border rounded-lg p-3 space-y-3"
      data-testid={testIdPrefix}
      role="dialog"
      aria-label="Compare periods"
    >
      <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
        Compare periods
      </div>

      {/* Preset row — 6 quick-fill shortcuts. */}
      <div
        className="flex flex-wrap items-center gap-1"
        data-testid={`${testIdPrefix}-presets`}
      >
        {COMPARE_PRESETS_V2.map((spec) => (
          <button
            key={spec.preset}
            type="button"
            onClick={() => applyPreset(spec.preset)}
            className="text-[10px] font-display font-bold px-2 py-1 rounded border bg-surface hover:bg-s2 text-text"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`${testIdPrefix}-preset-${spec.preset}`}
          >
            {spec.label}
          </button>
        ))}
      </div>

      <div className="text-[10px] text-dim italic">Or pick manually:</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Period A */}
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            Period A
          </div>
          <div className="flex items-center gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-dim">From</span>
              <input
                type="date"
                value={periodA.from}
                onChange={(e) =>
                  setPeriodA((prev) => ({ ...prev, from: e.target.value }))
                }
                onKeyDown={handleEnter}
                className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
                style={{ borderColor: 'var(--color-border)' }}
                data-testid={`${testIdPrefix}-period-a-from`}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-dim">To</span>
              <input
                type="date"
                value={periodA.to}
                onChange={(e) =>
                  setPeriodA((prev) => ({ ...prev, to: e.target.value }))
                }
                onKeyDown={handleEnter}
                className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
                style={{ borderColor: 'var(--color-border)' }}
                data-testid={`${testIdPrefix}-period-a-to`}
              />
            </label>
          </div>
        </div>

        {/* Period B */}
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            vs Period B
          </div>
          <div className="flex items-center gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-dim">From</span>
              <input
                type="date"
                value={periodB.from}
                onChange={(e) =>
                  setPeriodB((prev) => ({ ...prev, from: e.target.value }))
                }
                onKeyDown={handleEnter}
                className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
                style={{ borderColor: 'var(--color-border)' }}
                data-testid={`${testIdPrefix}-period-b-from`}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-dim">To</span>
              <input
                type="date"
                value={periodB.to}
                onChange={(e) =>
                  setPeriodB((prev) => ({ ...prev, to: e.target.value }))
                }
                onKeyDown={handleEnter}
                className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
                style={{ borderColor: 'var(--color-border)' }}
                data-testid={`${testIdPrefix}-period-b-to`}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] font-display font-bold px-3 py-1 rounded-md border bg-surface text-text hover:bg-s2"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid={`${testIdPrefix}-cancel`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!isValid}
          className="text-[11px] font-display font-bold px-3 py-1 rounded-md bg-de text-white border border-de hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid={`${testIdPrefix}-apply`}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
