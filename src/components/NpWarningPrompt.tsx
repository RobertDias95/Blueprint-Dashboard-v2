// Q6.2.d: soft-warning prompt when a drop's target range overlaps one or
// more NP blocks (Vacation/Training/Redesign/etc.) on the target DA. This
// is distinct from OverlapPrompt (which is for project-vs-project hard
// conflict + Push Down cascade). NP overlap is a soft warning — the
// system allows the data; the user just needs to be informed.

export interface NpWarningEntry {
  id: string;
  type: string;
  label: string | null;
  startWeek: string;
  endWeek: string;
}

interface Props {
  anchorAddress: string;
  daName: string;
  conflicts: NpWarningEntry[];
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}

export default function NpWarningPrompt({
  anchorAddress,
  daName,
  conflicts,
  onCancel,
  onConfirm,
  pending,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[9000] bg-black/50 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
      data-testid="np-warning-prompt-backdrop"
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl"
        data-testid="np-warning-prompt"
      >
        <div className="space-y-1">
          <div className="text-sm font-display font-bold text-text">
            {daName} has time blocked during this range
          </div>
          <div className="text-[11px] text-muted">
            Moving{' '}
            <span className="font-semibold text-text">{anchorAddress}</span>{' '}
            here overlaps with the following on {daName}'s calendar. You can
            still save — this is informational, not a hard conflict.
          </div>
        </div>

        <ul
          className="bg-bg border border-border rounded-md max-h-44 overflow-y-auto divide-y divide-border"
          data-testid="np-warning-prompt-list"
        >
          {conflicts.map((c) => (
            <li
              key={c.id}
              className="px-3 py-1.5 text-[11px] font-mono text-text flex items-baseline gap-2"
            >
              <span className="font-semibold">{c.type}</span>
              {c.label && c.label !== c.type && (
                <span className="text-muted truncate">— {c.label}</span>
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
            data-testid="np-warning-prompt-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-pm text-white font-display font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="np-warning-prompt-confirm"
          >
            {pending ? 'Saving…' : 'Save anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}
