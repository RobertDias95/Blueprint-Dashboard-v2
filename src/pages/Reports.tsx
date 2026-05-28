import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import {
  computeMetrics,
  enrichPermits,
  filterEnrichedPermits,
  type ReportFilters,
} from '../lib/reportMetrics';
import { groupAvgBy, groupCountBy } from '../lib/chartHelpers';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ReportFilterBar from '../components/Reports/ReportFilterBar';
import MetricCards from '../components/Reports/MetricCards';
import BarChartCard from '../components/Reports/BarChartCard';
import ReportTable from '../components/Reports/ReportTable';
import ScheduleBenchmarks from '../components/Reports/ScheduleBenchmarks';
import { exportEnrichedPermitsToCSV } from '../lib/csvExport';
import { pushToast } from '../stores/toastStore';
import type { PermitWithCycles, Project } from '../lib/database.types';

// Q7.2.b: Reports view. FilterBar → MetricCards → 6 charts → Benchmarks → Table.
// Q9.5.d: page header restyle + Export CSV button.
// fix-25-feat-BB: the Overview/Trends sub-tab bar was removed — the
// v1-parity Trends time-series merged into the top-level Trends page
// alongside the operational KPIs. Reports now renders the overview
// content directly with no sub-tab switch.

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
  search: '',
};

export default function Reports() {
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

  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  const enriched = useMemo(
    () => enrichPermits(permits, projectsById),
    [permits, projectsById],
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
    const set = new Set<string>();
    for (const e of enriched) if (e.productType) set.add(e.productType);
    return Array.from(set).sort();
  }, [enriched]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) for (const t of e.projectTags) set.add(t);
    return Array.from(set).sort();
  }, [enriched]);

  const filtered = useMemo(
    () => filterEnrichedPermits(enriched, filters, today),
    [enriched, filters, today],
  );

  const metrics = useMemo(() => computeMetrics(filtered), [filtered]);

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
    () => groupAvgBy(filtered, (e) => e.juris, (e) => e.cityReviewDays),
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
      {/* Q9.5.d: header restyle — "Reports & Metrics" title + Export CSV
          top-right + Overview/Trends sub-tab bar below */}
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

      {/* fix-67: Saved Reports — the minimal hub shape. Phase 2 generalizes
          this into categorized folders + a freeform builder. For now a
          single flagship report card. */}
      <div data-testid="saved-reports">
        <div className="text-[11px] font-extrabold uppercase tracking-wider text-dim mb-2">
          Saved Reports
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Link
            to="/reports/weekly-da"
            className="block rounded-lg border bg-surface p-3 hover:bg-s2 transition"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="report-card-weekly-da"
          >
            <div className="text-sm font-bold text-text mb-0.5">
              Weekly DA Update
            </div>
            <div className="text-[11px] text-muted leading-snug">
              Per-DA one-pager: permits in corrections (with the date
              corrections came out), carry-forward notes, and upcoming
              intakes for the week. Printable / send-ready.
            </div>
          </Link>
        </div>
      </div>

      <ReportFilterBar
        filters={filters}
        onChange={update}
        onClear={clearFilters}
        typeOptions={typeOptions}
        jurisOptions={jurisOptions}
        entOptions={entOptions}
        productTypeOptions={productTypeOptions}
        tagOptions={tagOptions}
        resultCount={filtered.length}
      />

      <MetricCards metrics={metrics} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BarChartCard
          title="Permits by Type"
          data={permitsByType}
          color="jv"
          showAverage={false}
          testId="chart-permits-by-type"
        />
        <BarChartCard
          title="Permits by Jurisdiction"
          data={permitsByJuris}
          color="is"
          showAverage={false}
          testId="chart-permits-by-juris"
        />
        <BarChartCard
          title="GO → Submit (avg days by type)"
          data={goToSubmitByType}
          color="de"
          unit="d"
          testId="chart-go-to-submit-by-type"
        />
        <BarChartCard
          title="Schedule Variance by Type (avg days off)"
          data={scheduleVarianceByType}
          color="co"
          unit="d"
          emptyState="No issued permits yet"
          testId="chart-schedule-variance-by-type"
        />
        <BarChartCard
          title="City Review by Jurisdiction (avg days)"
          data={cityReviewByJuris}
          color="pm"
          unit="d"
          emptyState="No completed reviews yet"
          testId="chart-city-review-by-juris"
        />
        <BarChartCard
          title="Correction Response by Type (avg days)"
          data={corrResponseByType}
          color="overdue"
          unit="d"
          emptyState="No correction rounds completed yet"
          testId="chart-corr-response-by-type"
        />
      </div>

      <ScheduleBenchmarks permits={permits} projects={projects} />

      <ReportTable permits={filtered} />
    </div>
  );
}
