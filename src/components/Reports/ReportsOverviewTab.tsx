import { useMemo, useState } from 'react';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import {
  computeMetrics,
  enrichPermits,
  filterEnrichedPermits,
  resolveClosedStringRange,
  type ReportFilters,
} from '../../lib/reportMetrics';
import {
  comparisonLabelFor,
  deriveComparisonRange,
} from '../../lib/comparisonCohort';
import { groupAvgBy, groupCountBy } from '../../lib/chartHelpers';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import ReportFilterBar from './ReportFilterBar';
import MetricCards from './MetricCards';
import ComparePresetChips from '../shared/ComparePresetChips';
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
  // fix-115-c: comparison defaults off so the page renders single-cohort
  // exactly as it did pre-fix-115. Opt-in via the new Filter Bar dropdown.
  compareTo: 'off',
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

  // fix-115-c: comparison cohort. Reuses Trends' compareTo semantics —
  // off / previous_period / previous_year — driven by the new filter bar
  // dropdown. Returns null when no comparison is meaningful (range='all'
  // has no temporal anchor; custom with at least one endpoint missing).
  // MetricCards renders single-cohort when comparisonMetrics is null.
  const comparisonRange = useMemo(() => {
    const current = resolveClosedStringRange(filters, today);
    return deriveComparisonRange(current, filters.compareTo);
  }, [filters, today]);

  const comparisonFiltered = useMemo(() => {
    if (!comparisonRange) return null;
    const comparisonFilters: ReportFilters = {
      ...filters,
      range: 'custom',
      dateFrom: comparisonRange.from,
      dateTo: comparisonRange.to,
      // Don't recurse — the comparison cohort itself doesn't have a
      // comparison cohort.
      compareTo: 'off',
    };
    return filterEnrichedPermits(enriched, comparisonFilters, today);
  }, [enriched, filters, today, comparisonRange]);

  const comparisonMetrics = useMemo(
    () =>
      comparisonFiltered === null ? null : computeMetrics(comparisonFiltered),
    [comparisonFiltered],
  );
  const comparisonLabel = useMemo(
    () => comparisonLabelFor(filters.compareTo, comparisonRange),
    [filters.compareTo, comparisonRange],
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

      {/* fix-124-b: one-click comparison presets above the filter bar.
          Each click sets range='custom' + dateFrom/dateTo + compareTo
          in one shot; the underlying ReportFilterBar controls below
          still own arbitrary slicing. */}
      <ComparePresetChips
        currentRange={
          filters.range === 'custom' && filters.dateFrom && filters.dateTo
            ? { from: filters.dateFrom, to: filters.dateTo }
            : null
        }
        compareTo={filters.compareTo}
        today={today}
        onApply={(range, presetCompareTo) =>
          setFilters((prev) => ({
            ...prev,
            range: 'custom',
            dateFrom: range.from,
            dateTo: range.to,
            compareTo: presetCompareTo,
          }))
        }
        testIdPrefix="reports-preset"
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
      />

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

      <ScheduleBenchmarks permits={filteredPermits} projects={projects} />

      <ReportTable permits={filtered} />
    </div>
  );
}
