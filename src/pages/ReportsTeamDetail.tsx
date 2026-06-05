import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  computeTeamMetrics,
  type TeamMemberMetrics,
  type TeamRoleSelection,
} from '../lib/teamPerformance';

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
        </>
      )}
      {/* 131-c: phase performance summary lands here. */}
      {/* 131-d: project list lands here. */}
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
