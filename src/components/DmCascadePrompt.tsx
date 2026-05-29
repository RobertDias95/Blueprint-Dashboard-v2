// fix-72: surfaced before a draw-schedule DA move when the team routing implies
// a DM (ent_lead) change. Lets the user apply the DM change, keep the current
// DM, or cancel the move entirely. Mirrors GapFillPrompt's visual pattern.

interface Props {
  /** Address of the project being moved (context). */
  movedAddress: string;
  /** The DA the project is being moved to. */
  newDa: string;
  /** Current DM (ent_lead) on the project's BP, or null. */
  fromLead: string | null;
  /** Routed DM the move would imply. */
  toLead: string;
  pending: boolean;
  onUpdateDm: () => void;
  onKeepDm: () => void;
  onCancel: () => void;
}

export default function DmCascadePrompt({
  movedAddress,
  newDa,
  fromLead,
  toLead,
  pending,
  onUpdateDm,
  onKeepDm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[9000] bg-black/50 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
      data-testid="dm-cascade-prompt-backdrop"
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl"
        data-testid="dm-cascade-prompt"
      >
        <div className="space-y-1">
          <div className="text-sm font-display font-bold text-text">
            Update DM as well?
          </div>
          <div className="text-[11px] text-muted" data-testid="dm-cascade-prompt-body">
            Moving{' '}
            <span className="font-semibold text-text">{movedAddress}</span> to{' '}
            <span className="font-semibold text-text">{newDa}</span> would also
            change the DM from{' '}
            <span className="font-semibold text-text">{fromLead ?? '—'}</span> to{' '}
            <span className="font-semibold text-text">{toLead}</span> based on the
            team routing. Apply the DM change?
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-s2 transition font-display disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="dm-cascade-prompt-cancel"
          >
            Cancel move
          </button>
          <button
            type="button"
            onClick={onKeepDm}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-s2 transition font-display disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="dm-cascade-prompt-keep"
          >
            Keep current DM
          </button>
          <button
            type="button"
            onClick={onUpdateDm}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="dm-cascade-prompt-update"
          >
            Update DM
          </button>
        </div>
      </div>
    </div>
  );
}
