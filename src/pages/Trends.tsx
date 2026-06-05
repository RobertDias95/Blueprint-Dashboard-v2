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
import { usePermitTypes } from '../hooks/usePermitTypes';
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
import {
  buildApprovedSeries,
  buildGoSeries,
  buildSubmittedSeries,
  buildTimelineSeries,
  DEFAULT_FILTERS as TR_DEFAULT_FILTERS,
  formatMonthShort,
  getGroupKeys,
  getMonthRange,
  trColor,
  trFilteredPermits,
  type ChartPoint,
  type TrendsFilters as TrTrendsFilters,
} from '../lib/trendsHelpers';
import {
  anchorFor,
  computeLearnedTargetSubmit,
  HARDCODED_TARGET_SUBMIT_OFFSETS,
  type TargetSubmitAnchor,
} from '../lib/targetSubmitLearner';
import type { RecencyTier } from '../lib/scheduleBenchmarks';
import {
  comparisonLabelFor,
  deriveComparisonRange,
  type CompareMode,
} from '../lib/comparisonCohort';
import {
  ComparisonRow,
  type ComparisonDirection,
} from '../components/shared/ComparisonRow';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-25-feat-T → V → BB: Trends — operational performance + volume +
// learned target_submit, merged into one sectioned surface. Replaces
// the legacy Reports → Trends sub-tab. Sections (scrolling):
//   - Filter bar (date / juris / type)
//   - KPI tile row (5 tiles)
//   - § Volume — 4 v1-parity charts (submit / approved / timeline / GOs)
//   - § City performance — intake→approval over time + city vs team
//   - § Variance — submit→intake + target hit summary tiles
//   - § Target Submit — learned anchor→submit per (juris × type)
//   - § Breakdown — unified per-cohort detail table
// Card style mirrors the old Reports → Trends sub-tab (bg-surface +
// border-border + uppercase-tracking title) that Bobby liked.

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
  const typesQ = usePermitTypes();

  const error = permitsQ.error ?? projectsQ.error ?? typesQ.error;
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
  if (permitsQ.isLoading || projectsQ.isLoading || typesQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-16" />;
  }

  return (
    <TrendsBody
      permits={permitsQ.data ?? []}
      projects={projectsQ.data ?? []}
      catalogTypes={(typesQ.data ?? []).map((t) => t.name)}
    />
  );
}

interface BodyProps {
  permits: PermitWithCycles[];
  projects: Project[];
  catalogTypes: string[];
}

function TrendsBody({ permits, projects, catalogTypes }: BodyProps) {
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

  // fix-114: period-comparison mode. Defaults to 'off'. Persisted via the
  // `compare` URL param alongside the other filters. Invalid values from
  // shared URLs collapse to 'off' so a stale link can't render bogus
  // comparison numbers.
  const compareTo: CompareMode = useMemo(() => {
    const raw = searchParams.get('compare');
    if (raw === 'previous_period' || raw === 'previous_year') return raw;
    return 'off';
  }, [searchParams]);

  function setFilter(patch: Partial<PerfTrendsFilters> & { compareTo?: CompareMode }) {
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
    if ('compareTo' in patch && patch.compareTo !== undefined) {
      if (patch.compareTo === 'off') next.delete('compare');
      else next.set('compare', patch.compareTo);
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

  // ----- Performance helpers (perfTrends) -----
  // fix-114: `filteredCurrent` is the active cohort (everything below uses
  // it). `filteredComparison` is the parallel cohort produced by swapping
  // only the date range — every other filter (juris / type / status etc.)
  // is identical so the comparison is apples-to-apples. Comparison is
  // null when compareTo='off'.
  const filteredCurrent = useMemo(
    () => filterPermits(permits, projectsById, filters),
    [permits, projectsById, filters],
  );

  const comparisonRange = useMemo(
    () => deriveComparisonRange(filters.dateRange, compareTo),
    [filters.dateRange, compareTo],
  );

  const filteredComparison = useMemo(() => {
    if (!comparisonRange) return null;
    return filterPermits(permits, projectsById, {
      ...filters,
      dateRange: comparisonRange,
    });
  }, [comparisonRange, permits, projectsById, filters]);

  const kpiTotal = totalApprovedInWindow(filteredCurrent);
  const kpiAvgClock = avgIntakeToApproval(filteredCurrent);
  const kpiAvgCycles = avgCyclesPerPermit(filteredCurrent);
  const kpiHitRate = targetSubmitHitRate(filteredCurrent);

  // fix-114: same 4 KPIs on the comparison cohort. Each returns null
  // when no permits qualify in the prior window — KpiTile renders
  // "no comparison data" in that case rather than a misleading delta.
  const cmpTotal = filteredComparison
    ? totalApprovedInWindow(filteredComparison)
    : null;
  const cmpAvgClock = filteredComparison
    ? avgIntakeToApproval(filteredComparison)
    : null;
  const cmpAvgCycles = filteredComparison
    ? avgCyclesPerPermit(filteredComparison)
    : null;
  const cmpHitRate = filteredComparison
    ? targetSubmitHitRate(filteredComparison)
    : null;

  // fix-114: timeline / breakdown / variance + the chart series + Volume +
  // Target Submit all consume `filteredCurrent` only. Comparison is a KPI-row
  // only feature for this PR. fix-115+ extends comparison into chart series.
  const timeSeries = useMemo(
    () => intakeToApprovalByMonth(filteredCurrent),
    [filteredCurrent],
  );

  const breakdown = useMemo(
    () => breakdownByTypeAndJuris(filteredCurrent, projectsById),
    [filteredCurrent, projectsById],
  );

  const varianceRows = useMemo(
    () => submissionToIntakeVariance(filteredCurrent, projectsById),
    [filteredCurrent, projectsById],
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

  // fix-114: parallel weighted-avg on the comparison cohort.
  const cmpSubmitToIntake = useMemo(() => {
    if (!filteredComparison) return null;
    const rows = submissionToIntakeVariance(filteredComparison, projectsById);
    let totalDays = 0;
    let totalN = 0;
    for (const v of rows) {
      totalDays += v.avgDaysFromSubmittedToIntakeAccepted * v.n;
      totalN += v.n;
    }
    if (totalN === 0) return null;
    return { avgDays: Math.round(totalDays / totalN), n: totalN };
  }, [filteredComparison, projectsById]);

  const cycleCharts = useMemo(
    () =>
      breakdown
        .filter(
          (r) =>
            r.avgCityReviewPerCycle !== null &&
            r.avgTeamTurnaroundPerCycle !== null,
        )
        .slice(0, 10)
        .map((r) => ({
          label: `${r.juris} · ${r.type}`,
          'City review': r.avgCityReviewPerCycle ?? 0,
          'Team turnaround': r.avgTeamTurnaroundPerCycle ?? 0,
          n: r.n,
        })),
    [breakdown],
  );

  // fix-118: City performance comparison series. Both charts in this
  // section (clock + citytm) get the same overlay treatment as fix-116's
  // Volume charts: comparison data is computed on filteredComparison
  // using the SAME helpers as current, then merged into the chart data
  // arrays so a second dashed/translucent series can render alongside
  // the solid current series. Legend strips reuse the local
  // ComparisonLegendStrip helper extracted in fix-116.
  const cmpTimeSeries = useMemo(
    () => (filteredComparison ? intakeToApprovalByMonth(filteredComparison) : null),
    [filteredComparison],
  );

  const cmpBreakdown = useMemo(
    () =>
      filteredComparison
        ? breakdownByTypeAndJuris(filteredComparison, projectsById)
        : null,
    [filteredComparison, projectsById],
  );

  const cmpCycleCharts = useMemo(() => {
    if (!cmpBreakdown) return null;
    return cmpBreakdown
      .filter(
        (r) =>
          r.avgCityReviewPerCycle !== null &&
          r.avgTeamTurnaroundPerCycle !== null,
      )
      .map((r) => ({
        label: `${r.juris} · ${r.type}`,
        'City review': r.avgCityReviewPerCycle ?? 0,
        'Team turnaround': r.avgTeamTurnaroundPerCycle ?? 0,
        n: r.n,
      }));
  }, [cmpBreakdown]);

  // Bucket-aligned merged data for the clock LineChart. Per fix-116's
  // policy, comparison values are re-indexed by bucket ORDER (not
  // calendar month) — the comparison's May 2026 row maps to the same x
  // position as the current's Jun 2026 row. Tooltip discloses the
  // comparison's actual month so the re-index is never silent.
  const clockChartData = useMemo(() => {
    return timeSeries.map((p, i) => ({
      month: p.month,
      avgDays: p.avgDays,
      n: p.n,
      cmpAvgDays: cmpTimeSeries?.[i]?.avgDays ?? null,
      cmpMonth: cmpTimeSeries?.[i]?.month ?? null,
      cmpN: cmpTimeSeries?.[i]?.n ?? null,
    }));
  }, [timeSeries, cmpTimeSeries]);

  // Category union for the citytm chart. Current's labels lead (preserves
  // the existing rank order); cmp-only labels are appended at the bottom.
  // Mirrors fix-117's BarChartCard union policy.
  type CycleChartRow = {
    label: string;
    'City review': number | null;
    'Team turnaround': number | null;
    n: number | null;
    'City review (cmp)': number | null;
    'Team turnaround (cmp)': number | null;
    cmpN: number | null;
  };
  const cycleChartsUnion: CycleChartRow[] = useMemo(() => {
    if (!cmpCycleCharts) {
      return cycleCharts.map((r) => ({
        label: r.label,
        'City review': r['City review'],
        'Team turnaround': r['Team turnaround'],
        n: r.n,
        'City review (cmp)': null,
        'Team turnaround (cmp)': null,
        cmpN: null,
      }));
    }
    const cmpByLabel = new Map(cmpCycleCharts.map((r) => [r.label, r] as const));
    const currentLabels = cycleCharts.map((r) => r.label);
    const cmpOnlyLabels = cmpCycleCharts
      .map((r) => r.label)
      .filter((l) => !cycleCharts.some((r) => r.label === l));
    const orderedLabels = [...currentLabels, ...cmpOnlyLabels];
    return orderedLabels.map((label) => {
      const cur = cycleCharts.find((r) => r.label === label);
      const cmp = cmpByLabel.get(label);
      return {
        label,
        'City review': cur?.['City review'] ?? null,
        'Team turnaround': cur?.['Team turnaround'] ?? null,
        n: cur?.n ?? null,
        'City review (cmp)': cmp?.['City review'] ?? null,
        'Team turnaround (cmp)': cmp?.['Team turnaround'] ?? null,
        cmpN: cmp?.n ?? null,
      };
    });
  }, [cycleCharts, cmpCycleCharts]);

  // ----- Volume helpers (trendsHelpers, v1-parity) -----
  //
  // fix-110: the Volume section now honors the page's Type + Juris
  // filters in addition to the date range. Pre-fix it only inherited
  // dateRange (v1 carry-over rationale: "Volume is a context overview
  // — all types, all jurises, grouped by juris"). That contradicted
  // the page's filter UI: Bobby picked Type=Building Permit + saw a
  // timeline chart that included Demolitions / PAR / SDOT Tree, with
  // Seattle reading 81d in June '26 (n=2 mixed-type) vs. the actual
  // BP value of 155d in that bucket / 127d all-time. Filter UI now
  // matches what the chart shows.
  //
  // Group stays 'jurisdiction' — the Volume series is still colored
  // by juris (Seattle / Bellevue / etc.). When filters.juris narrows
  // to one city, getGroupKeys returns just that one series.
  //
  // Convert the page's PerfTrendsFilters → trendsHelpers TrendsFilters
  // via a custom-range adapter — no new helpers, just a shape bridge.
  const volumeFilters: TrTrendsFilters = useMemo(
    () => ({
      ...TR_DEFAULT_FILTERS,
      range: 'custom',
      dateFrom: filters.dateRange.from.slice(0, 7),
      dateTo: filters.dateRange.to.slice(0, 7),
      type: filters.permitType ?? '',
      juris: filters.juris ?? '',
      group: 'jurisdiction',
    }),
    [filters.dateRange, filters.permitType, filters.juris],
  );
  const volumeMonths = useMemo(
    () => getMonthRange(volumeFilters, permits, projectsById, today),
    [volumeFilters, permits, projectsById, today],
  );
  const volumeFiltered = useMemo(
    () => trFilteredPermits(permits, volumeFilters, projectsById),
    [permits, volumeFilters, projectsById],
  );
  const volumeGroupKeys = useMemo(
    () => getGroupKeys(volumeFiltered, volumeFilters, projectsById),
    [volumeFiltered, volumeFilters, projectsById],
  );
  const submittedSeries = useMemo(
    () =>
      buildSubmittedSeries(
        volumeFiltered,
        volumeFilters,
        projectsById,
        volumeMonths,
        volumeGroupKeys,
      ),
    [volumeFiltered, volumeFilters, projectsById, volumeMonths, volumeGroupKeys],
  );
  const approvedSeries = useMemo(
    () =>
      buildApprovedSeries(
        volumeFiltered,
        volumeFilters,
        projectsById,
        volumeMonths,
        volumeGroupKeys,
      ),
    [volumeFiltered, volumeFilters, projectsById, volumeMonths, volumeGroupKeys],
  );
  const timelineSeries = useMemo(
    () =>
      buildTimelineSeries(
        volumeFiltered,
        volumeFilters,
        projectsById,
        volumeMonths,
        volumeGroupKeys,
      ),
    [volumeFiltered, volumeFilters, projectsById, volumeMonths, volumeGroupKeys],
  );
  const goSeries = useMemo(
    () =>
      buildGoSeries(
        volumeFiltered,
        volumeFilters,
        projectsById,
        volumeMonths,
        volumeGroupKeys,
      ),
    [volumeFiltered, volumeFilters, projectsById, volumeMonths, volumeGroupKeys],
  );

  // fix-116: Volume + Timeline comparison series. Same four helpers run
  // against `comparisonRange` swapped in for the Volume filter's dateFrom/
  // dateTo. Group keys come from the CURRENT cohort so the chart color
  // alignment matches the current bars (otherwise a juris that only
  // appears in the prior period would render under a different color
  // index). Bucket positions are taken from the current period; the
  // comparison series is re-indexed by bucket order in TrendChartCard
  // (e.g., current Jun 2026 bucket carries the comparison's May 2026
  // value at the same x position). Tooltip discloses the actual cmp
  // month so the re-index is never silent.
  const volumeComparisonFilters: TrTrendsFilters | null = useMemo(() => {
    if (!comparisonRange) return null;
    return {
      ...volumeFilters,
      dateFrom: comparisonRange.from.slice(0, 7),
      dateTo: comparisonRange.to.slice(0, 7),
    };
  }, [volumeFilters, comparisonRange]);

  const volumeComparisonMonths = useMemo(() => {
    if (!volumeComparisonFilters) return [];
    return getMonthRange(volumeComparisonFilters, permits, projectsById, today);
  }, [volumeComparisonFilters, permits, projectsById, today]);

  const volumeComparisonFiltered = useMemo(() => {
    if (!volumeComparisonFilters) return null;
    return trFilteredPermits(permits, volumeComparisonFilters, projectsById);
  }, [permits, volumeComparisonFilters, projectsById]);

  const cmpSubmittedSeries = useMemo(() => {
    if (!volumeComparisonFiltered || !volumeComparisonFilters) return null;
    return buildSubmittedSeries(
      volumeComparisonFiltered,
      volumeComparisonFilters,
      projectsById,
      volumeComparisonMonths,
      volumeGroupKeys,
    );
  }, [
    volumeComparisonFiltered,
    volumeComparisonFilters,
    projectsById,
    volumeComparisonMonths,
    volumeGroupKeys,
  ]);

  const cmpApprovedSeries = useMemo(() => {
    if (!volumeComparisonFiltered || !volumeComparisonFilters) return null;
    return buildApprovedSeries(
      volumeComparisonFiltered,
      volumeComparisonFilters,
      projectsById,
      volumeComparisonMonths,
      volumeGroupKeys,
    );
  }, [
    volumeComparisonFiltered,
    volumeComparisonFilters,
    projectsById,
    volumeComparisonMonths,
    volumeGroupKeys,
  ]);

  const cmpTimelineSeries = useMemo(() => {
    if (!volumeComparisonFiltered || !volumeComparisonFilters) return null;
    return buildTimelineSeries(
      volumeComparisonFiltered,
      volumeComparisonFilters,
      projectsById,
      volumeComparisonMonths,
      volumeGroupKeys,
    );
  }, [
    volumeComparisonFiltered,
    volumeComparisonFilters,
    projectsById,
    volumeComparisonMonths,
    volumeGroupKeys,
  ]);

  const cmpGoSeries = useMemo(() => {
    if (!volumeComparisonFiltered || !volumeComparisonFilters) return null;
    return buildGoSeries(
      volumeComparisonFiltered,
      volumeComparisonFilters,
      projectsById,
      volumeComparisonMonths,
      volumeGroupKeys,
    );
  }, [
    volumeComparisonFiltered,
    volumeComparisonFilters,
    projectsById,
    volumeComparisonMonths,
    volumeGroupKeys,
  ]);

  // Short range labels for chart legend strips. Show year only when it
  // differs from the comparison's year (compact display for in-year
  // comparisons like "Jun 2026 vs May 2026").
  const volumeCurrentRangeLabel = useMemo(() => {
    const from = filters.dateRange.from;
    const to = filters.dateRange.to;
    if (!from || !to) return '';
    return from === to ? from : `${from} – ${to}`;
  }, [filters.dateRange]);

  const volumeComparisonRangeLabel = useMemo(() => {
    if (!comparisonRange) return '';
    return comparisonRange.from === comparisonRange.to
      ? comparisonRange.from
      : `${comparisonRange.from} – ${comparisonRange.to}`;
  }, [comparisonRange]);

  // ----- Target Submit rows (fix-25-feat-AA) -----
  //
  // One row per (juris × catalog type) for non-mirror anchors. Respects
  // the global juris / type filter so the table narrows alongside the
  // rest of the page. Empty cohort still surfaces — source='default'
  // and the hardcoded fallback value get shown so the team sees what
  // the engine will produce when no signal exists.
  const targetSubmitRows = useMemo(
    () =>
      buildTargetSubmitRows(
        permits,
        projectsById,
        catalogTypes,
        jurisOptions,
        filters,
        today,
      ),
    [permits, projectsById, catalogTypes, jurisOptions, filters, today],
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

        {/* fix-114: period-comparison dropdown. Sits beside the date range
            so the spatial cue says "this control modifies date". Activates
            the KPI row's dual-value rendering — every other section stays
            single-cohort for this PR (charts in fix-115+). */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            Compare to
          </span>
          <select
            value={compareTo}
            onChange={(e) =>
              setFilter({ compareTo: e.target.value as CompareMode })
            }
            className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="trends-compare"
          >
            <option value="off">Off</option>
            <option value="previous_period">Previous period</option>
            <option value="previous_year">Previous year</option>
          </select>
        </div>
      </div>

      {/* fix-114: inline hint when comparison is requested without a date
          range. In the current Trends UI from/to always have a default value,
          so this is a safety guard rather than a user-visible path; renders
          only if both endpoints are missing. */}
      {compareTo !== 'off' && (!filters.dateRange.from || !filters.dateRange.to) && (
        <div
          className="text-[10px] text-co italic px-1"
          data-testid="trends-compare-hint"
        >
          Set a Date range to enable comparison.
        </div>
      )}

      {/* fix-112-c: the KPI row + City performance + Variance + Breakdown
          sections all route through filterPermits (perfTrends.ts:46-63),
          which silently restricts the cohort to permits with approval_date
          or actual_issue stamped. Volume + Target Submit sections do not.
          Make the gate visible so a user adjusting filters knows they're
          looking at finished work, not team activity. */}
      <div
        className="text-[11px] text-dim italic px-1"
        data-testid="trends-approved-only-banner"
      >
        Showing approved permits only — in-progress activity is not included
        in the KPI row, City performance, Variance, or Breakdown sections.
      </div>

      {/* KPI tile row */}
      {(() => {
        // fix-114: shared comparison label / pct-of-hit-rate helpers — kept
        // inline so the props passed to each KpiTile read top-to-bottom.
        const cmpLabel = comparisonLabelFor(compareTo, comparisonRange);
        const hitRatePct = (rate: typeof kpiHitRate): number | null =>
          rate === null || rate.total === 0
            ? null
            : Math.round((rate.hit / rate.total) * 100);
        const hitRateText = (rate: typeof kpiHitRate): string =>
          rate === null
            ? '—'
            : `${rate.hit} of ${rate.total} (${Math.round(
                (rate.hit / rate.total) * 100,
              )}%)`;
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile
              label="Approved permits in window"
              value={kpiTotal === 0 ? '—' : String(kpiTotal)}
              testId="trends-kpi-total"
              currentNumeric={kpiTotal}
              comparisonNumeric={cmpTotal}
              comparisonValueText={
                cmpTotal === null ? undefined : String(cmpTotal)
              }
              comparisonLabel={cmpLabel || undefined}
              direction="higher_better"
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
              currentNumeric={kpiSubmitToIntake?.avgDays ?? null}
              comparisonNumeric={cmpSubmitToIntake?.avgDays ?? null}
              comparisonValueText={
                cmpSubmitToIntake === null ? undefined : `${cmpSubmitToIntake.avgDays}d`
              }
              comparisonLabel={cmpLabel || undefined}
              direction="lower_better"
            />
            <KpiTile
              label="Avg city clock (intake → approval)"
              value={kpiAvgClock === null ? '—' : `${kpiAvgClock}d`}
              testId="trends-kpi-clock"
              currentNumeric={kpiAvgClock}
              comparisonNumeric={cmpAvgClock}
              comparisonValueText={
                cmpAvgClock === null ? undefined : `${cmpAvgClock}d`
              }
              comparisonLabel={cmpLabel || undefined}
              direction="lower_better"
            />
            <KpiTile
              label="Avg cycles per permit"
              value={kpiAvgCycles === null ? '—' : kpiAvgCycles.toFixed(1)}
              testId="trends-kpi-cycles"
              currentNumeric={kpiAvgCycles}
              comparisonNumeric={cmpAvgCycles}
              comparisonValueText={
                cmpAvgCycles === null ? undefined : cmpAvgCycles.toFixed(1)
              }
              comparisonLabel={cmpLabel || undefined}
              direction="lower_better"
            />
            <KpiTile
              label="Target submit hit rate"
              value={hitRateText(kpiHitRate)}
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
              currentNumeric={hitRatePct(kpiHitRate)}
              comparisonNumeric={hitRatePct(cmpHitRate)}
              comparisonValueText={
                cmpHitRate === null ? undefined : hitRateText(cmpHitRate)
              }
              comparisonLabel={cmpLabel || undefined}
              direction="higher_better"
            />
          </div>
        );
      })()}

      {/* § Volume */}
      <Section
        title="Volume"
        // fix-112-c: drop the stale "juris/type filters do not" parenthetical
        // (post-fix-110 they DO apply). Replace with the in-progress carve-out
        // so the contrast with the surrounding approved-only sections is
        // explicit — Volume is the one place on this page that surfaces
        // permits regardless of approval.
        subtitle="Permit activity over time — includes in-progress permits (no approval gate)"
        testId="trends-section-volume"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TrendChartCard
            title="Permits Submitted by Month"
            chartKind="bar"
            series={submittedSeries}
            groupKeys={volumeGroupKeys}
            yLabel="# Permits"
            testId="tr-chart-submitted"
            comparisonSeries={cmpSubmittedSeries}
            currentLabel={volumeCurrentRangeLabel}
            comparisonLabel={volumeComparisonRangeLabel}
          />
          <TrendChartCard
            title="Permits Approved by Month"
            chartKind="bar"
            series={approvedSeries}
            groupKeys={volumeGroupKeys}
            yLabel="# Permits"
            testId="tr-chart-approved"
            comparisonSeries={cmpApprovedSeries}
            currentLabel={volumeCurrentRangeLabel}
            comparisonLabel={volumeComparisonRangeLabel}
          />
          <TrendChartCard
            title="Avg Permit Timeline by Month"
            // fix-110: subtitle pedantic-but-honest. The endpoint is
            // COALESCE(approval_date, actual_issue) — for permits with
            // only actual_issue stamped (no approval_date), the chart
            // uses issue. Silent today for Seattle BPs (none are
            // issue-only) but visible elsewhere.
            subtitle="(submit → approval/issue, days)"
            chartKind="line"
            series={timelineSeries}
            groupKeys={volumeGroupKeys}
            yLabel="Avg Days"
            testId="tr-chart-timeline"
            comparisonSeries={cmpTimelineSeries}
            currentLabel={volumeCurrentRangeLabel}
            comparisonLabel={volumeComparisonRangeLabel}
          />
          <TrendChartCard
            title="GOs by Month"
            subtitle="(new projects)"
            chartKind="bar"
            series={goSeries}
            groupKeys={volumeGroupKeys}
            yLabel="# Projects"
            testId="tr-chart-goes"
            comparisonSeries={cmpGoSeries}
            currentLabel={volumeCurrentRangeLabel}
            comparisonLabel={volumeComparisonRangeLabel}
          />
        </div>
      </Section>

      {/* § City performance */}
      <Section title="City performance" testId="trends-section-city">
        {/* fix-118: legend strip lives OUTSIDE ChartCard so it renders
            even when the inner chart is in its empty state. ChartCard
            gates `children` on its `empty` prop; nesting the legend inside
            would hide it when the comparison cohort is the only one with
            data (or both are empty but the user still expects the legend
            disclosure). */}
        {cmpTimeSeries && (
          <ComparisonLegendStrip
            chartKind="line"
            currentLabel={volumeCurrentRangeLabel}
            comparisonLabel={volumeComparisonRangeLabel}
            comparisonHasData={cmpTimeSeries.some((p) => p.avgDays !== null)}
            testId="trends-chart-clock-cmp-legend"
          />
        )}
        <ChartCard
          title="Avg city clock by month (intake → approval)"
          testId="trends-chart-clock"
          empty={timeSeries.length === 0 && !cmpTimeSeries?.length}
          emptyLabel="No approved permits in this window"
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={clockChartData}
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
                formatter={(value, name, item) => {
                  const payload = (
                    item as { payload?: { n?: number; cmpN?: number; cmpMonth?: string } } | undefined
                  )?.payload;
                  if (name === 'cmpAvgDays') {
                    const cmpMonth = payload?.cmpMonth
                      ? ` (${payload.cmpMonth})`
                      : '';
                    return [
                      `${value}d · n=${payload?.cmpN ?? 0}`,
                      `Prev clock${cmpMonth}`,
                    ];
                  }
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
              {cmpTimeSeries && (
                <Line
                  type="monotone"
                  dataKey="cmpAvgDays"
                  stroke="var(--color-pm)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                  dot={{ r: 2, fillOpacity: 0.6 }}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* fix-118: same out-of-ChartCard pattern as the clock legend
            above — keeps the disclosure visible across the empty state. */}
        {cmpCycleCharts && (
          <ComparisonLegendStrip
            chartKind="bar"
            currentLabel={volumeCurrentRangeLabel}
            comparisonLabel={volumeComparisonRangeLabel}
            comparisonHasData={cmpCycleCharts.length > 0}
            testId="trends-chart-citytm-cmp-legend"
          />
        )}
        <ChartCard
          title="Where's time going? City review vs team turnaround per cycle"
          testId="trends-chart-citytm"
          empty={cycleChartsUnion.length === 0}
          emptyLabel="No multi-cycle permits in this window"
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={cycleChartsUnion}
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
              {cmpCycleCharts && (
                <>
                  <Bar
                    dataKey="City review (cmp)"
                    fill="var(--color-de)"
                    fillOpacity={0.35}
                    stroke="var(--color-de)"
                    strokeDasharray="2 2"
                    strokeWidth={1}
                  />
                  <Bar
                    dataKey="Team turnaround (cmp)"
                    fill="var(--color-co)"
                    fillOpacity={0.35}
                    stroke="var(--color-co)"
                    strokeDasharray="2 2"
                    strokeWidth={1}
                  />
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      {/* § Variance */}
      <Section
        title="Variance"
        subtitle="Slippage between plan and reality"
        testId="trends-section-variance"
      >
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-xs text-muted leading-relaxed">
            <strong className="text-text">Submit → Intake</strong>: gap between
            team submission (<code className="text-[10px]">c0.submitted</code>) and
            city intake acceptance. Captures packet quality + city responsiveness.
            Window weighted avg:{' '}
            <strong className="text-text">
              {kpiSubmitToIntake === null
                ? '—'
                : `${kpiSubmitToIntake.avgDays}d (n=${kpiSubmitToIntake.n})`}
            </strong>
            .
          </p>
          <p className="text-xs text-muted leading-relaxed mt-2">
            <strong className="text-text">Target hit rate</strong>: how often
            actual submission lands on or before the engine-derived
            target_submit. Window:{' '}
            <strong className="text-text">
              {kpiHitRate === null
                ? '—'
                : `${kpiHitRate.hit} of ${kpiHitRate.total} (${Math.round(
                    (kpiHitRate.hit / kpiHitRate.total) * 100,
                  )}%); ${
                    kpiHitRate.avgDaysOff > 0
                      ? `avg ${kpiHitRate.avgDaysOff}d late`
                      : kpiHitRate.avgDaysOff < 0
                        ? `avg ${Math.abs(kpiHitRate.avgDaysOff)}d early`
                        : 'on time'
                  }`}
            </strong>
            . Per-cohort detail in the Breakdown table below.
          </p>
        </div>
      </Section>

      {/* § Target Submit (fix-25-feat-AA) */}
      <Section
        title="Target Submit — Team prep time per anchor"
        subtitle="Learned days from each anchor (DD end / go-date / BP cycle dates) to c0.submitted, per (juris × type)"
        testId="trends-section-target-submit"
      >
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-s2">
              <tr>
                <TargetTh align="left">Juris</TargetTh>
                <TargetTh align="left">Type</TargetTh>
                <TargetTh align="left">Anchor</TargetTh>
                <TargetTh align="right">n</TargetTh>
                <TargetTh align="right">Avg days</TargetTh>
                <TargetTh align="left">Tier</TargetTh>
                <TargetTh align="left">Source</TargetTh>
              </tr>
            </thead>
            <tbody>
              {targetSubmitRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-dim italic">
                    No applicable (juris × type) combos with the current filter
                  </td>
                </tr>
              )}
              {targetSubmitRows.map((row) => (
                <tr
                  key={`${row.juris}-${row.type}`}
                  className={`border-t ${row.source === 'default' ? 'opacity-60' : ''}`}
                  style={{ borderColor: 'var(--color-border)' }}
                  data-testid={`trends-ts-row-${row.juris}-${row.type}`}
                >
                  <Td>{row.juris}</Td>
                  <Td>{row.type}</Td>
                  <Td>
                    <code className="text-[10px] text-muted">
                      {anchorLabel(row.anchor)}
                    </code>
                  </Td>
                  <Td align="right">{row.n}</Td>
                  <Td align="right">
                    {row.avgDays === null ? '—' : `${row.avgDays}d`}
                  </Td>
                  <Td>
                    <TierBadge tier={row.source} />
                  </Td>
                  <Td>
                    {row.source === 'default' ? (
                      <span className="text-[9px] italic text-dim">
                        hardcoded fallback
                      </span>
                    ) : (
                      <span className="text-[9px] text-text">
                        learned{row.isCrossJuris ? ' (cross-juris)' : ''}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-dim mt-2 leading-relaxed">
          Anchors: <strong>DD end</strong> (BP), <strong>go-date</strong>{' '}
          (ECA / PAR / SDOT / TRAO / LBA / SP / SIP),{' '}
          <strong>BP c0 intake</strong> (Demolition),{' '}
          <strong>BP c1 resub</strong> (IPR / ULS),{' '}
          <strong>BP actual issue</strong> (Condo). Avg days can be negative —
          some types (e.g. PAR/Pre-Sub) typically submit before the anchor date.
        </p>
      </Section>

      {/* § Breakdown table */}
      <Section title="Breakdown" testId="trends-section-breakdown">
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
      </Section>
    </div>
  );
}

// ============================================================
// Section wrapper — matches the Reports → Trends card style
// ============================================================

function Section({
  title,
  subtitle,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div>
        <h2 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
          {title}
        </h2>
        {subtitle && (
          <div className="text-[10px] text-dim mt-0.5">{subtitle}</div>
        )}
      </div>
      {children}
    </section>
  );
}

// ============================================================
// Target Submit row builder + helpers (fix-25-feat-BB)
// ============================================================

interface TargetSubmitRow {
  juris: string;
  type: string;
  anchor: TargetSubmitAnchor;
  n: number;
  avgDays: number | null;
  source: RecencyTier;
  isCrossJuris: boolean;
}

function buildTargetSubmitRows(
  permits: PermitWithCycles[],
  projectsById: Map<string, Project>,
  catalogTypes: string[],
  jurisOptions: string[],
  filters: PerfTrendsFilters,
  today: Date,
): TargetSubmitRow[] {
  // Mirror types (G&C / LSM) don't have a learner — anchorFor returns
  // 'mirror_bp' and they're excluded here. Catalog types with no entry
  // in HARDCODED_TARGET_SUBMIT_OFFSETS (and no anchor) also drop.
  const eligibleTypes = catalogTypes.filter((t) => {
    const a = anchorFor(t);
    if (a === 'mirror_bp') return false;
    return true;
  });

  // Single-tenant projects map by id (for the learner call signature).
  const projectsMap = new Map<string, Project>();
  for (const [k, v] of projectsById) projectsMap.set(k, v);

  const out: TargetSubmitRow[] = [];
  const jurises = filters.juris ? [filters.juris] : jurisOptions;
  for (const juris of jurises) {
    for (const type of eligibleTypes) {
      if (filters.permitType && type !== filters.permitType) continue;
      const result = computeLearnedTargetSubmit(
        permits,
        projectsMap,
        { type, juris },
        today,
      );
      // Skip rows that don't even have a hardcoded fallback (custom types).
      if (result.value === null && !(type in HARDCODED_TARGET_SUBMIT_OFFSETS)) {
        continue;
      }
      out.push({
        juris,
        type,
        anchor: anchorFor(type),
        n: result.sampleCount,
        avgDays: result.value,
        source: result.source,
        isCrossJuris: result.isCrossJuris,
      });
    }
  }
  // Sort: learned rows first (descending sample count), then defaults.
  out.sort((a, b) => {
    if (a.source === 'default' && b.source !== 'default') return 1;
    if (a.source !== 'default' && b.source === 'default') return -1;
    if (a.n !== b.n) return b.n - a.n;
    if (a.juris !== b.juris) return a.juris.localeCompare(b.juris);
    return a.type.localeCompare(b.type);
  });
  return out;
}

function anchorLabel(anchor: TargetSubmitAnchor): string {
  switch (anchor) {
    case 'dd_end':
      return 'dd_end';
    case 'go_date':
      return 'project.go_date';
    case 'bp_c0_intake':
      return 'BP c0.intake_accepted';
    case 'bp_c1_resub':
      return 'BP c1.resubmitted';
    case 'bp_actual_issue':
      return 'BP actual_issue';
    case 'mirror_bp':
      return '— (mirrors BP)';
  }
}

const TIER_LABEL: Record<RecencyTier, string> = {
  last_90d: 'last 90d',
  last_180d: 'last 180d',
  last_365d: 'last 365d',
  all_time: 'all-time',
  default: 'default',
};

const TIER_BG: Record<RecencyTier, string> = {
  last_90d: 'rgba(16,185,129,0.12)',
  last_180d: 'rgba(59,130,246,0.12)',
  last_365d: 'rgba(245,158,11,0.12)',
  all_time: 'rgba(148,163,184,0.18)',
  default: 'rgba(148,163,184,0.10)',
};

const TIER_FG: Record<RecencyTier, string> = {
  last_90d: 'var(--color-pm)',
  last_180d: 'var(--color-de)',
  last_365d: 'var(--color-co)',
  all_time: 'var(--color-dim)',
  default: 'var(--color-dim)',
};

function TierBadge({ tier }: { tier: RecencyTier }) {
  return (
    <span
      className="text-[9px] font-display font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
      style={{ background: TIER_BG[tier], color: TIER_FG[tier] }}
      data-testid={`tier-${tier}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

function TargetTh({
  children,
  align,
}: {
  children: React.ReactNode;
  align: 'left' | 'right';
}) {
  return (
    <th
      className={`px-3 py-2 text-[9px] uppercase tracking-wide font-display font-bold text-dim ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

// ============================================================
// Volume chart card — ported from ReportTrendsTab.TrendChartCard
// ============================================================

interface TrendChartCardProps {
  title: string;
  subtitle?: string;
  chartKind: 'bar' | 'line';
  series: ChartPoint[];
  groupKeys: string[];
  yLabel: string;
  testId: string;
  // fix-116: comparison overlay. comparisonSeries is bucketed by the
  // comparison period's own months; this component re-indexes by bucket
  // ORDER (not calendar month) into the current series' x positions, so
  // the dashed line / shadow bars sit on top of their current-period
  // counterparts. The tooltip discloses each bucket's actual comparison
  // month so the re-index never reads as "May data labelled June".
  comparisonSeries?: ChartPoint[] | null;
  /** Short range labels for the comparison legend strip — e.g.
   *  "2026-06-01 – 2026-06-30" / "2026-05-01 – 2026-05-31". */
  currentLabel?: string;
  comparisonLabel?: string;
}

function TrendChartCard({
  title,
  subtitle,
  chartKind,
  series,
  groupKeys,
  yLabel,
  testId,
  comparisonSeries,
  currentLabel,
  comparisonLabel,
}: TrendChartCardProps) {
  const hasComparison = Boolean(comparisonSeries);
  const chartData = series.map((p, i) => {
    const row: Record<string, string | number | null> = {
      month: formatMonthShort(p.month),
    };
    for (const k of groupKeys) row[k] = p.values[k] ?? null;
    if (hasComparison) {
      const cmp = comparisonSeries?.[i];
      for (const k of groupKeys) {
        row[`__cmp__${k}`] = cmp?.values[k] ?? null;
      }
      // Disclose the actual comparison month label for tooltip clarity —
      // critical because the comparison bar is rendered at the current
      // bucket's x position (which displays the current month label).
      row.__cmpMonth = cmp ? formatMonthShort(cmp.month) : '';
    }
    return row;
  });
  const hasAnyCurrentValue = series.some((p) =>
    Object.values(p.values).some((v) => v !== null && v !== 0),
  );
  const hasAnyComparisonValue =
    hasComparison &&
    !!comparisonSeries &&
    comparisonSeries.some((p) =>
      Object.values(p.values).some((v) => v !== null && v !== 0),
    );
  const hasAnyValue = hasAnyCurrentValue || hasAnyComparisonValue;

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
      {hasComparison && (
        <ComparisonLegendStrip
          chartKind={chartKind}
          currentLabel={currentLabel}
          comparisonLabel={comparisonLabel}
          comparisonHasData={hasAnyComparisonValue}
          testId={`${testId}-cmp-legend`}
        />
      )}
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
                  content={
                    hasComparison
                      ? (props) => (
                          <ComparisonTooltip
                            payload={props.payload}
                            label={props.label}
                            groupKeys={groupKeys}
                            currentLabel={currentLabel}
                            comparisonLabel={comparisonLabel}
                            yLabel={yLabel}
                          />
                        )
                      : undefined
                  }
                />
                {groupKeys.length > 1 && !hasComparison && (
                  <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
                )}
                {groupKeys.map((k, idx) => (
                  <Bar
                    key={k}
                    dataKey={k}
                    fill={trColor(k, idx)}
                    stackId={
                      hasComparison
                        ? 'current'
                        : groupKeys.length > 1
                          ? 'a'
                          : undefined
                    }
                  />
                ))}
                {hasComparison &&
                  groupKeys.map((k, idx) => (
                    <Bar
                      key={`cmp-${k}`}
                      dataKey={`__cmp__${k}`}
                      fill={trColor(k, idx)}
                      fillOpacity={0.35}
                      stroke={trColor(k, idx)}
                      strokeDasharray="2 2"
                      strokeWidth={1}
                      stackId="comparison"
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
                  content={
                    hasComparison
                      ? (props) => (
                          <ComparisonTooltip
                            payload={props.payload}
                            label={props.label}
                            groupKeys={groupKeys}
                            currentLabel={currentLabel}
                            comparisonLabel={comparisonLabel}
                            yLabel={yLabel}
                          />
                        )
                      : undefined
                  }
                />
                {groupKeys.length > 1 && !hasComparison && (
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
                {hasComparison &&
                  groupKeys.map((k, idx) => (
                    <Line
                      key={`cmp-${k}`}
                      type="monotone"
                      dataKey={`__cmp__${k}`}
                      stroke={trColor(k, idx)}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                      strokeWidth={2}
                      dot={{ r: 2, fill: trColor(k, idx), fillOpacity: 0.6 }}
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

// fix-116: chart-level legend rendered above the canvas when comparison
// is active. Two swatches keyed by chartKind — solid current + dashed
// comparison — let users read the chart without hovering. Legend stays
// in DOM (not SVG) so tests can assert presence via testId.
function ComparisonLegendStrip({
  chartKind,
  currentLabel,
  comparisonLabel,
  comparisonHasData,
  testId,
}: {
  chartKind: 'bar' | 'line';
  currentLabel?: string;
  comparisonLabel?: string;
  comparisonHasData: boolean;
  testId: string;
}) {
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-3 text-[10px] text-muted"
      data-testid={testId}
    >
      <span className="flex items-center gap-1.5">
        <ComparisonSwatch tone="current" chartKind={chartKind} />
        <span className="text-text font-display font-bold">
          {currentLabel ?? 'Current'}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <ComparisonSwatch tone="comparison" chartKind={chartKind} />
        <span className="text-dim font-display">
          vs {comparisonLabel ?? 'previous period'}
          {!comparisonHasData && (
            <span
              className="ml-2 italic"
              data-testid={`${testId}-empty`}
            >
              (no data)
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

function ComparisonSwatch({
  tone,
  chartKind,
}: {
  tone: 'current' | 'comparison';
  chartKind: 'bar' | 'line';
}) {
  const color = 'var(--color-de)';
  if (chartKind === 'bar') {
    return tone === 'current' ? (
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          background: color,
          borderRadius: 1,
        }}
      />
    ) : (
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          background: color,
          opacity: 0.35,
          border: `1px dashed ${color}`,
          borderRadius: 1,
        }}
      />
    );
  }
  // Line chart: short horizontal stroke (solid vs dashed).
  return tone === 'current' ? (
    <svg width={14} height={8} aria-hidden>
      <line x1={0} y1={4} x2={14} y2={4} stroke={color} strokeWidth={2} />
    </svg>
  ) : (
    <svg width={14} height={8} aria-hidden>
      <line
        x1={0}
        y1={4}
        x2={14}
        y2={4}
        stroke={color}
        strokeWidth={2}
        strokeDasharray="4 4"
        strokeOpacity={0.6}
      />
    </svg>
  );
}

// Custom Recharts tooltip used only when comparison is active. Standard
// recharts tooltip can't disclose the comparison's actual month (it'd just
// label both bars with the current period's bucket month).
function ComparisonTooltip({
  payload,
  label,
  groupKeys,
  currentLabel,
  comparisonLabel,
  yLabel,
}: {
  // Recharts' TooltipPayload generics complicate the type; keep it loose
  // since we only read .payload[i] (the row) by index.
  payload?: ReadonlyArray<{ payload?: unknown }>;
  label?: string | number;
  groupKeys: string[];
  currentLabel?: string;
  comparisonLabel?: string;
  yLabel: string;
}) {
  if (!payload || payload.length === 0) return null;
  const row = payload[0]?.payload as Record<string, unknown> | undefined;
  const cmpMonthLabel =
    typeof row?.__cmpMonth === 'string' && row.__cmpMonth
      ? row.__cmpMonth
      : null;
  function fmtValue(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') return String(v);
    return String(v);
  }
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        fontSize: 11,
        padding: '6px 8px',
        minWidth: 160,
      }}
    >
      <div className="font-bold text-text mb-1">{label}</div>
      {groupKeys.map((k) => {
        const cur = row?.[k];
        const cmp = row?.[`__cmp__${k}`];
        const curN = typeof cur === 'number' ? cur : null;
        const cmpN = typeof cmp === 'number' ? cmp : null;
        const delta = curN !== null && cmpN !== null ? curN - cmpN : null;
        const pct =
          delta !== null && cmpN !== null && cmpN !== 0
            ? Math.round((delta / Math.abs(cmpN)) * 100)
            : null;
        return (
          <div key={k} className="mb-1.5 last:mb-0">
            {groupKeys.length > 1 && (
              <div className="text-[9px] uppercase tracking-wide text-dim font-bold">
                {k}
              </div>
            )}
            <div className="text-text">
              {currentLabel ?? 'Current'}: <strong>{fmtValue(cur)}</strong>{' '}
              <span className="text-dim text-[9px]">{yLabel}</span>
            </div>
            <div className="text-dim">
              {comparisonLabel ?? 'Prev'}
              {cmpMonthLabel && cmpMonthLabel !== label
                ? ` (${cmpMonthLabel})`
                : ''}
              : <strong>{fmtValue(cmp)}</strong>{' '}
              <span className="text-dim text-[9px]">{yLabel}</span>
            </div>
            {delta !== null && (
              <div
                className="text-[10px] font-bold"
                style={{
                  color:
                    delta > 0
                      ? 'var(--color-pm)'
                      : delta < 0
                        ? 'var(--color-co)'
                        : 'var(--color-muted)',
                }}
              >
                Δ {delta > 0 ? '+' : ''}
                {delta}
                {pct === null ? '' : ` (${pct > 0 ? '+' : ''}${pct}%)`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Shared building blocks (existing on this page pre-fix-25-feat-BB)
// ============================================================

// fix-115-b: ComparisonRow + ComparisonDirection moved to
// src/components/shared/ComparisonRow.tsx so the Reports/Overview surface
// can consume the same renderer. KpiTile keeps its tile-specific layout
// (label / value / sub) and delegates the comparison row to the shared
// component when comparison props are present.
function KpiTile({
  label,
  value,
  sub,
  tileTitle,
  testId,
  currentNumeric,
  comparisonNumeric,
  comparisonLabel,
  comparisonValueText,
  direction,
}: {
  label: string;
  value: string;
  sub?: string;
  tileTitle?: string;
  testId?: string;
  /** Raw numeric value for delta math. When null, no delta computed. */
  currentNumeric?: number | null;
  /** Raw numeric value from the comparison cohort. */
  comparisonNumeric?: number | null;
  /** Range-stamped label e.g. "vs prev period (Jan 1 – Mar 31)". */
  comparisonLabel?: string;
  /** Display string for the comparison value (matches `value` formatting). */
  comparisonValueText?: string;
  /** Sign-color semantic for the delta arrow + percentage. */
  direction?: ComparisonDirection;
}) {
  const showComparison = Boolean(comparisonLabel);
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
      {showComparison && (
        <ComparisonRow
          testId={testId ? `${testId}-cmp` : undefined}
          comparisonLabel={comparisonLabel}
          comparisonValueText={comparisonValueText}
          currentNumeric={currentNumeric ?? null}
          comparisonNumeric={comparisonNumeric ?? null}
          direction={direction}
        />
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
