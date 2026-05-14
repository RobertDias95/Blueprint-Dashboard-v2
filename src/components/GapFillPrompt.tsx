// Q9.5.f-fix-20: surfaced after a successful bp_move_draw_schedule_da when
// the move leaves downstream blocks stranded on the OLD DA. Asks the user
// whether to shift those downstream blocks up to fill the gap, or leave
// them in place (e.g., the move was made for a reason — vacation, corrections,
// rebalancing load).
//
// Mirrors OverlapPrompt's visual pattern. "Shift Up" fires
// bp_shift_da_blocks_up via useShiftDaBlocksUp. "Leave Gap" dismisses with
// no further action. Blocks shifted: server-capped at current week — RPC
// returns a flag if the cap kicked in, so we can surface that to the user.

interface Props {
  /** Old DA name that just lost a block. */
  daName: string;
  /** How many downstream blocks would be candidates for shifting. */
  downstreamCount: number;
  /** Address of the project that was moved (provides context). */
  movedAddress: string;
  pending: boolean;
  onLeaveGap: () => void;
  onShiftUp: () => void;
}

export default function GapFillPrompt({
  daName,
  downstreamCount,
  movedAddress,
  pending,
  onLeaveGap,
  onShiftUp,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[9000] bg-black/50 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onLeaveGap();
      }}
      data-testid="gap-fill-prompt-backdrop"
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl"
        data-testid="gap-fill-prompt"
      >
        <div className="space-y-1">
          <div className="text-sm font-display font-bold text-text">
            Fill the gap on {daName}?
          </div>
          <div className="text-[11px] text-muted">
            Moving{' '}
            <span className="font-semibold text-text">{movedAddress}</span> left
            an empty slot on {daName}'s schedule.{' '}
            <span className="font-semibold text-text">{downstreamCount}</span>{' '}
            downstream block
            {downstreamCount === 1 ? '' : 's'} could shift up to fill it.
            Each block preserves its duration; nothing shifts before the
            current week.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onLeaveGap}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-s2 transition font-display disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="gap-fill-prompt-leave"
          >
            Leave gap
          </button>
          <button
            type="button"
            onClick={onShiftUp}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="gap-fill-prompt-shift"
          >
            {pending
              ? 'Shifting…'
              : `Shift up ${downstreamCount} block${downstreamCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
