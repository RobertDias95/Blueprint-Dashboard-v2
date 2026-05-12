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
import { permitUrgency } from '../lib/urgencyHelpers';
import type {
  DrawScheduleRow,
  Permit,
  PermitCycle,
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

  const { buckets, projectById, cyclesByPermit } = useMemo(() => {
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

    // Q9.5.c: per-permit cycle index for urgency lookups. Reuses the
    // same shape `bucketPermits` consumed so we don't re-walk permits.
    const cyclesByPermit = new Map<number, PermitCycle[]>();
    for (const b of visible) {
      cyclesByPermit.set(b.permit.id, b.cycles);
    }

    return {
      buckets: bucketed,
      projectById: projectByIdMap,
      cyclesByPermit,
    };
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
          cyclesByPermit={cyclesByPermit}
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
              // Q9.5.c: 'pm' urgency uses the latest city_target across cycles.
              urgencyStage: 'pm',
            },
            {
              title: 'Corrections',
              dotColor: '#d97706',
              permits: buckets.co,
              keyDateLabel: 'Corrections Out',
              getKeyDate: getMostRecentCorrIssued(permitsQ.data ?? []),
              // Corrections sub-bucket evaluates urgency under 'co' rules
              // (business-days-since open corr_issued), even though the
              // parent group's accent is pm.
              urgencyStage: 'co',
            },
          ]}
          stage="pm"
          projectById={projectById}
          cyclesByPermit={cyclesByPermit}
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
          cyclesByPermit={cyclesByPermit}
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
          cyclesByPermit={cyclesByPermit}
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
  /** Q9.5.c: optional override for urgency math when the sub-bucket's
   *  urgency stage differs from the group's parent stage (e.g., the
   *  Corrections sub-bucket inside the Permitting group uses 'co'
   *  predicates). Defaults to the parent group's `stage`. */
  urgencyStage?: Stage;
}

interface StageGroupProps {
  title: string;
  accent: 'de' | 'pm';
  totalCount: number;
  loading: boolean;
  subBuckets: SubBucket[];
  stage: Stage;
  projectById: Map<string, Project>;
  cyclesByPermit: Map<number, PermitCycle[]>;
}

// Q9.5.c: header backgrounds use the stage-bg tint per v1 §4.6.a.
// Tints are intentionally LIGHT so the count text stays readable.
const STAGE_HEADER_BG: Record<'de' | 'pm', string> = {
  de: 'var(--color-de-bg)',
  pm: 'var(--color-pm-bg)',
};
const STAGE_HEADER_BORDER: Record<'de' | 'pm', string> = {
  de: 'var(--color-de-border)',
  pm: 'var(--color-pm-border)',
};

function StageGroup({
  title,
  accent,
  totalCount,
  loading,
  subBuckets,
  stage,
  projectById,
  cyclesByPermit,
}: StageGroupProps) {
  return (
    <section className="bg-surface border border-border rounded-xl overflow-hidden">
      <header
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{
          background: STAGE_HEADER_BG[accent],
          borderBottomColor: STAGE_HEADER_BORDER[accent],
        }}
      >
        <span className="text-xs font-display font-extrabold uppercase tracking-wide text-text flex-1">
          {title}
        </span>
        <span className="text-2xl font-display font-black text-text">
          {totalCount}
        </span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-border">
        {subBuckets.map((sub) => {
          const subStage: Stage = sub.urgencyStage ?? stage;
          return (
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
                  sub.permits.map((p) => {
                    const cycles = cyclesByPermit.get(p.id) ?? [];
                    const urgency = permitUrgency(p, cycles, subStage);
                    return (
                      <PermitCard
                        key={p.id}
                        permit={p}
                        project={projectById.get(p.project_id)}
                        stage={subStage}
                        keyDate={sub.getKeyDate(p)}
                        keyDateLabel={sub.keyDateLabel}
                        urgency={urgency}
                      />
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
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
  cyclesByPermit: Map<number, PermitCycle[]>;
  loading: boolean;
}

// Q9.5.c: same stage-bg tinting pattern as the top stage groups for
// the Approval (jv) + Issued (is) bottom strips.
const BOTTOM_STRIP_BG: Record<'jv' | 'is', string> = {
  jv: 'var(--color-jv-bg)',
  is: 'var(--color-is-bg)',
};
const BOTTOM_STRIP_BORDER: Record<'jv' | 'is', string> = {
  jv: 'var(--color-jv-border)',
  is: 'var(--color-is-border)',
};

function BottomStrip({
  title,
  accent,
  subtitle,
  permits,
  stage,
  keyDateLabel,
  getKeyDate,
  projectById,
  cyclesByPermit,
  loading,
}: BottomStripProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-surface border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 transition text-left"
        style={{
          background: BOTTOM_STRIP_BG[accent],
          borderBottom: open ? `1px solid ${BOTTOM_STRIP_BORDER[accent]}` : 'none',
        }}
      >
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
        <div className="p-3">
          {loading ? (
            <SkeletonRows count={2} rowClassName="h-16" />
          ) : permits.length === 0 ? (
            <div className="text-[11px] text-dim italic px-2 py-3">
              No permits
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {permits.map((p) => {
                const cycles = cyclesByPermit.get(p.id) ?? [];
                const urgency = permitUrgency(p, cycles, stage);
                return (
                  <PermitCard
                    key={p.id}
                    permit={p}
                    project={projectById.get(p.project_id)}
                    stage={stage}
                    keyDate={getKeyDate(p)}
                    keyDateLabel={keyDateLabel}
                    urgency={urgency}
                  />
                );
              })}
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
