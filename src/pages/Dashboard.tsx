import { useCallback, useMemo, useState } from 'react';
import NewProjectWizard from '../components/NewProjectWizard';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useDrawSchedule } from '../hooks/useDrawSchedule';
import {
  bucketPermits,
  hideIssuedAtAddress,
  type BucketInput,
} from '../lib/permitStage';
import { cardUrgency } from '../lib/urgencyHelpers';
import type {
  DrawScheduleRow,
  Permit,
  PermitCycle,
  Project,
  Stage,
} from '../lib/database.types';
import AddrGroup from '../components/Dashboard/AddrGroup';
import StageFilters, {
  EMPTY_DASH_FILTERS,
  permitPassesDashFilters,
  type DashFilters,
} from '../components/Dashboard/StageFilters';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';

// Q9.5.e2: cross-bucket interactivity. `DashContext` lifts `highlightedAddress`
// + `openAddresses` to the Dashboard root so toggling open/highlight on one
// .addr-group propagates to every sub-bucket that shows the same address —
// mirrors v1's `toggleProjectExpanded` at index.html:2832 + `highlightProject`
// at :2823.
interface DashContext {
  highlightedAddress: string | null;
  openAddresses: Set<string>;
  toggleAddress: (addr: string) => void;
  setHighlight: (addr: string | null) => void;
}

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
  const [filters, setFilters] = useState<DashFilters>(EMPTY_DASH_FILTERS);
  const [highlightedAddress, setHighlightedAddress] = useState<string | null>(null);
  const [openAddresses, setOpenAddresses] = useState<Set<string>>(new Set());

  const toggleAddress = useCallback((addr: string) => {
    let didOpen = false;
    setOpenAddresses((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) {
        next.delete(addr);
        didOpen = false;
      } else {
        next.add(addr);
        didOpen = true;
      }
      return next;
    });
    // Mirror v1 :2864 — open toggles the highlight to this addr; close clears it.
    setHighlightedAddress((cur) => (cur === addr ? null : addr));
    // Q9.5.e2-fix-6: double rAF — first rAF runs after commit but before
    // paint; second runs after the first paint. Belt-and-suspenders for
    // cases where the expanded body hasn't laid out by the first frame.
    if (didOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollAddrIntoView(addr));
      });
    }
  }, []);

  const dashCtx: DashContext = useMemo(
    () => ({
      highlightedAddress,
      openAddresses,
      toggleAddress,
      setHighlight: setHighlightedAddress,
    }),
    [highlightedAddress, openAddresses, toggleAddress],
  );

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
    // Q9.5.f Item 2: per-permit ENT/DA/DM/Type filter on top of the
    // project-level search filter. Empty filter Sets are no-ops; specific
    // values exclude permits whose dimension is null per v1 :4949-4951.
    const filteredInputs: BucketInput[] = [];
    for (const project of projects) {
      const projectPermits = permitsByProjectId.get(project.id) ?? [];
      if (!matchesSearch(project, projectPermits.map((b) => b.permit))) continue;
      for (const b of projectPermits) {
        if (!permitPassesDashFilters(b.permit, filters)) continue;
        filteredInputs.push(b);
      }
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
  }, [projectsQ.data, permitsQ.data, drawQ.data, search, filters]);

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
        {/* Q9.5.f Item 2: filter dropdowns inline with search bar */}
        <StageFilters
          permits={permitsQ.data ?? []}
          filters={filters}
          onChange={setFilters}
        />
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition ml-auto"
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
          ctx={dashCtx}
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
          ctx={dashCtx}
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
          ctx={dashCtx}
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
          ctx={dashCtx}
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
  ctx: DashContext;
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
  ctx,
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
              <div
                className="border border-border rounded-md overflow-y-auto"
                style={{ maxHeight: 'calc(100vh - 220px)' }}
                data-scroll-bucket="true"
              >
                {loading ? (
                  <div className="p-2">
                    <SkeletonRows count={2} rowClassName="h-16" />
                  </div>
                ) : sub.permits.length === 0 ? (
                  <div className="text-[11px] text-dim italic px-2 py-3">
                    No permits
                  </div>
                ) : (
                  <SubBucketGroups
                    permits={sub.permits}
                    stage={subStage}
                    cyclesByPermit={cyclesByPermit}
                    projectById={projectById}
                    keyDateLabel={sub.keyDateLabel}
                    getKeyDate={sub.getKeyDate}
                    ctx={ctx}
                  />
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
  ctx: DashContext;
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
  ctx,
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
            <div
              className="border border-border rounded-md overflow-y-auto"
              style={{ maxHeight: 'calc(100vh - 220px)' }}
              data-scroll-bucket="true"
            >
              <SubBucketGroups
                permits={permits}
                stage={stage}
                cyclesByPermit={cyclesByPermit}
                projectById={projectById}
                keyDateLabel={keyDateLabel}
                getKeyDate={getKeyDate}
                ctx={ctx}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Q9.5.f Item 1: DashSummary removed — counts already render in each
// bucket header, the inline summary string near the search bar was
// redundant.

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

// Q9.5.e2-fix: scroll every bucket container that holds a matching addr-group
// so the just-opened card is in view. Mirrors v1 toggleProjectExpanded
// :2849-2860 — independent per-container scroll, smooth, with an 8px buffer
// so the card doesn't snap flush to the top edge.
// Q9.5.f-fix-1c: direct scrollTop assignment — no smooth, no setTimeout,
// no diagnostic toasts. Property assignment is the simplest possible
// mechanism: cannot be canceled by another smooth-scroll in flight, no
// browser optimization can defer it, no race between containers. If this
// doesn't visibly land cross-bucket, the bug isn't in scroll math or
// timing — it's structural (container re-mount, ref staleness, addr-
// group detached at the moment of measurement) and we'll instrument
// differently in the next iteration.
function scrollAddrIntoView(addr: string) {
  if (typeof document === 'undefined') return;
  const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(addr) : addr;
  const containers = document.querySelectorAll<HTMLElement>(
    '[data-scroll-bucket="true"]',
  );
  containers.forEach((container) => {
    const el = container.querySelector<HTMLElement>(`[data-addr-group="${safe}"]`);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = elRect.top - containerRect.top + container.scrollTop - 8;
    container.scrollTop = Math.max(0, offset);
  });
}

// Q9.5.e2: group permits in a sub-bucket by project address, then render one
// AddrGroup per address. Addresses sort by worst-urgency-first so red groups
// surface to the top — mirrors v1's :2686-2707 sort logic at the group level.
interface SubBucketGroupsProps {
  permits: Permit[];
  stage: Stage;
  cyclesByPermit: Map<number, PermitCycle[]>;
  projectById: Map<string, Project>;
  keyDateLabel: string;
  getKeyDate: (p: Permit) => string | null;
  ctx: DashContext;
}

function SubBucketGroups({
  permits,
  stage,
  cyclesByPermit,
  projectById,
  keyDateLabel,
  getKeyDate,
  ctx,
}: SubBucketGroupsProps) {
  const groups = useMemo(() => {
    const byAddr = new Map<string, Permit[]>();
    for (const p of permits) {
      const project = projectById.get(p.project_id);
      const addr = project?.address ?? p.struct_address ?? '—';
      const list = byAddr.get(addr) ?? [];
      list.push(p);
      byAddr.set(addr, list);
    }
    // Compute worst-urgency per group for sort + render
    const entries: {
      address: string;
      juris: string | null;
      projectId: string;
      permits: Permit[];
      urgency: ReturnType<typeof cardUrgency>;
    }[] = [];
    for (const [addr, ps] of byAddr) {
      const inputs = ps.map((p) => ({
        permit: p,
        cycles: cyclesByPermit.get(p.id) ?? [],
      }));
      const u = cardUrgency(inputs, stage);
      const first = ps[0];
      const project = projectById.get(first.project_id);
      entries.push({
        address: addr,
        juris: project?.juris ?? null,
        projectId: first.project_id,
        permits: ps,
        urgency: u,
      });
    }
    // Red → Yellow → OK; within same urgency, alpha by address.
    const urgRank = { red: 0, yellow: 1, ok: 2 } as const;
    entries.sort((a, b) => {
      const ra = urgRank[a.urgency];
      const rb = urgRank[b.urgency];
      if (ra !== rb) return ra - rb;
      return a.address.localeCompare(b.address);
    });
    return entries;
  }, [permits, projectById, cyclesByPermit, stage]);

  return (
    <>
      {groups.map((g) => (
        <AddrGroup
          key={g.address}
          address={g.address}
          juris={g.juris}
          projectId={g.projectId}
          permits={g.permits}
          stage={stage}
          cyclesByPermit={cyclesByPermit}
          cardUrgency={g.urgency}
          keyDateLabel={keyDateLabel}
          getKeyDate={getKeyDate}
          isOpen={ctx.openAddresses.has(g.address)}
          isHighlighted={ctx.highlightedAddress === g.address}
          onToggle={() => ctx.toggleAddress(g.address)}
          onHover={() => ctx.setHighlight(g.address)}
          onLeave={() =>
            ctx.setHighlight(
              ctx.openAddresses.has(g.address) ? g.address : null,
            )
          }
        />
      ))}
    </>
  );
}
