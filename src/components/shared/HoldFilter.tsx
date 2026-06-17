import type { HoldFilterMode } from '../../lib/holdFilter';

// fix-178: shared three-way hold filter (All / Only holds / Exclude holds) used
// by both the Dashboard and the Project List. Mirrors ScopeToggle's segmented-
// control styling. Default 'all'; no persistence (resets each load).

const OPTIONS: ReadonlyArray<{ mode: HoldFilterMode; label: string }> = [
  { mode: 'all', label: 'All' },
  { mode: 'only', label: 'Only Holds' },
  { mode: 'exclude', label: 'Exclude Holds' },
];

export default function HoldFilter({
  mode,
  onChange,
  testid = 'hold-filter',
}: {
  mode: HoldFilterMode;
  onChange: (mode: HoldFilterMode) => void;
  testid?: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-1"
      data-testid={testid}
      role="group"
      aria-label="Filter by hold status"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          onClick={() => onChange(o.mode)}
          className="text-[11px] px-3 py-1 rounded border font-bold"
          style={chipStyle(mode === o.mode)}
          data-testid={`${testid}-${o.mode}`}
          aria-pressed={mode === o.mode}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return active
    ? {
        background: 'var(--color-de)',
        borderColor: 'var(--color-de)',
        color: 'white',
      }
    : {
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
      };
}
