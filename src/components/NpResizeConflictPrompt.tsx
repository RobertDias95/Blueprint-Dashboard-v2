// fix-25-feat-a: soft-warning prompt for NP block resize that would
// overlap project blocks OR other NP blocks on the same DA. Both kinds
// are soft (the existing grid rendering already allows NP-over-project
// as clipped segments), so "Save anyway" + "Cancel" are the only
// actions. Push-down doesn't apply — moving project blocks to make
// room for a longer vacation isn't a sensible cascade.

interface ProjectConflict {
  kind: 'project';
  address: string;
  startWeek: string;
  endWeek: string;
}
interface NpConflict {
  kind: 'np';
  type: string;
  label: string | null;
  startWeek: string;
  endWeek: string;
}
type Conflict = ProjectConflict | NpConflict;

interface Props {
  /** The NP block being resized — short label like "Vacation" / "PTO". */
  anchorLabel: string;
  daName: string;
  conflictKind: 'project' | 'np';
  conflicts: Conflict[];
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}

export default function NpResizeConflictPrompt({
  anchorLabel,
  daName,
  conflictKind,
  conflicts,
  onCancel,
  onConfirm,
  pending,
}: Props) {
  const count = conflicts.length;
  const noun =
    conflictKind === 'project'
      ? `project block${count === 1 ? '' : 's'}`
      : `time block${count === 1 ? '' : 's'}`;
  return (
    <div
      className="fixed inset-0 z-[9000] bg-black/50 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
      data-testid="np-resize-conflict-backdrop"
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl"
        data-testid="np-resize-conflict-prompt"
      >
        <div className="space-y-1">
          <div className="text-sm font-display font-bold text-text">
            Resize overlaps {count} {noun}
          </div>
          <div className="text-[11px] text-muted">
            Resizing{' '}
            <span className="font-semibold text-text">{anchorLabel}</span>{' '}
            on {daName}'s lane would overlap the following. You can still
            save — this is informational, not a hard conflict.
          </div>
        </div>

        <ul
          className="bg-bg border border-border rounded-md max-h-44 overflow-y-auto divide-y divide-border"
          data-testid="np-resize-conflict-list"
        >
          {conflicts.map((c, i) => (
            <li
              key={i}
              className="px-3 py-1.5 text-[11px] font-mono text-text flex items-baseline gap-2"
            >
              {c.kind === 'project' ? (
                <span className="font-semibold truncate">{c.address}</span>
              ) : (
                <>
                  <span className="font-semibold">{c.type}</span>
                  {c.label && c.label !== c.type && (
                    <span className="text-muted truncate">— {c.label}</span>
                  )}
                </>
              )}
              <span className="text-dim ml-auto shrink-0">
                {c.startWeek} → {c.endWeek}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-s2 transition font-display disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="np-resize-conflict-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-pm text-white font-display font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="np-resize-conflict-confirm"
          >
            {pending ? 'Saving…' : 'Save anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}
