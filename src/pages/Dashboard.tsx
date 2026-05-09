import { useMemo, useState } from 'react';
import NewProjectWizard from '../components/NewProjectWizard';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useDrawSchedule } from '../hooks/useDrawSchedule';
import {
  bucketPermits,
  hideIssuedAtAddress,
  type BucketInput,
  type BucketedPermits,
} from '../lib/permitStage';
import type {
  DrawScheduleRow,
  Permit,
  Project,
  Stage,
} from '../lib/database.types';
import PermitCard from '../components/PermitCard';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';

// Q2: Dashboard matrix. Project-keyed render — iterates `projects`, looks
// up permits via project_id, classifies each by effectiveStage, splits the
// D&E column into early/late buckets via the draw_schedule status.
//
// Layout faithfully ports v1 (index.html line 661-745):
//   ROW 1: D&E group (Scheduled & Schematic | DD & Pending Consultants)
//          Permitting group (Under Review | Corrections)
//   ROW 2: Approval + Issued strips
//
// No placeholder permit synthesis — empty projects show in the search list,
// not as a fake card in a matrix slot.

export default function Dashboard() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const drawQ = useDrawSchedule();
  const [search, setSearch] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);

  const isLoading = projectsQ.isLoading || permitsQ.isLoading || drawQ.isLoading;
  const error = projectsQ.error ?? permitsQ.error ?? drawQ.error;

  const { buckets, projectById } = useMemo(() => {
    const projects = projectsQ.data ?? [];
    const permits = permitsQ.data ?? [];
    const draw = drawQ.data ?? [];

    const projectByIdMap = new Map<string, Project>(
      projects.map((p) => [p.id, p]),
    );
    const drawByProjectId = new Map<string, DrawScheduleRow>(
      draw.map((d) => [d.project_id, d]),
    );
    const projectIdToAddress = new Map<string, string>(
      projects.map((p) => [p.id, p.address]),
    );

    // Apply search filter at the project level — matches address, juris,
    // permit DA/DM/lead, permit num. Tokens AND-combine (space or comma).
    const tokens = search
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    const matchesSearch = (project: Project, projectPermits: Permit[]) => {
      if (!tokens.length) return true;
      const haystack = [
        project.address,
        project.juris ?? '',
        ...projectPermits.flatMap((p) => [
          p.da ?? '',
          p.dual_da ?? '',
          p.dm ?? '',
          p.ent_lead ?? '',
          p.permit_owner ?? '',
          p.num ?? '',
          p.type ?? '',
        ]),
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    };

    const permitsByProjectId = new Map<string, BucketInput[]>();
    for (const permit of permits) {
      const list = permitsByProjectId.get(permit.project_id) ?? [];
      list.push({ permit, cycles: permit.permit_cycles ?? [] });
      permitsByProjectId.set(permit.project_id, list);
    }

    // Project-keyed iteration — every visible permit must belong to a project.
    const filteredInputs: BucketInput[] = [];
    for (const project of projects) {
      const projectPermits = permitsByProjectId.get(project.id) ?? [];
      if (!matchesSearch(project, projectPermits.map((b) => b.permit))) continue;
      filteredInputs.push(...projectPermits);
    }

    const hide = hideIssuedAtAddress(filteredInputs, projectIdToAddress);
    const visible = filteredInputs.filter((b) => !hide.has(b.permit.id));
    const bucketed = bucketPermits(visible, drawByProjectId);

    return { buckets: bucketed, projectById: projectByIdMap };
  }, [projectsQ.data, permitsQ.data, drawQ.data, search]);

  if (error) {
    return (
      <QueryError
        title="Dashboard data failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
          drawQ.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address, DA, ENT, juris, num... (space or comma = AND)"
          className="flex-1 min-w-[220px] max-w-[360px] bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
        />
        <DashSummary buckets={buckets} loading={isLoading} />
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition"
          data-testid="dashboard-new-project"
        >
          + Add New Project
        </button>
      </div>
      <NewProjectWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StageGroup
          title="Design & Engineering"
          accent="de"
          totalCount={buckets.deEarly.length + buckets.deLate.length}
          loading={isLoading}
          subBuckets={[
            {
              title: 'Scheduled & Schematic',
              dotColor: '#5a84c0',
              permits: buckets.deEarly,
              keyDateLabel: 'Target Submit',
              getKeyDate: (p) => p.target_submit,
            },
            {
              title: 'DD & Pending Consultants',
              dotColor: '#02267e',
              permits: buckets.deLate,
              keyDateLabel: 'Target Submit',
              getKeyDate: (p) => p.target_submit,
            },
          ]}
          stage="de"
          projectById={projectById}
          permitsData={permitsQ.data ?? []}
        />
        <StageGroup
          title="Permitting"
          accent="pm"
          totalCount={buckets.pm.length + buckets.co.length}
          loading={isLoading}
          subBuckets={[
            {
              title: 'Under Review',
              dotColor: '#5cb8b2',
              permits: buckets.pm,
              keyDateLabel: 'City Target',
              getKeyDate: getMostRecentCityTarget(permitsQ.data ?? []),
            },
            {
              title: 'Corrections',
              dotColor: '#d97706',
              permits: buckets.co,
              keyDateLabel: 'Corrections Out',
              getKeyDate: getMostRecentCorrIssued(permitsQ.data ?? []),
            },
          ]}
          stage="pm"
          projectById={projectById}
          permitsData={permitsQ.data ?? []}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BottomStrip
          title="Approval"
          accent="jv"
          subtitle="approved, pending issue"
          permits={buckets.ap}
          stage="ap"
          keyDateLabel="Approved"
          getKeyDate={(p) => p.approval_date}
          projectById={projectById}
          loading={isLoading}
        />
        <BottomStrip
          title="Issued"
          accent="is"
          subtitle="active issued permits at this address"
          permits={buckets.is}
          stage="is"
          keyDateLabel="Issued"
          getKeyDate={(p) => p.actual_issue}
          projectById={projectById}
          loading={isLoading}
        />
      </div>
    </div>
  );
}

interface SubBucket {
  title: string;
  dotColor: string;
  permits: Permit[];
  keyDateLabel: string;
  getKeyDate: (p: Permit) => string | null;
}

interface StageGroupProps {
  title: string;
  accent: 'de' | 'pm';
  totalCount: number;
  loading: boolean;
  subBuckets: SubBucket[];
  stage: Stage;
  projectById: Map<string, Project>;
  permitsData: Permit[];
}

function StageGroup({
  title,
  accent,
  totalCount,
  loading,
  subBuckets,
  stage,
  projectById,
}: StageGroupProps) {
  const accentClass = accent === 'de' ? 'bg-de' : 'bg-pm';
  return (
    <section className="bg-surface border border-border rounded-xl overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className={`w-2 h-2 rounded-full ${accentClass}`} />
        <span className="text-xs font-display font-extrabold uppercase tracking-wide text-text flex-1">
          {title}
        </span>
        <span className="text-2xl font-display font-black text-text">
          {totalCount}
        </span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-border">
        {subBuckets.map((sub) => (
          <div key={sub.title} className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: sub.dotColor }}
              />
              <span className="text-[11px] font-display font-bold text-text flex-1">
                {sub.title}
              </span>
              <span className="text-xs font-display font-black text-text">
                {sub.permits.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {loading ? (
                <SkeletonRows count={2} rowClassName="h-16" />
              ) : sub.permits.length === 0 ? (
                <div className="text-[11px] text-dim italic px-2 py-3">
                  No permits
                </div>
              ) : (
                sub.permits.map((p) => (
                  <PermitCard
                    key={p.id}
                    permit={p}
                    project={projectById.get(p.project_id)}
                    stage={stage}
                    keyDate={sub.getKeyDate(p)}
                    keyDateLabel={sub.keyDateLabel}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface BottomStripProps {
  title: string;
  accent: 'jv' | 'is';
  subtitle: string;
  permits: Permit[];
  stage: Stage;
  keyDateLabel: string;
  getKeyDate: (p: Permit) => string | null;
  projectById: Map<string, Project>;
  loading: boolean;
}

function BottomStrip({
  title,
  accent,
  subtitle,
  permits,
  stage,
  keyDateLabel,
  getKeyDate,
  projectById,
  loading,
}: BottomStripProps) {
  const [open, setOpen] = useState(false);
  const accentClass = accent === 'jv' ? 'bg-jv' : 'bg-is';
  return (
    <section className="bg-surface border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-s2 transition text-left"
      >
        <span className={`w-2 h-2 rounded-full ${accentClass}`} />
        <span className="text-[11px] font-display font-extrabold uppercase tracking-wide text-text">
          {title}
        </span>
        <span className="text-base font-display font-black text-text">
          {permits.length}
        </span>
        <span className="text-[9px] text-dim ml-auto">{subtitle}</span>
        <span
          className="text-dim text-[10px] transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)' }}
        >
          ▶
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          {loading ? (
            <SkeletonRows count={2} rowClassName="h-16" />
          ) : permits.length === 0 ? (
            <div className="text-[11px] text-dim italic px-2 py-3">
              No permits
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {permits.map((p) => (
                <PermitCard
                  key={p.id}
                  permit={p}
                  project={projectById.get(p.project_id)}
                  stage={stage}
                  keyDate={getKeyDate(p)}
                  keyDateLabel={keyDateLabel}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface DashSummaryProps {
  buckets: BucketedPermits;
  loading: boolean;
}

function DashSummary({ buckets, loading }: DashSummaryProps) {
  if (loading) return <span className="text-xs text-dim">Loading…</span>;
  const parts = [
    `${buckets.deEarly.length + buckets.deLate.length} D&E`,
    `${buckets.pm.length} Permitting`,
    `${buckets.co.length} Corrections`,
    `${buckets.ap.length} Approved`,
    `${buckets.is.length} Issued`,
  ];
  return (
    <span className="text-[11px] text-muted font-mono ml-auto">
      {parts.join(' · ')}
    </span>
  );
}

// Helpers for permitting column key dates — pull most-recent cycle field
// across all cycles attached to that permit.
function getMostRecentCityTarget(permits: Permit[]) {
  const cycles = new Map<number, { city_target: string | null }[]>();
  for (const p of permits) {
    const ps = p as Permit & { permit_cycles?: { city_target: string | null }[] };
    cycles.set(ps.id, ps.permit_cycles ?? []);
  }
  return (p: Permit) => mostRecent(cycles.get(p.id) ?? [], (c) => c.city_target);
}

function getMostRecentCorrIssued(permits: Permit[]) {
  const cycles = new Map<number, { corr_issued: string | null }[]>();
  for (const p of permits) {
    const ps = p as Permit & { permit_cycles?: { corr_issued: string | null }[] };
    cycles.set(ps.id, ps.permit_cycles ?? []);
  }
  return (p: Permit) => mostRecent(cycles.get(p.id) ?? [], (c) => c.corr_issued);
}

function mostRecent<T>(rows: T[], pick: (row: T) => string | null): string | null {
  const dates = rows.map(pick).filter((d): d is string => Boolean(d)).sort();
  return dates.length ? dates[dates.length - 1] : null;
}
