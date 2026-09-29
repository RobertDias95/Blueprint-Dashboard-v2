import { useState } from 'react';
import {
  useDeletedQuarterLayout,
  useRestoreDeletedQuarterLayout,
} from '../../hooks/useRowHistory';
import { formatHistoryValue } from '../../lib/rowHistory';

// ===========================================================================
// ★★★ fix-590 §2 — THE ORIGIN CASE: A WHOLE QUARTER BACK IN ONE ACTION
// ===========================================================================
//
// **This is the screen the ticket is named after.** Bobby's hand-arranged Q4 2025
// layout — twelve columns, two DM groups — was not in the tool, and the reason he
// could not be told what happened to it is that this table had no history.
//
// ★★★ HIS ROWS DID NOT CHANGE, THEY VANISHED. So the question this component
//     answers is not *"what changed"* but *"what is missing"* — the newest history
//     entry per row, kept only where it is a delete. A per-row history panel
//     cannot answer that: you cannot open the history of a row that is not on
//     screen.
//
// ★★★ AND IF NOTHING WAS DELETED, IT RENDERS NOTHING — which is the honest answer
//     to the other half of §0. *"I could not tell him whether it had been deleted
//     or never saved."* Those were one observation; they are two now. When the
//     answer is "never saved" there is nothing to put back, the empty state says
//     so in words, and **a restore that invented a layout would be worse than the
//     gap it filled.**
//
// ★ Absent entirely for a reader with no write permission: the RPC is SECURITY
//   INVOKER and the quarter layout's own policy (admin OR
//   `profiles.may_edit_draw_schedule`) would refuse, so offering the button would
//   be fix-549 §B's *"a box you could use if you tried harder"*.

export default function QuarterLayoutRestore({
  quarter,
  readOnly = false,
}: {
  quarter: string;
  readOnly?: boolean;
}) {
  const { deleted, isLoading } = useDeletedQuarterLayout(quarter);
  const restore = useRestoreDeletedQuarterLayout();
  const [confirming, setConfirming] = useState(false);

  // ★ Nothing deleted, or nothing recorded yet (the migration is staged) → this
  //   component is invisible. It must not add a row of chrome to the 100+
  //   quarters that never lost anything.
  if (isLoading || deleted.length === 0) return null;

  const n = deleted.length;
  const when = deleted
    .map((e) => e.createdAt)
    .sort()
    .slice(-1)[0];
  /** ★ Name the columns, because "12 columns" is a number and "Cam, Marc,
   *  Brittani…" is the thing he arranged. Read off the DELETED row's own
   *  `before` values — the only place those names still exist. */
  const names = deleted
    .map(
      (e) =>
        e.fields.find((f) => f.column === 'da_name')?.rawBefore ??
        e.fields.find((f) => f.column === 'group_label')?.rawBefore ??
        e.fields.find((f) => f.column === 'label_override')?.rawBefore ??
        null,
    )
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .map((v) => formatHistoryValue(v));

  return (
    <div
      className="text-[11px] rounded-md border px-2.5 py-2 flex flex-col gap-1.5"
      style={{
        borderColor: 'var(--color-co-border)',
        background: 'var(--color-co-bg)',
        color: 'var(--color-text)',
      }}
      data-testid="ql-restore-banner"
    >
      <div>
        <span className="font-bold">
          {n} column{n === 1 ? '' : 's'}
        </span>{' '}
        {n === 1 ? 'was' : 'were'} removed from{' '}
        <span className="font-bold">{quarter}</span>
        {when ? ` on ${new Date(when).toLocaleDateString()}` : ''}.
        {names.length > 0 && (
          <span style={{ color: 'var(--color-muted)' }}>
            {' '}
            ({names.slice(0, 6).join(', ')}
            {names.length > 6 ? `, +${names.length - 6} more` : ''})
          </span>
        )}
      </div>
      {readOnly ? (
        <span className="italic" style={{ color: 'var(--color-muted)' }}>
          You need permission to edit the draw schedule to put them back.
        </span>
      ) : confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              restore.mutate({ quarter });
            }}
            disabled={restore.isPending}
            className="px-2 py-1 rounded border font-display font-bold disabled:opacity-50 cursor-pointer"
            style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
            data-testid="ql-restore-confirm"
          >
            Put {n === 1 ? 'it' : 'them'} back
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="cursor-pointer"
            style={{ color: 'var(--color-dim)' }}
            data-testid="ql-restore-cancel"
          >
            Cancel
          </button>
        </div>
      ) : (
        /* ★★ IT ASKS FIRST. This re-creates rows into a live quarter, and
           fix-440's rule is that one control does not mean one click. */
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start px-2 py-1 rounded border font-display font-bold cursor-pointer"
          style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
          data-testid="ql-restore-open"
        >
          Restore {n === 1 ? 'it' : 'them'}
        </button>
      )}
    </div>
  );
}
