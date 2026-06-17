import type { ScopeMode } from '../../lib/selfScope';

// fix-176: shared "My work / Everyone" segmented control used by the Dashboard,
// Project Overview, and My tab. Defaults to "My work" for rostered users; the
// choice is remembered per-user (see useScopeMode). Renders nothing for an
// unmapped login (no roster name -> nothing to scope to).

export default function ScopeToggle({
  mode,
  onChange,
  name,
  testid = 'scope-toggle',
}: {
  mode: ScopeMode;
  onChange: (mode: ScopeMode) => void;
  /** Roster name of the logged-in user. When null the control hides. */
  name: string | null;
  testid?: string;
}) {
  if (!name) return null;
  return (
    <div
      className="inline-flex items-center gap-1"
      data-testid={testid}
      role="group"
      aria-label="Scope work to me or everyone"
    >
      <button
        type="button"
        onClick={() => onChange('mine')}
        className="text-[11px] px-3 py-1 rounded border font-bold"
        style={chipStyle(mode === 'mine')}
        data-testid={`${testid}-mine`}
        aria-pressed={mode === 'mine'}
        title={`Show only ${name}'s work`}
      >
        My Work
      </button>
      <button
        type="button"
        onClick={() => onChange('all')}
        className="text-[11px] px-3 py-1 rounded border font-bold"
        style={chipStyle(mode === 'all')}
        data-testid={`${testid}-all`}
        aria-pressed={mode === 'all'}
      >
        Everyone
      </button>
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
