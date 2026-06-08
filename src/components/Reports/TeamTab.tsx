import { useMemo, useState } from 'react';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import TeamPerformanceTable from './TeamPerformanceTable';
import WorkloadBalance from './WorkloadBalance';
import {
  computeTeamMetrics,
  type TeamMetricsFilters,
  type TeamRoleSelection,
} from '../../lib/teamPerformance';

// fix-127: Team performance dashboard. Sits as the 3rd tab on Reports
// (Overview / Trends / Team). Per-associate volume + phase metrics for
// Design Associates / Design Managers / Entitlement Leads. Managerial
// visibility tool only — not for performance reviews; "see who's
// carrying what load, where slowness is happening per associate"
// (Bobby's brief during the fix-126 redesign brainstorm).
//
// Layout: role tabs at top (DA / DM / ENT) → filter row (active only,
// date range, juris, include redesigns) → results table with one row
// per associate and vs-team-avg color treatment on the phase metric
// cells.

const ROLE_TABS: { id: TeamRoleSelection; label: string; pluralLabel: string }[] = [
  { id: 'da', label: 'Design Associates', pluralLabel: 'Design Associates' },
  { id: 'dm', label: 'Design Managers', pluralLabel: 'Design Managers' },
  { id: 'ent', label: 'Entitlement Leads', pluralLabel: 'Entitlement Leads' },
];

export default function TeamTab() {
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const teamMembersQ = useTeamMembers();

  const error = permitsQ.error ?? projectsQ.error ?? teamMembersQ.error;
  if (error) {
    return (
      <QueryError
        title="Team performance failed to load"
        error={error}
        onRetry={() => {
          permitsQ.refetch();
          projectsQ.refetch();
          teamMembersQ.refetch();
        }}
      />
    );
  }
  if (permitsQ.isLoading || projectsQ.isLoading || teamMembersQ.isLoading) {
    return <SkeletonRows count={5} rowClassName="h-12" />;
  }

  return (
    <Body
      permits={permitsQ.data ?? []}
      projects={projectsQ.data ?? []}
      teamMembers={teamMembersQ.all ?? []}
    />
  );
}

function Body({
  permits,
  projects,
  teamMembers,
}: {
  permits: NonNullable<ReturnType<typeof usePermits>['data']>;
  projects: NonNullable<ReturnType<typeof useProjects>['data']>;
  teamMembers: NonNullable<ReturnType<typeof useTeamMembers>['all']>;
}) {
  const [role, setRole] = useState<TeamRoleSelection>('da');
  const [activeOnly, setActiveOnly] = useState(true);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [juris, setJuris] = useState<string>('');
  const [includeRedesigns, setIncludeRedesigns] = useState(true);

  const jurisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) if (p.juris) set.add(p.juris);
    return Array.from(set).sort();
  }, [projects]);

  const filters: TeamMetricsFilters = useMemo(
    () => ({
      role,
      activeOnly,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      juris,
      includeRedesigns,
    }),
    [role, activeOnly, dateFrom, dateTo, juris, includeRedesigns],
  );

  const result = useMemo(
    () => computeTeamMetrics(permits, projects, teamMembers, filters),
    [permits, projects, teamMembers, filters],
  );

  const activeTabLabel =
    ROLE_TABS.find((t) => t.id === role)?.pluralLabel ?? 'associates';

  return (
    <div className="space-y-3" data-testid="team-tab">
      {/* Role selector — sub-sub-tabs. Same visual register as the
          Reports tab bar above but in a lighter weight so the
          hierarchy reads correctly. */}
      <div
        role="tablist"
        aria-label="Team role"
        className="flex items-center gap-2"
        data-testid="team-role-tabs"
      >
        {ROLE_TABS.map((t) => {
          const isActive = role === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setRole(t.id)}
              className="text-[11px] font-bold font-display px-3 py-1.5 rounded-md border transition"
              style={{
                background: isActive
                  ? 'var(--color-de)'
                  : 'var(--color-surface)',
                color: isActive ? '#fff' : 'var(--color-muted)',
                borderColor: isActive
                  ? 'var(--color-de)'
                  : 'var(--color-border)',
              }}
              data-testid={`team-role-tab-${t.id}`}
              data-active={isActive ? 'true' : 'false'}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filter row */}
      <div
        className="flex flex-wrap items-end gap-3 p-3 rounded-lg border"
        style={{
          background: 'var(--color-s2)',
          borderColor: 'var(--color-border)',
        }}
        data-testid="team-filter-bar"
      >
        <label className="flex items-center gap-1.5 text-[11px] font-display text-text">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            data-testid="team-filter-active-only"
          />
          Active only
        </label>
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
            data-testid="team-filter-from"
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
            data-testid="team-filter-to"
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
            data-testid="team-filter-juris"
          >
            <option value="">All</option>
            {jurisOptions.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-display text-text">
          <input
            type="checkbox"
            checked={includeRedesigns}
            onChange={(e) => setIncludeRedesigns(e.target.checked)}
            data-testid="team-filter-include-redesigns"
          />
          Include redesigns in phase metrics
        </label>
        <span
          className="text-[11px] text-dim font-mono ml-auto"
          data-testid="team-result-count"
        >
          {result.rows.length} associate{result.rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* fix-133-b: current workload balance — sits above the
          historical table so the operational "who has bandwidth right
          now?" view leads. Driven by the same role + activeOnly
          filters as the table below; it intentionally ignores the
          date / juris / includeRedesigns inputs because workload is a
          snapshot, not a historical query. */}
      <WorkloadBalance
        permits={permits}
        projects={projects}
        teamMembers={teamMembers}
        filters={{ role, activeOnly }}
      />

      {result.rows.length === 0 ? (
        <div
          className="text-xs text-dim italic px-3 py-12 text-center bg-surface border border-border rounded-lg"
          data-testid="team-empty-state"
        >
          No active {activeTabLabel} in the current filter.
        </div>
      ) : (
        <TeamPerformanceTable result={result} />
      )}
    </div>
  );
}
