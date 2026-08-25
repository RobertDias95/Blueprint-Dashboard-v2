import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import OriginLink from '../components/OriginLink';
import { useAllCorrectionItems } from '../hooks/useAllCorrectionItems';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ExportCsvButton from '../components/shared/ExportCsvButton';
import { rowsToCsv, reportCsvFilename } from '../lib/reportCsv';
import {
  NOT_RECORDED,
  SEGMENTS,
  permitLinkCoverage,
  segmentValues,
  type SegmentProject,
} from '../lib/correctionsPrevalence';
import PrevalenceView from '../components/Reports/CorrectionsPrevalenceView';
import {
  PERIOD_PRESETS,
  dateSanity,
  precedingPeriod,
  resolvePeriod,
  rowsInPeriod,
  type PeriodPreset,
} from '../lib/correctionPeriods';
import MissingLetterWorklist from '../components/Reports/CorrectionsMissingWorklist';
import { correctionDisciplineLabel } from '../lib/correctionItems';
import RecurringCorrections from '../components/Reports/RecurringCorrections';
import {
  EXCLUSION_HINT,
  countExclusions,
  partitionCorrections,
  type ExclusionCount,
} from '../lib/correctionsExclusion';
import {
  CORRECTIONS_CSV_COLUMNS,
  EMPTY_FILTERS,
  architectCoverage,
  correctionArchitectLabel,
  correctionFilterOptions,
  correctionThemeLabel,
  correctionsCsvPreamble,
  correctionsCsvRows,
  countsByDiscipline,
  countsByTheme,
  describeFilters,
  filterCorrectionRows,
  filtersAreEmpty,
  hasPermitLevelFilter,
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

type View =
  | 'recurring'
  | 'prevalence'
  | 'repeats'
  | 'counts'
  | 'items'
  | 'missing'
  | 'excluded';

// fix-279: prevalence leads. It is the question the business actually asked
// ("we get this correction 65% of the time" -> fix the template); repeat rate
// answers a different one ("when we get it we fail to close it 25% of the
// time" -> fix the response process). They are separate views on purpose:
// shown in one column without labels they would send template work at exactly
// the wrong categories.
// ★★★ fix-374 · §2 — THE DRILL-DOWN GREETS YOU NOW.
//
// Bobby: *"can we make this drill down more relevant on the main screen? seems
// complicated to find… I have to go by theme/discipline to get the drill down
// option."* He was right: the recurring corrections are the entire reason
// fix-372 exists and they were three clicks and a guess away. `recurring` is
// first and is the default, and every row of it opens one specific pattern.
//
// ★★ fix-374 · §3 — AND THE LABELS ARE THE WORDS PEOPLE SAY.
//
// Bobby: *"idk what prevalance is."* The hint under that tab already said it
// better than the label did, which is the tell: a label that needs a hint has
// not been written yet (fix-364's rule, applied here).
//
//   Prevalence          -> How often we get it   ★ its own hint, promoted
//   By theme & discipline -> Where the volume sits  ★ likewise
//   Items               -> Every comment         (`Items` is our word for rows)
//   Excluded            -> Not corrections       (excluded FROM WHAT?)
//   Repeat rate         KEPT — it is already plain, and it is the phrase the
//                       business used when asking for it. Renaming a term
//                       people already say would break fix-364's rule, not keep it.
//   No letter found     KEPT — a whole sentence in three words, nothing to fix.
const VIEWS: Array<{ key: View; label: string; hint: string }> = [
  { key: 'recurring', label: 'What keeps coming back',
    hint: 'The corrections we get again and again — open one to see every project it hit' },
  { key: 'prevalence', label: 'How often we get it',
    hint: 'Of the projects in scope, how many hit each correction — what to fix in the template' },
  { key: 'repeats', label: 'Repeat rate',
    hint: 'When we get it, how often it comes back — where the response breaks' },
  { key: 'counts', label: 'Where the volume sits', hint: 'By theme and by discipline' },
  { key: 'items', label: 'Every comment', hint: 'The individual comments, unedited' },
  { key: 'missing', label: 'No letter found',
    hint: 'Corrections the tool says exist that we have not found on the share' },
  // fix-283a: last, because it is about the data rather than the work — but a
  // tab of its own, not a footnote. The filter is heuristic, and the only way
  // anyone can tell it is wrong is by reading what it took out.
  { key: 'excluded', label: 'Not corrections',
    hint: 'Rows the indexer judged not to be corrections, and why' },
];

/** The drill-down is the long tail of a 2,194-row corpus; rendering it all at
 *  once is a wall, not a report. */
const ITEMS_PAGE = 100;

/** fix-283a: how many excluded rows to show per reason. Enough to judge the
 *  rule by, short of rendering all 141 — the count beside each heading is the
 *  real total, and it is stated when the list is cut. */
const EXCLUDED_PER_REASON = 25;

export default function CorrectionsReport() {
  const itemsQ = useAllCorrectionItems();
  const projectsQ = useProjects();
  const permitsQ = usePermits();

  // fix-281: one notion of "now" for the whole page — the presets, the
  // preceding window and the implausible-date test all read the same value, so
  // they cannot disagree by a day at midnight.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState<PeriodPreset>('all');

  const [filters, setFilters] = useState<CorrectionFilters>(EMPTY_FILTERS);
  // ★★ fix-374: the view is in the URL. It has to be, now that the page greets
  // you with one view and the others are a click away — a link to "the repeat
  // rate" that lands on the recurring list is the same complaint Bobby made
  // about the drill-down, one level up. Default `recurring`; unknown values
  // fall back to it rather than rendering nothing.
  const [params, setParams] = useSearchParams();
  const view = useMemo<View>(() => {
    const requested = params.get('view') ?? '';
    return VIEWS.some((v) => v.key === requested) ? (requested as View) : 'recurring';
  }, [params]);
  const setView = (next: View) => {
    const merged = new URLSearchParams(params);
    if (next === 'recurring') merged.delete('view');
    else merged.set('view', next);
    setParams(merged, { replace: true });
  };
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

  // fix-279: permit facts for the permit-level slices. Keyed by permit id, so
  // an item with no permit_id simply finds nothing — which is the honest
  // outcome for ~50% of the corpus.
  const permitsById = useMemo(() => {
    const m = new Map<number, { id: number; type: string | null; da: string | null }>();
    for (const p of permitsQ.data ?? []) m.set(p.id, { id: p.id, type: p.type, da: p.da });
    return m;
  }, [permitsQ.data]);

  // fix-279: project attributes for the segment filters and breakdowns.
  const projectsById = useMemo(() => {
    const m = new Map<string, SegmentProject>();
    for (const p of projectsQ.data ?? []) m.set(p.id, p as SegmentProject);
    return m;
  }, [projectsQ.data]);

  // ★ fix-283a: THE FILTER POINT, AND THERE IS ONLY ONE.
  //
  // Every figure on this page — prevalence, its denominator, repeat rates,
  // theme and discipline counts, the CSV, the item list — is derived from
  // `allRows`. Splitting here means all of them recompute from real
  // corrections without any of them knowing the filter exists, which is what
  // the brief asks for: the prevalence denominator becomes "projects with at
  // least one CORRECTION", recomputed rather than adjusted.
  //
  // The excluded rows are kept in hand, not dropped, so the page can say how
  // many it removed and why.
  const joinedRows = useMemo(
    () =>
      joinCorrectionRows(
        itemsQ.data ?? [],
        projectsQ.data ?? [],
        architectByProjectId,
        permitsById,
      ),
    [itemsQ.data, projectsQ.data, architectByProjectId, permitsById],
  );
  const { included: allRows, excluded: excludedRows } = useMemo(
    () => partitionCorrections(joinedRows),
    [joinedRows],
  );
  const exclusionCounts = useMemo(
    () => countExclusions(excludedRows),
    [excludedRows],
  );

  // Options come off the UNFILTERED set so the dropdowns don't collapse as you
  // narrow — picking Bellevue must not empty the discipline list.
  const options = useMemo(() => correctionFilterOptions(allRows), [allRows]);
  // fix-281: the period narrows BEFORE the filter bar's own from/to, and a
  // preset overrides them — two date controls fighting each other would be
  // unreadable, so choosing a preset is what sets the window.
  const resolved = useMemo(
    () => resolvePeriod(period, today, { from: filters.from, to: filters.to }),
    [period, today, filters.from, filters.to],
  );
  const previous = useMemo(() => precedingPeriod(resolved), [resolved]);

  const periodRows = useMemo(
    () => (period === 'all' && !filters.from && !filters.to
      ? allRows
      : rowsInPeriod(allRows, resolved, today)),
    [allRows, period, resolved, today, filters.from, filters.to],
  );

  const rows = useMemo(
    () => filterCorrectionRows(periodRows, filters, projectsById),
    [periodRows, filters, projectsById],
  );
  // The preceding window, filtered identically so the two sides differ only by
  // their dates. Null on an unbounded period — "all time" has no previous.
  const previousRows = useMemo(() => {
    if (!previous) return null;
    return filterCorrectionRows(
      rowsInPeriod(allRows, previous, today), filters, projectsById);
  }, [previous, allRows, today, filters, projectsById]);

  // fix-281: 10 of the 2,194 letter dates are impossible — five in the future,
  // all from one letter, and five before 2025, all from another. Counted and
  // shown; never corrected.
  const sanity = useMemo(() => dateSanity(allRows, today), [allRows, today]);
  // fix-279: the prevalence DENOMINATOR set — every filter except theme. See
  // computePrevalence: letting a theme filter shrink the denominator would make
  // every category inside that theme read high, and a single-theme slice 100%.
  const scopeRows = useMemo(
    () => filterCorrectionRows(periodRows, filters, projectsById, 'scope'),
    [periodRows, filters, projectsById],
  );
  const prevalenceScopeNote = filters.theme
    ? `Rows are limited to the “${filters.theme}” theme, but the denominator stays ` +
      'the whole filtered slice — otherwise every category inside a theme would ' +
      'read near 100%.'
    : null;

  // fix-279: how much of the slice can answer a permit-level question at all.
  const permitCoverage = useMemo(() => permitLinkCoverage(rows), [rows]);
  const permitFilterActive = hasPermitLevelFilter(filters);

  const summary = useMemo(() => summarizeReport(rows), [rows]);
  const themes = useMemo(() => countsByTheme(rows), [rows]);
  const disciplines = useMemo(() => countsByDiscipline(rows), [rows]);
  const architectCov = useMemo(() => architectCoverage(allRows), [allRows]);
  // fix-279: values for each segment dropdown, taken off the projects that
  // actually have corrections — offering a zone nobody in the corpus uses would
  // be a filter that always returns nothing.
  const segmentOptions = useMemo(() => {
    const projectIds = new Set(allRows.map((r) => r.project_id));
    const out: Record<string, string[]> = {};
    for (const seg of SEGMENTS) {
      const vals = new Set<string>();
      for (const id of projectIds) {
        const p = projectsById.get(id);
        if (p) for (const v of segmentValues(seg, p)) vals.add(v);
      }
      out[seg.key] = [...vals].sort((a, b) =>
        a === NOT_RECORDED ? 1 : b === NOT_RECORDED ? -1 : a.localeCompare(b, undefined, { numeric: true }),
      );
    }
    return out;
  }, [allRows, projectsById]);
  const permitOptions = useMemo(() => {
    const types = new Set<string>();
    const das = new Set<string>();
    for (const r of allRows) {
      if (r.permit_type) types.add(r.permit_type);
      if (r.permit_da) das.add(r.permit_da);
    }
    return {
      types: [...types].sort((a, b) => a.localeCompare(b)),
      das: [...das].sort((a, b) => a.localeCompare(b)),
    };
  }, [allRows]);

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
      {/* ★★ fix-372: the way in to levels two and three. Bobby: "I don't know
          how this UI necessarily flows given the current flow of the report you
          already built" — the answer is that nothing here goes away. */}
      <Link
        to="/reports/corrections/patterns"
        className="inline-block text-[11px] font-bold text-de hover:underline no-underline"
        data-testid="corrections-to-patterns"
      >
        Recurring corrections — which one to change the template for →
      </Link>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-display font-bold text-text mb-1">
            Corrections
          </h1>
          <p className="text-[11px] text-muted max-w-3xl">
            Every comment the cities have written on our correction letters,
            pulled off the file server by the indexer. Two different questions,
            two separate views:{' '}
            <span className="font-semibold">prevalence</span> is how often we
            get a correction at all (fix the template);{' '}
            <span className="font-semibold">repeat rate</span> is how often it
            comes back the next cycle when we do (fix the response). They move
            in opposite directions for the same category, so they are never
            shown as one number. Read-only — nothing here changes a permit.
          </p>
        </div>
        <ExportCsvButton
          filename={reportCsvFilename('corrections')}
          onExport={() =>
            // fix-279: the filter set rides along, so a shared file cannot be
            // read as the whole business when it was one jurisdiction and one
            // unit band.
            correctionsCsvPreamble(filters, [
              `View: ${VIEWS.find((v) => v.key === view)?.label ?? view}`,
              `Rows: ${rows.length} items across ${summary.projects} projects`,
              // fix-283a: an exported file outlives the page that explains it.
              // Without this line the numbers look like the old ones on the
              // old basis, and they are neither.
              ...(excludedRows.length
                ? [
                    `Excludes ${excludedRows.length} indexed rows judged not to be ` +
                      `corrections (${exclusionCounts
                        .map((c) => `${c.count} ${c.label.toLowerCase()}`)
                        .join(', ')}). Counts are NOT comparable with reports ` +
                      'produced before this filter existed.',
                  ]
                : []),
            ]) + rowsToCsv([...CORRECTIONS_CSV_COLUMNS], correctionsCsvRows(rows))
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
        coverage={architectCov}
        segmentOptions={segmentOptions}
        permitOptions={permitOptions}
        period={period}
        onPeriod={(p) => {
          setPeriod(p);
          // A preset owns the window, so it clears any hand-typed bounds rather
          // than silently competing with them.
          if (p !== 'custom') patch({ from: '', to: '' });
          setShown(ITEMS_PAGE);
        }}
        periodLabel={resolved.label}
        sanity={sanity}
      />

      {/* fix-279: the active filter set, restated in words. The same string
          goes into every CSV — see correctionsCsvPreamble. */}
      {!filtersAreEmpty(filters) && (
        <div
          className="text-[10px] text-dim"
          data-testid="corrections-active-filters"
        >
          Showing: {describeFilters(filters).join(' · ')}
        </div>
      )}

      {/* fix-279: permit-linked slices cover about half the corpus. Say so
          rather than letting two different totals appear on one page with no
          explanation. */}
      {permitFilterActive && (
        <div
          className="text-[11px] px-3 py-2 rounded-md border"
          style={{
            background: 'var(--color-co-bg)',
            borderColor: 'var(--color-co-border)',
            color: 'var(--color-hold-text)',
          }}
          data-testid="corrections-permit-coverage"
        >
          <strong>Permit-level filter active.</strong> Only{' '}
          {permitCoverage.linked} of {permitCoverage.total} items in this slice
          carry a permit link ({permitCoverage.pct}%); the remaining{' '}
          {permitCoverage.total - permitCoverage.linked} are{' '}
          <strong>excluded</strong> from every figure below. The indexer links a
          letter to a permit only when it can do so unambiguously, so an
          unlinked item is not evidence of anything — it just cannot answer a
          per-permit question.
        </div>
      )}

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
      ) : rows.length === 0 && view !== 'missing' ? (
        // fix-279: 'missing' is exempt — it is about letters that are ABSENT
        // from correction_items, so an empty filtered row set says nothing
        // about whether that view has anything to show.
        <div
          className="py-8 text-center text-dim italic text-xs"
          data-testid="corrections-report-no-match"
        >
          No corrections match these filters.{' '}
          <button
            type="button"
            onClick={() => setView('missing')}
            className="underline text-de not-italic font-bold"
            data-testid="corrections-no-match-to-missing"
          >
            Show corrections with no letter found
          </button>
        </div>
      ) : (
        <>
          <SummaryStrip summary={summary} />
          {/* fix-283a: shown on every view, not only the Excluded tab. A filter
              that silently removes 141 rows reads as "this is the whole
              corpus"; this is the sentence that stops it. */}
          <ExclusionNote
            excluded={excludedRows.length}
            included={allRows.length}
            counts={exclusionCounts}
            onShow={() => setView('excluded')}
            active={view === 'excluded'}
          />

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
                title={v.hint}
              >
                {v.label}
              </button>
            ))}
          </div>
          {/* The hint below the tabs, not only in a tooltip: prevalence and
              repeat rate are easy to conflate and a hover is not a label. */}
          <div className="text-[10px] text-dim -mt-2" data-testid="corrections-view-hint">
            {VIEWS.find((v) => v.key === view)?.hint}
          </div>

          {view === 'recurring' && <RecurringCorrections />}
          {view === 'prevalence' && (
            <PrevalenceView
              scopeRows={scopeRows}
              displayRows={rows}
              projectsById={projectsById}
              scopeNote={prevalenceScopeNote}
              previousRows={previousRows}
              currentPeriodLabel={resolved.label}
              previousPeriodLabel={previous ? previous.label : null}
              today={today}
            />
          )}
          {view === 'missing' && <MissingLetterWorklist />}
          {view === 'excluded' && (
            <ExcludedView rows={excludedRows} counts={exclusionCounts} />
          )}
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
  segmentOptions,
  permitOptions,
  period,
  onPeriod,
  periodLabel,
  sanity,
}: {
  filters: CorrectionFilters;
  options: ReturnType<typeof correctionFilterOptions>;
  onChange: (next: Partial<CorrectionFilters>) => void;
  onReset: () => void;
  coverage: ReturnType<typeof architectCoverage>;
  segmentOptions: Record<string, string[]>;
  permitOptions: { types: string[]; das: string[] };
  period: PeriodPreset;
  onPeriod: (p: PeriodPreset) => void;
  periodLabel: string;
  sanity: ReturnType<typeof dateSanity>;
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
      {/* fix-281: period presets. 2026 YTD first — it is the window the
          business is actually trying to improve. */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-dim">Period</span>
        <div className="flex gap-1" data-testid="corrections-period-presets">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPeriod(p.key)}
              className={`px-2 py-1 rounded text-[11px] font-bold border transition ${
                period === p.key
                  ? 'bg-de text-white border-de'
                  : 'bg-surface text-muted border-border hover:bg-s3'
              }`}
              data-testid={`corrections-period-${p.key}`}
              data-active={period === p.key ? 'true' : 'false'}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-dim" data-testid="corrections-period-label">
          {periodLabel}
        </span>
      </div>
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

      {/* fix-281: the dates that are not real. Counted and visible, never
          corrected — a wrong date guessed into a plausible one is worse than an
          outlier you can still chase back to its letter. */}
      {sanity.implausible > 0 && (
        <div
          className="basis-full text-[10px] text-dim italic"
          data-testid="corrections-date-sanity"
          title="Excluded from every period window and from the period comparison. They still appear in the drill-down, flagged, because the letter still says something."
        >
          {sanity.implausible} of {sanity.total} comments carry an implausible
          letter date ({sanity.future} in the future, {sanity.tooOld} before{' '}
          2025). They are excluded from period windows and comparisons, flagged
          where they appear, and never corrected.
        </div>
      )}

      {/* fix-279: SEGMENTS. Project attributes, in their own row so the twelve
          of them do not bury the six content filters above. */}
      <div className="basis-full border-t pt-2 mt-1" style={{ borderTopColor: 'var(--color-border)' }}>
        <div className="text-[10px] uppercase tracking-wide text-dim mb-1.5">
          Segment by project
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {SEGMENTS.filter((seg) => seg.key !== 'juris').map((seg) => (
            <Select
              key={seg.key}
              label={seg.label}
              value={filters.segments[seg.key] ?? ''}
              onChange={(v) =>
                onChange({ segments: { ...filters.segments, [seg.key]: v } })
              }
              options={segmentOptions[seg.key] ?? []}
              allLabel={`Any ${seg.label.toLowerCase()}`}
              testId={`corrections-segment-${seg.key}`}
            />
          ))}
          {/* Permit-level, visually grouped with a warning: these two cover
              about half the corpus and the page says so when either is set. */}
          <Select
            label="Permit type ⚠"
            value={filters.permitType}
            onChange={(v) => onChange({ permitType: v })}
            options={permitOptions.types}
            allLabel="Any permit type"
            testId="corrections-filter-permit-type"
          />
          <Select
            label="DA ⚠"
            value={filters.da}
            onChange={(v) => onChange({ da: v })}
            options={permitOptions.das}
            allLabel="Any DA"
            testId="corrections-filter-da"
          />
        </div>
        <div className="text-[10px] text-dim italic mt-1">
          ⚠ Permit type and DA come from the linked permit. Only about half the
          comments carry a permit link, so either filter excludes the rest — the
          page states the exact coverage when one is active.
        </div>
      </div>
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
                    <OriginLink
                      to={`/project/${t.projectId}`}
                      className="text-de hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.address}
                    </OriginLink>
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
              {/* ★★ fix-372: THE ROW IS NOW A DOOR. Nothing about this report
                  changes — it is still level one — but a category or theme with
                  a percentage against it was a number nobody could open. It
                  leads to the recurring corrections that make up that number. */}
              <td className="py-1.5 text-text">
                <Link
                  to="/reports/corrections/patterns"
                  className="text-text hover:text-de no-underline hover:underline"
                  data-testid={`${testId}-link-${r.label}`}
                >
                  {r.label}
                </Link>
              </td>
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
          <OriginLink
            to={`/project/${row.project_id}`}
            className="text-de hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.address}
          </OriginLink>
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

// ------------------------------------------------------- fix-283a: excluded --

/** The always-visible "N excluded" line.
 *
 *  ★ NOT A TOOLTIP AND NOT ONLY ON THE EXCLUDED TAB. The brief's requirement is
 *  that the filter be noticeable if it is wrong, and a figure somebody has to
 *  go looking for does not meet that. It renders on every view, states the
 *  count and the reasons in words, and links to the rows themselves.
 *
 *  Renders NOTHING when nothing was excluded — a permanent "0 excluded" is
 *  noise, and its absence is not ambiguous. */
function ExclusionNote({
  excluded,
  included,
  counts,
  onShow,
  active,
}: {
  excluded: number;
  included: number;
  counts: ExclusionCount[];
  onShow: () => void;
  active: boolean;
}) {
  if (excluded === 0) return null;
  const total = excluded + included;
  const pct = total > 0 ? Math.round((excluded / total) * 1000) / 10 : 0;
  return (
    <div
      className="rounded-md border border-border bg-s2 px-3 py-2 text-[11px] text-muted flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid="corrections-exclusion-note"
    >
      <span>
        Every figure below excludes{' '}
        <strong className="text-text" data-testid="corrections-excluded-count">
          {excluded.toLocaleString()}
        </strong>{' '}
        of {total.toLocaleString()} indexed rows ({pct}%) that the indexer judged
        not to be corrections:
      </span>
      <span className="text-dim">
        {counts.map((c) => `${c.count} ${c.label.toLowerCase()}`).join(' · ')}
      </span>
      {!active && (
        <button
          type="button"
          onClick={onShow}
          className="underline text-de font-bold"
          data-testid="corrections-exclusion-show"
        >
          See what was excluded
        </button>
      )}
    </div>
  );
}

/** The excluded rows themselves, grouped by the rule that caught them.
 *
 *  Shows the TEXT, because the text is the evidence. A reason and a count alone
 *  would let a wrong rule hide behind a plausible label — the only way to judge
 *  "drawing text" is to read what was called drawing text. */
function ExcludedView({
  rows,
  counts,
}: {
  rows: CorrectionReportRow[];
  counts: ExclusionCount[];
}) {
  if (rows.length === 0) {
    return (
      <div
        className="text-xs text-dim italic py-6 text-center"
        data-testid="corrections-excluded-empty"
      >
        Nothing has been excluded — every indexed row reads as a correction.
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="corrections-excluded">
      <p className="text-[11px] text-muted leading-relaxed max-w-[70ch]">
        These rows are still in the database and are excluded from every count
        on this page. The detection is a heuristic and will get some wrong — if
        one of these is a real correction, that is worth saying, because the
        rules live in the indexer and can be changed.
      </p>
      {counts.map((c) => {
        const group = rows.filter(
          (r) => (r.exclusion_reason || 'unknown') === c.reason,
        );
        return (
          <section key={c.reason} data-testid={`corrections-excluded-${c.reason}`}>
            <h3 className="text-xs font-display font-bold text-text">
              {c.label}{' '}
              <span className="text-dim font-normal">
                · {c.count.toLocaleString()}
              </span>
            </h3>
            {EXCLUSION_HINT[c.reason] && (
              <p className="text-[10.5px] text-dim mt-0.5 mb-1.5 max-w-[70ch]">
                {EXCLUSION_HINT[c.reason]}
              </p>
            )}
            <ul className="space-y-1">
              {group.slice(0, EXCLUDED_PER_REASON).map((r) => (
                <li
                  key={r.id}
                  className="text-[11px] border border-border rounded px-2 py-1 bg-surface"
                  data-testid={`corrections-excluded-row-${r.id}`}
                >
                  <OriginLink
                    to={`/project/${r.project_id}`}
                    className="text-de hover:underline font-bold"
                  >
                    {r.address}
                  </OriginLink>
                  <span className="text-dim"> · {r.source_file}</span>
                  <div className="text-muted mt-0.5 line-clamp-2">
                    {((r.subject ?? '') + ' ' + (r.body ?? '')).trim() || (
                      <span className="italic text-dim">(no text)</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {group.length > EXCLUDED_PER_REASON && (
              <div className="text-[10px] text-dim mt-1">
                Showing {EXCLUDED_PER_REASON} of {group.length.toLocaleString()}.
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
