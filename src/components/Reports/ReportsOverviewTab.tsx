import { useMemo, useState } from 'react';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import {
  useAllProjectHolds,
  holdsByProjectId,
} from '../../hooks/useProjectHolds';
import {
  computeMetrics,
  enrichPermits,
  filterEnrichedPermits,
  type ReportFilters,
} from '../../lib/reportMetrics';
import { comparisonLabelForRange } from '../../lib/comparisonCohort';
import { groupAvgBy, groupCountBy } from '../../lib/chartHelpers';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import ReportFilterBar from './ReportFilterBar';
import MetricCards from './MetricCards';
import PerCycleDrawer from './PerCycleDrawer';
import { computePerCycleBuckets } from '../../lib/perCycleMetrics';
import MetricInfoTooltip from '../shared/MetricInfoTooltip';
import { REPORTS_BARCHART_METRICS } from '../../lib/metricDefinitions';
import AddComparisonButton from '../shared/AddComparisonButton';
import ComparePanel from '../shared/ComparePanel';
import BarChartCard from './BarChartCard';
import ReportTable from './ReportTable';
import ScheduleBenchmarks from './ScheduleBenchmarks';
import { exportEnrichedPermitsToCSV } from '../../lib/csvExport';
import { pushToast } from '../../stores/toastStore';
import type { PermitWithCycles, Project } from '../../lib/database.types';

// Q7.2.b: Reports Overview — FilterBar → MetricCards → 6 charts → Benchmarks
// → Table + CSV export. Q9.5.d: header restyle + Export CSV button.
//
// fix-trends-subtab (2026-05-28): extracted verbatim from the old
// pages/Reports.tsx body. Reports.tsx is now a sub-tab shell that renders
// this under the "Overview" tab and <Trends /> under the "Trends" tab. The
// content (charts / filter bar / CSV) is unchanged — it just moved here.

// fix-129-c: factory for BarChartCard titleSlot tooltips. Each definition
// lives in REPORTS_BARCHART_METRICS keyed by slug; the factory builds the
// MetricInfoTooltip with the right label + formula + cohort + slug.
function barTip(slug: keyof typeof REPORTS_BARCHART_METRICS) {
  const def = REPORTS_BARCHART_METRICS[slug];
  return (
    <MetricInfoTooltip
      label={def.label}
      description={def.description}
      formula={def.formula}
      cohort={def.cohort}
      slug={`bar-${slug}`}
    />
  );
}

const DEFAULT_FILTERS: ReportFilters = {
  types: new Set(),
  jurisdictions: new Set(),
  ents: new Set(),
  productTypes: new Set(),
  tags: new Set(),
  range: 'all',
  dateFrom: null,
  dateTo: null,
  status: 'all',
  // fix-113-a: permit-level cohort filter, decoupled from the project-level
  // `status` above (now labelled "Project Status" in the UI).
  permitStatus: 'all',
  search: '',
  // fix-115-c → fix-137: comparison defaults to null so the page
  // renders single-cohort exactly as it did pre-fix-115. Opt-in via
  // the AddComparisonButton + ComparePanel below the filter bar.
  comparisonRange: null,
};

export default function ReportsOverviewTab() {
  const permitsQ = usePermits();
  const projectsQ = useProjects();

  const error = permitsQ.error ?? projectsQ.error;
  if (error) {
    return (
      <QueryError
        title="Reports failed to load"
        error={error}
        onRetry={() => {
          permitsQ.refetch();
          projectsQ.refetch();
        }}
      />
    );
  }
  if (permitsQ.isLoading || projectsQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-16" />;
  }

  return (
    <Body
      permits={permitsQ.data ?? []}
      projects={projectsQ.data ?? []}
    />
  );
}

function Body({
  permits,
  projects,
}: {
  permits: PermitWithCycles[];
  projects: Project[];
}) {
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const today = useMemo(() => new Date(), []);
  // fix-137: compare-panel open state lives on the page (sibling, not popover).
  const [comparePanelOpen, setComparePanelOpen] = useState(false);
  // fix-142: per-cycle breakdown drawer — default closed, toggled by the
  // three timeline tiles.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  // fix-171 (effect B): subtract held days from the turnaround tiles. One fetch,
  // indexed by project; threaded into enrich + both computeMetrics cohorts.
  const holdsQ = useAllProjectHolds();
  const holdsMap = useMemo(() => holdsByProjectId(holdsQ.data), [holdsQ.data]);

  const enriched = useMemo(
    () => enrichPermits(permits, projectsById, holdsMap),
    [permits, projectsById, holdsMap],
  );

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) if (e.permit.type) set.add(e.permit.type);
    return Array.from(set).sort();
  }, [enriched]);

  const jurisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) if (e.juris) set.add(e.juris);
    return Array.from(set).sort();
  }, [enriched]);

  const entOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) {
      if (e.permit.ent_lead) set.add(e.permit.ent_lead);
    }
    return Array.from(set).sort();
  }, [enriched]);

  const productTypeOptions = useMemo(() => {
    // fix-91: productTypes is multi-valued on each enriched row. Union
    // the distinct values across the whole result set for the picklist.
    const set = new Set<string>();
    for (const e of enriched) for (const t of e.productTypes) set.add(t);
    return Array.from(set).sort();
  }, [enriched]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) for (const t of e.projectTags) set.add(t);
    return Array.from(set).sort();
  }, [enriched]);

  // fix-113-a: distinct permits.status values present in the unfiltered cohort,
  // sorted alphabetically. Drives the new permit-level Status select; values
  // are reported as-is (no normalization) so the dropdown always matches the
  // exact strings the data carries.
  const permitStatusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) {
      if (e.permit.status) set.add(e.permit.status);
    }
    return Array.from(set).sort();
  }, [enriched]);

  const filtered = useMemo(
    () => filterEnrichedPermits(enriched, filters, today),
    [enriched, filters, today],
  );

  // fix-137: explicit Period B comparison range, sourced directly from
  // the page filter state (no more deriveComparisonRange call). Null =
  // single-cohort rendering.
  const comparisonRange = filters.comparisonRange;

  const comparisonFiltered = useMemo(() => {
    if (!comparisonRange) return null;
    const comparisonFilters: ReportFilters = {
      ...filters,
      range: 'custom',
      dateFrom: comparisonRange.from,
      dateTo: comparisonRange.to,
      // Don't recurse — the comparison cohort itself doesn't have a
      // comparison cohort.
      comparisonRange: null,
    };
    return filterEnrichedPermits(enriched, comparisonFilters, today);
  }, [enriched, filters, today, comparisonRange]);

  const comparisonMetrics = useMemo(
    () =>
      comparisonFiltered === null
        ? null
        : computeMetrics(comparisonFiltered, holdsMap),
    [comparisonFiltered, holdsMap],
  );
  const comparisonLabel = useMemo(
    () => comparisonLabelForRange(comparisonRange),
    [comparisonRange],
  );

  // fix-112-a: ScheduleBenchmarks consumes the SAME filtered cohort as every
  // other surface on this page. Previously it received raw `permits` so the
  // Type / Juris / ENT / DateRange / Status / Product / Tags / Search filters
  // all silently bypassed the benchmark cards — Bobby would pick Type=BP +
  // Juris=Seattle, watch the KPIs / charts / ledger narrow, and the benchmark
  // cards underneath would still average across the whole dataset.
  const filteredPermits = useMemo(
    () => filtered.map((e) => e.permit),
    [filtered],
  );

  const metrics = useMemo(
    () => computeMetrics(filtered, holdsMap),
    [filtered, holdsMap],
  );

  // fix-142: per-cycle buckets for the drawer — current cohort + the
  // comparison cohort (when Period B is set), so each cell can render the
  // current | comparison | delta mini-split.
  const perCycleBuckets = useMemo(
    () => computePerCycleBuckets(filtered, holdsMap),
    [filtered, holdsMap],
  );
  const comparisonPerCycleBuckets = useMemo(
    () =>
      comparisonFiltered === null
        ? null
        : computePerCycleBuckets(comparisonFiltered, holdsMap),
    [comparisonFiltered, holdsMap],
  );

  const permitsByType = useMemo(
    () => groupCountBy(filtered, (e) => e.permit.type),
    [filtered],
  );
  const permitsByJuris = useMemo(
    () => groupCountBy(filtered, (e) => e.juris),
    [filtered],
  );
  const goToSubmitByType = useMemo(
    () => groupAvgBy(filtered, (e) => e.permit.type, (e) => e.goToSubmit),
    [filtered],
  );
  const scheduleVarianceByType = useMemo(
    () =>
      groupAvgBy(
        filtered,
        (e) => e.permit.type,
        (e) => (e.variance === null ? null : Math.abs(e.variance)),
      ),
    [filtered],
  );
  const cityReviewByJuris = useMemo(
    // fix-141: field renamed cityReviewDays → permitTimelineDays. This bar
    // (City Review by Jurisdiction) keeps the intake → approval formula.
    () => groupAvgBy(filtered, (e) => e.juris, (e) => e.permitTimelineDays),
    [filtered],
  );
  const corrResponseByType = useMemo(
    () =>
      groupAvgBy(filtered, (e) => e.permit.type, (e) => e.corrResponseDays),
    [filtered],
  );

  function update<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }
  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  function handleExport() {
    try {
      const result = exportEnrichedPermitsToCSV(filtered);
      const kb = Math.round(result.bytes / 1024);
      pushToast(
        `Exported ${result.rowsExported} permits (${kb} KB)`,
        'success',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast(`CSV export failed — ${msg}`, 'error');
    }
  }

  return (
    <div className="space-y-4" data-testid="reports-page">
      {/* Q9.5.d: "Reports & Metrics" title + Export CSV top-right. The
          Overview/Trends switch now lives in the Reports sub-tab bar. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xl font-extrabold text-text">
          Reports &amp; Metrics
        </div>
        <button
          onClick={handleExport}
          className="px-3 py-1.5 rounded-md text-xs font-bold bg-de text-white border border-de hover:opacity-90 transition"
          data-testid="reports-export-csv"
        >
          ↓ Export CSV
        </button>
      </div>

      {/* fix-68: the Saved Reports library moved to Settings -> Reporting
          (a tenant-owned category tree). The Reports tab is analytics-only
          now — Reports & Metrics + the Trends sub-tab. */}

      {/* fix-137: Add comparison entry-point — replaces the old
          ComparePresetChips row + the Compare-to dropdown on the
          filter bar. */}
      <div className="flex items-center gap-2">
        <AddComparisonButton
          isOpen={comparePanelOpen}
          hasComparison={!!comparisonRange}
          comparisonRange={comparisonRange}
          onOpenChange={setComparePanelOpen}
          onRemoveComparison={() => {
            update('comparisonRange', null);
            setComparePanelOpen(false);
          }}
          testIdPrefix="reports-compare"
        />
      </div>
      <ComparePanel
        open={comparePanelOpen}
        primaryRange={
          filters.range === 'custom' && filters.dateFrom && filters.dateTo
            ? { from: filters.dateFrom, to: filters.dateTo }
            : null
        }
        comparisonRange={comparisonRange}
        today={today}
        onApply={(periodA, periodB) => {
          setFilters((prev) => ({
            ...prev,
            range: 'custom',
            dateFrom: periodA.from,
            dateTo: periodA.to,
            comparisonRange: periodB,
          }));
          setComparePanelOpen(false);
        }}
        onCancel={() => setComparePanelOpen(false)}
        testIdPrefix="reports-compare-panel"
      />

      <ReportFilterBar
        filters={filters}
        onChange={update}
        onClear={clearFilters}
        typeOptions={typeOptions}
        jurisOptions={jurisOptions}
        entOptions={entOptions}
        productTypeOptions={productTypeOptions}
        tagOptions={tagOptions}
        permitStatusOptions={permitStatusOptions}
        resultCount={filtered.length}
      />

      <MetricCards
        metrics={metrics}
        comparisonMetrics={comparisonMetrics}
        comparisonLabel={comparisonLabel}
        // fix-129-b: thread the resolved current + comparison ranges so
        // MetricCard can render KpiSplitView when comparison is active.
        currentRangeLabel={
          filters.dateFrom && filters.dateTo
            ? filters.dateFrom === filters.dateTo
              ? filters.dateFrom
              : `${filters.dateFrom} – ${filters.dateTo}`
            : undefined
        }
        comparisonRangeLabel={
          comparisonRange
            ? comparisonRange.from === comparisonRange.to
              ? comparisonRange.from
              : `${comparisonRange.from} – ${comparisonRange.to}`
            : undefined
        }
        comparisonModeLabel={comparisonRange ? 'vs comparison' : undefined}
        onTimelineTileClick={() => setDrawerOpen((o) => !o)}
        drawerOpen={drawerOpen}
      />

      {/* fix-142: per-cycle breakdown drawer — between MetricCards and the
          charts row. Toggled by the three timeline tiles above. */}
      <PerCycleDrawer
        open={drawerOpen}
        buckets={perCycleBuckets}
        comparisonBuckets={comparisonPerCycleBuckets}
        comparisonLabel={comparisonLabel ?? null}
      />

      {/* fix-129-c: each BarChartCard's title is wrapped in a
          MetricInfoTooltip so the formula + cohort gate are one hover
          away. The tip(...) factory pulls from metricDefinitions and
          flows through the titleSlot prop. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BarChartCard
          title="Permits by Type"
          titleSlot={barTip('permitsByType')}
          data={permitsByType}
          color="jv"
          showAverage={false}
          testId="chart-permits-by-type"
        />
        <BarChartCard
          title="Permits by Jurisdiction"
          titleSlot={barTip('permitsByJuris')}
          data={permitsByJuris}
          color="is"
          showAverage={false}
          testId="chart-permits-by-juris"
        />
        <BarChartCard
          title="GO → Submit (avg days by type)"
          titleSlot={barTip('goToSubmitByType')}
          data={goToSubmitByType}
          color="de"
          unit="d"
          testId="chart-go-to-submit-by-type"
        />
        <BarChartCard
          title="Schedule Variance by Type (avg days off)"
          titleSlot={barTip('scheduleVarianceByType')}
          data={scheduleVarianceByType}
          color="co"
          unit="d"
          emptyState="No issued permits yet"
          testId="chart-schedule-variance-by-type"
        />
        <BarChartCard
          title="City Review by Jurisdiction (avg days)"
          titleSlot={barTip('cityReviewByJuris')}
          data={cityReviewByJuris}
          color="pm"
          unit="d"
          emptyState="No completed reviews yet"
          testId="chart-city-review-by-juris"
        />
        <BarChartCard
          title="Correction Response by Type (avg days)"
          titleSlot={barTip('corrResponseByType')}
          data={corrResponseByType}
          color="overdue"
          unit="d"
          emptyState="No correction rounds completed yet"
          testId="chart-corr-response-by-type"
        />
      </div>

      <ScheduleBenchmarks permits={filteredPermits} projects={projects} />

      <ReportTable permits={filtered} />
    </div>
  );
}
