import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  avgCyclesPerPermit,
  avgIntakeToApproval,
  breakdownByTypeAndJuris,
  defaultDateRange,
  filterPermits,
  intakeToApprovalByMonth,
  SPARSE_GATE,
  submissionToIntakeVariance,
  targetSubmitHitRate,
  totalApprovedInWindow,
  type PerfTrendsFilters,
} from '../lib/perfTrends';

// fix-25-feat-T: Trends — operational performance MVP. Answers Bobby's
// three operational questions:
//   1. Are we getting faster? — line chart of avg intake→approval over time
//   2. Where's time going? — grouped bar of city review vs team turnaround
//   3. Are we hitting target? — KPI tile + per-cohort hit rate column
// Filters (date range / juris / type) persist to URL search params so
// the view is shareable.

const QUICK_RANGES: Array<{
  label: string;
  compute: (now: Date) => { from: string; to: string };
}> = [
  {
    label: 'Last 90 days',
    compute: (now) => {
      const to = now.toISOString().slice(0, 10);
      const fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 90);
      return { from: fromDate.toISOString().slice(0, 10), to };
    },
  },
  {
    label: 'Last 12 months',
    compute: defaultDateRange,
  },
  {
    label: 'YTD',
    compute: (now) => ({
      from: `${now.getFullYear()}-01-01`,
      to: now.toISOString().slice(0, 10),
    }),
  },
  {
    label: 'All time',
    compute: () => ({ from: '2000-01-01', to: '2100-12-31' }),
  },
];

export default function Trends() {
  const permitsQ = usePermits();
  const projectsQ = useProjects();

  const error = permitsQ.error ?? projectsQ.error;
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
  if (permitsQ.isLoading || projectsQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-16" />;
  }

  return (
    <TrendsBody
      permits={permitsQ.data ?? []}
      projects={projectsQ.data ?? []}
    />
  );
}

interface BodyProps {
  permits: import('../lib/database.types').PermitWithCycles[];
  projects: import('../lib/database.types').Project[];
}

function TrendsBody({ permits, projects }: BodyProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = useMemo(() => new Date(), []);
  const defaultRange = useMemo(() => defaultDateRange(today), [today]);

  const filters: PerfTrendsFilters = useMemo(
    () => ({
      dateRange: {
        from: searchParams.get('from') ?? defaultRange.from,
        to: searchParams.get('to') ?? defaultRange.to,
      },
      juris: searchParams.get('juris') || undefined,
      permitType: searchParams.get('type') || undefined,
    }),
    [searchParams, defaultRange],
  );

  function setFilter(patch: Partial<PerfTrendsFilters>) {
    const next = new URLSearchParams(searchParams);
    if (patch.dateRange) {
      next.set('from', patch.dateRange.from);
      next.set('to', patch.dateRange.to);
    }
    if ('juris' in patch) {
      if (patch.juris) next.set('juris', patch.juris);
      else next.delete('juris');
    }
    if ('permitType' in patch) {
      if (patch.permitType) next.set('type', patch.permitType);
      else next.delete('type');
    }
    setSearchParams(next, { replace: true });
  }

  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  const jurisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) if (p.juris) set.add(p.juris);
    return Array.from(set).sort();
  }, [projects]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of permits) if (p.type) set.add(p.type);
    return Array.from(set).sort();
  }, [permits]);

  const filtered = useMemo(
    () => filterPermits(permits, projectsById, filters),
    [permits, projectsById, filters],
  );

  const kpiTotal = totalApprovedInWindow(filtered);
  const kpiAvgClock = avgIntakeToApproval(filtered);
  const kpiAvgCycles = avgCyclesPerPermit(filtered);
  const kpiHitRate = targetSubmitHitRate(filtered);

  const timeSeries = useMemo(
    () => intakeToApprovalByMonth(filtered),
    [filtered],
  );

  const breakdown = useMemo(
    () => breakdownByTypeAndJuris(filtered, projectsById),
    [filtered, projectsById],
  );

  // fix-25-feat-V: aggregate submission → intake variance for the
  // tile + a lookup map for per-row table joining. Helper returns one
  // VarianceRow per (juris × type); the tile weighs avgDays by n.
  const varianceRows = useMemo(
    () => submissionToIntakeVariance(filtered, projectsById),
    [filtered, projectsById],
  );
  const submitToIntakeByCohort = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of varianceRows) {
      m.set(`${v.juris}||${v.type}`, v.avgDaysFromSubmittedToIntakeAccepted);
    }
    return m;
  }, [varianceRows]);
  const kpiSubmitToIntake = useMemo(() => {
    let totalDays = 0;
    let totalN = 0;
    for (const v of varianceRows) {
      totalDays += v.avgDaysFromSubmittedToIntakeAccepted * v.n;
      totalN += v.n;
    }
    if (totalN === 0) return null;
    return { avgDays: Math.round(totalDays / totalN), n: totalN };
  }, [varianceRows]);

  // Chart 2: grouped bar over breakdown rows that have BOTH per-cycle
  // averages populated. Sparse rows still show in the table below.
  const cycleCharts = useMemo(
    () =>
      breakdown
        .filter(
          (r) =>
            r.avgCityReviewPerCycle !== null &&
            r.avgTeamTurnaroundPerCycle !== null,
        )
        .slice(0, 10) // cap to keep the chart readable
        .map((r) => ({
          label: `${r.juris} · ${r.type}`,
          'City review': r.avgCityReviewPerCycle ?? 0,
          'Team turnaround': r.avgTeamTurnaroundPerCycle ?? 0,
          n: r.n,
        })),
    [breakdown],
  );

  type SortKey =
    | 'juris'
    | 'type'
    | 'n'
    | 'avgIntakeToApproval'
    | 'avgCycles'
    | 'avgCityReviewPerCycle'
    | 'avgTeamTurnaroundPerCycle'
    | 'submitToIntake'
    | 'targetHitRate';
  const [sortKey, setSortKey] = useState<SortKey>('n');
  const [sortDesc, setSortDesc] = useState(true);
  /** Resolve the sort field for a row. submitToIntake comes from the
   *  variance map (not a column on BreakdownRow); everything else
   *  reads off the row directly. */
  function sortValue(
    row: (typeof breakdown)[number],
    key: SortKey,
  ): number | string | null {
    if (key === 'submitToIntake') {
      return submitToIntakeByCohort.get(`${row.juris}||${row.type}`) ?? null;
    }
    return row[key];
  }
  const sortedBreakdown = useMemo(() => {
    const arr = [...breakdown];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === bv) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDesc ? bv - av : av - bv;
      }
      return sortDesc
        ? String(bv).localeCompare(String(av))
        : String(av).localeCompare(String(bv));
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, sortKey, sortDesc, submitToIntakeByCohort]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="space-y-4" data-testid="trends-page">
      <div className="text-xl font-extrabold text-text">Trends</div>

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-end gap-3 p-3 rounded-lg border"
        style={{
          background: 'var(--color-s2)',
          borderColor: 'var(--color-border)',
        }}
        data-testid="trends-filter-bar"
      >
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            From
          </span>
          <input
            type="date"
            value={filters.dateRange.from}
            onChange={(e) =>
              setFilter({
                dateRange: { from: e.target.value, to: filters.dateRange.to },
              })
            }
            className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="trends-from"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            To
          </span>
          <input
            type="date"
            value={filters.dateRange.to}
            onChange={(e) =>
              setFilter({
                dateRange: {
                  from: filters.dateRange.from,
                  to: e.target.value,
                },
              })
            }
            className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="trends-to"
          />
        </div>
        <div className="flex items-end gap-1">
          {QUICK_RANGES.map((q) => (
            <button
              key={q.label}
              onClick={() => setFilter({ dateRange: q.compute(today) })}
              className="text-[10px] font-display font-bold px-2 py-1 rounded border bg-surface hover:bg-s3 text-text"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid={`trends-quick-${q.label}`}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            Juris
          </span>
          <select
            value={filters.juris ?? ''}
            onChange={(e) =>
              setFilter({ juris: e.target.value || undefined })
            }
            className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="trends-juris"
          >
            <option value="">All</option>
            {jurisOptions.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            Permit type
          </span>
          <select
            value={filters.permitType ?? ''}
            onChange={(e) =>
              setFilter({ permitType: e.target.value || undefined })
            }
            className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="trends-type"
          >
            <option value="">All</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI tile row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile
          label="Approved permits in window"
          value={kpiTotal === 0 ? '—' : String(kpiTotal)}
          testId="trends-kpi-total"
        />
        <KpiTile
          label="Avg submit → intake delay"
          value={
            kpiSubmitToIntake === null ? '—' : `${kpiSubmitToIntake.avgDays}d`
          }
          sub={
            kpiSubmitToIntake === null
              ? undefined
              : `${kpiSubmitToIntake.n} sample${kpiSubmitToIntake.n === 1 ? '' : 's'}`
          }
          tileTitle="Avg days between team submission (c0.submitted) and city intake acceptance (c0.intake_accepted). Low = team ready + city responsive. High = packet issues / fees / city delay."
          testId="trends-kpi-submit-intake"
        />
        <KpiTile
          label="Avg city clock (intake → approval)"
          value={kpiAvgClock === null ? '—' : `${kpiAvgClock}d`}
          testId="trends-kpi-clock"
        />
        <KpiTile
          label="Avg cycles per permit"
          value={kpiAvgCycles === null ? '—' : kpiAvgCycles.toFixed(1)}
          testId="trends-kpi-cycles"
        />
        <KpiTile
          label="Target submit hit rate"
          value={
            kpiHitRate === null
              ? '—'
              : `${kpiHitRate.hit} of ${kpiHitRate.total} (${Math.round(
                  (kpiHitRate.hit / kpiHitRate.total) * 100,
                )}%)`
          }
          sub={
            kpiHitRate === null
              ? undefined
              : kpiHitRate.avgDaysOff > 0
                ? `avg ${kpiHitRate.avgDaysOff}d late`
                : kpiHitRate.avgDaysOff < 0
                  ? `avg ${Math.abs(kpiHitRate.avgDaysOff)}d early`
                  : 'on time'
          }
          testId="trends-kpi-hitrate"
        />
      </div>

      {/* Chart 1: time series */}
      <ChartCard
        title="Avg city clock by month (intake → approval)"
        testId="trends-chart-clock"
        empty={timeSeries.length === 0}
        emptyLabel="No approved permits in this window"
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={timeSeries}
            margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: 'var(--color-dim)' }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-dim)' }}
              label={{
                value: 'days',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 10, fill: 'var(--color-dim)' },
              }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                fontSize: 11,
              }}
              formatter={(value, _name, item) => {
                const payload = (item as { payload?: { n?: number } } | undefined)
                  ?.payload;
                return [
                  `${value}d · n=${payload?.n ?? 0}`,
                  'Avg city clock',
                ];
              }}
            />
            <Line
              type="monotone"
              dataKey="avgDays"
              stroke="var(--color-pm)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Chart 2: grouped bar — city vs team */}
      <ChartCard
        title="Where's time going? City review vs team turnaround per cycle"
        testId="trends-chart-citytm"
        empty={cycleCharts.length === 0}
        emptyLabel="No multi-cycle permits in this window"
      >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={cycleCharts}
            margin={{ top: 10, right: 20, bottom: 60, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--color-dim)' }}
              angle={-30}
              textAnchor="end"
              height={70}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-dim)' }}
              label={{
                value: 'days/cycle',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 10, fill: 'var(--color-dim)' },
              }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                fontSize: 11,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="City review" fill="var(--color-de)" />
            <Bar dataKey="Team turnaround" fill="var(--color-co)" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Detail table */}
      <div
        className="rounded-lg border overflow-hidden"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
        }}
        data-testid="trends-breakdown-table"
      >
        <div className="px-3 py-2 text-[11px] font-display font-bold text-text border-b" style={{ borderColor: 'var(--color-border)' }}>
          Breakdown — {breakdown.length} cohort{breakdown.length === 1 ? '' : 's'}
        </div>
        <table className="w-full text-[11px]">
          <thead className="bg-s2">
            <tr>
              <Th onClick={() => toggleSort('juris')} active={sortKey === 'juris'} desc={sortDesc}>Juris</Th>
              <Th onClick={() => toggleSort('type')} active={sortKey === 'type'} desc={sortDesc}>Type</Th>
              <Th onClick={() => toggleSort('n')} active={sortKey === 'n'} desc={sortDesc} align="right">n</Th>
              <Th onClick={() => toggleSort('avgIntakeToApproval')} active={sortKey === 'avgIntakeToApproval'} desc={sortDesc} align="right">Avg city clock</Th>
              <Th onClick={() => toggleSort('avgCycles')} active={sortKey === 'avgCycles'} desc={sortDesc} align="right">Avg cycles</Th>
              <Th onClick={() => toggleSort('avgCityReviewPerCycle')} active={sortKey === 'avgCityReviewPerCycle'} desc={sortDesc} align="right">City/cycle</Th>
              <Th onClick={() => toggleSort('avgTeamTurnaroundPerCycle')} active={sortKey === 'avgTeamTurnaroundPerCycle'} desc={sortDesc} align="right">Team/cycle</Th>
              <Th onClick={() => toggleSort('submitToIntake')} active={sortKey === 'submitToIntake'} desc={sortDesc} align="right">Submit→Intake (d)</Th>
              <Th onClick={() => toggleSort('targetHitRate')} active={sortKey === 'targetHitRate'} desc={sortDesc} align="right">Target hit</Th>
            </tr>
          </thead>
          <tbody>
            {sortedBreakdown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-dim italic">
                  No approved permits match the filters
                </td>
              </tr>
            )}
            {sortedBreakdown.map((row) => {
              const sparse = row.n < SPARSE_GATE;
              const submitToIntake = submitToIntakeByCohort.get(
                `${row.juris}||${row.type}`,
              );
              return (
                <tr
                  key={`${row.juris}-${row.type}`}
                  className={`border-t ${sparse ? 'opacity-60' : ''}`}
                  style={{ borderColor: 'var(--color-border)' }}
                  data-testid={`trends-row-${row.juris}-${row.type}`}
                  data-sparse={sparse ? 'true' : undefined}
                >
                  <Td>{row.juris}</Td>
                  <Td>
                    {row.type}
                    {sparse && (
                      <span className="ml-2 text-[9px] uppercase tracking-wide text-dim italic">
                        sparse
                      </span>
                    )}
                  </Td>
                  <Td align="right">{row.n}</Td>
                  <Td align="right">
                    {row.avgIntakeToApproval === null ? '—' : `${row.avgIntakeToApproval}d`}
                  </Td>
                  <Td align="right">
                    {row.avgCycles === null ? '—' : row.avgCycles.toFixed(1)}
                  </Td>
                  <Td align="right">
                    {row.avgCityReviewPerCycle === null ? '—' : `${row.avgCityReviewPerCycle}d`}
                  </Td>
                  <Td align="right">
                    {row.avgTeamTurnaroundPerCycle === null ? '—' : `${row.avgTeamTurnaroundPerCycle}d`}
                  </Td>
                  <Td align="right">
                    {submitToIntake === undefined ? '—' : `${submitToIntake}d`}
                  </Td>
                  <Td align="right">
                    {row.targetHitRate === null
                      ? '—'
                      : `${Math.round(row.targetHitRate * 100)}%`}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  tileTitle,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Hover tooltip on the whole tile — surfaces the metric's definition
   *  / interpretation guidance without bloating the visible label. */
  tileTitle?: string;
  testId?: string;
}) {
  return (
    <div
      className="p-3 rounded-lg border"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
      data-testid={testId}
      title={tileTitle}
    >
      <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
        {label}
      </div>
      <div className="mt-1 text-xl font-extrabold text-text">{value}</div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-muted">{sub}</div>
      )}
    </div>
  );
}

function ChartCard({
  title,
  children,
  empty,
  emptyLabel,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  empty: boolean;
  emptyLabel: string;
  testId?: string;
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
      data-testid={testId}
    >
      <div className="text-[11px] font-display font-bold text-text mb-2">
        {title}
      </div>
      {empty ? (
        <div className="h-40 flex items-center justify-center text-dim italic text-xs">
          {emptyLabel}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  desc,
  align,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  desc: boolean;
  align?: 'right';
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 text-[9px] uppercase tracking-wide font-display font-bold cursor-pointer hover:bg-s3 transition select-none ${
        active ? 'text-de' : 'text-dim'
      } ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
      {active && (
        <span className="ml-1 text-[10px]">{desc ? '▼' : '▲'}</span>
      )}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'right';
}) {
  return (
    <td
      className={`px-3 py-2 text-text ${
        align === 'right' ? 'text-right font-mono' : ''
      }`}
    >
      {children}
    </td>
  );
}
