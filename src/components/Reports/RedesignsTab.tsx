import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import MetricCard from './MetricCard';
import BarChartCard from './BarChartCard';
import MetricInfoTooltip from '../shared/MetricInfoTooltip';
import ExportCsvButton from '../shared/ExportCsvButton';
import { rowsToCsv } from '../../lib/reportCsv';
import {
  computeRedesignAnalytics,
  computeRedesignCycleTimeComparison,
  type AssociateRedesignEntry,
  type BuilderEntry,
  type CycleTimeComparison,
  type PhaseComparison,
  type RecentRedesign,
  type RedesignAnalyticsFilters,
} from '../../lib/redesignAnalytics';
import {
  REDESIGNS_KPI_METRICS,
  REDESIGNS_CYCLE_COMPARISON,
} from '../../lib/metricDefinitions';

// fix-134-b: 4th sub-tab on Reports. Surfaces the redesign data fix-126
// added to the schema so the team can answer "which builders are
// triggering rework?" and "are we reusing original permits when we
// can?" — Bobby's brainstorm questions.
//
// Layout (top to bottom):
//   1. Filter bar (date range + juris — slimmer than Overview)
//   2. KPI row: Total Redesigns / Reuse Permit Rate / Builders count
//   3. Trigger Source Breakdown bar chart
//   4. Builder Leaderboard table (sortable visual)
//   5. DA / DM / ENT mini-leaderboards (3 cards side-by-side)
//   6. Recent Redesigns table (capped at 25, sorted by created_at desc)
//
// All sections share a single filter bar — workload is a snapshot,
// trends are not, but redesigns ARE historical so date / juris do
// apply.

export default function RedesignsTab() {
  const permitsQ = usePermits();
  const projectsQ = useProjects();

  const error = permitsQ.error ?? projectsQ.error;
  if (error) {
    return (
      <QueryError
        title="Redesign analytics failed to load"
        error={error}
        onRetry={() => {
          permitsQ.refetch();
          projectsQ.refetch();
        }}
      />
    );
  }
  if (permitsQ.isLoading || projectsQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-12" />;
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
  permits: NonNullable<ReturnType<typeof usePermits>['data']>;
  projects: NonNullable<ReturnType<typeof useProjects>['data']>;
}) {
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [juris, setJuris] = useState<string>('');

  const jurisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) if (p.juris) set.add(p.juris);
    return Array.from(set).sort();
  }, [projects]);

  const filters: RedesignAnalyticsFilters = useMemo(
    () => ({
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      juris,
    }),
    [dateFrom, dateTo, juris],
  );

  const result = useMemo(
    () => computeRedesignAnalytics(permits, projects, filters),
    [permits, projects, filters],
  );

  // fix-136-b: redesign vs original cycle-time comparison — same
  // filters as the rest of the page so a date / juris narrow trims
  // both cohorts symmetrically.
  const cycleTime = useMemo(
    () => computeRedesignCycleTimeComparison(permits, projects, filters),
    [permits, projects, filters],
  );

  const triggerChartData = result.triggerBreakdown.map((t) => ({
    name: t.label,
    value: t.count,
  }));

  const reuseRateDisplay =
    result.reusePermitRate === null
      ? '—'
      : `${Math.round(result.reusePermitRate * 100)}%`;

  // fix-135-b: Redesigns tab CSV export — the recent-redesigns rows
  // (the bottom table). The same `recentRedesigns` array drives both
  // the table and the export so filter changes flow through both.
  const csvFilename = `redesigns-${todayStamp()}.csv`;
  const handleExport = (): string => buildRedesignsCsv(result.recentRedesigns);

  return (
    <div className="space-y-4" data-testid="redesigns-tab">
      {/* Page header — title space on the left + Export CSV on the
          right, mirroring the Reports Overview tab's header line. */}
      <div className="flex items-center justify-end">
        <ExportCsvButton
          filename={csvFilename}
          onExport={handleExport}
          disabled={result.recentRedesigns.length === 0}
          testId="redesigns-export-csv-button"
        />
      </div>

      {/* Filter bar — slimmer than the Overview bar; no status / type /
          tag cohorts since this surface is about a single subset of
          projects (the redesigns). */}
      <div
        className="flex flex-wrap items-end gap-3 p-3 rounded-lg border"
        style={{
          background: 'var(--color-s2)',
          borderColor: 'var(--color-border)',
        }}
        data-testid="redesigns-filter-bar"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            From
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="redesigns-filter-from"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            To
          </span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="redesigns-filter-to"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
            Juris
          </span>
          <select
            value={juris}
            onChange={(e) => setJuris(e.target.value)}
            className="text-[11px] px-2 py-1 border rounded-md bg-surface text-text outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="redesigns-filter-juris"
          >
            <option value="">All</option>
            {jurisOptions.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <span
          className="text-[11px] text-dim font-mono ml-auto"
          data-testid="redesigns-result-count"
        >
          {result.totalRedesigns} redesign
          {result.totalRedesigns === 1 ? '' : 's'}
        </span>
      </div>

      {result.totalRedesigns === 0 ? (
        <div
          className="text-xs text-dim italic px-3 py-12 text-center bg-surface border border-border rounded-lg"
          data-testid="redesigns-empty-state"
        >
          No redesigns recorded in the current filter. Start tracking
          redesigns by spawning one from a project's settings (Spawn
          Redesign button on{' '}
          <Link
            to="/projects"
            className="underline text-de"
            data-testid="redesigns-empty-link"
          >
            the project list
          </Link>
          ).
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
            data-testid="redesigns-kpi-row"
          >
            <MetricCard
              testId="redesigns-kpi-total"
              label={REDESIGNS_KPI_METRICS.totalRedesigns.label}
              value={result.totalRedesigns}
              labelSlot={
                <MetricInfoTooltip
                  label={REDESIGNS_KPI_METRICS.totalRedesigns.label}
                  description={REDESIGNS_KPI_METRICS.totalRedesigns.description}
                  formula={REDESIGNS_KPI_METRICS.totalRedesigns.formula}
                  slug="redesigns-total"
                />
              }
            />
            <MetricCard
              testId="redesigns-kpi-reuse-rate"
              label={REDESIGNS_KPI_METRICS.reusePermitRate.label}
              value={reuseRateDisplay}
              subText={`${result.reusePermitCount} of ${result.totalRedesigns} redesigns reuse the original permit`}
              labelSlot={
                <MetricInfoTooltip
                  label={REDESIGNS_KPI_METRICS.reusePermitRate.label}
                  description={REDESIGNS_KPI_METRICS.reusePermitRate.description}
                  formula={REDESIGNS_KPI_METRICS.reusePermitRate.formula}
                  cohort={REDESIGNS_KPI_METRICS.reusePermitRate.cohort}
                  slug="redesigns-reuse-rate"
                />
              }
            />
            <MetricCard
              testId="redesigns-kpi-builders"
              label={REDESIGNS_KPI_METRICS.buildersTriggering.label}
              value={result.builderLeaderboard.length}
              subText="distinct builders with at least one redesign"
              labelSlot={
                <MetricInfoTooltip
                  label={REDESIGNS_KPI_METRICS.buildersTriggering.label}
                  description={REDESIGNS_KPI_METRICS.buildersTriggering.description}
                  formula={REDESIGNS_KPI_METRICS.buildersTriggering.formula}
                  cohort={REDESIGNS_KPI_METRICS.buildersTriggering.cohort}
                  slug="redesigns-builders"
                />
              }
            />
          </div>

          {/* fix-136-b: Cycle Time vs Originals — second tile row.
              Separate section header differentiates it from the
              redesign-only KPI row above. */}
          <CycleTimeSection comparison={cycleTime} />

          {/* Trigger Source Breakdown */}
          <div data-testid="redesigns-trigger-breakdown">
            <BarChartCard
              title="Trigger Source Breakdown"
              data={triggerChartData}
              color="co"
              unit=""
              showAverage={false}
              testId="redesigns-trigger-chart"
              emptyState="No trigger data available."
            />
          </div>

          {/* Builder Leaderboard */}
          <BuilderLeaderboard rows={result.builderLeaderboard} />

          {/* Per-role mini-leaderboards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <RoleLeaderboard
              testId="redesigns-da-leaderboard"
              title="Design Associates"
              rows={result.daLeaderboard}
              role="da"
            />
            <RoleLeaderboard
              testId="redesigns-dm-leaderboard"
              title="Design Managers"
              rows={result.dmLeaderboard}
              role="dm"
            />
            <RoleLeaderboard
              testId="redesigns-ent-leaderboard"
              title="Entitlement Leads"
              rows={result.entLeaderboard}
              role="ent"
            />
          </div>

          {/* Recent Redesigns table */}
          <RecentRedesignsTable rows={result.recentRedesigns} />
        </>
      )}
    </div>
  );
}

// ============================================================
// Builder leaderboard — full-width table with rate color-coding
// ============================================================

const HIGH_REDESIGN_RATE = 0.2;

function BuilderLeaderboard({ rows }: { rows: BuilderEntry[] }) {
  if (rows.length === 0) {
    return (
      <div
        className="text-xs text-dim italic px-3 py-6 text-center bg-surface border border-border rounded-lg"
        data-testid="redesigns-builder-leaderboard-empty"
      >
        No builders with redesigns in the current filter.
      </div>
    );
  }
  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-testid="redesigns-builder-leaderboard"
    >
      <div className="px-4 py-2 text-[10px] uppercase tracking-wide text-dim font-display font-bold border-b border-border">
        Builder Leaderboard
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] uppercase tracking-wide text-dim font-display font-bold border-b border-border">
            <th className="text-left px-4 py-2">Builder</th>
            <th className="text-right px-4 py-2">Redesigns</th>
            <th className="text-right px-4 py-2">Total Projects</th>
            <th className="text-right px-4 py-2">Redesign Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isHigh = row.redesignRate >= HIGH_REDESIGN_RATE;
            return (
              <tr
                key={row.builderName}
                className="border-b border-border last:border-b-0"
                data-testid={`redesigns-builder-row-${row.builderName}`}
                data-tone={isHigh ? 'co' : 'neutral'}
              >
                <td className="text-left px-4 py-2 font-display font-bold text-text">
                  {row.builderName}
                </td>
                <td className="text-right px-4 py-2 font-mono">
                  {row.redesignCount}
                </td>
                <td className="text-right px-4 py-2 font-mono text-muted">
                  {row.totalProjectCount}
                </td>
                <td
                  className="text-right px-4 py-2 font-mono"
                  style={{
                    color: isHigh ? 'var(--color-co)' : 'var(--color-text)',
                  }}
                >
                  {Math.round(row.redesignRate * 100)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Per-role mini-leaderboards (DA / DM / ENT)
// ============================================================

function RoleLeaderboard({
  testId,
  title,
  rows,
  role,
}: {
  testId: string;
  title: string;
  rows: AssociateRedesignEntry[];
  role: 'da' | 'dm' | 'ent';
}) {
  const shown = rows.slice(0, 5);
  return (
    <div
      className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
        {title}
      </div>
      {shown.length === 0 ? (
        <div className="text-xs text-dim italic text-center py-4">
          No credited associates.
        </div>
      ) : (
        <ul className="space-y-1">
          {shown.map((row) => (
            <li
              key={row.name}
              className="flex items-center justify-between text-[11px]"
              data-testid={`${testId}-row-${row.name}`}
            >
              <Link
                to={`/reports/team/${encodeURIComponent(row.name)}?role=${role}`}
                className="font-display font-bold text-text hover:underline truncate"
                data-testid={`${testId}-row-${row.name}-link`}
              >
                {row.name}
              </Link>
              <span className="font-mono text-muted">{row.redesignCount}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// Recent Redesigns table
// ============================================================

function RecentRedesignsTable({ rows }: { rows: RecentRedesign[] }) {
  if (rows.length === 0) return null;
  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-testid="redesigns-recent-table"
    >
      <div className="px-4 py-2 text-[10px] uppercase tracking-wide text-dim font-display font-bold border-b border-border">
        Recent Redesigns
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-dim font-display font-bold border-b border-border">
              <th className="text-left px-4 py-2">Redesign</th>
              <th className="text-left px-4 py-2">Original</th>
              <th className="text-left px-4 py-2">Trigger</th>
              <th className="text-left px-4 py-2">Reuses Permit?</th>
              <th className="text-left px-4 py-2">Builder</th>
              <th className="text-left px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.redesignProjectId}
                className="border-b border-border last:border-b-0"
                data-testid={`redesigns-recent-row-${row.redesignProjectId}`}
              >
                <td className="text-left px-4 py-2">
                  <Link
                    to={`/project/${row.redesignProjectId}`}
                    className="text-de hover:underline"
                    data-testid={`redesigns-recent-row-${row.redesignProjectId}-redesign-link`}
                  >
                    {row.redesignAddress}
                  </Link>
                </td>
                <td className="text-left px-4 py-2">
                  {row.originalProjectId && row.originalAddress ? (
                    <Link
                      to={`/project/${row.originalProjectId}`}
                      className="text-muted hover:underline"
                      data-testid={`redesigns-recent-row-${row.redesignProjectId}-original-link`}
                    >
                      {row.originalAddress}
                    </Link>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
                <td className="text-left px-4 py-2 text-text">
                  {row.triggerLabel}
                </td>
                <td className="text-left px-4 py-2 font-mono">
                  {row.reusesOriginalPermit === true
                    ? 'Yes'
                    : row.reusesOriginalPermit === false
                      ? 'No'
                      : '—'}
                </td>
                <td className="text-left px-4 py-2 text-text">
                  {row.builderName ?? <span className="text-dim">—</span>}
                </td>
                <td
                  className="text-left px-4 py-2 text-muted max-w-xs truncate"
                  title={row.notes ?? undefined}
                >
                  {row.notes ?? <span className="text-dim">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// fix-135-b: CSV export helpers
// ============================================================

const REDESIGNS_CSV_COLUMNS = [
  { key: 'redesignAddress', label: 'Redesign Address' },
  { key: 'originalAddress', label: 'Original Address' },
  { key: 'trigger', label: 'Trigger' },
  { key: 'reusesOriginalPermit', label: 'Reuses Permit?' },
  { key: 'builderName', label: 'Builder' },
  { key: 'notes', label: 'Notes' },
  { key: 'createdAt', label: 'Created At' },
];

function buildRedesignsCsv(rows: RecentRedesign[]): string {
  if (rows.length === 0) return '';
  return rowsToCsv(
    REDESIGNS_CSV_COLUMNS,
    rows.map((r) => ({
      redesignAddress: r.redesignAddress,
      originalAddress: r.originalAddress ?? '',
      trigger: r.triggerLabel,
      reusesOriginalPermit:
        r.reusesOriginalPermit === true
          ? 'Yes'
          : r.reusesOriginalPermit === false
            ? 'No'
            : '',
      builderName: r.builderName ?? '',
      notes: r.notes ?? '',
      createdAt: r.createdAt,
    })),
  );
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ============================================================
// fix-136-b: Cycle Time vs Originals section
// ============================================================
//
// Bobby's brainstorm question: "are redesigns taking longer than
// fresh-from-scratch projects?" One card per phase, each showing
// redesign + original avg + delta. Lower is better for all 4 metrics
// (DD, City Review, Corrections, Issuance), so a positive delta
// (redesigns slower) is "bad" / co-color, a negative delta
// (redesigns faster) is "good" / pm-color.

interface PhaseDef {
  key: keyof CycleTimeComparison;
  metricKey: keyof typeof REDESIGNS_CYCLE_COMPARISON;
  testId: string;
  unit: string;
}

const CYCLE_PHASE_DEFS: PhaseDef[] = [
  { key: 'ddPhase', metricKey: 'ddPhase', testId: 'redesigns-cycle-dd', unit: 'd' },
  {
    key: 'cityReview',
    metricKey: 'cityReview',
    testId: 'redesigns-cycle-city-review',
    unit: 'd',
  },
  {
    key: 'corrections',
    metricKey: 'corrections',
    testId: 'redesigns-cycle-corrections',
    unit: '',
  },
  { key: 'issuance', metricKey: 'issuance', testId: 'redesigns-cycle-issuance', unit: 'd' },
];

// Within ±5% of the original baseline → "Same as originals" / neutral.
// fix-124 set this band on the team-tab comparison; reused here so the
// "no-signal" threshold reads the same across surfaces.
const NEUTRAL_BAND = 0.05;

function CycleTimeSection({ comparison }: { comparison: CycleTimeComparison }) {
  return (
    <section className="space-y-2" data-testid="redesigns-cycle-section">
      <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
        Cycle Time vs Originals
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {CYCLE_PHASE_DEFS.map((def) => (
          <CycleTimeCard
            key={def.key}
            phase={comparison[def.key]}
            metricKey={def.metricKey}
            testId={def.testId}
            unit={def.unit}
          />
        ))}
      </div>
    </section>
  );
}

function CycleTimeCard({
  phase,
  metricKey,
  testId,
  unit,
}: {
  phase: PhaseComparison;
  metricKey: keyof typeof REDESIGNS_CYCLE_COMPARISON;
  testId: string;
  unit: string;
}) {
  const def = REDESIGNS_CYCLE_COMPARISON[metricKey];
  const canCompare =
    phase.redesignAvg !== null && phase.originalAvg !== null && phase.delta !== null;
  // Tone: bad when delta > +neutral band (redesigns slower), good
  // when delta < −neutral band (redesigns faster), neutral when
  // within ±5% of the original baseline. Original-avg gates the
  // band so a 0-original-avg (i.e., everyone hit 0) doesn't NaN.
  let tone: 'good' | 'bad' | 'neutral' = 'neutral';
  if (canCompare && phase.originalAvg !== null && phase.originalAvg > 0) {
    const ratio = Math.abs(phase.delta!) / phase.originalAvg;
    if (ratio <= NEUTRAL_BAND) tone = 'neutral';
    else if (phase.delta! > 0) tone = 'bad';
    else tone = 'good';
  } else if (canCompare && phase.delta !== 0) {
    // Original avg is 0 — anything non-zero on redesigns is "slower"
    // by definition; anything matching is neutral.
    tone = phase.delta! > 0 ? 'bad' : 'good';
  }

  const toneColor =
    tone === 'bad'
      ? 'var(--color-co)'
      : tone === 'good'
        ? 'var(--color-pm)'
        : 'var(--color-muted)';

  const formatValue = (v: number | null): string =>
    v === null ? '—' : `${v}${unit}`;

  return (
    <div
      className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2"
      data-testid={testId}
      data-tone={tone}
    >
      <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
        <MetricInfoTooltip
          label={def.label}
          description={def.description}
          formula={def.formula}
          cohort={def.cohort}
          slug={`cycle-${metricKey}`}
        />
      </div>
      {!canCompare ? (
        <div
          className="text-xs text-dim italic py-2"
          data-testid={`${testId}-empty`}
        >
          Not enough data to compare.
          {phase.redesignAvg !== null && (
            <span className="block text-[10px] text-muted mt-1">
              Redesigns: {formatValue(phase.redesignAvg)} (n={phase.redesignN})
            </span>
          )}
          {phase.originalAvg !== null && (
            <span className="block text-[10px] text-muted mt-1">
              Originals: {formatValue(phase.originalAvg)} (n={phase.originalN})
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div
              className="flex flex-col"
              data-testid={`${testId}-redesigns`}
            >
              <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
                Redesigns
              </span>
              <span className="text-xl font-display font-extrabold text-text">
                {formatValue(phase.redesignAvg)}
              </span>
              <span className="text-[10px] text-muted">
                n={phase.redesignN}
              </span>
            </div>
            <div
              className="flex flex-col"
              data-testid={`${testId}-originals`}
            >
              <span className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
                Originals
              </span>
              <span className="text-xl font-display font-extrabold text-muted">
                {formatValue(phase.originalAvg)}
              </span>
              <span className="text-[10px] text-muted">
                n={phase.originalN}
              </span>
            </div>
          </div>
          <div
            className="text-[11px] font-display font-bold pt-1 border-t border-border"
            style={{ color: toneColor }}
            data-testid={`${testId}-delta`}
          >
            {tone === 'neutral' ? (
              <>→ Same as originals</>
            ) : phase.delta! > 0 ? (
              <>↑ +{phase.delta}{unit} slower than originals</>
            ) : (
              <>↓ {phase.delta}{unit} faster than originals</>
            )}
          </div>
        </>
      )}
    </div>
  );
}
