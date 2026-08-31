import { useMemo, useState } from 'react';
import OriginLink from '../OriginLink';
import {
  visibleRows,
  backlogBreakdown,
  ageTone,
  EXPANDED_ROWS,
  SNAPSHOT_COLUMNS,
  SNAPSHOT_MIN_WIDTH_PX,
  TOP_N,
  type SectionSpec,
  type SnapshotColumn,
  type SnapshotRow,
  type SortKey,
  type SortState,
} from '../../lib/weeklySnapshot';

// ===========================================================================
// ★★★ fix-463 §A2–§A6 (P-108) — ONE SNAPSHOT SECTION
// ★★★ fix-465 §A–§C (P-114) — …AND NOW ONE SET OF COLUMN BOUNDARIES
// ===========================================================================
//
// The mock-up is the spec, and this reproduces its behaviour rather than
// re-imagining it: header with title, search box and a Show all N / Show top 3
// toggle; collapsed shows the top three; expanded shows about ten and scrolls
// with a sticky header; every column sorts; every row opens its permit.
//
// ★★★ fix-465 §A — THE FIVE SECTIONS NOW SHARE ONE GRID. The columns and their
// widths live in `SNAPSHOT_COLUMNS` (see the long note there for why that is
// the single source and why the real defect was the MISSING `table-layout:
// fixed` rather than a duplicated list). One `<colgroup>` is rendered from it,
// so section A's "Project" column and section E's start at the same pixel and
// the reader's eye tracks one report down the page instead of re-finding the
// columns five times.
//
// ★★★ fix-465 §B — THE SURFACE LADDER, AND THE END OF `text-dim`. The page is
// `--color-bg`, the section header bar is `--color-s3`, the data sits on
// `--color-surface`. Three steps, so a section reads as a card rather than as a
// tint. Every data cell was `--color-dim`, which measures **2.82:1 on white** —
// under the 4.5:1 floor and the whole of the "I can barely read it" complaint.
// The ladder is now: `--color-text` (15.19:1) for the two columns that identify
// the row, `--color-muted` (5.48:1) for the rest, and NOTHING on `--color-dim`.

export default function SnapshotSection({
  spec,
  rows,
}: {
  spec: SectionSpec;
  rows: readonly SnapshotRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  // ★ The server's order is already "most urgent first" (age desc), so the
  //   default sort agrees with it rather than re-deciding on arrival.
  const [sort, setSort] = useState<SortState>({ key: 'age_days', dir: 'desc' });

  // ★★★ §A3 — SORT, THEN FILTER, THEN SLICE. Re-sorting therefore RE-PICKS the
  //     top three: the preview reflects the reader's chosen order rather than a
  //     frozen list. Slicing first would look identical until somebody clicked
  //     a header, which is exactly how this gets built wrongly.
  const { shown, matched, total } = useMemo(
    () => visibleRows(rows, sort, query, expanded),
    [rows, sort, query, expanded],
  );

  const backlog = useMemo(
    () => (spec.key === 'b' ? backlogBreakdown(rows) : null),
    [spec.key, rows],
  );

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }

  function onSearch(next: string) {
    setQuery(next);
    // ★ §A5: searching AUTO-EXPANDS a collapsed section. A search that filtered
    //   a three-row preview would report "1 of 40 shown" and show nothing —
    //   the mock-up expands, and so does this.
    if (next.trim() !== '') setExpanded(true);
  }

  const label = (c: SnapshotColumn) =>
    c.label ?? (c.key === 'on_date' ? spec.dateLabel : spec.ageLabel);

  return (
    <section
      className="rounded border overflow-hidden"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      data-testid={`snapshot-${spec.key}`}
      data-expanded={expanded ? 'true' : 'false'}
    >
      {/* ★★ §B1 — the header bar is the middle rung of the ladder. It is the
          one band of colour in the card, which is what separates five sections
          on one page without five borders doing the work. */}
      <header
        className="px-2.5 py-2 flex flex-wrap items-center gap-2 border-b"
        style={{
          borderBottomColor: 'var(--color-border)',
          background: 'var(--color-s3)',
        }}
      >
        {/* ★★ §B5: the title carries the section's weight — 13px/800 in the
            mock, against 11px/700 before. It is the only thing on this bar a
            reader is scanning FOR. `--color-text` on `--color-s3` = 11.75:1. */}
        <span
          className="text-[13px] font-bold"
          style={{ color: 'var(--color-text)' }}
          data-testid={`snapshot-${spec.key}-title`}
        >
          {spec.title}
        </span>
        {/* ★★★ §C — THE COUNT CHIP IS GONE, AND THE TOGGLE ALREADY SAID IT.
            "Show all 103" states the total in words, one control to the right
            of where the chip sat; the chip repeated that number in a second
            visual weight and was the third thing on a bar with four things on
            it. See the PR for what the chip DID carry that this does not
            replace — the mock's per-section severity tone. */}
        {/* ★ §A5's "n of N shown", which only appears while a search is live. */}
        {query.trim() !== '' && (
          <span
            className="text-[11px]"
            style={{ color: 'var(--color-de)' }}
            data-testid={`snapshot-${spec.key}-hits`}
          >
            {matched} of {total} shown
          </span>
        )}
        <span className="flex-1" />
        <input
          value={query}
          placeholder="Search…"
          onChange={(e) => onSearch(e.target.value)}
          className="text-[11.5px] border rounded px-2 py-1"
          style={{
            borderColor: 'var(--color-border)',
            // ★ §B1: the input sits ON the s3 bar, so it takes the surface
            //   colour to stay a field rather than a hole. Its text is
            //   `--color-text` on white — 15.19:1.
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
          data-testid={`snapshot-${spec.key}-search`}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11.5px] font-bold px-2.5 py-1 rounded border whitespace-nowrap"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-surface)',
            // ★ §B4: was `--color-muted` on the s3 bar = 4.24:1, under the
            //   floor. On the button's own white surface it is 5.48:1.
            color: 'var(--color-muted)',
          }}
          data-testid={`snapshot-${spec.key}-toggle`}
        >
          {expanded ? `Show top ${TOP_N}` : `Show all ${total}`}
        </button>
      </header>

      {/* ★★ §A2: expanded scrolls with a STICKY header, so the column you are
          sorting by stays legible ten rows down.
          ★★★ §A1: and it scrolls HORIZONTALLY below the width the fixed grid
          needs. A fixed layout without this would not truncate — it would
          squeeze eight columns into a phone and make all eight unreadable. */}
      <div
        className={expanded ? 'overflow-y-auto overflow-x-auto' : 'overflow-x-auto'}
        style={expanded ? { maxHeight: `${EXPANDED_ROWS * 32}px` } : undefined}
        data-testid={`snapshot-${spec.key}-scroller`}
      >
        {/* ★★★ §A1 — `table-fixed` IS THE TICKET. Without it each of the five
            tables auto-sizes to its own three rows and no two sections line
            up; `minWidth` keeps the grid honest instead of crushing it. */}
        <table
          className="w-full table-fixed"
          style={{
            minWidth: `${SNAPSHOT_MIN_WIDTH_PX}px`,
            background: 'var(--color-surface)',
          }}
          data-testid={`snapshot-${spec.key}-table`}
        >
          {/* ★★★ §A2 — ONE colgroup, rendered from the shared constant. */}
          <colgroup>
            {SNAPSHOT_COLUMNS.map((c) => (
              <col key={c.key} style={{ width: `${c.width}%` }} data-col={c.key} />
            ))}
          </colgroup>
          <thead
            className={expanded ? 'sticky top-0' : ''}
            style={{ background: 'var(--color-surface)' }}
          >
            <tr>
              {SNAPSHOT_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={`px-2.5 py-1.5 text-[9.5px] font-extrabold uppercase cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis border-b ${
                    c.num ? 'text-right' : 'text-left'
                  }`}
                  style={{
                    // ★★ §B4: the header ink was `--color-dim` (2.82:1). On
                    //   white, `--color-muted` measures 5.48:1 — and a column
                    //   header the reader cannot read is a table they cannot
                    //   sort.
                    color: 'var(--color-muted)',
                    letterSpacing: '0.07em',
                    borderBottomColor: 'var(--color-border)',
                  }}
                  data-testid={`snapshot-${spec.key}-th-${c.key}`}
                  data-sorted={sort.key === c.key ? sort.dir : undefined}
                >
                  {label(c)}
                  {sort.key === c.key ? (sort.dir === 'asc' ? ' ▴' : ' ▾') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Row key={`${r.bucket}-${r.permit_id}`} spec={spec} row={r} />
            ))}
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={SNAPSHOT_COLUMNS.length}
                  className="px-2.5 py-3 text-center text-[12.5px]"
                  style={{ color: 'var(--color-muted)' }}
                  data-testid={`snapshot-${spec.key}-empty`}
                >
                  {query.trim() === '' ? 'Nothing here.' : 'Nothing matches that search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ★★★ B IS A BACKLOG, NOT A WEEK'S NEWS. The mock-up states the tail as a
          sentence instead of dumping 101 rows — and the rows are still all
          there behind Show all and the search, because a count nobody can drill
          into is a rumour.
          ★ fix-465: it sits on `--color-s2`, a half-step off the data, so it
          reads as a note ABOUT the table rather than as a ninth row of it.
          `--color-muted` on `--color-s2` = 4.65:1. */}
      {backlog && backlog.overMonth > 0 && !expanded && (
        <p
          className="px-2.5 py-1.5 text-[11.5px] border-t"
          style={{
            borderTopColor: 'var(--color-border)',
            background: 'var(--color-s2)',
            color: 'var(--color-muted)',
          }}
          data-testid="snapshot-b-backlog"
        >
          {backlog.overMonth} more are over a month late — {backlog.overQuarter} over
          three months, {backlog.overYear} over a year.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ★★ ONE ROW. Split out so the ink ladder is stated once per KIND of cell
// rather than eight times per row — the shape that let `text-dim` reach all
// eight columns in the first place.
// ---------------------------------------------------------------------------
function Row({ spec, row: r }: { spec: SectionSpec; row: SnapshotRow }) {
  const tone = ageTone(r.bucket, r.age_days);

  /** ★★ §B2: `soft` is the only ink decision a cell makes, and it is declared
   *  in `SNAPSHOT_COLUMNS` beside the width. Neither is `--color-dim`. */
  const ink = (c: SnapshotColumn) =>
    c.soft ? 'var(--color-muted)' : 'var(--color-text)';

  const cell = (c: SnapshotColumn, value: string | null) => (
    <td
      key={c.key}
      className={`px-2.5 py-2 text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis ${
        c.mono ? 'font-mono text-[11.5px]' : ''
      } ${c.num ? 'text-right tabular-nums' : ''}`}
      style={{ color: ink(c) }}
      data-testid={`snapshot-${spec.key}-cell-${r.permit_id}-${c.key}`}
    >
      {value ?? '—'}
    </td>
  );

  const col = (key: SortKey) => SNAPSHOT_COLUMNS.find((c) => c.key === key)!;

  return (
    <tr
      className="border-t"
      style={{ borderTopColor: 'var(--color-s2)' }}
      data-testid={`snapshot-${spec.key}-row-${r.permit_id}`}
    >
      {/* ★ §A6: every row opens its permit. OriginLink so Previous brings the
          reader back to the Agenda (fix-408). It opens the PERMIT, not just the
          project — `?permit=N` is the deep link fix-362 established. A row
          whose project id is somehow missing renders as text rather than as a
          link to nowhere. */}
      <td
        className="px-2.5 py-2 text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis"
        data-testid={`snapshot-${spec.key}-cell-${r.permit_id}-address`}
      >
        {r.project_id ? (
          <OriginLink
            to={`/project/${r.project_id}?permit=${r.permit_id}`}
            className="hover:underline font-medium"
            style={{ color: 'var(--color-de)' }}
            data-testid={`snapshot-${spec.key}-open-${r.permit_id}`}
          >
            {r.address ?? '(no address)'}
          </OriginLink>
        ) : (
          // ★ §B4: a row with no project id is not a LESS IMPORTANT row, so it
          //   is not a fainter one — it is simply not a link. It was
          //   `text-dim`, which said "ignore me" about a permit that may be the
          //   most urgent in the section.
          <span style={{ color: 'var(--color-text)' }}>{r.address ?? '(no address)'}</span>
        )}
      </td>
      {cell(col('num'), r.num)}
      {cell(col('type'), r.type)}
      {cell(col('ent_lead'), r.ent_lead)}
      {cell(col('da'), r.da)}
      {cell(col('on_date'), r.on_date)}
      {/* ★★★ §B3 — THE URGENCY TINT. `ageTone` decides; see its note in
          weeklySnapshot.ts for why 30 and 90 and why section A has no tint.
          `--color-er` measures 4.83:1 on white and `--color-wa` 5.56:1 —
          `--color-co` (#d97706), the obvious choice for "warn", measures
          3.19:1 and would have failed the very floor this ticket is about.
          fix-406 hit exactly this and pinned `--color-wa` to the number that
          clears it; this reuses that ink rather than adding a second one. */}
      <td
        className={`px-2.5 py-2 text-[12.5px] text-right tabular-nums ${
          tone ? 'font-extrabold' : ''
        }`}
        style={{
          color:
            tone === 'hot'
              ? 'var(--color-er)'
              : tone === 'warn'
                ? 'var(--color-wa)'
                : 'var(--color-text)',
        }}
        data-tone={tone ?? undefined}
        data-testid={`snapshot-${spec.key}-cell-${r.permit_id}-age_days`}
      >
        {r.age_days ?? '—'}
      </td>
      {cell(col('status'), r.status)}
    </tr>
  );
}
