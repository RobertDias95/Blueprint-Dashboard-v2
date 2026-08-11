import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAllCorrectionItems } from '../hooks/useAllCorrectionItems';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ExportCsvButton from '../components/shared/ExportCsvButton';
import { rowsToCsv, reportCsvFilename } from '../lib/reportCsv';
import { correctionDisciplineLabel } from '../lib/correctionItems';
import {
  CORRECTIONS_CSV_COLUMNS,
  EMPTY_FILTERS,
  architectCoverage,
  correctionArchitectLabel,
  correctionFilterOptions,
  correctionThemeLabel,
  correctionsCsvRows,
  countsByDiscipline,
  countsByTheme,
  filterCorrectionRows,
  filtersAreEmpty,
  joinCorrectionRows,
  summarizeReport,
  type CorrectionFilters,
  type CorrectionReportRow,
  type CountRow,
  type RepeatTopic,
} from '../lib/correctionsReport';

// fix-277: "Corrections" — every indexed correction-letter comment, across every
// project, with the analysis the fix-276 per-project panel could not do.
//
// READ-ONLY. public.correction_items grants `authenticated` SELECT and nothing
// else; the rows are written by the file_indexer on Bobby's PC (scraper repo).
//
// Three views over one filtered set: what keeps coming back (repeat rate), where
// the volume is (theme / discipline), and the individual comments (drill-down).
// The filter bar drives all three, so a number in one view and a row in another
// always describe the same slice.

type View = 'repeats' | 'counts' | 'items';

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'repeats', label: 'Repeat rate' },
  { key: 'counts', label: 'By theme & discipline' },
  { key: 'items', label: 'Items' },
];

/** The drill-down is the long tail of a 2,194-row corpus; rendering it all at
 *  once is a wall, not a report. */
const ITEMS_PAGE = 100;

export default function CorrectionsReport() {
  const itemsQ = useAllCorrectionItems();
  const projectsQ = useProjects();
  const permitsQ = usePermits();

  const [filters, setFilters] = useState<CorrectionFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<View>('repeats');
  const [shown, setShown] = useState(ITEMS_PAGE);

  // permits.architect is the only architect the schema carries. One value per
  // project: a project whose permits disagree is vanishingly rare, and the
  // first non-empty one is a better answer than none.
  const architectByProjectId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of permitsQ.data ?? []) {
      const a = (p.architect ?? '').trim();
      if (a && !m.has(p.project_id)) m.set(p.project_id, a);
    }
    return m;
  }, [permitsQ.data]);

  const allRows = useMemo(
    () =>
      joinCorrectionRows(
        itemsQ.data ?? [],
        projectsQ.data ?? [],
        architectByProjectId,
      ),
    [itemsQ.data, projectsQ.data, architectByProjectId],
  );

  // Options come off the UNFILTERED set so the dropdowns don't collapse as you
  // narrow — picking Bellevue must not empty the discipline list.
  const options = useMemo(() => correctionFilterOptions(allRows), [allRows]);
  const rows = useMemo(
    () => filterCorrectionRows(allRows, filters),
    [allRows, filters],
  );

  const summary = useMemo(() => summarizeReport(rows), [rows]);
  const themes = useMemo(() => countsByTheme(rows), [rows]);
  const disciplines = useMemo(() => countsByDiscipline(rows), [rows]);
  const coverage = useMemo(() => architectCoverage(allRows), [allRows]);

  const error = itemsQ.error ?? projectsQ.error ?? permitsQ.error;
  if (error) {
    return (
      <QueryError
        title="Corrections failed to load"
        error={error as Error}
        onRetry={() => {
          itemsQ.refetch();
          projectsQ.refetch();
          permitsQ.refetch();
        }}
      />
    );
  }

  const isLoading = itemsQ.isLoading || projectsQ.isLoading || permitsQ.isLoading;

  function patch(next: Partial<CorrectionFilters>) {
    setFilters((f) => ({ ...f, ...next }));
    setShown(ITEMS_PAGE);
  }

  return (
    <div className="space-y-4" data-testid="corrections-report">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-display font-bold text-text mb-1">
            Corrections
          </h1>
          <p className="text-[11px] text-muted max-w-3xl">
            Every comment the cities have written on our correction letters,
            pulled off the file server by the indexer. A{' '}
            <span className="font-semibold">topic</span> is a building,
            discipline and category together; a{' '}
            <span className="font-semibold">repeat</span> is a topic raised in
            one cycle and raised again in the very next one. Read-only — nothing
            here changes a permit.
          </p>
        </div>
        <ExportCsvButton
          filename={reportCsvFilename('corrections')}
          onExport={() =>
            rowsToCsv([...CORRECTIONS_CSV_COLUMNS], correctionsCsvRows(rows))
          }
          disabled={rows.length === 0}
          testId="corrections-export-csv"
        />
      </div>

      <FilterBar
        filters={filters}
        options={options}
        onChange={patch}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setShown(ITEMS_PAGE);
        }}
        coverage={coverage}
      />

      {isLoading ? (
        <SkeletonRows count={8} rowClassName="h-9" />
      ) : allRows.length === 0 ? (
        <div
          className="py-8 text-center text-dim italic text-xs"
          data-testid="corrections-report-empty"
        >
          Nothing indexed yet. Correction letters are read off the file server by
          the indexer, which runs by hand.
        </div>
      ) : rows.length === 0 ? (
        <div
          className="py-8 text-center text-dim italic text-xs"
          data-testid="corrections-report-no-match"
        >
          No corrections match these filters.
        </div>
      ) : (
        <>
          <SummaryStrip summary={summary} />

          <div className="flex gap-1" data-testid="corrections-view-tabs">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={`px-3 py-1 rounded-md text-xs font-bold border transition ${
                  view === v.key
                    ? 'bg-de text-white border-de'
                    : 'bg-s2 text-muted border-border hover:bg-s3'
                }`}
                data-testid={`corrections-view-${v.key}`}
                data-active={view === v.key ? 'true' : 'false'}
              >
                {v.label}
              </button>
            ))}
          </div>

          {view === 'repeats' && (
            <RepeatsView
              summary={summary}
              onDrillIn={(topic) => {
                patch({
                  discipline: topic.discipline,
                  cycle: '',
                });
                setView('items');
              }}
            />
          )}
          {view === 'counts' && (
            <CountsView themes={themes} disciplines={disciplines} />
          )}
          {view === 'items' && (
            <ItemsView
              rows={rows}
              shown={shown}
              onShowMore={() => setShown((n) => n + ITEMS_PAGE)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ filters --

function FilterBar({
  filters,
  options,
  onChange,
  onReset,
  coverage,
}: {
  filters: CorrectionFilters;
  options: ReturnType<typeof correctionFilterOptions>;
  onChange: (next: Partial<CorrectionFilters>) => void;
  onReset: () => void;
  coverage: ReturnType<typeof architectCoverage>;
}) {
  return (
    <div
      className="bg-s2 border border-border rounded-lg p-3 flex flex-wrap gap-3 items-end"
      data-testid="corrections-filters"
    >
      <Select
        label="Jurisdiction"
        value={filters.juris}
        onChange={(v) => onChange({ juris: v })}
        options={options.jurisdictions}
        allLabel="All jurisdictions"
        testId="corrections-filter-juris"
      />
      <Select
        label="Discipline"
        value={filters.discipline}
        onChange={(v) => onChange({ discipline: v })}
        options={options.disciplines}
        allLabel="All disciplines"
        testId="corrections-filter-discipline"
      />
      <Select
        label="Theme"
        value={filters.theme}
        onChange={(v) => onChange({ theme: v })}
        options={options.themes}
        allLabel="All themes"
        testId="corrections-filter-theme"
      />
      <Select
        label="Cycle"
        value={filters.cycle}
        onChange={(v) => onChange({ cycle: v })}
        options={options.cycles.map(String)}
        allLabel="All cycles"
        testId="corrections-filter-cycle"
      />
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-dim">
          Architect
        </span>
        <select
          value={filters.architect}
          onChange={(e) => onChange({ architect: e.target.value })}
          className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
          data-testid="corrections-filter-architect"
          title={
            // Say it out loud: 3% coverage looks like a broken filter otherwise.
            `Architect is recorded on ${coverage.withArchitect} of ${coverage.total} indexed comments (${coverage.pct}%).`
          }
        >
          <option value="">All architects</option>
          {options.architects.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-dim">
          Letter date from
        </span>
        <input
          type="date"
          value={filters.from}
          onChange={(e) => onChange({ from: e.target.value })}
          className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
          data-testid="corrections-filter-from"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-dim">to</span>
        <input
          type="date"
          value={filters.to}
          onChange={(e) => onChange({ to: e.target.value })}
          className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
          data-testid="corrections-filter-to"
        />
      </label>
      {!filtersAreEmpty(filters) && (
        <button
          type="button"
          onClick={onReset}
          className="px-2 py-1 rounded text-[11px] font-bold text-muted border border-border bg-surface hover:bg-s3 transition"
          data-testid="corrections-filter-reset"
        >
          Reset
        </button>
      )}
      {coverage.pct < 50 && (
        <div
          className="basis-full text-[10px] text-dim italic"
          data-testid="corrections-architect-coverage"
        >
          Architect is recorded on {coverage.withArchitect} of {coverage.total}{' '}
          indexed comments ({coverage.pct}%). Filtering by one will hide almost
          everything until more projects carry it.
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-dim">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
        data-testid={testId}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ summary --

function SummaryStrip({
  summary,
}: {
  summary: ReturnType<typeof summarizeReport>;
}) {
  return (
    <div
      className="flex flex-wrap gap-6 items-baseline text-[11px] text-muted"
      data-testid="corrections-summary"
    >
      <Stat n={summary.items} label={summary.items === 1 ? 'comment' : 'comments'} testId="corrections-stat-items" />
      <Stat n={summary.projects} label={summary.projects === 1 ? 'project' : 'projects'} testId="corrections-stat-projects" />
      <Stat
        n={summary.jurisdictions}
        label={summary.jurisdictions === 1 ? 'jurisdiction' : 'jurisdictions'}
        testId="corrections-stat-juris"
      />
      <span data-testid="corrections-stat-repeat-rate">
        <strong className="text-text text-[15px]">{summary.repeat.pct}%</strong>{' '}
        repeat rate{' '}
        <span className="text-dim">
          ({summary.repeat.repeated} of {summary.repeat.eligible} topics came
          back the next cycle)
        </span>
      </span>
    </div>
  );
}

function Stat({ n, label, testId }: { n: number; label: string; testId: string }) {
  return (
    <span data-testid={testId}>
      <strong className="text-text text-[15px]">{n}</strong> {label}
    </span>
  );
}

// ------------------------------------------------------------------ repeats --

function RepeatsView({
  summary,
  onDrillIn,
}: {
  summary: ReturnType<typeof summarizeReport>;
  onDrillIn: (topic: RepeatTopic) => void;
}) {
  const { repeat } = summary;
  if (repeat.eligible === 0) {
    return (
      <div
        className="py-6 text-center text-dim italic text-xs"
        data-testid="corrections-repeats-none-eligible"
      >
        No topic has had the chance to repeat — nothing in this slice has a
        following cycle.
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="corrections-repeats">
      <p className="text-[11px] text-muted">
        A topic counts here only when the project actually had a{' '}
        <em>next</em> cycle. A comment on the last round could never come back,
        so counting it would flatter every project that has only been reviewed
        once.
      </p>
      {repeat.repeatedTopics.length === 0 ? (
        <div
          className="py-6 text-center text-dim italic text-xs"
          data-testid="corrections-repeats-empty"
        >
          Nothing came back the next cycle in this slice.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
                <th className="text-left py-1.5 font-display font-bold">Project</th>
                <th className="text-left py-1.5 font-display font-bold">Building</th>
                <th className="text-left py-1.5 font-display font-bold">Discipline</th>
                <th className="text-left py-1.5 font-display font-bold">Category</th>
                <th className="text-left py-1.5 font-display font-bold">Cycles</th>
                <th className="text-right py-1.5 font-display font-bold">Comments</th>
              </tr>
            </thead>
            <tbody>
              {repeat.repeatedTopics.map((t) => (
                <tr
                  key={`${t.projectId}-${t.building ?? ''}-${t.discipline}-${t.category}`}
                  className="border-b border-border/40 hover:bg-s2 cursor-pointer"
                  onClick={() => onDrillIn(t)}
                  data-testid={`corrections-repeat-row-${t.projectId}`}
                >
                  <td className="py-1.5">
                    <Link
                      to={`/project/${t.projectId}`}
                      className="text-de hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.address}
                    </Link>
                    <span className="text-dim"> · {t.juris}</span>
                  </td>
                  <td className="py-1.5 text-muted">{t.building ?? '—'}</td>
                  <td className="py-1.5 text-text">{t.discipline}</td>
                  <td className="py-1.5 text-muted">{t.category}</td>
                  <td className="py-1.5 text-muted">
                    {t.cycles.join(', ')}
                    <span className="text-dim">
                      {' '}
                      (back after{' '}
                      {t.repeatedFromCycles.map((c) => `${c}→${c + 1}`).join(', ')})
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-text">{t.items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- counts --

function CountsView({
  themes,
  disciplines,
}: {
  themes: CountRow[];
  disciplines: CountRow[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="corrections-counts">
      <CountTable title="By theme" rows={themes} testId="corrections-theme-table" />
      <CountTable
        title="By discipline"
        rows={disciplines}
        testId="corrections-discipline-table"
      />
    </div>
  );
}

function CountTable({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: CountRow[];
  testId: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.items), 0);
  return (
    <div data-testid={testId}>
      <h2 className="text-[11px] font-display font-bold text-text uppercase tracking-wide mb-1">
        {title}
      </h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
            <th className="text-left py-1.5 font-display font-bold">Name</th>
            <th className="text-right py-1.5 font-display font-bold">Comments</th>
            <th className="text-right py-1.5 font-display font-bold">Projects</th>
            <th className="text-right py-1.5 font-display font-bold pl-2">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              className="border-b border-border/40"
              data-testid={`${testId}-row-${r.label}`}
            >
              <td className="py-1.5 text-text">{r.label}</td>
              <td className="py-1.5 text-right text-text font-semibold">
                {r.items}
              </td>
              <td className="py-1.5 text-right text-muted">{r.projects}</td>
              <td className="py-1.5 pl-2">
                <div className="flex items-center gap-1.5 justify-end">
                  <span className="text-dim text-[10px] w-9 text-right">
                    {r.pct}%
                  </span>
                  <span
                    className="inline-block h-1.5 rounded"
                    style={{
                      width: max === 0 ? 0 : `${Math.round((48 * r.items) / max)}px`,
                      background: 'var(--color-de)',
                    }}
                    aria-hidden="true"
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------------- items --

function ItemsView({
  rows,
  shown,
  onShowMore,
}: {
  rows: CorrectionReportRow[];
  shown: number;
  onShowMore: () => void;
}) {
  const page = rows.slice(0, shown);
  return (
    <div className="space-y-2" data-testid="corrections-items">
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[860px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
              <th className="text-left py-1.5 font-display font-bold">Project</th>
              <th className="text-center py-1.5 font-display font-bold">Cycle</th>
              <th className="text-left py-1.5 font-display font-bold">Discipline</th>
              <th className="text-left py-1.5 font-display font-bold">Category</th>
              <th className="text-left py-1.5 font-display font-bold">Subject</th>
              <th className="text-left py-1.5 font-display font-bold">Reviewer</th>
              <th className="text-left py-1.5 font-display font-bold">Date</th>
            </tr>
          </thead>
          <tbody>
            {page.map((r) => (
              <ItemRow key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > page.length && (
        <button
          type="button"
          onClick={onShowMore}
          className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-s2 text-text hover:bg-s3 transition"
          data-testid="corrections-items-more"
        >
          Show {Math.min(ITEMS_PAGE, rows.length - page.length)} more ·{' '}
          {page.length} of {rows.length}
        </button>
      )}
    </div>
  );
}

function ItemRow({ row }: { row: CorrectionReportRow }) {
  const [open, setOpen] = useState(false);
  const hasBody = (row.body ?? '').trim() !== '';
  return (
    <>
      <tr
        className={`border-b border-border/40 ${hasBody ? 'cursor-pointer hover:bg-s2' : ''}`}
        onClick={hasBody ? () => setOpen((v) => !v) : undefined}
        data-testid={`corrections-item-row-${row.id}`}
      >
        <td className="py-1.5">
          <Link
            to={`/project/${row.project_id}`}
            className="text-de hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.address}
          </Link>
          {row.building && <span className="text-dim"> · {row.building}</span>}
        </td>
        <td className="py-1.5 text-center text-muted">{row.cycle ?? '—'}</td>
        <td className="py-1.5 text-muted">
          {correctionDisciplineLabel(row.discipline)}
        </td>
        <td className="py-1.5 text-muted">{row.category ?? '—'}</td>
        <td className="py-1.5 text-text">
          {hasBody && (
            <span className="text-dim mr-1" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
          )}
          {(row.subject ?? '').trim() || (
            <span className="text-dim italic">(no subject)</span>
          )}
        </td>
        <td className="py-1.5 text-muted">{row.reviewer ?? '—'}</td>
        <td className="py-1.5 text-muted">{row.letter_date ?? '—'}</td>
      </tr>
      {hasBody && open && (
        <tr data-testid={`corrections-item-body-${row.id}`}>
          <td colSpan={7} className="py-2 px-3 bg-s2 text-[11px] text-muted whitespace-pre-wrap">
            {row.body}
            <div className="mt-1 text-[10px] text-dim">
              {correctionThemeLabel(row.theme)}
              {row.codes ? ` · ${row.codes}` : ''}
              {' · '}
              {correctionArchitectLabel(row.architect)}
              {' · '}
              {row.source_file}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
