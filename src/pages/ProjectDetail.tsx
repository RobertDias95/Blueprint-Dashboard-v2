import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermitsByProject } from '../hooks/usePermitsByProject';
import { effectiveStage } from '../lib/permitStage';
import { permitUrgency } from '../lib/urgencyHelpers';
import { useUpdateProject } from '../hooks/useUpdateProject';
import type {
  PermitCycle,
  PermitWithCycles,
  Stage,
} from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';
import NotesDocsFooter from '../components/ProjectDetail/NotesDocsFooter';
import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';
import { pushToast } from '../stores/toastStore';

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
        onDelete={() => {
          // Q9.5.e-fix-1: Delete button is a stub for now — destructive
          // op needs a confirm modal + cascade RPC. Backlog #67.
          pushToast(
            'Project delete — backlog; route this via Settings → DB Tools or contact Claude for SQL delete.',
            'info',
          );
        }}
        onSettings={() => {
          // Q9.5.e-fix-1: Project Settings modal is v1's per-project
          // info editor (index.html:773-850). Build lands in
          // Q9.5.e-fix-2 (editable Site fields all wire there).
          pushToast(
            'Project Settings modal — lands in Q9.5.e-fix-2 alongside the editable Site fields.',
            'info',
          );
        }}
      />

      {/* Project address sub-header — centered, larger per v1 :758 */}
      <div className="text-center pt-1 pb-3 flex-shrink-0">
        <div className="text-[15px] font-extrabold text-text">
          {project.address}
        </div>
        <div className="text-[11px] text-muted font-mono mt-0.5">
          {project.juris ?? '—'}
        </div>
      </div>

      {/* Q9.5.e-fix-1: right-pane toggle. When no permit is selected,
          the right pane shows the project overview (4-col header +
          Schedule Health + Notes/Docs footer). Click a permit and the
          whole right pane swaps to that permit's edit UI. Matches v1
          showProjectOverview/_renderPermitDetail (index.html:3526-4096). */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <PermitsSidebar
          permits={permits}
          project={project}
          selectedId={selectedPermit?.id ?? null}
          onSelect={setSelectedPermitId}
        />
        <div
          className="flex-1 flex flex-col overflow-hidden min-h-0"
          data-testid="project-right-pane"
        >
          {selectedPermitId === null || !selectedPermit ? (
            // Q9.5.e-fix-4: project overview pane is a flex column where
            // ProjectDetailHeader + ScheduleHealthTable take their natural
            // height and NotesDocsFooter claims the remaining viewport.
            // Top section is internally scrollable when the health table
            // grows past available space.
            <div
              className="flex-1 flex flex-col overflow-hidden min-h-0"
              data-testid="project-overview-pane"
            >
              <div className="overflow-y-auto flex-shrink-0">
                <ProjectDetailHeader
                  project={project}
                  permits={permits}
                  bp={bp}
                />
                <ScheduleHealthTable permits={permits} />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <NotesDocsFooter project={project} />
              </div>
            </div>
          ) : (
            // Q9.5.e-fix-2: selected permit edit state. The "← Back to
            // overview" button is promoted out of the sidebar header and
            // pinned at the top of the right pane — same visual register
            // as the chrome "← Search" button.
            <div
              className="flex-1 flex flex-col overflow-hidden min-h-0"
              data-testid="permit-edit-pane"
            >
              <div
                className="px-3 py-2 border-b flex-shrink-0 flex items-center"
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
              <div className="flex-1 overflow-y-auto min-h-0">
                <PermitDetailV2
                  key={selectedPermit.id}
                  permit={selectedPermit}
                />
              </div>
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
}: {
  permits: PermitWithCycles[];
  project: NonNullable<ReturnType<typeof useProjects>['data']>[number];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const updateProject = useUpdateProject();
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Sort by project.permit_order; unordered permits drop to the end.
  const order = useMemo(
    () =>
      Array.isArray(project.permit_order) ? project.permit_order : [],
    [project.permit_order],
  );
  const sorted = useMemo(() => {
    return [...permits].sort((a, b) => {
      const oa = order.indexOf(a.id);
      const ob = order.indexOf(b.id);
      const aRank = oa === -1 ? Number.MAX_SAFE_INTEGER : oa;
      const bRank = ob === -1 ? Number.MAX_SAFE_INTEGER : ob;
      if (aRank !== bRank) return aRank - bRank;
      // Fallback: created order (id ascending, since permits.id is identity)
      return a.id - b.id;
    });
  }, [permits, order]);

  function commitOrder(nextIds: number[]) {
    if (!project.updated_at) return;
    void updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { permit_order: nextIds },
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
    const ids = sorted.map((p) => p.id);
    const fromIdx = ids.indexOf(src);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...ids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, src);
    commitOrder(next);
  }

  return (
    <aside
      className="flex-shrink-0 border-r flex flex-col bg-surface"
      style={{ width: 240, borderRightColor: 'var(--color-border)' }}
      data-testid="permits-sidebar"
    >
      <header
        className="px-3 py-2 border-b flex items-center justify-center"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <span className="text-[11px] font-extrabold text-text uppercase tracking-wider">
          Permits ({permits.length})
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="text-[11px] text-dim italic p-4 text-center">
            No permits yet.
          </div>
        ) : (
          sorted.map((p) => (
            <SidebarRow
              key={p.id}
              permit={p}
              selected={p.id === selectedId}
              dragOver={p.id === dragOverId}
              onSelect={() => onSelect(p.id)}
              onDragStart={(e) => onDragStart(e, p.id)}
              onDragOver={(e) => onDragOver(e, p.id)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, p.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function SidebarRow({
  permit,
  selected,
  dragOver,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  permit: PermitWithCycles;
  selected: boolean;
  dragOver: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const cycles = permit.permit_cycles ?? [];
  const stage = effectiveStage(permit, cycles);
  const urgency =
    stage === 'is' ? 'ok' : permitUrgency(permit, cycles, stage);
  const { label: keyLabel, date: keyDate } = pickKeyDate(permit, cycles, stage);
  const displayLabel =
    permit.type === 'Building Permit' && permit.nickname
      ? `Building Permit — ${permit.nickname}`
      : permit.type ?? '—';
  const dateColor =
    urgency === 'red'
      ? '#dc2626'
      : urgency === 'yellow'
        ? 'var(--color-co)'
        : stage === 'is'
          ? 'var(--color-is)'
          : 'var(--color-text)';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onSelect}
      className="w-full px-3 py-2 border-b cursor-pointer transition flex flex-col gap-1"
      style={{
        borderBottomColor: 'var(--color-border)',
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
        <span className="text-[11px] font-bold text-text truncate flex-1 min-w-0">
          {displayLabel}
        </span>
        <span
          className="text-dim flex-shrink-0 cursor-grab text-[12px] leading-none"
          title="Drag to reorder"
        >
          ⠿
        </span>
      </div>
      <div className="text-[10px] truncate">
        {permit.num ? (
          <span className="text-de font-mono">{permit.num}</span>
        ) : (
          <span className="text-dim italic">No permit # yet</span>
        )}
      </div>
      {keyDate && (
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="text-[8px] font-bold uppercase tracking-wide"
            style={{ color: STAGE_DOT_COLOR[stage] }}
          >
            {keyLabel}
          </span>
          <span
            className="text-[10px] font-bold font-mono"
            style={{ color: dateColor }}
          >
            {keyDate}
          </span>
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

