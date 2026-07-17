import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermitsByProject } from '../hooks/usePermitsByProject';
import { useAllPermitCycleReviewers } from '../hooks/useAllPermitCycleReviewers';
import { effectiveStage } from '../lib/permitStage';
import { STAGE_LABEL } from '../lib/stageLabel';
import { isSubPermit, subPermitBadgeLabel } from '../lib/subPermit';
import { useUpdateProject } from '../hooks/useUpdateProject';
import type {
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
  Project,
  RedesignTrigger,
  Stage,
} from '../lib/database.types';
import { REDESIGN_TRIGGER_LABELS } from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';
import NotesPanel from '../components/ProjectDetail/NotesPanel';
import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';
import ProjectSettingsModal from '../components/ProjectDetail/ProjectSettingsModal';
import { ProjectHoldBadge } from '../components/ProjectDetail/ProjectHold';
import { LandUsePhaseBadge } from '../components/ProjectDetail/LandUsePhaseBadge';
import DeleteProjectDialog from '../components/ProjectDetail/DeleteProjectDialog';
import DeleteRedesignDialog from '../components/ProjectDetail/DeleteRedesignDialog';
import EditRedesignModal from '../components/ProjectDetail/EditRedesignModal';
import QuickEditPermitModal from '../components/ProjectDetail/QuickEditPermitModal';
import NewProjectWizard from '../components/NewProjectWizard';
import ReassignDaModal from '../components/ProjectDetail/ReassignDaModal';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import { useProjectDaHandoffs } from '../hooks/useProjectDaHandoffs';
import {
  makeRedesignWizardState,
  type WizardState,
} from '../components/wizard/wizardState';
import {
  useProjectRedesigns,
  useProjectRedesignsWithPermits,
} from '../hooks/useProjectRedesigns';

// Q3 + Q4: Single-project view. Q3 wired editable permit-level fields. Q4
// adds editable cycles (5 date columns + add/delete) and a tasks section
// per permit (3 buckets: de/pm/co + add/delete). All writes are row-level
// OCC via the bp_upsert_*_row / bp_delete_*_row RPCs.
//
// Q9.5.e: layout rewrite to v1 §4.2.1 parity. Top strip = 4-column
// header (DD Phase / Project / Team / Builder). Body splits into:
//   - Schedule Health summary table (5 cols this phase; full 8 in polish)
//   - Permits sidebar (200px) on the left + selected-permit detail pane
//     (flex) on the right. Existing PermitDetailRow inline edits reused
//     intact inside the right pane.
// Notes + Documents footer below.
//
// Q9.5.e-fix-5: permit edit panel moved to PermitDetailV2 (separate file).
// The inline PermitDetailRow + helpers were removed; per-stage label / badge /
// override option constants moved with them.

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectsQ = useProjects();
  const permitsQ = usePermitsByProject(id);

  if (projectsQ.error || permitsQ.error) {
    return (
      <QueryError
        title="Project detail failed to load"
        error={projectsQ.error ?? permitsQ.error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
        }}
      />
    );
  }

  const project = projectsQ.data?.find((p) => p.id === id);
  const isLoading = projectsQ.isLoading || permitsQ.isLoading;

  if (!isLoading && !project) {
    return (
      <div className="text-sm text-dim italic px-2 py-12 text-center">
        Project not found.{' '}
        <Link to="/projects" className="text-de underline">
          Back to project list
        </Link>
      </div>
    );
  }

  if (isLoading || !project) {
    return <SkeletonRows count={6} rowClassName="h-16" />;
  }
  const permits = permitsQ.data ?? [];
  return <ProjectDetailBody project={project} permits={permits} />;
}

function ProjectDetailBody({
  project,
  permits,
}: {
  project: NonNullable<ReturnType<typeof useProjects>['data']>[number];
  permits: PermitWithCycles[];
}) {
  // fix-126: full projects list is already cached by the page-level
  // useProjects call; re-issuing it here is free under React Query's
  // dedupe + lets the "Redesign of [original]" badge + the
  // "Redesigns (N)" subsection look up siblings without prop drilling.
  const projectsQ = useProjects();
  const allProjects = projectsQ.data ?? [];
  // Building Permit is the canonical anchor for project-level fields
  // (matches v1's `bp = ps.filter(p => p.type === 'Building Permit')[0] || ps[0]`).
  const bp = useMemo(() => {
    return permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  }, [permits]);

  // fix-217: deep-link target permit from ?permit=<id> (My Tasks → "Open in
  // Project View"). Resolves to a real permit id on this project, else null (an
  // absent/invalid param — e.g. a project-level task — falls back to the project
  // overview, the pre-fix behavior).
  const [searchParams] = useSearchParams();
  const permitParam = searchParams.get('permit');
  // fix-219: resolve the ?permit= value TYPE-ROBUSTLY. permit.id is typed
  // `number` but the URL param is a string, and a strict === against a coerced
  // Number silently misses if the runtime id shape ever differs. Match by
  // String coercion on both sides and return the permit's OWN id (whatever its
  // runtime type) so downstream selection comparisons stay self-consistent.
  const permitParamId = useMemo(() => {
    if (!permitParam) return null;
    const match = permits.find((p) => String(p.id) === String(permitParam));
    return match ? match.id : null;
  }, [permitParam, permits]);

  // Q9.5.e-fix-1: default to project-overview view (null selection)
  // per v1 spatial pattern (index.html:3611). Sidebar click sets a
  // permit; "← Back to overview" link clears back to null.
  const [selectedPermitId, setSelectedPermitId] = useState<number | null>(null);
  // fix-217 → fix-218: apply the deep-link (?permit=) selection when the id
  // RESOLVES to a real permit — NOT merely when the raw param string changes.
  // usePermitsByProject loads async, so on mount `permits` is empty and
  // permitParamId is null; it flips null→<id> on a LATER render with the param
  // string UNCHANGED. fix-217 keyed on the string, so that later resolution never
  // fired and the user stayed on the overview (repro: 548 3rd Ave N, permit 200).
  // We instead remember the param value we've already applied a selection for:
  // apply once when permitParamId is non-null and differs from the applied value.
  // This is the React in-render "adjust state on change" pattern (fix-63/64), not
  // a setState-in-effect (no cascading-render). Applying ONCE per param value
  // preserves a manual "← Back to overview" (we don't re-force it every render);
  // a NEW ?permit= value re-selects; an absent/invalid param never selects
  // (permitParamId null) → overview fallback.
  const [appliedDeepLinkParam, setAppliedDeepLinkParam] = useState<
    string | null
  >(null);
  if (permitParamId !== null && permitParam !== appliedDeepLinkParam) {
    setAppliedDeepLinkParam(permitParam);
    setSelectedPermitId(permitParamId);
  }
  const selectedPermit =
    selectedPermitId !== null
      ? permits.find((p) => p.id === selectedPermitId) ?? null
      : null;

  // fix-217: the permit-detail pane, scrolled into view once the deep-linked
  // permit is selected + rendered (effect runs after commit → ref populated).
  const deepLinkPaneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedPermitId !== null && selectedPermitId === permitParamId) {
      deepLinkPaneRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [selectedPermitId, permitParamId]);
  // Q9.5.f-fix-16 D + E: Project Settings modal + Delete confirmation
  // dialog are owned at the page level so all four entry points (Settings
  // button / Delete button / future hotkeys) target the same instances.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // fix-126: redesign-wizard state. When non-null the New Project wizard
  // mounts in redesign mode with this seed; settingsOpen is closed first
  // so the two modals never overlap. The seed embeds the parent project's
  // address suffixed " [Redesign N]" — see makeRedesignWizardState +
  // useProjectRedesigns.
  const [redesignSeed, setRedesignSeed] = useState<WizardState | null>(null);
  // fix-225: DA reassign (ownership handoff) — admin-only modal + shared marker.
  const [reassignOpen, setReassignOpen] = useState(false);
  const isAdmin = useIsTenantAdmin();
  const handoffsQ = useProjectDaHandoffs(project.id);
  const redesignsQ = useProjectRedesigns(project.id);
  // fix-151: redesigns + their permits. Drives the Redesigns sidebar section
  // and the Schedule Health lineage aggregation (parent + all redesign permits
  // → one holistic health computation). Empty for projects with no redesigns,
  // so non-redesign parents behave exactly as before.
  const redesignsWithPermitsQ = useProjectRedesignsWithPermits(project.id);
  const lineagePermits = useMemo<PermitWithCycles[]>(() => {
    const redesignPermits = redesignsWithPermitsQ.data.flatMap((r) => r.permits);
    return redesignPermits.length > 0 ? [...permits, ...redesignPermits] : permits;
  }, [permits, redesignsWithPermitsQ.data]);
  // Q9.5.f-fix-19: Quick Edit popup opened by double-click on a sidebar row.
  const [quickEditPermitId, setQuickEditPermitId] = useState<number | null>(
    null,
  );
  const quickEditPermit =
    quickEditPermitId !== null
      ? permits.find((p) => p.id === quickEditPermitId) ?? null
      : null;
  // Keep bp around for the project-overview render even when no permit
  // is explicitly selected — the 4-col header anchors on the BP.
  void bp;

  return (
    <div
      className="flex flex-col h-[calc(100vh-100px)] overflow-hidden"
      data-testid="project-detail-page"
    >
      {/* Q9.5.e-fix-1: page chrome matches v1 :751-756 — Search button
          left, centered "Project Overview" title (absolute positioning
          so the buttons don't shift it off-center), Project Settings +
          Delete buttons right. */}
      <ProjectPageChrome
        onDelete={() => setDeleteOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onReassignDa={() => setReassignOpen(true)}
        canReassign={isAdmin}
      />

      {settingsOpen && (
        <ProjectSettingsModal
          project={project}
          onClose={() => setSettingsOpen(false)}
          onSpawnRedesign={() => {
            // fix-126: close the settings modal first so the wizard
            // doesn't overlay it. The seed builds the new wizard state
            // from this project's site facts + auto-suffixes the
            // address so the unique-address constraint is satisfied.
            const seed = makeRedesignWizardState(
              project,
              redesignsQ.count,
              // fix-158: seed the Redesign DD Phase DA with the parent's BP DA.
              bp?.da ?? null,
            );
            setSettingsOpen(false);
            setRedesignSeed(seed);
          }}
        />
      )}
      {redesignSeed && (
        <NewProjectWizard
          open={true}
          onClose={() => setRedesignSeed(null)}
          initialState={redesignSeed}
        />
      )}
      {reassignOpen && (
        <ReassignDaModal
          projectId={project.id}
          projectAddress={project.address}
          currentDa={bp?.da ?? null}
          onClose={() => setReassignOpen(false)}
          onUseRedesign={() => {
            // fix-225: the new-block case is a Redesign — reuse the exact
            // wizard-seed path the Settings modal's "Spawn Redesign" uses.
            setReassignOpen(false);
            setRedesignSeed(
              makeRedesignWizardState(project, redesignsQ.count, bp?.da ?? null),
            );
          }}
        />
      )}
      {deleteOpen && (
        <DeleteProjectDialog
          project={project}
          permitCount={permits.length}
          onClose={() => setDeleteOpen(false)}
        />
      )}
      {quickEditPermit && (
        <QuickEditPermitModal
          permit={quickEditPermit}
          siblings={permits}
          onClose={() => setQuickEditPermitId(null)}
        />
      )}

      {/* Project address sub-header — centered, larger per v1 :758 */}
      <div className="text-center pt-1 pb-2 flex-shrink-0">
        <div className="text-[15px] font-extrabold text-text">
          {project.address}
        </div>
        <div className="text-[11px] text-muted font-mono mt-0.5">
          {project.juris ?? '—'}
        </div>
        {/* fix-126: top "Redesign of X" badge when this project IS a
            redesign of another. Sits directly under the address so the
            link is obvious. Click navigates to the parent's overview. */}
        {project.redesign_of_project_id && (
          <RedesignOfBadge
            originalId={project.redesign_of_project_id}
            projects={allProjects}
          />
        )}
        {/* fix-167: "On Hold — <reason>" badge — the answer to "why hasn't
            this issued?". Renders only when an active hold exists. */}
        <ProjectHoldBadge projectId={project.id} />
        {/* fix-225: "shared" marker — this project's work was split across DAs
            via a reassign (ownership handoff), so it isn't solely one DA's. */}
        {handoffsQ.data && handoffsQ.data.length > 0 && (
          <span
            className="inline-block mt-1 ml-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border align-middle"
            style={{
              borderColor: 'var(--color-jv-border)',
              background: 'var(--color-jv-bg)',
              color: 'var(--color-jv)',
            }}
            title={`DA reassigned — work shared (was ${handoffsQ.data[0].from_da ?? 'unassigned'}, now ${handoffsQ.data[0].to_da})`}
            data-testid="pd-shared-badge"
          >
            ✳ Shared
          </span>
        )}
      </div>

      {/* fix-23e: Two-pillbox body layout. The outer page is bounded
          by `h-[calc(100vh-100px)] overflow-hidden` (set above on the
          page-root), so vertical growth is impossible regardless of
          how many permits a project has or how tall any single widget
          renders. Inside, two side-by-side pillboxes scroll
          independently:
            • pd-left-pillbox = the permits list (PermitsSidebar)
            • pd-right-pillbox = either the project overview content
              (when no permit is selected) or the per-permit detail
              widgets (when one is). PermitDetailV2's own internal
              flex layout handles the stacking of HeaderStrip / Cycle
              tabs / DateStrip / Tasks / Sidebar widgets; it all
              scrolls as one inside the right pillbox.

          Both pillboxes get rounded-lg border + bg-surface + their
          own overflow-y-auto so the content clips at the pillbox
          edge instead of pushing the outer page down. */}
      <div className="flex flex-1 gap-3 px-3 pb-3 overflow-hidden min-h-0">
        <PermitsSidebar
          permits={permits}
          project={project}
          selectedId={selectedPermit?.id ?? null}
          onSelect={setSelectedPermitId}
          onQuickEdit={setQuickEditPermitId}
        />
        <div
          className="flex-1 rounded-lg border bg-surface overflow-y-auto min-h-0"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="pd-right-pillbox"
        >
          {selectedPermitId === null || !selectedPermit ? (
            // No permit selected → project overview content. Stacks
            // vertically inside the right pillbox: 4-col header,
            // Schedule Health table, Notes/Docs footer. All scroll
            // together as one pillbox.
            <div
              className="flex flex-col"
              data-testid="project-overview-pane"
            >
              <ProjectDetailHeader
                project={project}
                permits={permits}
                bp={bp}
                allProjects={allProjects}
              />
              {/* fix-151: Schedule Health computes across the whole lineage
                  (parent + all redesign permits), not just the parent's. */}
              <ScheduleHealthTable permits={lineagePermits} />
              {/* fix-notes-1: holistic project notes log (permit_id NULL).
                  Replaces the old single-textarea + Documents footer. */}
              <NotesPanel projectId={project.id} />
            </div>
          ) : (
            // Permit selected → per-permit widgets stack inside the
            // same right pillbox. The "← Back to overview" button sits
            // at the top of the pillbox content; PermitDetailV2 below
            // contributes HeaderStrip / Cycle tabs / DateStrip /
            // Tasks + Sidebar widgets, all rendered in their natural
            // height. The pillbox's overflow-y-auto handles the scroll.
            <div
              ref={deepLinkPaneRef}
              className="flex flex-col min-h-0"
              data-testid="permit-edit-pane"
            >
              <div
                className="px-3 py-2 border-b flex-shrink-0 flex items-center sticky top-0 z-10"
                style={{
                  background: 'var(--color-s2)',
                  borderBottomColor: 'var(--color-border)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedPermitId(null)}
                  className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-surface text-text hover:bg-s3 transition"
                  data-testid="permit-edit-back-overview"
                >
                  ← Back to overview
                </button>
              </div>
              <PermitDetailV2
                key={selectedPermit.id}
                permit={selectedPermit}
                project={project}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// fix-126: "Redesign of [original]" badge shown directly under the
// project address when this project is itself a redesign. Clicking
// navigates to the original project's overview. Falls back to a generic
// "Redesign of (unknown)" label if the parent project isn't in the
// cached list — defensive (FK should always resolve under RLS, but a
// soft-deleted parent or a stale cache shouldn't break the UI).
function RedesignOfBadge({
  originalId,
  projects,
}: {
  originalId: string;
  projects: { id: string; address: string }[];
}) {
  const original = projects.find((p) => p.id === originalId) ?? null;
  return (
    <Link
      to={`/project/${originalId}`}
      className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border hover:opacity-80 transition"
      style={{
        background: 'var(--color-co-bg)',
        color: 'var(--color-co)',
        borderColor: 'var(--color-co-border)',
      }}
      data-testid="pd-redesign-of-badge"
    >
      ↗ Redesign of {original ? original.address : '(unknown original)'}
    </Link>
  );
}

// Q9.5.e-fix-1: page chrome bar per v1 :751-756. Three-section layout
// using absolute centering on the title so the side buttons can grow
// without shifting the title off-center.
function ProjectPageChrome({
  onDelete,
  onSettings,
  onReassignDa,
  canReassign,
}: {
  onDelete: () => void;
  onSettings: () => void;
  /** fix-225: admin-only "Reassign DA" (ownership handoff). */
  onReassignDa: () => void;
  canReassign: boolean;
}) {
  return (
    <div
      className="relative flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
      style={{ borderBottomColor: 'var(--color-border)' }}
      data-testid="project-page-chrome"
    >
      <Link
        to="/projects"
        className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-s2 text-text hover:bg-s3 transition no-underline"
        data-testid="project-search-back"
      >
        ← Search
      </Link>
      <div
        className="absolute left-0 right-0 text-center pointer-events-none text-xl font-extrabold text-text"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      >
        Project Overview
      </div>
      <div className="flex items-center gap-2">
        {canReassign && (
          <button
            onClick={onReassignDa}
            className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-s2 text-text hover:bg-s3 transition"
            data-testid="project-reassign-da-btn"
            title="Move ownership to a different DA (board stays put)"
          >
            ⇄ Reassign DA
          </button>
        )}
        <button
          onClick={onSettings}
          className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-s2 text-text hover:bg-s3 transition"
          data-testid="project-settings-btn"
        >
          ⚙ Project Settings
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1 rounded-md text-xs font-bold transition"
          style={{
            background: '#fee2e2',
            color: '#991b1b',
            border: '1px solid #fca5a5',
          }}
          data-testid="project-delete-btn"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

// Q9.5.e-fix-4: sidebar redesign per v1 §4.2.1 sidebar parity and
// index.html:3539-3596. Each row shows a stage-tinted dot, permit type
// (Building Permit shows nickname when set), permit # / "No permit # yet",
// stage-appropriate key date with urgency-driven color, and a drag handle.
// Order is persisted as projects.permit_order (number[]). Permits without
// an explicit order are appended after ordered ones, alphabetical fallback.
const STAGE_DOT_COLOR: Record<Stage, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
  ap: 'var(--color-jv)',
  is: 'var(--color-is)',
};

function PermitsSidebar({
  permits,
  project,
  selectedId,
  onSelect,
  onQuickEdit,
}: {
  permits: PermitWithCycles[];
  project: NonNullable<ReturnType<typeof useProjects>['data']>[number];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onQuickEdit: (id: number) => void;
}) {
  const updateProject = useUpdateProject();
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  // fix-104: reviewers feed effectiveStage for MPB / Pending / Applied
  // permits (see fix-54). Pre-fix the sidebar called effectiveStage
  // without reviewers and the row's stage could disagree with the
  // right-hand Schedule Health table — same permit, different label.
  // Index per-permit once at the sidebar level so each SidebarRow
  // grabs its own list cheaply on render.
  const reviewersQ = useAllPermitCycleReviewers();
  const reviewersByPermit = useMemo(() => {
    const m = new Map<number, PermitCycleReviewer[]>();
    for (const r of reviewersQ.data ?? []) {
      const list = m.get(r.permit_id) ?? [];
      list.push(r);
      m.set(r.permit_id, list);
    }
    return m;
  }, [reviewersQ.data]);

  // Sort by project.permit_order; unordered permits drop to the end.
  const order = useMemo(
    () =>
      Array.isArray(project.permit_order) ? project.permit_order : [],
    [project.permit_order],
  );

  // fix-65 (2026-05-27): partition into ACTIVE + ISSUED for the v1 sidebar
  // shape Bobby asked to restore. Active permits stay drag-reorderable
  // (their permit_order persists); issued permits collect at the bottom
  // under a "✓ ISSUED (n)" divider with the --color-is highlight tint and
  // are sorted by actual_issue desc (most recently issued first), static.
  //
  // Classification reuses effectiveStage — the same signal Schedule Health
  // + the row's stage dot already use, so "ISSUED" in the sidebar matches
  // the row's "ISSUED <date>" label without inventing a parallel rule.
  // Pre-fix the partition was inline in the sort comparator (`!!actual_
  // issue`); migrating to effectiveStage also picks up the rare case
  // where a permit has stage_override='is' / terminal portal status but
  // no actual_issue yet.
  // fix-194: index sub/child permits by their parent so each renders nested
  // under its parent row (and never as a standalone active/issued row). A
  // child's "reviewed under <parent #>" label needs the parent's num.
  const childrenByParent = useMemo(() => {
    const m = new Map<number, PermitWithCycles[]>();
    for (const p of permits) {
      if (!isSubPermit(p)) continue;
      const pid = p.parent_permit_id as number;
      const list = m.get(pid) ?? [];
      list.push(p);
      m.set(pid, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.id - b.id);
    return m;
  }, [permits]);
  const numById = useMemo(() => {
    const m = new Map<number, string | null>();
    for (const p of permits) m.set(p.id, p.num);
    return m;
  }, [permits]);

  const { activeSorted, issuedSorted } = useMemo(() => {
    const active: PermitWithCycles[] = [];
    const issued: PermitWithCycles[] = [];
    for (const p of permits) {
      // fix-194: children are rendered nested under their parent, not as their
      // own active/issued row.
      if (isSubPermit(p)) continue;
      // fix-104: pass per-permit reviewers so the active/issued split
      // matches what the row itself + the Schedule Health table see.
      const isIssued =
        effectiveStage(
          p,
          p.permit_cycles ?? [],
          reviewersByPermit.get(p.id) ?? null,
        ) === 'is';
      (isIssued ? issued : active).push(p);
    }
    const byOrder = (a: PermitWithCycles, b: PermitWithCycles) => {
      const oa = order.indexOf(a.id);
      const ob = order.indexOf(b.id);
      const aRank = oa === -1 ? Number.MAX_SAFE_INTEGER : oa;
      const bRank = ob === -1 ? Number.MAX_SAFE_INTEGER : ob;
      if (aRank !== bRank) return aRank - bRank;
      // Fallback: created order (id ascending, since permits.id is identity)
      return a.id - b.id;
    };
    active.sort(byOrder);
    // Issued: most-recently-issued first. Permits with stage='is' but
    // no actual_issue (e.g. stage_override or terminal portal status
    // without a stamped date) fall back to approval_date, then id desc.
    issued.sort((a, b) => {
      const da = a.actual_issue ?? a.approval_date ?? '';
      const db = b.actual_issue ?? b.approval_date ?? '';
      if (da !== db) return db.localeCompare(da);
      return b.id - a.id;
    });
    return { activeSorted: active, issuedSorted: issued };
  }, [permits, order, reviewersByPermit]);

  function commitOrder(nextActiveIds: number[]) {
    if (!project.updated_at) return;
    // Persist the canonical order across BOTH groups so a permit moving
    // back from issued → active (rare — e.g. an actual_issue cleared
    // by fix-actual-issue self-heal) still has a stable position. Active
    // first (user-chosen), issued appended in their current date-desc
    // order (stable across navigations).
    const next = [...nextActiveIds, ...issuedSorted.map((p) => p.id)];
    void updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { permit_order: next },
      fieldLabel: 'Permit order',
    });
  }

  function onDragStart(e: React.DragEvent, permitId: number) {
    e.dataTransfer.setData('text/plain', String(permitId));
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent, permitId: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== permitId) setDragOverId(permitId);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOverId(null);
  }
  function onDrop(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    setDragOverId(null);
    const src = Number(e.dataTransfer.getData('text/plain'));
    if (!src || src === targetId) return;
    // Reorder operates ONLY within the active group. v1 kept issued
    // permits as a static bottom block; matching that here keeps the
    // "what's done" section from being accidentally re-ordered when
    // a user is shuffling active permits.
    const activeIds = activeSorted.map((p) => p.id);
    const fromIdx = activeIds.indexOf(src);
    const toIdx = activeIds.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...activeIds];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, src);
    commitOrder(next);
  }

  // fix-23e: PermitsSidebar is the left pillbox. Outer aside has the
  // rounded border + bg-surface; the header stays pinned at top via
  // flex-shrink-0; the permit list claims remaining height and scrolls
  // internally via overflow-y-auto. The aside itself does NOT scroll
  // (overflow-hidden) so the rounded border isn't broken by content
  // overlapping the rounded corners.
  return (
    <aside
      className="flex-shrink-0 rounded-lg border bg-surface flex flex-col overflow-hidden min-h-0"
      style={{ width: 240, borderColor: 'var(--color-border)' }}
      data-testid="pd-left-pillbox"
    >
      <header
        className="px-3 py-2 border-b flex-shrink-0 flex items-center justify-center"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <span
          className="text-[11px] font-extrabold text-text uppercase tracking-wider"
          data-testid="permits-sidebar-count"
        >
          {/* fix-194: count standalone/parent permits — sub-permit placeholders
              nest under their parent and don't inflate the header count. */}
          Permits ({activeSorted.length + issuedSorted.length})
        </span>
      </header>
      <div className="flex-1 overflow-y-auto" data-testid="permits-sidebar-list">
        {activeSorted.length === 0 && issuedSorted.length === 0 ? (
          <div className="text-[11px] text-dim italic p-4 text-center">
            No permits yet.
          </div>
        ) : (
          <>
            {/* fix-65: ACTIVE group. Drag-reorder lives here.
                fix-194: each parent renders its sub-permit children nested
                directly beneath it. */}
            {activeSorted.map((p) => (
              <Fragment key={p.id}>
                <SidebarRow
                  permit={p}
                  reviewers={reviewersByPermit.get(p.id) ?? []}
                  selected={p.id === selectedId}
                  dragOver={p.id === dragOverId}
                  draggable
                  onSelect={() => onSelect(p.id)}
                  onQuickEdit={() => onQuickEdit(p.id)}
                  onDragStart={(e) => onDragStart(e, p.id)}
                  onDragOver={(e) => onDragOver(e, p.id)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, p.id)}
                />
                {(childrenByParent.get(p.id) ?? []).map((c) => (
                  <SidebarRow
                    key={c.id}
                    permit={c}
                    reviewers={[]}
                    selected={c.id === selectedId}
                    dragOver={false}
                    draggable={false}
                    parentNum={numById.get(p.id) ?? null}
                    onSelect={() => onSelect(c.id)}
                    onQuickEdit={() => onQuickEdit(c.id)}
                    onDragStart={() => {}}
                    onDragOver={() => {}}
                    onDragLeave={() => {}}
                    onDrop={() => {}}
                  />
                ))}
              </Fragment>
            ))}
            {/* fix-65: ✓ ISSUED divider + group. Rendered only when there
                IS at least one issued permit so a fully-active project
                (no issued permits yet) doesn't gain an empty section. */}
            {issuedSorted.length > 0 && (
              <>
                <div
                  className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 border-y"
                  style={{
                    background: 'var(--color-is-bg)',
                    color: 'var(--color-is)',
                    borderTopColor: 'var(--color-is-border)',
                    borderBottomColor: 'var(--color-is-border)',
                  }}
                  data-testid="permits-sidebar-issued-divider"
                >
                  <span aria-hidden="true">✓</span>
                  <span>Issued ({issuedSorted.length})</span>
                </div>
                <div
                  style={{ background: 'var(--color-is-bg)' }}
                  data-testid="permits-sidebar-issued-group"
                >
                  {issuedSorted.map((p) => (
                    <Fragment key={p.id}>
                      <SidebarRow
                        permit={p}
                        reviewers={reviewersByPermit.get(p.id) ?? []}
                        selected={p.id === selectedId}
                        // Issued rows aren't part of active drag-reorder
                        // (v1 kept them as a static bottom block).
                        dragOver={false}
                        draggable={false}
                        onSelect={() => onSelect(p.id)}
                        onQuickEdit={() => onQuickEdit(p.id)}
                        onDragStart={() => {}}
                        onDragOver={() => {}}
                        onDragLeave={() => {}}
                        onDrop={() => {}}
                      />
                      {/* fix-194: sub-permit children nested under an issued parent. */}
                      {(childrenByParent.get(p.id) ?? []).map((c) => (
                        <SidebarRow
                          key={c.id}
                          permit={c}
                          reviewers={[]}
                          selected={c.id === selectedId}
                          dragOver={false}
                          draggable={false}
                          parentNum={numById.get(p.id) ?? null}
                          onSelect={() => onSelect(c.id)}
                          onQuickEdit={() => onQuickEdit(c.id)}
                          onDragStart={() => {}}
                          onDragOver={() => {}}
                          onDragLeave={() => {}}
                          onDrop={() => {}}
                        />
                      ))}
                    </Fragment>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {/* fix-151: redesigns of this project + their permits, surfaced below
            the parent's permits so the lineage is visible from one place. */}
        <RedesignsSidebarSection parentId={project.id} />
      </div>
    </aside>
  );
}

// fix-193: a redesign's own placeholder permit is a PPR with no number yet
// (created even for a reuses-permit redesign so it has a row of its own). Give
// it a readable label so the redesign never looks empty. Scoped to the redesign
// sidebar context — only a num-less PPR gets the special label; every other
// permit keeps its type + stage. (Leaves unrelated num-less permits elsewhere
// untouched.)
function redesignPermitLabel(p: PermitWithCycles): {
  primary: string;
  secondary: string;
} {
  if (!p.num && p.type === 'PPR') {
    return { primary: 'PPR', secondary: 'Pre-Submittal · no number yet' };
  }
  return {
    primary: p.type ?? '—',
    secondary:
      STAGE_LABEL[effectiveStage(p, p.permit_cycles ?? [], null)] ?? '—',
  };
}

// fix-151: "Redesigns (n)" section at the bottom of the permits sidebar. Each
// redesign row links to that redesign's project overview (permits navigate via
// local selection state on each project's own page, so there's no per-permit
// deep route — the permit rows here link to the redesign project too). A
// reuses-permit redesign shows a "Reuses parent's permits" note AND its own
// placeholder permit (fix-193) so the redesign isn't visually empty. One hop
// (useProjectRedesignsWithPermits doesn't recurse).
function RedesignsSidebarSection({ parentId }: { parentId: string }) {
  const { data } = useProjectRedesignsWithPermits(parentId);
  // fix-193: per-redesign edit / delete targets (the redesign + its sidebar
  // "Redesign N" label). Null = no dialog open.
  const [editTarget, setEditTarget] = useState<{
    project: Project;
    label: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    project: Project;
    label: string;
  } | null>(null);
  if (data.length === 0) return null;
  return (
    <div data-testid="project-overview-redesigns-section">
      <div
        className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 border-y"
        style={{
          background: 'var(--color-co-bg)',
          color: 'var(--color-co)',
          borderTopColor: 'var(--color-co-border)',
          borderBottomColor: 'var(--color-co-border)',
        }}
      >
        <span aria-hidden="true">↳</span>
        <span>Redesigns ({data.length})</span>
      </div>
      {data.map((r, i) => {
        const reuses = r.project.redesign_reuses_original_permit === true;
        const trig = r.project.redesign_trigger;
        const triggerLabel = trig
          ? REDESIGN_TRIGGER_LABELS[trig as RedesignTrigger] ?? trig
          : null;
        const rowLabel = `Redesign ${i + 1}`;
        return (
          <div
            key={r.project.id}
            className="border-b"
            style={{ borderBottomColor: 'var(--color-border)' }}
          >
            {/* fix-193: row header = link to the redesign + edit / delete
                actions. The buttons sit OUTSIDE the Link (no nested
                interactives). */}
            <div className="flex items-center gap-1 px-3 py-1.5 hover:bg-s2 transition">
              <Link
                to={`/project/${r.project.id}`}
                className="flex-1 min-w-0"
                data-testid={`project-overview-redesign-row-${r.project.id}`}
              >
                <span className="text-[11px] font-bold text-text">
                  {rowLabel}
                </span>
                {triggerLabel && (
                  <span className="text-[10px] text-dim"> · {triggerLabel}</span>
                )}
              </Link>
              <button
                type="button"
                onClick={() =>
                  setEditTarget({ project: r.project, label: rowLabel })
                }
                className="text-dim hover:text-co text-[11px] leading-none px-1 shrink-0"
                title={`Edit ${rowLabel}`}
                data-testid={`project-overview-redesign-edit-${r.project.id}`}
              >
                ✎
              </button>
              <button
                type="button"
                onClick={() =>
                  setDeleteTarget({ project: r.project, label: rowLabel })
                }
                className="text-dim hover:text-de text-[12px] leading-none px-1 shrink-0"
                title={`Delete ${rowLabel}`}
                data-testid={`project-overview-redesign-delete-${r.project.id}`}
              >
                ✕
              </button>
            </div>
            {/* fix-193: a reuses-permit redesign keeps the "Reuses parent's
                permits" note, but we ALSO list its own permits below (its PPR
                placeholder) so the redesign isn't empty. A non-reuse redesign
                just lists its own permits. */}
            {reuses && (
              <div className="px-3 pb-1.5 -mt-0.5 text-[10px] italic text-dim">
                Reuses parent's permits
              </div>
            )}
            {r.permits.map((p) => {
              const label = redesignPermitLabel(p);
              return (
                <Link
                  key={p.id}
                  to={`/project/${r.project.id}`}
                  className="block pl-6 pr-3 py-1 hover:bg-s2 transition"
                  data-testid={`project-overview-redesign-permit-${p.id}`}
                >
                  <span className="text-[10px] text-text">{label.primary}</span>
                  <span className="text-[10px] text-dim">
                    {' · '}
                    {label.secondary}
                  </span>
                </Link>
              );
            })}
          </div>
        );
      })}
      {editTarget && (
        <EditRedesignModal
          redesign={editTarget.project}
          label={editTarget.label}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteRedesignDialog
          redesign={deleteTarget.project}
          label={deleteTarget.label}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function SidebarRow({
  permit,
  reviewers,
  selected,
  dragOver,
  draggable,
  parentNum,
  onSelect,
  onQuickEdit,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  permit: PermitWithCycles;
  /** fix-194: when this permit is a sub/child, the parent's permit number for
   *  the "reviewed under <parent #>" badge. Undefined for normal rows. */
  parentNum?: string | null;
  /** fix-104: reviewer rows for THIS permit. Threaded into
   *  effectiveStage so the sidebar's stage agrees with the Schedule
   *  Health table (which has always passed reviewers in). Empty
   *  array is fine for permit types that don't carry rollup-driven
   *  status — effectiveStage falls through to the cycle-state path. */
  reviewers: PermitCycleReviewer[];
  selected: boolean;
  dragOver: boolean;
  /** fix-65: issued permits sit in the static bottom group and are not
   *  drag-reorderable. Active permits stay drag-reorderable as before. */
  draggable: boolean;
  onSelect: () => void;
  onQuickEdit: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const cycles = permit.permit_cycles ?? [];
  const stage = effectiveStage(permit, cycles, reviewers);
  const { label: keyLabel, date: keyDate } = pickKeyDate(permit, cycles, stage);
  const displayLabel =
    permit.type === 'Building Permit' && permit.nickname
      ? `Building Permit — ${permit.nickname}`
      : permit.type ?? '—';

  // fix-194: a sub/child permit renders as an indented placeholder — type +
  // permit # + a "Sub-permit · reviewed under <parent #>" badge, NO stage dot /
  // breadcrumb / review timeline (it carries no review state of its own). Still
  // selectable + double-click-editable so the parent link can be cleared.
  if (isSubPermit(permit)) {
    return (
      <div
        onClick={onSelect}
        onDoubleClick={onQuickEdit}
        className="w-full pl-7 pr-3 py-2 border-b cursor-pointer transition flex flex-col gap-0.5"
        style={{
          borderBottomColor: 'var(--color-border)',
          background: selected ? 'var(--color-s3)' : 'transparent',
          borderLeft: '3px solid transparent',
        }}
        data-testid={`permits-sidebar-row-${permit.id}`}
        data-sub-permit="true"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-dim flex-shrink-0 text-[11px] leading-none" aria-hidden="true">
            ↳
          </span>
          <span
            className="text-[11px] truncate flex-1 min-w-0 font-bold text-text"
            data-testid={`permits-sidebar-type-${permit.id}`}
          >
            {displayLabel}
          </span>
        </div>
        <div
          className="text-[9px] text-dim italic truncate pl-[18px]"
          data-testid={`permits-sidebar-subpermit-${permit.id}`}
        >
          {subPermitBadgeLabel(parentNum)}
        </div>
        {permit.num && (
          <div className="text-[10px] truncate pl-[18px]">
            <span className="text-text font-mono" data-testid={`permits-sidebar-num-${permit.id}`}>
              {permit.num}
            </span>
          </div>
        )}
      </div>
    );
  }
  // fix-104: parent stage breadcrumb (e.g. "Building Permit · Permitting")
  // anchors the card on the stage; the sub-event date line below is then
  // clearly subordinate. Pre-fix the card showed only the type on the
  // top line and rendered the dated event in caps below, which read as
  // the primary stage label (the bug Bobby reported on 10431 SE 19th St).
  // The pre-fix urgency-driven date color is gone too — the card's own
  // bg tint / left-border (stage color) already signals stage, and the
  // sub-event line is text-only secondary detail.
  const stageBreadcrumb = STAGE_LABEL[stage];

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDragLeave={draggable ? onDragLeave : undefined}
      onDrop={draggable ? onDrop : undefined}
      onClick={onSelect}
      onDoubleClick={onQuickEdit}
      className="w-full px-3 py-2 border-b cursor-pointer transition flex flex-col gap-1"
      style={{
        borderBottomColor: 'var(--color-border)',
        // Selection / drag-over tints sit on top of the parent group's
        // background tint, so the issued group's --color-is-bg shows
        // through for un-selected, un-hovered issued rows.
        background: dragOver
          ? 'var(--color-de-bg)'
          : selected
            ? 'var(--color-s3)'
            : 'transparent',
        borderLeft: selected
          ? `3px solid var(--color-${stage})`
          : dragOver
            ? '3px solid var(--color-de)'
            : '3px solid transparent',
      }}
      data-testid={`permits-sidebar-row-${permit.id}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="inline-block flex-shrink-0 rounded-full"
          style={{
            width: 7,
            height: 7,
            background: STAGE_DOT_COLOR[stage],
          }}
        />
        {/* fix-104: type · stage breadcrumb. The type stays bold (it's
            still the row's primary identity); the stage gets the muted
            text-dim treatment so the eye reads "Building Permit FIRST,
            currently in Permitting" — not two competing labels. */}
        <span
          className="text-[11px] truncate flex-1 min-w-0"
          data-testid={`permits-sidebar-type-${permit.id}`}
        >
          <span className="font-bold text-text">{displayLabel}</span>
          <span
            className="text-dim font-normal"
            data-testid={`permits-sidebar-stage-${permit.id}`}
          >
            {' · '}
            {stageBreadcrumb}
          </span>
        </span>
        {draggable && (
          <span
            className="text-dim flex-shrink-0 cursor-grab text-[12px] leading-none"
            title="Drag to reorder"
          >
            ⠿
          </span>
        )}
      </div>
      {/* fix-169: land-use phase badge — only for *-LU permits, answers
          "why hasn't this issued?" on the overview. Null for everything else. */}
      <LandUsePhaseBadge permit={permit} />
      <div className="text-[10px] truncate">
        {permit.num ? (
          permit.portal_url ? (
            // fix-35 Bug 1b: restore the portal-link <a> dropped during
            // fix-26→32 (the # had regressed to a blue-styled non-link span).
            // stopPropagation so clicking the # opens the portal without also
            // firing the row's onSelect.
            <a
              href={permit.portal_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-de font-mono hover:underline"
              title="Open city portal"
              data-testid={`permits-sidebar-portal-${permit.id}`}
            >
              {permit.num} ↗
            </a>
          ) : (
            // No portal URL on file: plain (non-blue) mono so it doesn't
            // masquerade as a broken link.
            <span
              className="text-text font-mono"
              title="No portal URL on file"
              data-testid={`permits-sidebar-num-${permit.id}`}
            >
              {permit.num}
            </span>
          )
        ) : (
          <span className="text-dim italic">No permit # yet</span>
        )}
      </div>
      {permit.struct_address && (
        // fix-35 Bug 1a: structure address so multiple BPs on one project
        // are distinguishable.
        <div
          className="text-[10px] text-dim truncate"
          title={permit.struct_address}
          data-testid={`permits-sidebar-addr-${permit.id}`}
        >
          {permit.struct_address}
        </div>
      )}
      {keyDate && (
        // fix-104: sub-event line — lowercase label, normal weight,
        // muted color. No more "CORRECTIONS YYYY-MM-DD" reading like
        // the primary stage; this is now "Corrections: 2026-05-26"
        // in plain secondary text. The label string still comes from
        // pickKeyDate so the precedence (per-stage) is unchanged.
        <div
          className="text-[10px] text-dim font-mono mt-0.5"
          data-testid={`permits-sidebar-sub-event-${permit.id}`}
        >
          {keyLabel}: {keyDate}
        </div>
      )}
    </div>
  );
}

// Stage-appropriate "key date" + short label, mirrors v1's index.html
// :3554-3577 logic.
function pickKeyDate(
  permit: PermitWithCycles,
  cycles: PermitCycle[],
  stage: Stage,
): { label: string; date: string | null } {
  const sortedCycles = [...cycles].sort((a, b) => a.cycle_index - b.cycle_index);
  const c0 = sortedCycles[0];
  const latest = sortedCycles[sortedCycles.length - 1];

  if (stage === 'is') {
    if (permit.actual_issue) return { label: 'Issued', date: permit.actual_issue };
    if (permit.approval_date) return { label: 'Approved', date: permit.approval_date };
  }
  if (stage === 'ap' && permit.approval_date) {
    return { label: 'Approved', date: permit.approval_date };
  }
  if (stage === 'co' && latest) {
    if (latest.corr_issued) return { label: 'Corrections', date: latest.corr_issued };
    if (latest.resubmitted) return { label: 'Resubmitted', date: latest.resubmitted };
    if (c0?.submitted) return { label: 'Submitted', date: c0.submitted };
  }
  if (stage === 'pm' && latest) {
    if (latest.city_target) return { label: 'City Target', date: latest.city_target };
    if (latest.submitted) return { label: 'Submitted', date: latest.submitted };
    if (c0?.submitted) return { label: 'Submitted', date: c0.submitted };
  }
  // de stage (or anything fallthrough): submitted on cycle 0, else target_submit
  if (c0?.submitted) return { label: 'Submitted', date: c0.submitted };
  if (permit.target_submit) return { label: 'Target', date: permit.target_submit };
  return { label: 'Target', date: null };
}

