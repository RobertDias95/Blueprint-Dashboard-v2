import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import TrendsFilterBar from './TrendsFilterBar';
import {
  DEFAULT_FILTERS,
  buildApprovedSeries,
  buildGoSeries,
  buildSubmittedSeries,
  buildTimelineSeries,
  formatMonthShort,
  getGroupKeys,
  getMonthRange,
  trColor,
  trFilteredPermits,
  type ChartPoint,
  type TrendsFilters,
} from '../../lib/trendsHelpers';

// Q9.5.d: Reports → Trends tab. Filter bar + 4 time-series charts:
//   1. Permits Submitted by Month (bar, count)
//   2. Permits Approved by Month (bar, count)
//   3. Avg Permit Timeline by Month (line, days)
//   4. GOs by Month (bar, distinct addresses)
//
// v1 used Chart.js; v2 uses Recharts (already in deps from Q7.2). Visual
// register matches v1's defaults: legend top, gridded axes, tooltip
// per-month with footer total.

export default function ReportTrendsTab() {
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const typesQ = usePermitTypes();
  const jurisQ = useJurisdictions();
  const teamQ = useTeamMembers();
  const cfgQ = useAppConfig();

  const [filters, setFilters] = useState<TrendsFilters>(DEFAULT_FILTERS);

  function update<K extends keyof TrendsFilters>(key: K, value: TrendsFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const error =
    permitsQ.error ??
    projectsQ.error ??
    typesQ.error ??
    jurisQ.error ??
    teamQ.error ??
    cfgQ.error;
  if (error) {
    return (
      <QueryError
        title="Trends failed to load"
        error={error}
        onRetry={() => {
          permitsQ.refetch();
          projectsQ.refetch();
        }}
      />
    );
  }
  if (
    permitsQ.isLoading ||
    projectsQ.isLoading ||
    typesQ.isLoading ||
    jurisQ.isLoading ||
    teamQ.isLoading ||
    cfgQ.isLoading
  ) {
    return <SkeletonRows count={4} rowClassName="h-60" />;
  }

  const permits = permitsQ.data ?? [];
  const projects = projectsQ.data ?? [];

  const typeOptions = (typesQ.data ?? []).map((t) => t.name);
  const jurisOptions = (jurisQ.data ?? []).map((j) => j.name);
  const entOptions = teamQ.ents.map((m) => m.name);
  const daOptions = teamQ.activeDas.map((m) => m.name);
  const tagOptions = readAppConfigStringArray(cfgQ.map, 'projectTagOptions');

  return (
    <Body
      filters={filters}
      onChange={update}
      onReset={() => setFilters(DEFAULT_FILTERS)}
      permits={permits}
      projects={projects}
      typeOptions={typeOptions}
      jurisOptions={jurisOptions}
      entOptions={entOptions}
      daOptions={daOptions}
      tagOptions={tagOptions}
    />
  );
}

interface BodyProps {
  filters: TrendsFilters;
  onChange: <K extends keyof TrendsFilters>(
    key: K,
    value: TrendsFilters[K],
  ) => void;
  onReset: () => void;
  permits: NonNullable<ReturnType<typeof usePermits>['data']>;
  projects: NonNullable<ReturnType<typeof useProjects>['data']>;
  typeOptions: string[];
  jurisOptions: string[];
  entOptions: string[];
  daOptions: string[];
  tagOptions: string[];
}

function Body({
  filters,
  onChange,
  onReset,
  permits,
  projects,
  typeOptions,
  jurisOptions,
  entOptions,
  daOptions,
  tagOptions,
}: BodyProps) {
  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  const months = useMemo(
    () => getMonthRange(filters, permits),
    [filters, permits],
  );
  const filteredPermits = useMemo(
    () => trFilteredPermits(permits, filters, projectsById),
    [permits, filters, projectsById],
  );
  const groupKeys = useMemo(
    () => getGroupKeys(filteredPermits, filters, projectsById),
    [filteredPermits, filters, projectsById],
  );

  const submittedSeries = useMemo(
    () =>
      buildSubmittedSeries(
        filteredPermits,
        filters,
        projectsById,
        months,
        groupKeys,
      ),
    [filteredPermits, filters, projectsById, months, groupKeys],
  );
  const approvedSeries = useMemo(
    () =>
      buildApprovedSeries(
        filteredPermits,
        filters,
        projectsById,
        months,
        groupKeys,
      ),
    [filteredPermits, filters, projectsById, months, groupKeys],
  );
  const timelineSeries = useMemo(
    () =>
      buildTimelineSeries(
        filteredPermits,
        filters,
        projectsById,
        months,
        groupKeys,
      ),
    [filteredPermits, filters, projectsById, months, groupKeys],
  );
  const goSeries = useMemo(
    () =>
      buildGoSeries(
        filteredPermits,
        filters,
        projectsById,
        months,
        groupKeys,
      ),
    [filteredPermits, filters, projectsById, months, groupKeys],
  );

  return (
    <div className="space-y-4" data-testid="report-trends-tab">
      <TrendsFilterBar
        filters={filters}
        onChange={onChange}
        onReset={onReset}
        typeOptions={typeOptions}
        jurisOptions={jurisOptions}
        entOptions={entOptions}
        daOptions={daOptions}
        tagOptions={tagOptions}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendChartCard
          title="Permits Submitted by Month"
          chartKind="bar"
          series={submittedSeries}
          groupKeys={groupKeys}
          yLabel="# Permits"
          testId="tr-chart-submitted"
        />
        <TrendChartCard
          title="Permits Approved by Month"
          chartKind="bar"
          series={approvedSeries}
          groupKeys={groupKeys}
          yLabel="# Permits"
          testId="tr-chart-approved"
        />
        <TrendChartCard
          title="Avg Permit Timeline by Month"
          subtitle="(submit → approval, days)"
          chartKind="line"
          series={timelineSeries}
          groupKeys={groupKeys}
          yLabel="Avg Days"
          testId="tr-chart-timeline"
        />
        <TrendChartCard
          title="GOs by Month"
          subtitle="(new projects)"
          chartKind="bar"
          series={goSeries}
          groupKeys={groupKeys}
          yLabel="# Projects"
          testId="tr-chart-goes"
        />
      </div>
    </div>
  );
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  chartKind: 'bar' | 'line';
  series: ChartPoint[];
  groupKeys: string[];
  yLabel: string;
  testId: string;
}

function TrendChartCard({
  title,
  subtitle,
  chartKind,
  series,
  groupKeys,
  yLabel,
  testId,
}: ChartCardProps) {
  // Flatten ChartPoint[] into Recharts-friendly shape:
  //   [{ month: 'May 26', Seattle: 4, Bellevue: 1 }, ...]
  const chartData = series.map((p) => {
    const row: Record<string, string | number | null> = {
      month: formatMonthShort(p.month),
    };
    for (const k of groupKeys) row[k] = p.values[k] ?? null;
    return row;
  });

  // Detect "no data" — every value across every month is 0 or null.
  const hasAnyValue = series.some((p) =>
    Object.values(p.values).some((v) => v !== null && v !== 0),
  );

  return (
    <div
      className="bg-surface border border-border rounded-lg p-4"
      data-testid={testId}
    >
      <div className="mb-3 text-[11px] font-extrabold text-text uppercase tracking-wider">
        {title}
        {subtitle && (
          <span className="ml-2 text-[9px] font-normal text-dim normal-case tracking-normal">
            {subtitle}
          </span>
        )}
      </div>
      {!hasAnyValue ? (
        <div className="text-xs text-dim italic text-center py-12">
          No data in the selected range
        </div>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            {chartKind === 'bar' ? (
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: yLabel,
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: '#64748b', fontSize: 10 },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                />
                {groupKeys.length > 1 && (
                  <Legend
                    wrapperStyle={{ fontSize: 9, paddingTop: 4 }}
                  />
                )}
                {groupKeys.map((k, idx) => (
                  <Bar
                    key={k}
                    dataKey={k}
                    fill={trColor(k, idx)}
                    stackId={groupKeys.length > 1 ? 'a' : undefined}
                  />
                ))}
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: yLabel,
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: '#64748b', fontSize: 10 },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                />
                {groupKeys.length > 1 && (
                  <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
                )}
                {groupKeys.map((k, idx) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    stroke={trColor(k, idx)}
                    strokeWidth={2}
                    dot={{ r: 3, fill: trColor(k, idx) }}
                    connectNulls
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
