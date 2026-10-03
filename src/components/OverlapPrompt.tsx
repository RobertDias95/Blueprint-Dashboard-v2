// Q6.2: Option B conflict UX. Shown when a drag-drop on the schedule grid
// would overlap one or more existing project blocks on the target DA.
//
// Q6.2.b: Push Down is enabled — clicking it fires bp_resolve_da_overlap
// via useResolveDaOverlap, which moves the anchor + cascades the displaced
// blocks past the new anchor end (preserving each block's duration).

interface Props {
  anchorAddress: string;
  conflictingAddresses: string[];
  conflictCount: number;
  /**
   * ═══ ★★★ fix-621 (P-316) — WHAT THIS MOVE WILL *NOT* DO ═══
   *
   * ⚖️ Bobby, 2026-10-03: **"Approved/issued keep them"**
   *
   * Push Down rewrites `dd_start` / `dd_end` / `target_submit` on the anchor AND
   * every displaced project — except, now, on permits that are approved or
   * issued. A confirm that does less than it says is the thing worth naming, so
   * the count is spelled out here rather than discovered afterwards.
   *
   * ★ Built by `finishedPermitsNoteAcross` from the rows the caller already
   *   holds, so the prompt cannot invent a number. `null` when the rule does not
   *   apply, and then nothing renders — a line that said "0 permits keep their
   *   dates" on every ordinary move would train people to stop reading it.
   */
  finishedNote?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}

export default function OverlapPrompt({
  anchorAddress,
  conflictingAddresses,
  conflictCount,
  finishedNote = null,
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
            here would conflict with the following on the target DA. Push Down
            moves the displaced projects to start immediately after the new
            anchor end (preserves each project's duration).
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

        {finishedNote && (
          <div
            className="text-[11px] text-muted border-l-2 border-border pl-2"
            data-testid="overlap-prompt-finished-note"
          >
            {finishedNote}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-s2 transition font-display disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="overlap-prompt-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="overlap-prompt-push-down"
          >
            {pending ? 'Pushing…' : `Push down ${conflictCount} project${conflictCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
