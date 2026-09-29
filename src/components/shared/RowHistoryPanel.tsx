import { useState } from 'react';
import {
  stableKeyPart,
  useRestoreAuditedRow,
  useRowHistory,
} from '../../hooks/useRowHistory';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import {
  actorLabel,
  emptyHistoryLine,
  type HistoryEntry,
} from '../../lib/rowHistory';

// ===========================================================================
// ★★★ fix-590 §2 — THE THREE THINGS THAT COUNT AS DONE
// ===========================================================================
//
// §2's minimum, and this component is 1 and 2 of it:
//   1. **See the history of one row** — what changed, when, by whom, from what
//      to what.
//   2. **Put a prior version back**, in one action, from the screen.
//   3. **Restoring is itself an audited write** — which is the RPC's doing, not
//      this file's: the restore's UPDATE fires the same trigger as any other
//      change, so it appears in this very list the moment it lands.
//
// ★★★ ONE PANEL, EVERY SURFACE. The roster, the policy numbers, the tag options,
//     the task templates, the DA routing and the quarter layout all arrange rows
//     by hand and all lose them the same way. Six copies of this would be six
//     places for the restore button to behave differently — the defect class this
//     Brain has removed six times, arriving through a UI door.

/** ★ Recording began when Bobby applied the migration. Stated so an empty panel
 *  can say WHY it is empty — see `emptyHistoryLine`, and §0's whole point. */
export const HISTORY_RECORDING_SINCE: string | null = null;

export default function RowHistoryPanel({
  table,
  rowId,
  rowKey,
  label,
  onClose,
}: {
  table: string;
  /** A single-column key. ★ Pass this OR `rowKey`, never both — see
   *  `RowHistoryTarget` for why a composite key must not be stringified. */
  rowId?: string;
  /** A composite key, as `{column: value}`. */
  rowKey?: Record<string, string>;
  /** What this row is called, for the heading. */
  label: string;
  onClose?: () => void;
}) {
  const { entries, isLoading } = useRowHistory({ table, rowId, rowKey });
  const teamQ = useTeamMembers();
  const restore = useRestoreAuditedRow();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  // ★★★ fix-330's rule: `profiles.name` is NULL for all 29 prod logins, so a
  //     person's name comes from `team_members` — matched on the auth id where
  //     the roster carries one. A row whose actor is not on the roster says so
  //     rather than printing a uuid at somebody.
  const nameFor = (id: string): string | null => {
    const m = (teamQ.data ?? []).find(
      (t) => (t as { user_id?: string | null }).user_id === id,
    );
    return m?.name ?? null;
  };

  return (
    <div
      className="flex flex-col gap-1.5 rounded border p-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
      data-testid={`row-history-${table}-${rowId ?? stableKeyPart(rowKey ?? null)}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-[9px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--color-dim)' }}
        >
          History · {label}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] cursor-pointer"
            style={{ color: 'var(--color-de)' }}
            data-testid="row-history-close"
          >
            Close
          </button>
        )}
      </div>

      {isLoading && (
        <div className="text-[10px] italic" style={{ color: 'var(--color-dim)' }}>
          Loading…
        </div>
      )}

      {/* ★★★ THE EMPTY STATE IS PART OF THE FIX, not a placeholder. §0: *"I could
          not tell him whether it had been deleted or never saved."* Those were
          the same observation; they are different now, and when the answer is
          "never saved" this sentence is the answer. */}
      {!isLoading && entries.length === 0 && (
        <div
          className="text-[10px] leading-snug"
          style={{ color: 'var(--color-muted)' }}
          data-testid="row-history-empty"
        >
          {emptyHistoryLine(HISTORY_RECORDING_SINCE)}
        </div>
      )}

      {entries.map((e) => (
        <Entry
          key={e.id}
          entry={e}
          who={actorLabel(e.raw.user_id, nameFor)}
          pending={restore.isPending}
          confirming={confirmId === e.id}
          onAskConfirm={() => setConfirmId(e.id)}
          onCancel={() => setConfirmId(null)}
          onRestore={() => {
            setConfirmId(null);
            restore.mutate({ auditId: e.id, table });
          }}
        />
      ))}
    </div>
  );
}

function Entry({
  entry,
  who,
  pending,
  confirming,
  onAskConfirm,
  onCancel,
  onRestore,
}: {
  entry: HistoryEntry;
  who: string;
  pending: boolean;
  confirming: boolean;
  onAskConfirm: () => void;
  onCancel: () => void;
  onRestore: () => void;
}) {
  const when = new Date(entry.createdAt).toLocaleString();
  return (
    <div
      className="flex flex-col gap-0.5 border-t pt-1"
      style={{ borderTopColor: 'var(--color-border)' }}
      data-testid={`row-history-entry-${entry.id}`}
      data-op={entry.op ?? 'other'}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px]" style={{ color: 'var(--color-text)' }}>
          <span className="font-mono">{opWord(entry)}</span>{' '}
          <span style={{ color: 'var(--color-dim)' }}>{when} ·</span> {who}
          {/* ★★★ §3: the scraper's writes are RECORDED AND MARKED. `auth.uid()`
              is null for it, which is the signal — 1,297 of the last 3,030 audit
              rows already carry no actor. ⛔ They are not filtered out. */}
          {entry.machine && (
            <span
              className="ml-1 text-[9px] px-1 rounded"
              style={{ background: 'var(--color-s2)', color: 'var(--color-muted)' }}
              data-testid={`row-history-machine-${entry.id}`}
            >
              not a person
            </span>
          )}
        </span>
        {entry.blockedReason === null ? (
          confirming ? (
            <span className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onRestore}
                disabled={pending}
                className="text-[10px] font-bold cursor-pointer disabled:opacity-50"
                style={{ color: 'var(--color-de)' }}
                data-testid={`row-history-restore-confirm-${entry.id}`}
              >
                Put it back
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="text-[10px] cursor-pointer"
                style={{ color: 'var(--color-dim)' }}
                data-testid={`row-history-restore-cancel-${entry.id}`}
              >
                Cancel
              </button>
            </span>
          ) : (
            /* ★★ IT ASKS FIRST. A restore is a write that overwrites whatever is
               there now, and fix-440's rule is that one control does not mean one
               click. Two taps, no dialog. */
            <button
              type="button"
              onClick={onAskConfirm}
              className="text-[10px] cursor-pointer shrink-0"
              style={{ color: 'var(--color-de)' }}
              data-testid={`row-history-restore-${entry.id}`}
            >
              Restore
            </button>
          )
        ) : (
          /* ★★★ AND WHEN IT CANNOT, IT SAYS WHY — rather than showing a dead
              button or nothing at all. `restoreBlockedReason` mirrors the RPC's
              own refusals in the RPC's order, so the person is told before they
              click instead of after. */
          <span
            className="text-[9px] italic shrink-0 max-w-[45%] text-right"
            style={{ color: 'var(--color-dim)' }}
            title={entry.blockedReason}
            data-testid={`row-history-blocked-${entry.id}`}
          >
            {entry.blockedReason}
          </span>
        )}
      </div>
      {entry.fields.map((f) => (
        <div
          key={f.column}
          className="text-[10px] font-mono pl-2"
          style={{ color: 'var(--color-muted)' }}
          data-testid={`row-history-field-${entry.id}-${f.column}`}
        >
          {f.column}: <span title={String(f.rawBefore ?? '')}>{f.before}</span>
          {' → '}
          <span
            style={{ color: 'var(--color-text)' }}
            title={String(f.rawAfter ?? '')}
          >
            {f.after}
          </span>
        </div>
      ))}
    </div>
  );
}

/** ★ The word a reader needs, not the action string. An unrecognised action
 *  prints verbatim — a history that silently omitted rows would be the original
 *  defect in miniature. */
function opWord(entry: HistoryEntry): string {
  switch (entry.op) {
    case 'inserted':
      return 'created';
    case 'deleted':
      return 'deleted';
    case 'updated':
      return 'changed';
    default:
      return entry.raw.action;
  }
}
