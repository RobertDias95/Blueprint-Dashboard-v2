import { useMemo, useState } from 'react';
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
import type { PermitWithCycles, Project } from '../lib/database.types';

// Q7.2.b: Reports view rewrite. Drops the Q2 tab shell (Q4 decision —
// v1 had no tabs). Single scrolling page: FilterBar → MetricCards → 4
// charts. Report Table + Schedule Benchmarks + remaining 2 charts land
// in Q7.2.c.

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
    <Body permits={permitsQ.data ?? []} projects={projectsQ.data ?? []} />
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

  // Dropdown options pull from the FULL dataset so they don't mysteriously
  // shrink as the user narrows the filter set.
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

  // Chart data — pure transforms via chartHelpers.
  const permitsByType = useMemo(
    () => groupCountBy(filtered, (e) => e.permit.type),
    [filtered],
  );
  const permitsByJuris = useMemo(
    () => groupCountBy(filtered, (e) => e.juris),
    [filtered],
  );
  const goToSubmitByType = useMemo(
    () =>
      groupAvgBy(
        filtered,
        (e) => e.permit.type,
        (e) => e.goToSubmit,
      ),
    [filtered],
  );
  const scheduleVarianceByType = useMemo(
    () =>
      groupAvgBy(
        filtered,
        (e) => e.permit.type,
        // v1 uses ABS variance for the chart (line 5533) — magnitude of
        // schedule deviation, signed-direction shown in the metric card.
        (e) => (e.variance === null ? null : Math.abs(e.variance)),
      ),
    [filtered],
  );

  function update<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }
  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  return (
    <div className="space-y-4" data-testid="reports-page">
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
      </div>
    </div>
  );
}
