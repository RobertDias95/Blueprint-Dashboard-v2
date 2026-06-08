import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import MetricCard from './MetricCard';
import BarChartCard from './BarChartCard';
import MetricInfoTooltip from '../shared/MetricInfoTooltip';
import {
  computeRedesignAnalytics,
  type AssociateRedesignEntry,
  type BuilderEntry,
  type RecentRedesign,
  type RedesignAnalyticsFilters,
} from '../../lib/redesignAnalytics';
import { REDESIGNS_KPI_METRICS } from '../../lib/metricDefinitions';

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

  const triggerChartData = result.triggerBreakdown.map((t) => ({
    name: t.label,
    value: t.count,
  }));

  const reuseRateDisplay =
    result.reusePermitRate === null
      ? '—'
      : `${Math.round(result.reusePermitRate * 100)}%`;

  return (
    <div className="space-y-4" data-testid="redesigns-tab">
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
