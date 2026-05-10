// Q6.2: Option B conflict UX. Shown when a drag-drop on the schedule grid
// would overlap one or more existing project blocks on the target DA.
// "Push Down" cascade is the Q6.2.b ship; for now the button is rendered
// disabled with a tooltip so the design intent is visible while we land
// the read/move paths first.

interface Props {
  anchorAddress: string;
  conflictingAddresses: string[];
  conflictCount: number;
  onCancel: () => void;
}

export default function OverlapPrompt({
  anchorAddress,
  conflictingAddresses,
  conflictCount,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[9000] bg-black/50 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      data-testid="overlap-prompt-backdrop"
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl"
        data-testid="overlap-prompt"
      >
        <div className="space-y-1">
          <div className="text-sm font-display font-bold text-text">
            Drop overlaps {conflictCount} project
            {conflictCount === 1 ? '' : 's'}
          </div>
          <div className="text-[11px] text-muted">
            Moving <span className="font-semibold text-text">{anchorAddress}</span>{' '}
            here would conflict with the following on the target DA:
          </div>
        </div>

        <ul
          className="bg-bg border border-border rounded-md max-h-44 overflow-y-auto divide-y divide-border"
          data-testid="overlap-prompt-list"
        >
          {conflictingAddresses.map((addr) => (
            <li
              key={addr}
              className="px-3 py-1.5 text-[11px] font-mono text-text"
            >
              {addr}
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-s2 transition font-display"
            data-testid="overlap-prompt-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled
            title="Push-down cascade ships in Q6.2.b — the server RPC isn't deployed yet."
            className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold opacity-40 cursor-not-allowed"
            data-testid="overlap-prompt-push-down"
          >
            Push down (Q6.2.b)
          </button>
        </div>
      </div>
    </div>
  );
}
