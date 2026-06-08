import type { DateRange } from '../../lib/comparisonCohort';

// fix-137-b: entry-point for the new compare control. Sits in the
// page's filter row. Two visual states:
//   - No comparison: dashed-border "+ Add comparison" button. Click
//     opens the inline ComparePanel.
//   - Comparison active: solid chip showing "vs YYYY-MM-DD – YYYY-MM-DD"
//     with an X to remove and an edit icon to re-open the panel.
//
// Open/close is fully parent-controlled — the AddComparisonButton
// doesn't own the panel's open state because the panel lives as a
// sibling, not as a popover. Keeps the visual placement predictable
// (panel below filter row, not floating).

export interface AddComparisonButtonProps {
  isOpen: boolean;
  hasComparison: boolean;
  comparisonRange: DateRange | null;
  onOpenChange: (open: boolean) => void;
  onRemoveComparison: () => void;
  testIdPrefix?: string;
}

export default function AddComparisonButton({
  isOpen,
  hasComparison,
  comparisonRange,
  onOpenChange,
  onRemoveComparison,
  testIdPrefix = 'compare',
}: AddComparisonButtonProps) {
  if (!hasComparison || !comparisonRange) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        className="text-[11px] font-display font-bold px-3 py-1.5 rounded-md border-2 border-dashed bg-surface text-muted hover:text-de hover:border-de transition"
        style={{ borderColor: isOpen ? 'var(--color-de)' : 'var(--color-border)' }}
        data-testid={`${testIdPrefix}-add-button`}
        data-open={isOpen ? 'true' : 'false'}
        aria-expanded={isOpen}
      >
        + Add comparison
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded-md border bg-de-bg text-[11px] font-display"
      style={{
        borderColor: 'var(--color-de-border)',
        color: 'var(--color-de)',
      }}
      data-testid={`${testIdPrefix}-chip`}
    >
      <span className="font-bold">
        vs {comparisonRange.from} – {comparisonRange.to}
      </span>
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        className="ml-1 px-1 py-0.5 rounded hover:bg-surface transition"
        title="Edit comparison range"
        aria-label="Edit comparison range"
        data-testid={`${testIdPrefix}-edit-button`}
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onRemoveComparison}
        className="px-1 py-0.5 rounded hover:bg-surface transition"
        title="Remove comparison"
        aria-label="Remove comparison"
        data-testid={`${testIdPrefix}-remove-button`}
      >
        ×
      </button>
    </div>
  );
}
