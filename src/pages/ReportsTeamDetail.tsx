import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
import {
  computeTeamTrends,
  type PhaseMonthEntry,
  type TeamTrendsResult,
} from '../lib/teamTrends';
import MetricInfoTooltip from '../components/shared/MetricInfoTooltip';
import ExportCsvButton from '../components/shared/ExportCsvButton';
import { rowsToCsv } from '../lib/reportCsv';
import { formatCompareNumber } from '../lib/comparisonCohort';
import { TEAM_DETAIL_PHASE_METRICS } from '../lib/metricDefinitions';
import { worstStage } from '../lib/libraryHelpers';
import { STAGE_LABEL } from '../lib/stageLabel';
import type {
  PermitWithCycles,
  Project,
  Stage,
  TeamMember,
} from '../lib/database.types';

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

  // fix-135-b: drill-down CSV export — the project list rows at the
  // bottom of the page. The same buildRows() that drives ProjectList
  // also drives the export, so a filter change flows through both
  // surfaces simultaneously. Declared BEFORE the not-found early
  // return so React Hooks call order is stable across renders.
  const projectRows = useMemo(
    () => buildRows(name, role, permits, projects),
    [name, role, permits, projects],
  );
  const csvFilename = `${slugifyName(name)}-projects-${todayStamp()}.csv`;
  const handleExport = (): string => buildDrilldownCsv(projectRows);

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
      {/* Back link + Export CSV — share the page header line so the
          export button sits in the same visual position as on the
          Team tab. */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div data-testid="team-detail-back">
          <Link
            to={`/reports?tab=team`}
            className="text-xs font-bold text-de hover:underline"
          >
            ← Team Performance
          </Link>
        </div>
        <ExportCsvButton
          filename={csvFilename}
          onExport={handleExport}
          disabled={projectRows.length === 0}
          testId="team-detail-export-csv-button"
        />
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
          {/* fix-132: monthly trend charts beneath the snapshot cards.
              Independent of the snapshot — its own range selector,
              its own cohort gates. Renders only when the associate
              has at least one credited permit (no point computing
              trends for an empty cohort). */}
          <PhaseTrends
            associateName={name}
            role={role}
            permits={permits}
            projects={projects}
            teamMembers={teamMembers}
          />
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

// ============================================================
// 132-b: phase trend charts (monthly)
// ============================================================
//
// 4 line charts in a 2×2 grid, one per phase metric. Each chart shows
// the associate's monthly avg overlaid against the team avg for the
// same month — "is Trevor getting faster on DD over time?" patterns
// surface visually. Range selector at top — independent of the
// snapshot above; defaults to 6 months.

type TrendRange = 3 | 6 | 12 | 24;
const TREND_RANGES: TrendRange[] = [3, 6, 12, 24];

const PHASE_DEFS: Array<{
  key: keyof TeamTrendsResult;
  metricKey: keyof typeof TEAM_DETAIL_PHASE_METRICS;
  testId: string;
  unit: string;
}> = [
  { key: 'ddPhase', metricKey: 'avgDdDays', testId: 'team-detail-trend-dd', unit: 'd' },
  {
    key: 'cityReview',
    metricKey: 'avgCityReviewDays',
    testId: 'team-detail-trend-city-review',
    unit: 'd',
  },
  {
    key: 'corrections',
    metricKey: 'avgCorrectionsCycles',
    testId: 'team-detail-trend-corrections',
    unit: '',
  },
  {
    key: 'issuance',
    metricKey: 'avgIssuanceDays',
    testId: 'team-detail-trend-issuance',
    unit: 'd',
  },
];

/** Subtract N months from a Date and return 'YYYY-MM'. Used to build
 *  the inclusive monthFrom anchor for the range selector. Pure integer
 *  math on year/month components to dodge Date-object TZ weirdness. */
function shiftMonth(today: Date, monthsBack: number): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  let targetY = y;
  let targetM = m - monthsBack;
  while (targetM <= 0) {
    targetM += 12;
    targetY -= 1;
  }
  return `${String(targetY).padStart(4, '0')}-${String(targetM).padStart(2, '0')}`;
}

function currentMonth(today: Date): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

function PhaseTrends({
  associateName,
  role,
  permits,
  projects,
  teamMembers,
}: {
  associateName: string;
  role: TeamRoleSelection;
  permits: PermitWithCycles[];
  projects: Project[];
  teamMembers: TeamMember[];
}) {
  const [range, setRange] = useState<TrendRange>(6);
  // Stable "now" anchor for the lifetime of this mount — re-mounts on
  // navigation (new associate/role) will recompute; pressing a range
  // button after that shifts the window without drifting.
  const today = useMemo(() => new Date(), []);
  const monthTo = useMemo(() => currentMonth(today), [today]);
  const monthFrom = useMemo(
    () => shiftMonth(today, range - 1),
    [today, range],
  );
  const trends = useMemo(
    () =>
      computeTeamTrends(permits, projects, teamMembers, {
        role,
        associateName,
        monthFrom,
        monthTo,
      }),
    [permits, projects, teamMembers, role, associateName, monthFrom, monthTo],
  );

  return (
    <section className="space-y-3" data-testid="team-detail-phase-trends">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-wide text-dim font-display font-bold">
          Phase Trend
        </div>
        <div
          role="tablist"
          aria-label="Trend range"
          className="flex items-center gap-1"
          data-testid="team-detail-trend-range"
        >
          {TREND_RANGES.map((r) => {
            const isActive = range === r;
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setRange(r)}
                className="text-[10px] font-display font-bold px-2.5 py-1 rounded-md border transition"
                style={{
                  background: isActive
                    ? 'var(--color-de)'
                    : 'var(--color-surface)',
                  color: isActive ? '#fff' : 'var(--color-muted)',
                  borderColor: isActive
                    ? 'var(--color-de)'
                    : 'var(--color-border)',
                }}
                data-testid={`team-detail-trend-range-${r}`}
                data-active={isActive ? 'true' : 'false'}
              >
                {r} months
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PHASE_DEFS.map((def) => (
          <TrendChart
            key={def.key}
            entries={trends[def.key]}
            metricKey={def.metricKey}
            associateName={associateName}
            testId={def.testId}
            unit={def.unit}
          />
        ))}
      </div>
    </section>
  );
}

interface ChartRow {
  month: string;
  associateAvg: number | null;
  teamAvg: number | null;
  associateN: number;
  teamN: number;
}

function TrendChart({
  entries,
  metricKey,
  associateName,
  testId,
  unit,
}: {
  entries: PhaseMonthEntry[];
  metricKey: keyof typeof TEAM_DETAIL_PHASE_METRICS;
  associateName: string;
  testId: string;
  unit: string;
}) {
  const def = TEAM_DETAIL_PHASE_METRICS[metricKey];
  const data: ChartRow[] = entries.map((e) => ({
    month: e.month,
    associateAvg: e.associateAvg,
    teamAvg: e.teamAvg,
    associateN: e.associateN,
    teamN: e.teamN,
  }));
  // Empty state: no associate data points anywhere in the window.
  const hasAssociateData = entries.some((e) => e.associateAvg !== null);

  return (
    <div
      className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-1"
      data-testid={testId}
    >
      <div className="text-[11px] font-display font-bold text-text">
        <MetricInfoTooltip
          label={def.label}
          description={def.description}
          formula={def.formula}
          cohort={def.cohort}
          slug={`team-trend-${metricKey}`}
        />
      </div>
      {!hasAssociateData ? (
        <div
          className="h-40 flex items-center justify-center text-dim italic text-xs text-center px-4"
          data-testid={`${testId}-empty`}
        >
          Not enough data in the {entries.length} month window.
        </div>
      ) : (
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 9, fill: 'var(--color-dim)' }}
              />
              <YAxis
                tick={{ fontSize: 9, fill: 'var(--color-dim)' }}
                width={28}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  fontSize: 11,
                }}
                formatter={(value, name, item) => {
                  const payload = (
                    item as { payload?: ChartRow } | undefined
                  )?.payload;
                  if (name === 'teamAvg') {
                    return [
                      `${value}${unit} · n=${payload?.teamN ?? 0}`,
                      'Team avg',
                    ];
                  }
                  return [
                    `${value}${unit} · n=${payload?.associateN ?? 0}`,
                    associateName,
                  ];
                }}
              />
              <Line
                type="monotone"
                dataKey="associateAvg"
                name="associateAvg"
                stroke="var(--color-de)"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="teamAvg"
                name="teamAvg"
                stroke="var(--color-muted)"
                strokeWidth={2}
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                dot={{ r: 2, fillOpacity: 0.7 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ============================================================
// fix-135-b: CSV export helpers
// ============================================================

const DRILLDOWN_CSV_COLUMNS = [
  { key: 'address', label: 'Project Address' },
  { key: 'juris', label: 'Juris' },
  { key: 'types', label: 'Permit Types' },
  { key: 'stage', label: 'Stage' },
  { key: 'goDate', label: 'GO Date' },
  { key: 'targetSubmit', label: 'Target Submit' },
  { key: 'approvalDate', label: 'Approval Date' },
  { key: 'isRedesign', label: 'Redesign?' },
];

function buildDrilldownCsv(rows: ProjectListRow[]): string {
  if (rows.length === 0) return '';
  return rowsToCsv(
    DRILLDOWN_CSV_COLUMNS,
    rows.map((r) => ({
      address: r.address,
      juris: r.juris,
      // Permit types: comma-joined string lands in a single cell;
      // rowsToCsv quotes the cell automatically because of the comma.
      types: r.types.join(', '),
      stage: STAGE_LABEL[r.stage] ?? r.stage,
      goDate: r.goDate ?? '',
      targetSubmit: r.targetSubmit ?? '',
      approvalDate: r.approvalDate ?? '',
      isRedesign: r.isRedesign ? 'Yes' : 'No',
    })),
  );
}

function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'associate';
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
