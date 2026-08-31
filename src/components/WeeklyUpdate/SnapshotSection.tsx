import { useMemo, useState } from 'react';
import OriginLink from '../OriginLink';
import {
  visibleRows,
  backlogBreakdown,
  EXPANDED_ROWS,
  TOP_N,
  type SectionSpec,
  type SnapshotRow,
  type SortKey,
  type SortState,
} from '../../lib/weeklySnapshot';

// ===========================================================================
// ★★★ fix-463 §A2–§A6 (P-108) — ONE SNAPSHOT SECTION
// ===========================================================================
//
// The mock-up is the spec, and this reproduces its behaviour rather than
// re-imagining it: header with title, count, search box and a Show all N /
// Show top 3 toggle; collapsed shows the top three; expanded shows about ten and
// scrolls with a sticky header; every column sorts; every row opens its permit.

/** The eight columns, in the mock-up's order. Two of them are named by the
 *  section (Target submit / Days late, Submitted / Days waiting, …). */
const COLUMNS: ReadonlyArray<{ key: SortKey; label?: string; num?: boolean }> = [
  { key: 'address', label: 'Project' },
  { key: 'num', label: 'Permit #' },
  { key: 'type', label: 'Type' },
  { key: 'ent_lead', label: 'ENT lead' },
  { key: 'da', label: 'DA' },
  { key: 'on_date' }, // section's date label
  { key: 'age_days', num: true }, // section's age label
  { key: 'status', label: 'City status' },
];

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

  const label = (c: (typeof COLUMNS)[number]) =>
    c.label ?? (c.key === 'on_date' ? spec.dateLabel : spec.ageLabel);

  return (
    <section
      className="rounded border"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid={`snapshot-${spec.key}`}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <header className="px-2.5 py-1.5 flex flex-wrap items-center gap-2 border-b"
        style={{ borderBottomColor: 'var(--color-border)' }}>
        <span className="text-[11px] font-bold text-text">{spec.title}</span>
        <span
          className="text-[11px] font-bold tabular-nums px-1.5 rounded"
          style={{ background: 'var(--color-s2)', color: 'var(--color-muted)' }}
          data-testid={`snapshot-${spec.key}-count`}
        >
          {total}
        </span>
        {/* ★ §A5's "n of N shown", which only appears while a search is live —
            a permanent counter would just repeat the header's number. */}
        {query.trim() !== '' && (
          <span className="text-[10px]" style={{ color: 'var(--color-de)' }}
            data-testid={`snapshot-${spec.key}-hits`}>
            {matched} of {total} shown
          </span>
        )}
        <span className="flex-1" />
        <input
          value={query}
          placeholder="Search…"
          onChange={(e) => onSearch(e.target.value)}
          className="text-[11px] border rounded px-1.5 py-0.5 bg-surface"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid={`snapshot-${spec.key}-search`}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] px-2 py-0.5 rounded border whitespace-nowrap"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          data-testid={`snapshot-${spec.key}-toggle`}
        >
          {expanded ? `Show top ${TOP_N}` : `Show all ${total}`}
        </button>
      </header>

      {/* ★★ §A2: expanded scrolls with a STICKY header, so the column you are
          sorting by stays legible ten rows down. */}
      <div
        className={expanded ? 'overflow-y-auto' : ''}
        style={expanded ? { maxHeight: `${EXPANDED_ROWS * 28}px` } : undefined}
        data-testid={`snapshot-${spec.key}-scroller`}
      >
        <table className="w-full text-[10.5px]">
          <thead
            className={expanded ? 'sticky top-0' : ''}
            style={{ background: 'var(--color-surface)' }}
          >
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={`px-1.5 py-1 font-bold uppercase tracking-wide cursor-pointer whitespace-nowrap ${
                    c.num ? 'text-right' : 'text-left'
                  }`}
                  style={{ color: 'var(--color-dim)' }}
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
              <tr
                key={`${r.bucket}-${r.permit_id}`}
                className="border-t"
                style={{ borderTopColor: 'var(--color-border)' }}
                data-testid={`snapshot-${spec.key}-row-${r.permit_id}`}
              >
                {/* ★ §A6: every row opens its permit. OriginLink so Previous
                    brings the reader back to the Agenda (fix-408). */}
                <td className="px-1.5 py-1">
                  {/* ★ §A6: opens the PERMIT, not just the project — `?permit=N`
                      is the deep link fix-362 established. A row whose project
                      id is somehow missing renders as text rather than as a
                      link to nowhere. */}
                  {r.project_id ? (
                    <OriginLink
                      to={`/project/${r.project_id}?permit=${r.permit_id}`}
                      className="text-de hover:underline"
                      data-testid={`snapshot-${spec.key}-open-${r.permit_id}`}
                    >
                      {r.address ?? '(no address)'}
                    </OriginLink>
                  ) : (
                    <span className="text-dim">{r.address ?? '(no address)'}</span>
                  )}
                </td>
                <td className="px-1.5 py-1 font-mono text-dim">{r.num ?? '—'}</td>
                <td className="px-1.5 py-1 text-dim">{r.type ?? '—'}</td>
                <td className="px-1.5 py-1 text-dim">{r.ent_lead ?? '—'}</td>
                <td className="px-1.5 py-1 text-dim">{r.da ?? '—'}</td>
                <td className="px-1.5 py-1 font-mono text-dim">{r.on_date ?? '—'}</td>
                <td className="px-1.5 py-1 text-right tabular-nums">
                  {r.age_days ?? '—'}
                </td>
                <td className="px-1.5 py-1 text-dim truncate max-w-[150px]">
                  {r.status ?? '—'}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-1.5 py-2 text-center text-dim"
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
          into is a rumour. */}
      {backlog && backlog.overMonth > 0 && !expanded && (
        <p
          className="px-2.5 py-1 text-[10px] border-t"
          style={{ borderTopColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          data-testid="snapshot-b-backlog"
        >
          {backlog.overMonth} more are over a month late — {backlog.overQuarter} over
          three months, {backlog.overYear} over a year.
        </p>
      )}
    </section>
  );
}
