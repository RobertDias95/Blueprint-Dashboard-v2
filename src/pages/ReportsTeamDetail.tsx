import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  computeTeamMetrics,
  type TeamMemberMetrics,
  type TeamMetricsResult,
  type TeamRoleSelection,
} from '../lib/teamPerformance';
import MetricInfoTooltip from '../components/shared/MetricInfoTooltip';
import { formatCompareNumber } from '../lib/comparisonCohort';
import { TEAM_DETAIL_PHASE_METRICS } from '../lib/metricDefinitions';
import { worstStage } from '../lib/libraryHelpers';
import { STAGE_LABEL } from '../lib/stageLabel';
import type { PermitWithCycles, Project, Stage } from '../lib/database.types';

// fix-131: per-associate drill-down page. Reached from
// TeamPerformanceTable's name links on the Team tab. Shows a single
// associate's volume + phase performance + project list in depth —
// "where exactly is this person strong/weak, what projects are they on
// right now" (Bobby's framing during the fix-127 productivity
// brainstorm).
//
// 131-a: route + skeleton + header (name, role chip, active/inactive,
//   back link to Team tab).
// 131-b: volume summary cards (Projects/Units/Lots/Permits + redesign
//   counterparts).
// 131-c: phase performance cards with vs-team-avg deltas mirroring the
//   TeamPerformanceTable cell treatment.
// 131-d: project list (sortable, with status + redesign chip).

const ROLE_LABEL: Record<TeamRoleSelection, string> = {
  da: 'Design Associate',
  dm: 'Design Manager',
  ent: 'Entitlement Lead',
};

function parseRole(raw: string | null): TeamRoleSelection {
  if (raw === 'dm' || raw === 'ent') return raw;
  return 'da';
}

export default function ReportsTeamDetail() {
  const params = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const name = decodeURIComponent(params.name ?? '');
  const role = parseRole(searchParams.get('role'));

  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const teamMembersQ = useTeamMembers();

  const error = permitsQ.error ?? projectsQ.error ?? teamMembersQ.error;
  if (error) {
    return (
      <QueryError
        title="Team detail failed to load"
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
    return <SkeletonRows count={6} rowClassName="h-12" />;
  }

  return (
    <Body
      name={name}
      role={role}
      permits={permitsQ.data ?? []}
      projects={projectsQ.data ?? []}
      teamMembers={teamMembersQ.all ?? []}
    />
  );
}

function Body({
  name,
  role,
  permits,
  projects,
  teamMembers,
}: {
  name: string;
  role: TeamRoleSelection;
  permits: NonNullable<ReturnType<typeof usePermits>['data']>;
  projects: NonNullable<ReturnType<typeof useProjects>['data']>;
  teamMembers: NonNullable<ReturnType<typeof useTeamMembers>['all']>;
}) {
  // Compute team metrics across the whole role cohort so the
  // vs-team-avg deltas use the same baseline as the Team tab. Pull
  // the associate's row by name; if missing, the page renders the
  // "not found" empty state.
  const result = useMemo(
    () =>
      computeTeamMetrics(permits, projects, teamMembers, {
        role,
        // The drill-down shows the user's data regardless of active —
        // they clicked through, so respect their intent. The
        // activeOnly toggle gates the LIST on the Team tab, not the
        // detail page.
        activeOnly: false,
        dateFrom: null,
        dateTo: null,
        juris: '',
        includeRedesigns: true,
      }),
    [permits, projects, teamMembers, role],
  );

  const associate = result.rows.find((r) => r.name === name) ?? null;
  // Active-status lookup against the roster. Matches computeTeamMetrics's
  // OR-merge over role variants ('ent' + 'ent_lead' both count as ENT).
  const targetRoles =
    role === 'da'
      ? new Set(['da'])
      : role === 'dm'
        ? new Set(['dm'])
        : new Set(['ent', 'ent_lead']);
  const memberRosterMatch = teamMembers.some(
    (m) => m.name === name && targetRoles.has(m.role),
  );
  const isActive = teamMembers.some(
    (m) => m.name === name && targetRoles.has(m.role) && m.active !== false,
  );

  if (!associate && !memberRosterMatch) {
    return (
      <div className="space-y-4" data-testid="team-detail-page">
        <div data-testid="team-detail-back">
          <Link
            to={`/reports?tab=team`}
            className="text-xs font-bold text-de hover:underline"
          >
            ← Team Performance
          </Link>
        </div>
        <div
          className="text-sm text-dim italic px-3 py-12 text-center bg-surface border border-border rounded-lg"
          data-testid="team-detail-not-found"
        >
          Associate <span className="font-mono">{name}</span> not found in the{' '}
          {ROLE_LABEL[role]} roster.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="team-detail-page">
      {/* Back link — preserves the role so Team tab opens on the right
          sub-tab when the user clicks back. */}
      <div data-testid="team-detail-back">
        <Link
          to={`/reports?tab=team`}
          className="text-xs font-bold text-de hover:underline"
        >
          ← Team Performance
        </Link>
      </div>

      {/* Header — large name + role chip + active/inactive chip. */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1
          className="text-2xl font-display font-extrabold text-text"
          data-testid="team-detail-name"
        >
          {name}
        </h1>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
          style={{
            background: 'var(--color-de-bg)',
            color: 'var(--color-de)',
            borderColor: 'var(--color-de-border)',
          }}
          data-testid="team-detail-role"
        >
          {ROLE_LABEL[role]}
        </span>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
          style={{
            background: isActive
              ? 'var(--color-pm-bg)'
              : 'var(--color-s2)',
            color: isActive ? 'var(--color-pm)' : 'var(--color-dim)',
            borderColor: isActive
              ? 'var(--color-pm-border)'
              : 'var(--color-border)',
          }}
          data-testid="team-detail-active-status"
        >
          {isActive ? 'Active' : 'Inactive'}
        </span>
        {!associate && (
          <span
            className="text-[10px] italic text-dim"
            data-testid="team-detail-no-permits"
          >
            (no credited permits in window)
          </span>
        )}
      </div>

      {associate && (
        <>
          <VolumeSummary associate={associate} />
          <PhasePerformance associate={associate} result={result} />
        </>
      )}
      <ProjectList
        name={name}
        role={role}
        permits={permits}
        projects={projects}
      />
    </div>
  );
}

// ============================================================
// 131-d: project list
// ============================================================
//
// Lists every project the associate is credited on (any of their
// permits' role field matches their name). One row per project — when
// multiple permits at the same project credit them, the types column
// joins them. Sortable headers, sticky thead, redesign chip for
// projects whose redesign_of_project_id is set. Default sort: GO date
// desc (most recent first).

const STAGE_BADGE: Record<Stage, string> = {
  de: 'bg-de-bg text-de border-de-border',
  pm: 'bg-pm-bg text-pm border-pm-border',
  co: 'bg-co-bg text-co border-co-border',
  ap: 'bg-jv-bg text-jv border-jv-border',
  is: 'bg-is-bg text-is border-is-border',
};

function roleField(role: TeamRoleSelection): 'da' | 'dm' | 'ent_lead' {
  if (role === 'da') return 'da';
  if (role === 'dm') return 'dm';
  return 'ent_lead';
}

interface ProjectListRow {
  projectId: string;
  address: string;
  juris: string;
  types: string[];
  stage: Stage;
  goDate: string | null;
  targetSubmit: string | null;
  approvalDate: string | null;
  isRedesign: boolean;
}

type SortKey =
  | 'address'
  | 'juris'
  | 'stage'
  | 'goDate'
  | 'targetSubmit'
  | 'approvalDate';

function buildRows(
  name: string,
  role: TeamRoleSelection,
  permits: PermitWithCycles[],
  projects: Project[],
): ProjectListRow[] {
  const field = roleField(role);
  const projectsById = new Map<string, Project>();
  for (const p of projects) projectsById.set(p.id, p);

  // Group the associate's permits by project. The associate may have
  // multiple permits at a single project (BP + Demo, etc.), so accumulate.
  const byProjectId = new Map<string, PermitWithCycles[]>();
  for (const permit of permits) {
    const credited = (permit[field] ?? '').trim() === name;
    if (!credited) continue;
    const list = byProjectId.get(permit.project_id) ?? [];
    list.push(permit);
    byProjectId.set(permit.project_id, list);
  }

  const rows: ProjectListRow[] = [];
  for (const [projectId, projectPermits] of byProjectId) {
    const project = projectsById.get(projectId);
    if (!project) continue;
    const types = Array.from(
      new Set(projectPermits.map((p) => p.type).filter((t): t is string => !!t)),
    ).sort();
    const stage = worstStage(projectPermits);
    const maxDate = (dates: (string | null | undefined)[]): string | null => {
      const valid = dates.filter(
        (d): d is string => typeof d === 'string' && d.trim() !== '',
      );
      if (valid.length === 0) return null;
      return valid.sort()[valid.length - 1];
    };
    rows.push({
      projectId,
      address: project.address,
      juris: project.juris ?? '',
      types,
      stage,
      goDate: project.go_date ?? null,
      targetSubmit: maxDate(projectPermits.map((p) => p.target_submit)),
      approvalDate: maxDate(projectPermits.map((p) => p.approval_date)),
      isRedesign: !!project.redesign_of_project_id,
    });
  }
  return rows;
}

const STAGE_ORDER: Record<Stage, number> = {
  de: 0,
  pm: 1,
  co: 2,
  ap: 3,
  is: 4,
};

function ProjectList({
  name,
  role,
  permits,
  projects,
}: {
  name: string;
  role: TeamRoleSelection;
  permits: PermitWithCycles[];
  projects: Project[];
}) {
  const rows = useMemo(
    () => buildRows(name, role, permits, projects),
    [name, role, permits, projects],
  );
  const [sortKey, setSortKey] = useState<SortKey>('goDate');
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const out = [...rows];
    const dir = sortDesc ? -1 : 1;
    out.sort((a, b) => {
      if (sortKey === 'stage') {
        return (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) * dir;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls sort to the end regardless of direction.
      if ((av === null || av === '') && (bv === null || bv === '')) return 0;
      if (av === null || av === '') return 1;
      if (bv === null || bv === '') return -1;
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir;
      }
      return 0;
    });
    return out;
  }, [rows, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      setSortDesc(key === 'goDate' || key === 'approvalDate' || key === 'targetSubmit');
    }
  }

  if (rows.length === 0) {
    return (
      <section
        className="space-y-2 bg-surface border border-border rounded-lg px-4 py-12 text-center"
        data-testid="team-detail-project-list"
      >
        <div className="text-sm text-text font-display font-bold">
          {name} has no projects in the system.
        </div>
        <div className="text-xs text-dim italic">
          Maybe try adjusting the active-only filter on the main Team page.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2" data-testid="team-detail-project-list">
      <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
        Projects ({rows.length})
      </div>
      <div className="bg-surface border border-border rounded-lg overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-s2 sticky top-0 z-10">
            <tr className="border-b-2 border-border">
              <ProjectTh col="address" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort} align="left">
                Address
              </ProjectTh>
              <ProjectTh col="juris" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort} align="left">
                Juris
              </ProjectTh>
              <th className="px-2 py-1.5 text-[9px] uppercase tracking-wide font-display font-bold text-text/80 text-left">
                Permit Types
              </th>
              <ProjectTh col="stage" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
                Status
              </ProjectTh>
              <ProjectTh col="goDate" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
                GO Date
              </ProjectTh>
              <ProjectTh col="targetSubmit" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
                Target Submit
              </ProjectTh>
              <ProjectTh col="approvalDate" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
                Approval
              </ProjectTh>
              <th className="px-2 py-1.5 text-[9px] uppercase tracking-wide font-display font-bold text-text/80 text-center">
                Redesign?
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.projectId}
                className="border-b border-border hover:bg-s2 transition"
                data-testid={`team-detail-project-row-${row.projectId}`}
              >
                <td className="px-2 py-1.5 font-display font-bold">
                  <Link
                    to={`/project/${row.projectId}`}
                    className="text-de hover:underline"
                  >
                    {row.address}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-muted">{row.juris || '—'}</td>
                <td className="px-2 py-1.5 text-text">
                  {row.types.join(', ')}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span
                    className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border ${STAGE_BADGE[row.stage]}`}
                  >
                    {STAGE_LABEL[row.stage]}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center font-mono text-text">
                  {row.goDate ?? <span className="text-dim">—</span>}
                </td>
                <td className="px-2 py-1.5 text-center font-mono text-text">
                  {row.targetSubmit ?? <span className="text-dim">—</span>}
                </td>
                <td className="px-2 py-1.5 text-center font-mono text-text">
                  {row.approvalDate ?? <span className="text-dim">—</span>}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {row.isRedesign ? (
                    <span
                      className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border"
                      style={{
                        background: 'var(--color-co-bg)',
                        color: 'var(--color-co)',
                        borderColor: 'var(--color-co-border)',
                      }}
                      data-testid={`team-detail-project-row-${row.projectId}-redesign-chip`}
                    >
                      Redesign
                    </span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProjectTh({
  col,
  sortKey,
  sortDesc,
  onClick,
  align = 'center',
  children,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDesc: boolean;
  onClick: (col: SortKey) => void;
  align?: 'left' | 'center';
  children: React.ReactNode;
}) {
  const isActive = sortKey === col;
  const arrow = isActive ? (sortDesc ? '↓' : '↑') : '↕';
  return (
    <th
      onClick={() => onClick(col)}
      className={`px-2 py-1.5 text-[9px] uppercase tracking-wide font-display font-bold cursor-pointer select-none whitespace-nowrap text-${align} ${
        isActive ? 'text-text' : 'text-text/80'
      }`}
      data-testid={`team-detail-project-th-${col}`}
      aria-sort={isActive ? (sortDesc ? 'descending' : 'ascending') : 'none'}
    >
      {children} {arrow}
    </th>
  );
}

// ============================================================
// 131-c: phase performance summary — 4 cards with vs-team-avg deltas
// ============================================================
//
// Mirrors the TeamPerformanceTable.PhaseCell treatment but as cards.
// Each card renders the associate's value, the directional delta vs
// the team average (green/red/muted with arrow), and the team avg as
// subtext for context.
//
// All four phase metrics are "lower is better" — faster than the team
// avg colors green, slower colors red, within ±5% reads muted. Same
// no-signal band as fix-127-c's PhaseCell so the two surfaces agree on
// when a difference is significant.

const NO_SIGNAL_BAND = 0.05;

function classifyDelta(
  delta: number,
  teamAvg: number,
): 'good' | 'bad' | 'neutral' {
  if (teamAvg === 0) {
    return delta === 0 ? 'neutral' : delta > 0 ? 'bad' : 'good';
  }
  const pct = Math.abs(delta) / Math.abs(teamAvg);
  if (pct < NO_SIGNAL_BAND) return 'neutral';
  return delta < 0 ? 'good' : 'bad';
}

function PhasePerformance({
  associate,
  result,
}: {
  associate: TeamMemberMetrics;
  result: TeamMetricsResult;
}) {
  return (
    <section className="space-y-3" data-testid="team-detail-phase">
      <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
        Phase Performance
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PhaseCard
          metricKey="avgDdDays"
          value={associate.avgDdDays}
          teamAvg={result.teamAvgDdDays}
          unit="d"
          testId="team-detail-phase-dd"
        />
        <PhaseCard
          metricKey="avgCityReviewDays"
          value={associate.avgCityReviewDays}
          teamAvg={result.teamAvgCityReviewDays}
          unit="d"
          testId="team-detail-phase-city-review"
        />
        <PhaseCard
          metricKey="avgCorrectionsCycles"
          value={associate.avgCorrectionsCycles}
          teamAvg={result.teamAvgCorrectionsCycles}
          unit=""
          testId="team-detail-phase-corrections"
        />
        <PhaseCard
          metricKey="avgIssuanceDays"
          value={associate.avgIssuanceDays}
          teamAvg={result.teamAvgIssuanceDays}
          unit="d"
          testId="team-detail-phase-issuance"
        />
      </div>
    </section>
  );
}

function PhaseCard({
  metricKey,
  value,
  teamAvg,
  unit,
  testId,
}: {
  metricKey: keyof typeof TEAM_DETAIL_PHASE_METRICS;
  value: number | null;
  teamAvg: number | null;
  unit: string;
  testId: string;
}) {
  const def = TEAM_DETAIL_PHASE_METRICS[metricKey];
  const labelNode = (
    <MetricInfoTooltip
      label={def.label}
      description={def.description}
      formula={def.formula}
      cohort={def.cohort}
      slug={`team-${metricKey}`}
    />
  );

  if (value === null) {
    return (
      <div
        className="bg-surface border border-border rounded-lg px-4 py-3 flex flex-col gap-1"
        data-testid={testId}
        data-tone="neutral"
      >
        <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
          {labelNode}
        </div>
        <div className="text-2xl font-display font-extrabold text-dim">—</div>
        <div className="text-[10px] text-dim italic">Not enough data</div>
      </div>
    );
  }

  const delta = teamAvg !== null ? formatCompareNumber(value - teamAvg) : null;
  const tone =
    delta === null || teamAvg === null
      ? 'neutral'
      : classifyDelta(delta, teamAvg);
  const color =
    tone === 'good'
      ? 'var(--color-pm)'
      : tone === 'bad'
        ? 'var(--color-co)'
        : 'var(--color-muted)';
  const arrow =
    delta === null ? '' : delta > 0 ? '↑' : delta < 0 ? '↓' : '→';

  return (
    <div
      className="bg-surface border border-border rounded-lg px-4 py-3 flex flex-col gap-1"
      data-testid={testId}
      data-tone={tone}
    >
      <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
        {labelNode}
      </div>
      <div className="text-2xl font-display font-extrabold text-text">
        {value}
        <span className="text-sm font-display font-normal text-muted ml-0.5">
          {unit}
        </span>
      </div>
      {delta !== null && (
        <div
          className="text-[11px] font-bold flex items-center gap-1"
          style={{ color }}
          data-testid={`${testId}-delta`}
        >
          <span aria-hidden="true">{arrow}</span>
          <span>
            {delta > 0 ? '+' : ''}
            {delta}
            {unit}
          </span>
        </div>
      )}
      {teamAvg !== null && (
        <div className="text-[10px] text-muted">
          Team avg: {teamAvg}
          {unit}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 131-b: volume summary — Originals row + (conditional) Redesigns row
// ============================================================
//
// One card per volume metric. Mirrors the Reports/Overview MetricCards
// visual register: small uppercase label + big value + optional
// subtext. No KpiSplitView — single-cohort drill-down, no comparison
// cohort to render side-by-side.

function VolumeSummary({ associate }: { associate: TeamMemberMetrics }) {
  const hasRedesigns =
    associate.redesignProjectCount > 0 ||
    associate.redesignUnitCount > 0 ||
    associate.redesignLotCount > 0 ||
    associate.redesignPermitCount > 0;

  return (
    <section className="space-y-3" data-testid="team-detail-volume">
      <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
        Originals
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <VolumeCard
          label="Projects"
          value={associate.projectCount}
          subtext={
            hasRedesigns
              ? `+${associate.redesignProjectCount} redesigns = ${
                  associate.projectCount + associate.redesignProjectCount
                } total`
              : undefined
          }
          testId="team-detail-volume-projects"
        />
        <VolumeCard
          label="Units"
          value={associate.unitCount}
          subtext={
            hasRedesigns
              ? `+${associate.redesignUnitCount} redesign units = ${
                  associate.unitCount + associate.redesignUnitCount
                } total`
              : undefined
          }
          testId="team-detail-volume-units"
        />
        <VolumeCard
          label="Lots"
          value={associate.lotCount}
          subtext={
            hasRedesigns
              ? `+${associate.redesignLotCount} redesign lots = ${
                  associate.lotCount + associate.redesignLotCount
                } total`
              : undefined
          }
          testId="team-detail-volume-lots"
        />
        <VolumeCard
          label="Permits"
          value={associate.permitCount}
          subtext={
            hasRedesigns
              ? `+${associate.redesignPermitCount} redesign permits = ${
                  associate.permitCount + associate.redesignPermitCount
                } total`
              : undefined
          }
          testId="team-detail-volume-permits"
        />
      </div>
      {hasRedesigns && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold pt-2">
            Redesigns
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <VolumeCard
              label="Redesign Projects"
              value={associate.redesignProjectCount}
              testId="team-detail-volume-redesign-projects"
            />
            <VolumeCard
              label="Redesign Units"
              value={associate.redesignUnitCount}
              testId="team-detail-volume-redesign-units"
            />
            <VolumeCard
              label="Redesign Lots"
              value={associate.redesignLotCount}
              testId="team-detail-volume-redesign-lots"
            />
            <VolumeCard
              label="Redesign Permits"
              value={associate.redesignPermitCount}
              testId="team-detail-volume-redesign-permits"
            />
          </div>
        </>
      )}
    </section>
  );
}

function VolumeCard({
  label,
  value,
  subtext,
  testId,
}: {
  label: string;
  value: number;
  subtext?: string;
  testId: string;
}) {
  return (
    <div
      className="bg-surface border border-border rounded-lg px-4 py-3 flex flex-col gap-1"
      data-testid={testId}
    >
      <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
        {label}
      </div>
      <div className="text-2xl font-display font-extrabold text-text">
        {value}
      </div>
      {subtext && (
        <div className="text-[10px] text-muted truncate">{subtext}</div>
      )}
    </div>
  );
}
