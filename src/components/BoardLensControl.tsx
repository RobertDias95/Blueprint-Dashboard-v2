import type { BoardLens } from '../lib/boardByAssociate';

// ===========================================================================
// ★★ fix-365 §1 — ONE CONTROL, TWO POSITIONS
// ===========================================================================
//
// Bobby said both *"organize it by that"* and *"through the lens of"*. Those
// are two different things:
//
//   GROUP  the same board, sectioned by associate, so the split is visible
//   FOCUS  narrow to one associate, so a 1:1 shows only that person
//
// ★ They are one control's two positions, not two features — so this is a
// single row: a toggle, then the people. Picking a name focuses; "All" clears.

export default function BoardLensControl({
  associates,
  lens,
  onChange,
  unmanaged,
}: {
  associates: string[];
  lens: BoardLens;
  onChange: (next: BoardLens) => void;
  /** ★ Active design associates with no manager — see the note below. */
  unmanaged: string[];
}) {
  if (associates.length === 0) return null;

  // ★★★ JADE HAS EXACTLY ONE ASSOCIATE, and a grouping control offering one
  // group is noise.
  //
  // ★ So with one associate the control is not a grouping control at all — it
  // is a single toggle that says what it does: "Only Erick". Grouping her nine
  // rows into "Erick" and "your own work" would be two headings to say what one
  // sentence says, and the useful half of the feature for her is the focus.
  const single = associates.length === 1;

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      data-testid="board-lens"
      data-associate-count={associates.length}
      data-mode={single ? 'single' : lens.mode}
    >
      <span className="text-[9px] font-extrabold uppercase tracking-wide text-muted">
        {single ? 'Associate' : 'By associate'}
      </span>

      {single ? (
        <button
          type="button"
          onClick={() =>
            onChange({
              mode: 'off',
              focus: lens.focus ? null : associates[0],
            })
          }
          className="text-[10px] px-2 py-0.5 rounded border font-bold"
          style={chip(lens.focus === associates[0])}
          aria-pressed={lens.focus === associates[0]}
          data-testid="board-lens-only"
        >
          Only {associates[0]}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() =>
              onChange({
                mode: lens.mode === 'group' ? 'off' : 'group',
                focus: lens.focus,
              })
            }
            className="text-[10px] px-2 py-0.5 rounded border font-bold"
            style={chip(lens.mode === 'group')}
            aria-pressed={lens.mode === 'group'}
            title="Section each date bucket by design associate"
            data-testid="board-lens-group"
          >
            Group
          </button>
          {/* ★ FOCUS. "All" is first and is the cleared state, so getting back
              to the whole board is one click and is always in the same place. */}
          <button
            type="button"
            onClick={() => onChange({ ...lens, focus: null })}
            className="text-[10px] px-2 py-0.5 rounded border font-bold"
            style={chip(lens.focus === null)}
            aria-pressed={lens.focus === null}
            data-testid="board-lens-focus-all"
          >
            All
          </button>
          {associates.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() =>
                onChange({ ...lens, focus: lens.focus === a ? null : a })
              }
              className="text-[10px] px-2 py-0.5 rounded border font-bold"
              style={chip(lens.focus === a)}
              aria-pressed={lens.focus === a}
              data-testid={`board-lens-focus-${a}`}
            >
              {a}
            </button>
          ))}
        </>
      )}

      {/* ★★★ THE ASSOCIATES NOBODY MANAGES.
          MEASURED: Cam and Shire are active design associates with no row in
          dm_da_groups, holding 21 open tasks between them — more than
          Brittani's whole book. Their work reaches no manager at all, and it
          never reaches this control either.

          ★ Said out loud, because the alternative is worse than the gap: a
          manager reading "Marc · Ahmadi · Fisk" would reasonably conclude that
          is the whole design bench, and grouping would have turned an existing
          hole into an invisible one. Fixing dm_da_groups is a data change and
          Bobby's call — this only stops the tool hiding the question. */}
      {unmanaged.length > 0 && (
        <span
          className="text-[9.5px] text-co ml-1"
          title="These design associates have no manager in the team structure, so their work does not reach anybody's board through this."
          data-testid="board-lens-unmanaged"
        >
          Not on anyone&apos;s board: {unmanaged.join(', ')}
        </span>
      )}
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--color-de)' : 'var(--color-bg)',
    color: active ? '#fff' : 'var(--color-text)',
    borderColor: active ? 'var(--color-de)' : 'var(--color-border)',
  };
}
