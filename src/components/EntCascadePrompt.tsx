// fix-72 (originally DmCascadePrompt) → fix-102 (renamed to
// EntCascadePrompt with corrected labels). Surfaced before a
// draw-schedule DA move when the team routing implies an Entitlement
// Lead (ent_lead) change. Lets the user apply the ENT cascade, keep
// the current ENT, or cancel the move entirely. Mirrors GapFillPrompt's
// visual pattern.
//
// History: fix-72 named this "DM" because the prior owner thought
// ent_lead was the "design manager." It isn't — DMs (Brittani, Derry,
// Jade, Lindsay) live in projects.design_manager and route through
// dm_da_groups. The ENTs (Miles, Briana) live in projects.entitlement_lead
// and route through da_team_routing — which is what this cascade
// operates on. fix-102 corrects the user-facing strings + testids; the
// underlying RPCs (bp_cascade_ent_lead_for_project,
// bp_move_draw_schedule_da) were always correct.

interface Props {
  /** Address of the project being moved (context). */
  movedAddress: string;
  /** The DA the project is being moved to. */
  newDa: string;
  /** Current Entitlement Lead (ent_lead) on the project's BP, or null. */
  fromLead: string | null;
  /** Routed Entitlement Lead the move would imply. */
  toLead: string;
  pending: boolean;
  onUpdateEntLead: () => void;
  onKeepEntLead: () => void;
  onCancel: () => void;
}

export default function EntCascadePrompt({
  movedAddress,
  newDa,
  fromLead,
  toLead,
  pending,
  onUpdateEntLead,
  onKeepEntLead,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[9000] bg-black/50 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
      data-testid="ent-cascade-prompt-backdrop"
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl"
        data-testid="ent-cascade-prompt"
      >
        <div className="space-y-1">
          <div className="text-sm font-display font-bold text-text">
            Update Entitlement Lead as well?
          </div>
          <div
            className="text-[11px] text-muted"
            data-testid="ent-cascade-prompt-body"
          >
            Moving{' '}
            <span className="font-semibold text-text">{movedAddress}</span> to{' '}
            <span className="font-semibold text-text">{newDa}</span> would also
            change the Entitlement Lead from{' '}
            <span className="font-semibold text-text">
              {fromLead ?? '—'}
            </span>{' '}
            to <span className="font-semibold text-text">{toLead}</span> based
            on the team routing. Apply the Entitlement Lead change?
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-s2 transition font-display disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="ent-cascade-prompt-cancel"
          >
            Cancel move
          </button>
          <button
            type="button"
            onClick={onKeepEntLead}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-s2 transition font-display disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="ent-cascade-prompt-keep"
          >
            Keep current Entitlement Lead
          </button>
          <button
            type="button"
            onClick={onUpdateEntLead}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="ent-cascade-prompt-update"
          >
            Update Entitlement Lead
          </button>
        </div>
      </div>
    </div>
  );
}
