import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  commentsForLabel,
  countComments,
  isPlausibleLetterDate,
  type CommentSort,
} from '../../lib/correctionPeriods';
import { correctionDisciplineLabel } from '../../lib/correctionItems';
import type { CorrectionReportRow } from '../../lib/correctionsReport';
import type { PrevalenceLevel } from '../../lib/correctionsPrevalence';

// fix-281: the words themselves.
//
// Prevalence says "Parking / access / curb cut — 64.5% of projects, 137 items".
// That says where to look. It does not say WHAT the correction is, which is the
// thing template work actually needs. Underneath that one category sit Parking
// Space Identification, Sight Triangle, Solid Waste Storage, EV-Ready Stalls,
// Curb Cut Closure, Backing Distance — and no machine can name them from this
// corpus yet (one reviewer's house style covers about 6% of it). So this does
// not try. It shows the text and lets a human read it.
//
// ★ THE BODY IS THE PAYLOAD. It is never truncated, never clamped to a line,
// never collapsed behind another click. Every layout decision here gives way to
// the text being readable — that is the entire feature.
//
// Grouped by project because the pattern being hunted is the same wording
// recurring across projects: reading one project's comments and then the next
// is what makes that visible.

/** Rendered a page at a time: 137 comments behind one row, and several rows can
 *  be open at once. */
const PAGE = 20;

interface Props {
  /** Already filtered to the active scope by the caller. */
  rows: CorrectionReportRow[];
  level: PrevalenceLevel;
  label: string;
  today: string;
}

export default function CorrectionCommentList({ rows, level, label, today }: Props) {
  const [sort, setSort] = useState<CommentSort>('newest');
  const [shown, setShown] = useState(PAGE);

  const groups = useMemo(
    () => commentsForLabel(rows, level, label, sort, today),
    [rows, level, label, sort, today],
  );
  const total = useMemo(() => countComments(groups), [groups]);

  // Walk the groups until `shown` comments have been laid out, so the cut falls
  // mid-group rather than dropping a whole project.
  const visible = useMemo(() => {
    const out: typeof groups = [];
    let budget = shown;
    for (const g of groups) {
      if (budget <= 0) break;
      out.push(
        g.comments.length <= budget
          ? g
          : { ...g, comments: g.comments.slice(0, budget) },
      );
      budget -= g.comments.length;
    }
    return out;
  }, [groups, shown]);

  const rendered = countComments(visible);

  if (total === 0) {
    return (
      <div
        className="px-3 py-3 text-[11px] text-dim italic"
        data-testid={`comments-empty-${label}`}
      >
        No comments in this category match the current filters.
      </div>
    );
  }

  return (
    <div className="px-3 py-2" data-testid={`comments-${label}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[10px] uppercase tracking-wide text-dim">
          {total} comment{total === 1 ? '' : 's'} across {groups.length} project
          {groups.length === 1 ? '' : 's'} — the words behind {label}
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-muted">
          <span className="uppercase tracking-wide text-dim">Sort</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as CommentSort);
              setShown(PAGE);
            }}
            className="bg-bg border border-border rounded px-1.5 py-0.5 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid={`comments-sort-${label}`}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {visible.map((g) => (
          <div
            key={g.projectId}
            className="border rounded-md"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`comments-project-${g.projectId}`}
          >
            <div
              className="px-2 py-1 border-b flex items-baseline gap-2"
              style={{
                borderBottomColor: 'var(--color-border)',
                background: 'var(--color-s2)',
              }}
            >
              <Link
                to={`/project/${g.projectId}`}
                className="text-[11px] font-bold text-de hover:underline"
              >
                {g.address}
              </Link>
              <span className="text-[10px] text-dim">{g.juris}</span>
              <span className="text-[10px] text-dim ml-auto">
                {g.comments.length} comment{g.comments.length === 1 ? '' : 's'}
              </span>
            </div>
            {g.comments.map((c) => (
              <Comment key={c.id} row={c} today={today} />
            ))}
          </div>
        ))}
      </div>

      {rendered < total && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="mt-2 px-3 py-1 rounded-md text-xs font-bold border border-border bg-s2 text-text hover:bg-s3 transition"
          data-testid={`comments-more-${label}`}
        >
          Show {Math.min(PAGE, total - rendered)} more · {rendered} of {total}
        </button>
      )}
    </div>
  );
}

function Comment({ row, today }: { row: CorrectionReportRow; today: string }) {
  const badDate = !isPlausibleLetterDate(row.letter_date, today);
  const meta = [
    row.cycle == null ? null : `Cycle ${row.cycle}`,
    correctionDisciplineLabel(row.discipline),
    row.reviewer,
  ].filter(Boolean) as string[];

  return (
    <div
      className="px-2 py-2 border-b last:border-b-0"
      style={{ borderBottomColor: 'var(--color-border)' }}
      data-testid={`comment-${row.id}`}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-text">
          {(row.subject ?? '').trim() || (
            <span className="text-dim italic font-normal">(no subject)</span>
          )}
        </span>
        <span className="text-[10px] text-dim">{meta.join(' · ')}</span>
        <span
          className={`text-[10px] ml-auto ${badDate ? 'text-co font-semibold' : 'text-dim'}`}
          title={
            badDate
              ? 'This letter date is outside the plausible range and is excluded ' +
                'from period comparisons. It is shown, not corrected.'
              : undefined
          }
          data-testid={`comment-date-${row.id}`}
          data-implausible={badDate ? 'true' : 'false'}
        >
          {row.letter_date ?? '—'}
          {badDate && ' ⚠'}
        </span>
      </div>

      {/* ★ The payload. Full text, wrapped, never clamped. */}
      {(row.body ?? '').trim() ? (
        <p
          className="mt-1 text-[11px] text-muted leading-relaxed whitespace-pre-wrap"
          data-testid={`comment-body-${row.id}`}
        >
          {row.body}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-dim italic">
          (this comment has a subject but no body text)
        </p>
      )}

      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-dim">
        {row.codes && (
          <span className="font-mono" data-testid={`comment-codes-${row.id}`}>
            {row.codes}
          </span>
        )}
        <span data-testid={`comment-source-${row.id}`}>{row.source_file}</span>
      </div>
    </div>
  );
}
