import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermitsByProject } from '../hooks/usePermitsByProject';
import { useAllPermitCycleReviewers } from '../hooks/useAllPermitCycleReviewers';
import { effectiveStage } from '../lib/permitStage';
import { STAGE_LABEL } from '../lib/stageLabel';
import { useUpdateProject } from '../hooks/useUpdateProject';
import type {
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
  Stage,
} from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';
import NotesDocsFooter from '../components/ProjectDetail/NotesDocsFooter';
import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';
import ProjectSettingsModal from '../components/ProjectDetail/ProjectSettingsModal';
import DeleteProjectDialog from '../components/ProjectDetail/DeleteProjectDialog';
import QuickEditPermitModal from '../components/ProjectDetail/QuickEditPermitModal';
import NewProjectWizard from '../components/NewProjectWizard';
import {
  makeRedesignWizardState,
  type WizardState,
} from '../components/wizard/wizardState';
import { useProjectRedesigns } from '../hooks/useProjectRedesigns';

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
  // Building Permit is the canonical anchor for project-level fields
  // (matches v1's `bp = ps.filter(p => p.type === 'Building Permit')[0] || ps[0]`).
  const bp = useMemo(() => {
    return permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  }, [permits]);

  // Q9.5.e-fix-1: default to project-overview view (null selection)
  // per v1 spatial pattern (index.html:3611). Sidebar click sets a
  // permit; "← Back to overview" link clears back to null.
  const [selectedPermitId, setSelectedPermitId] = useState<number | null>(null);
  const selectedPermit =
    selectedPermitId !== null
      ? permits.find((p) => p.id === selectedPermitId) ?? null
      : null;
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
  const redesignsQ = useProjectRedesigns(project.id);
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
              />
              <ScheduleHealthTable permits={permits} />
              <NotesDocsFooter project={project} />
            </div>
          ) : (
            // Permit selected → per-permit widgets stack inside the
            // same right pillbox. The "← Back to overview" button sits
            // at the top of the pillbox content; PermitDetailV2 below
            // contributes HeaderStrip / Cycle tabs / DateStrip /
            // Tasks + Sidebar widgets, all rendered in their natural
            // height. The pillbox's overflow-y-auto handles the scroll.
            <div
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

// Q9.5.e-fix-1: page chrome bar per v1 :751-756. Three-section layout
// using absolute centering on the title so the side buttons can grow
// without shifting the title off-center.
function ProjectPageChrome({
  onDelete,
  onSettings,
}: {
  onDelete: () => void;
  onSettings: () => void;
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
  const { activeSorted, issuedSorted } = useMemo(() => {
    const active: PermitWithCycles[] = [];
    const issued: PermitWithCycles[] = [];
    for (const p of permits) {
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
        <span className="text-[11px] font-extrabold text-text uppercase tracking-wider">
          Permits ({permits.length})
        </span>
      </header>
      <div className="flex-1 overflow-y-auto" data-testid="permits-sidebar-list">
        {activeSorted.length === 0 && issuedSorted.length === 0 ? (
          <div className="text-[11px] text-dim italic p-4 text-center">
            No permits yet.
          </div>
        ) : (
          <>
            {/* fix-65: ACTIVE group. Drag-reorder lives here. */}
            {activeSorted.map((p) => (
              <SidebarRow
                key={p.id}
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
                    <SidebarRow
                      key={p.id}
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
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function SidebarRow({
  permit,
  reviewers,
  selected,
  dragOver,
  draggable,
  onSelect,
  onQuickEdit,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  permit: PermitWithCycles;
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

