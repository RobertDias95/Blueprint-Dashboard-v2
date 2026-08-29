// ★ fix-441 §D (P-091): one chipStyle, in lib/chipStyle. `'surface'` is
//   THIS file's inactive tint — the four originals were two different
//   implementations, not one repeated. See the note there.
import { chipStyle } from '../../lib/chipStyle';
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
          style={chipStyle(mode === o.mode, 'surface')}
          data-testid={`${testid}-${o.mode}`}
          aria-pressed={mode === o.mode}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

