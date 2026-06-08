import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type {
  PermitWithCycles,
  Project,
  TeamMember,
} from '../../lib/database.types';
import {
  computeTeamWorkload,
  type TeamWorkloadFilters,
} from '../../lib/teamWorkload';
import MetricInfoTooltip from '../shared/MetricInfoTooltip';

// fix-133-b: Current Workload visualization on the Team tab. Sits
// ABOVE the historical TeamPerformanceTable so the operational
// question ("who has bandwidth right now?") is the FIRST thing the
// user sees when triaging the cohort. Bar chart per associate, stacked
// by lifecycle stage, with a dashed team-avg overlay for the
// imbalance signal.

interface Props {
  permits: PermitWithCycles[];
  projects: Project[];
  teamMembers: TeamMember[];
  filters: TeamWorkloadFilters;
}

const ROLE_LABEL: Record<TeamWorkloadFilters['role'], string> = {
  da: 'Design Associates',
  dm: 'Design Managers',
  ent: 'Entitlement Leads',
};

export default function WorkloadBalance({
  permits,
  projects,
  teamMembers,
  filters,
}: Props) {
  const result = useMemo(
    () => computeTeamWorkload(permits, projects, teamMembers, filters),
    [permits, projects, teamMembers, filters],
  );

  // Hard ceiling for the bar scale — the widest visible row pegs at
  // 100%, everyone else scales relative to that. Falls back to 1 so
  // the division below never divides by 0 in the empty-state path
  // (the empty state short-circuits the render anyway).
  const maxPermits = useMemo(() => {
    let m = 0;
    for (const r of result.rows) {
      if (r.activePermitCount > m) m = r.activePermitCount;
    }
    return m || 1;
  }, [result.rows]);

  const teamAvg = result.teamAvgActivePermitCount;
  const teamAvgPct =
    teamAvg !== null ? Math.min(100, (teamAvg / maxPermits) * 100) : null;

  return (
    <section
      className="space-y-2 p-3 rounded-lg border"
      style={{
        background: 'var(--color-s2)',
        borderColor: 'var(--color-border)',
      }}
      data-testid="team-workload-balance"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
          <MetricInfoTooltip
            label="Current Workload"
            description="Open permits per associate, stacked by lifecycle stage. A permit is open when its effective stage is Design / Under Review / Corrections — Approved and Issued permits don't count toward current load."
            formula="In Design = effectiveStage('de')  ·  In Review = effectiveStage('pm')  ·  In Corrections = effectiveStage('co')"
            cohort="Sorted by open permit count, descending. Team average is across the visible rows in the current role + active-only filter."
            slug="team-workload"
          />
        </div>
        {teamAvg !== null && (
          <div
            className="text-[10px] text-muted font-display font-bold"
            data-testid="team-workload-team-avg"
          >
            Team avg: {teamAvg} open
          </div>
        )}
      </div>

      {result.rows.length === 0 ? (
        <div
          className="text-xs text-dim italic px-3 py-8 text-center bg-surface border border-border rounded-md"
          data-testid="team-workload-empty"
        >
          No active {ROLE_LABEL[filters.role]} in the current filter.
        </div>
      ) : (
        <>
          <ul className="space-y-1.5">
            {result.rows.map((row) => {
              const rowPct = (row.activePermitCount / maxPermits) * 100;
              const designPct =
                row.activePermitCount === 0
                  ? 0
                  : (row.inDesignCount / row.activePermitCount) * 100;
              const reviewPct =
                row.activePermitCount === 0
                  ? 0
                  : (row.inReviewCount / row.activePermitCount) * 100;
              const corrPct =
                row.activePermitCount === 0
                  ? 0
                  : (row.inCorrectionsCount / row.activePermitCount) * 100;
              return (
                <li
                  key={row.name}
                  className="grid items-center gap-2"
                  style={{ gridTemplateColumns: '8rem 1fr 5rem' }}
                  data-testid={`team-workload-row-${row.name}`}
                  data-active={row.isActive ? 'true' : 'false'}
                >
                  <Link
                    to={`/reports/team/${encodeURIComponent(row.name)}?role=${filters.role}`}
                    className="text-[11px] font-display font-bold text-text truncate hover:underline"
                    data-testid={`team-workload-row-${row.name}-link`}
                  >
                    {row.name}
                  </Link>
                  {/* Outer track: full width of the chart area; inner
                      coloured bar is sized to rowPct of the track. The
                      stacked segments fill the inner bar in fixed-order
                      proportion (Design → Review → Corrections). */}
                  <div
                    className="relative h-5 rounded-md overflow-hidden"
                    style={{ background: 'var(--color-border)' }}
                    data-testid={`team-workload-row-${row.name}-bar`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 flex h-full"
                      style={{ width: `${rowPct}%` }}
                    >
                      {row.inDesignCount > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${designPct}%`,
                            background: 'var(--color-de)',
                          }}
                          data-testid={`team-workload-row-${row.name}-design`}
                          title={`In Design: ${row.inDesignCount}`}
                        />
                      )}
                      {row.inReviewCount > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${reviewPct}%`,
                            background: 'var(--color-pm)',
                          }}
                          data-testid={`team-workload-row-${row.name}-review`}
                          title={`In Review: ${row.inReviewCount}`}
                        />
                      )}
                      {row.inCorrectionsCount > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${corrPct}%`,
                            background: 'var(--color-co)',
                          }}
                          data-testid={`team-workload-row-${row.name}-corrections`}
                          title={`In Corrections: ${row.inCorrectionsCount}`}
                        />
                      )}
                    </div>
                    {/* Team-avg vertical line — dashed, sits on top of
                        the bar so the user can read each associate's
                        bar relative to the team baseline at a glance. */}
                    {teamAvgPct !== null && (
                      <div
                        className="absolute inset-y-0 pointer-events-none"
                        style={{
                          left: `${teamAvgPct}%`,
                          width: 0,
                          borderLeft: '1.5px dashed var(--color-muted)',
                        }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div
                    className="text-[11px] font-mono text-text text-right"
                    data-testid={`team-workload-row-${row.name}-total`}
                  >
                    {row.activePermitCount}
                    <span className="text-dim">
                      {' '}
                      / {row.activeProjectCount}p
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div
            className="flex items-center gap-3 pt-1 text-[10px] text-dim font-display"
            data-testid="team-workload-legend"
          >
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-3 h-2 rounded-sm"
                style={{ background: 'var(--color-de)' }}
              />
              In Design
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-3 h-2 rounded-sm"
                style={{ background: 'var(--color-pm)' }}
              />
              In Review
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-3 h-2 rounded-sm"
                style={{ background: 'var(--color-co)' }}
              />
              In Corrections
            </span>
            <span className="inline-flex items-center gap-1 ml-auto">
              <span
                className="inline-block w-3 h-px"
                style={{ borderTop: '1.5px dashed var(--color-muted)' }}
              />
              Team avg
            </span>
            <span className="text-muted">
              count · <em>p</em> = distinct projects
            </span>
          </div>
        </>
      )}
    </section>
  );
}
