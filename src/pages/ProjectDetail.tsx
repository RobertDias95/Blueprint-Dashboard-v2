import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermitsByProject } from '../hooks/usePermitsByProject';
import { usePermitTasks } from '../hooks/usePermitTasks';
import { useUpdatePermit } from '../hooks/useUpdatePermit';
import {
  useUpsertPermitCycle,
  type CyclePatch,
  type DateField,
} from '../hooks/useUpsertPermitCycle';
import { useDeletePermitCycle } from '../hooks/useDeletePermitCycle';
import { useUpsertPermitTask, type TaskPatch } from '../hooks/useUpsertPermitTask';
import { useDeletePermitTask } from '../hooks/useDeletePermitTask';
import { effectiveStage } from '../lib/permitStage';
import type {
  Permit,
  PermitCycle,
  PermitTask,
  PermitWithCycles,
  Stage,
} from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import EditableField from '../components/EditableField';
import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';
import NotesDocsFooter from '../components/ProjectDetail/NotesDocsFooter';
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

const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

const STAGE_BADGE: Record<Stage, string> = {
  de: 'bg-de-bg text-de border-de-border',
  pm: 'bg-pm-bg text-pm border-pm-border',
  co: 'bg-co-bg text-co border-co-border',
  ap: 'bg-jv-bg text-jv border-jv-border',
  is: 'bg-is-bg text-is border-is-border',
};

const STAGE_OVERRIDE_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'de', label: 'D&E' },
  { value: 'pm', label: 'Permitting' },
  { value: 'co', label: 'Corrections' },
  { value: 'ap', label: 'Approved' },
  { value: 'is', label: 'Issued' },
];

const TASK_BUCKETS = [
  { id: 'de', label: 'Design' },
  { id: 'pm', label: 'Permit' },
  { id: 'co', label: 'Corrections' },
] as const;

const COMPLETION_OPTIONS = [
  { value: 'Open', label: 'Open' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Resolved', label: 'Resolved' },
  { value: 'Skipped', label: 'Skipped' },
];

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
          selectedId={selectedPermit?.id ?? null}
          onSelect={setSelectedPermitId}
        />
        <div
          className="flex-1 flex flex-col overflow-hidden min-h-0"
          data-testid="project-right-pane"
        >
          {selectedPermitId === null || !selectedPermit ? (
            // Q9.5.e-fix-2: project overview pane is a single scrollable
            // column — no flex-1 spacer between Schedule Health and
            // Notes/Docs, so the footer sits ~16px below the table.
            <div
              className="flex-1 overflow-y-auto"
              data-testid="project-overview-pane"
            >
              <ProjectDetailHeader
                project={project}
                permits={permits}
                bp={bp}
              />
              <ScheduleHealthTable permits={permits} />
              <div style={{ height: 16 }} />
              <NotesDocsFooter project={project} />
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
              <div className="flex-1 overflow-y-auto p-3 min-h-0">
                <PermitDetailRow
                  key={selectedPermit.id}
                  permit={selectedPermit}
                  projectId={project.id}
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

function PermitsSidebar({
  permits,
  selectedId,
  onSelect,
}: {
  permits: PermitWithCycles[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <aside
      className="flex-shrink-0 border-r flex flex-col bg-surface"
      style={{ width: 220, borderRightColor: 'var(--color-border)' }}
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
        {permits.length === 0 ? (
          <div className="text-[11px] text-dim italic p-4 text-center">
            No permits yet.
          </div>
        ) : (
          permits.map((p) => {
            const stage = effectiveStage(p, p.permit_cycles ?? []);
            const isSelected = p.id === selectedId;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className="w-full text-left px-3 py-2.5 border-b transition flex flex-col gap-1"
                style={{
                  borderBottomColor: 'var(--color-border)',
                  background: isSelected
                    ? 'var(--color-s3)'
                    : 'transparent',
                  borderLeft: isSelected
                    ? `3px solid var(--color-${stage})`
                    : '3px solid transparent',
                }}
                data-testid={`permits-sidebar-row-${p.id}`}
              >
                <div className="text-[11px] font-bold text-text truncate">
                  {p.type ?? '—'}
                  {p.nickname && (
                    <span className="text-muted font-normal ml-1">
                      — {p.nickname}
                    </span>
                  )}
                </div>
                <div className="text-[9px] text-muted truncate font-mono">
                  {p.num ?? '—'}
                  {p.ent_lead && (
                    <span className="ml-1 text-text">{p.ent_lead}</span>
                  )}
                  {p.da && <span className="ml-1 text-text">{p.da}</span>}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function PermitDetailRow({
  permit,
  projectId,
}: {
  permit: PermitWithCycles;
  projectId: string;
}) {
  const cycles = permit.permit_cycles ?? [];
  const stage = effectiveStage(permit, cycles);
  const updateMutation = useUpdatePermit();
  const occMissing = !permit.updated_at;

  function makePermitSaver<K extends keyof Permit>(field: K, label: string) {
    return async (next: string) => {
      if (occMissing || !permit.updated_at) return;
      await updateMutation.mutateAsync({
        permitId: permit.id,
        projectId: permit.project_id,
        expectedUpdatedAt: permit.updated_at,
        patch: { [field]: next === '' ? null : next } as Partial<Permit>,
        fieldLabel: label,
      });
    };
  }

  const inFlight = updateMutation.isPending
    ? Object.keys(updateMutation.variables?.patch ?? {})[0]
    : null;
  const isFieldSaving = (field: keyof Permit) =>
    updateMutation.isPending && inFlight === field;

  return (
    <article className="bg-surface border border-border rounded-xl overflow-hidden">
      <header className="flex items-start gap-3 px-4 py-3 border-b border-border">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-display font-bold text-text">
            {permit.type ?? '—'}
            {permit.num && (
              <span className="ml-2 font-mono text-xs text-muted">
                {permit.num}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted mt-1">
            {[permit.ent_lead, permit.da, permit.dual_da, permit.dm]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded border font-semibold tracking-wide uppercase ${STAGE_BADGE[stage]}`}
        >
          {STAGE_LABEL[stage]}
        </span>
      </header>

      {occMissing && (
        <div className="px-4 py-2 bg-co-bg/40 border-b border-co-border text-[11px] text-co">
          Editing disabled — this permit has no updated_at token. Refresh and
          try again.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3">
        <EditableField
          kind="date"
          label="Target Submit"
          value={permit.target_submit}
          saving={isFieldSaving('target_submit')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makePermitSaver('target_submit', 'Target Submit')}
          testId={`permit-${permit.id}-target_submit`}
        />
        <ReadOnlyDateField
          label="DD Start"
          value={permit.dd_start}
          testId={`permit-${permit.id}-dd_start`}
        />
        <ReadOnlyDateField
          label="DD End"
          value={permit.dd_end}
          testId={`permit-${permit.id}-dd_end`}
        />
        <EditableField
          kind="date"
          label="Expected Issue"
          value={permit.expected_issue}
          saving={isFieldSaving('expected_issue')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makePermitSaver('expected_issue', 'Expected Issue')}
          testId={`permit-${permit.id}-expected_issue`}
        />
        <EditableField
          kind="text"
          label="DA"
          value={permit.da}
          saving={isFieldSaving('da')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makePermitSaver('da', 'DA')}
          testId={`permit-${permit.id}-da`}
        />
        <EditableField
          kind="text"
          label="DM"
          value={permit.dm}
          saving={isFieldSaving('dm')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makePermitSaver('dm', 'DM')}
          testId={`permit-${permit.id}-dm`}
        />
        <EditableField
          kind="text"
          label="ENT Lead"
          value={permit.ent_lead}
          saving={isFieldSaving('ent_lead')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makePermitSaver('ent_lead', 'ENT Lead')}
          testId={`permit-${permit.id}-ent_lead`}
        />
        <EditableField
          kind="text"
          label="Status"
          value={permit.status}
          saving={isFieldSaving('status')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makePermitSaver('status', 'Status')}
          testId={`permit-${permit.id}-status`}
        />
        <EditableField
          kind="select"
          label="Stage Override"
          value={permit.stage_override ?? ''}
          options={STAGE_OVERRIDE_OPTIONS}
          saving={isFieldSaving('stage_override')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makePermitSaver('stage_override', 'Stage')}
          testId={`permit-${permit.id}-stage_override`}
        />
      </div>

      <CycleSection
        permitId={permit.id}
        projectId={projectId}
        cycles={cycles}
      />

      <TaskSection permitId={permit.id} />
    </article>
  );
}

function CycleSection({
  permitId,
  projectId,
  cycles,
}: {
  permitId: number;
  projectId: string;
  cycles: PermitCycle[];
}) {
  const upsert = useUpsertPermitCycle();
  const remove = useDeletePermitCycle();
  const sorted = useMemo(
    () => [...cycles].sort((a, b) => a.cycle_index - b.cycle_index),
    [cycles],
  );

  function makeCycleSaver(cycle: PermitCycle, field: DateField) {
    return async (next: string) => {
      await upsert.mutateAsync({
        op: 'update',
        permitId,
        projectId,
        cycle,
        patch: { [field]: next === '' ? null : next } as CyclePatch,
      });
    };
  }

  function handleAddCycle() {
    const nextIndex = sorted.length
      ? Math.max(...sorted.map((c) => c.cycle_index)) + 1
      : 1;
    upsert.mutate({
      op: 'insert',
      permitId,
      projectId,
      cycleIndex: nextIndex,
      patch: {},
    });
  }

  function handleDelete(cycle: PermitCycle) {
    if (
      !window.confirm(
        `Delete cycle ${cycle.cycle_index}? This will hard-delete the row.`,
      )
    ) {
      return;
    }
    remove.mutate({ cycle, permitId, projectId });
  }

  const inFlightCycleId =
    upsert.isPending && upsert.variables?.op === 'update'
      ? upsert.variables.cycle.id
      : null;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-dim uppercase tracking-wide">
          Cycles
        </div>
        <button
          type="button"
          onClick={handleAddCycle}
          disabled={upsert.isPending}
          className="text-[10px] px-2 py-0.5 rounded border border-border bg-s2 hover:bg-s3 text-text transition disabled:opacity-50"
          data-testid={`permit-${permitId}-add-cycle`}
        >
          + Add cycle
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="text-[11px] text-dim italic py-2">
          No cycles yet — add one to track submission/correction dates.
        </div>
      ) : (
        <table className="w-full text-[10px]">
          <thead className="text-dim">
            <tr>
              <th className="text-left font-normal pb-1 pr-2">#</th>
              <th className="text-left font-normal pb-1 pr-2">Submitted</th>
              <th className="text-left font-normal pb-1 pr-2">City Target</th>
              <th className="text-left font-normal pb-1 pr-2">Corr. Out</th>
              <th className="text-left font-normal pb-1 pr-2">Resubmitted</th>
              <th className="text-left font-normal pb-1 pr-2">Intake Acc.</th>
              <th className="text-left font-normal pb-1" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((cycle) => {
              const saving = inFlightCycleId === cycle.id;
              return (
                <tr key={cycle.id} className="border-t border-border/50">
                  <td className="py-1 pr-2 font-mono text-text">
                    {cycle.cycle_index}
                  </td>
                  <td className="py-1 pr-2">
                    <CycleDateCell
                      cycle={cycle}
                      field="submitted"
                      saving={saving}
                      onSave={makeCycleSaver(cycle, 'submitted')}
                      pending={upsert.isPending}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <CycleDateCell
                      cycle={cycle}
                      field="city_target"
                      saving={saving}
                      onSave={makeCycleSaver(cycle, 'city_target')}
                      pending={upsert.isPending}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <CycleDateCell
                      cycle={cycle}
                      field="corr_issued"
                      saving={saving}
                      onSave={makeCycleSaver(cycle, 'corr_issued')}
                      pending={upsert.isPending}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <CycleDateCell
                      cycle={cycle}
                      field="resubmitted"
                      saving={saving}
                      onSave={makeCycleSaver(cycle, 'resubmitted')}
                      pending={upsert.isPending}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <CycleDateCell
                      cycle={cycle}
                      field="intake_accepted"
                      saving={saving}
                      onSave={makeCycleSaver(cycle, 'intake_accepted')}
                      pending={upsert.isPending}
                    />
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(cycle)}
                      disabled={remove.isPending || upsert.isPending}
                      className="text-co hover:text-co/70 px-1 disabled:opacity-50"
                      title="Delete cycle"
                      data-testid={`cycle-${cycle.id}-delete`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Q5.5.D: dd_start/dd_end on permits are sourced from the draw schedule via
// the Q5.5.C atomic RPC. ProjectDetail surfaces them as read-only displays;
// editing happens in the draw schedule view (Q6).
function ReadOnlyDateField({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted font-mono">
        {label}
      </span>
      <span
        className="text-xs text-text font-mono px-2 py-1 bg-bg/40 border border-border/40 rounded min-h-[26px] flex items-center"
        data-testid={testId}
        title="Edited via the draw schedule view"
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

function CycleDateCell({
  cycle,
  field,
  saving,
  pending,
  onSave,
}: {
  cycle: PermitCycle;
  field: DateField;
  saving: boolean;
  pending: boolean;
  onSave: (next: string) => void | Promise<void>;
}) {
  return (
    <EditableField
      kind="date"
      label=""
      value={cycle[field] ?? null}
      saving={saving}
      disabled={pending && !saving}
      onSave={onSave}
      testId={`cycle-${cycle.id}-${field}`}
    />
  );
}

function TaskSection({ permitId }: { permitId: number }) {
  const tasksQ = usePermitTasks(permitId);
  const upsert = useUpsertPermitTask();
  const remove = useDeletePermitTask();

  const tasksByBucket = useMemo(() => {
    const m = new Map<string, PermitTask[]>();
    for (const t of tasksQ.data ?? []) {
      const list = m.get(t.bucket) ?? [];
      list.push(t);
      m.set(t.bucket, list);
    }
    return m;
  }, [tasksQ.data]);

  function handleAdd(bucketId: string) {
    upsert.mutate({
      op: 'insert',
      permitId,
      patch: {
        bucket: bucketId,
        text: 'New task',
        completion_status: 'Open',
        stage: bucketId === 'co' ? 'co' : bucketId === 'pm' ? 'pm' : 'de',
      },
    });
  }

  function handleDelete(task: PermitTask) {
    if (!window.confirm(`Delete task "${task.text}"?`)) return;
    remove.mutate({ task, permitId });
  }

  function makeTaskSaver(task: PermitTask, field: keyof PermitTask) {
    return async (next: string) => {
      await upsert.mutateAsync({
        op: 'update',
        permitId,
        task,
        patch: { [field]: next === '' ? null : next } as TaskPatch,
      });
    };
  }

  const inFlightTaskId =
    upsert.isPending && upsert.variables?.op === 'update'
      ? upsert.variables.task.id
      : null;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="text-[10px] text-dim uppercase tracking-wide mb-2">
        Tasks
      </div>
      {tasksQ.isLoading ? (
        <SkeletonRows count={2} rowClassName="h-10" />
      ) : tasksQ.error ? (
        <QueryError
          title="Tasks failed to load"
          error={tasksQ.error}
          onRetry={() => tasksQ.refetch()}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {TASK_BUCKETS.map((bucket) => {
            const bucketTasks = tasksByBucket.get(bucket.id) ?? [];
            return (
              <div
                key={bucket.id}
                className="border border-border rounded-lg overflow-hidden bg-bg/40"
                data-testid={`task-bucket-${bucket.id}`}
              >
                <div className="flex items-center justify-between px-2.5 py-1.5 bg-s2">
                  <span className="text-[11px] font-display font-bold text-text">
                    {bucket.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-dim font-mono">
                      {bucketTasks.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAdd(bucket.id)}
                      disabled={upsert.isPending}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface hover:bg-s3 text-text transition disabled:opacity-50"
                      data-testid={`task-add-${bucket.id}-${permitId}`}
                    >
                      + Add
                    </button>
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {bucketTasks.length === 0 ? (
                    <li className="px-2.5 py-2 text-[11px] text-dim italic">
                      No tasks yet.
                    </li>
                  ) : (
                    bucketTasks.map((task) => {
                      const saving = inFlightTaskId === task.id;
                      const isTemp = task.id.startsWith('temp-');
                      return (
                        <li
                          key={task.id}
                          className="px-2.5 py-2 flex flex-col gap-1.5"
                        >
                          <div className="flex items-start gap-1.5">
                            <div className="flex-1 min-w-0">
                              <EditableField
                                kind="text"
                                label=""
                                value={task.text}
                                saving={saving}
                                disabled={isTemp || upsert.isPending}
                                onSave={makeTaskSaver(task, 'text')}
                                testId={`task-${task.id}-text`}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDelete(task)}
                              disabled={
                                isTemp || remove.isPending || upsert.isPending
                              }
                              className="text-co hover:text-co/70 px-1 disabled:opacity-50"
                              title="Delete task"
                              data-testid={`task-${task.id}-delete`}
                            >
                              ✕
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            <EditableField
                              kind="select"
                              label="Status"
                              value={task.completion_status ?? 'Open'}
                              options={COMPLETION_OPTIONS}
                              saving={saving}
                              disabled={isTemp || upsert.isPending}
                              onSave={makeTaskSaver(task, 'completion_status')}
                              testId={`task-${task.id}-completion_status`}
                            />
                            <EditableField
                              kind="text"
                              label="Assignee"
                              value={task.assigned_to}
                              saving={saving}
                              disabled={isTemp || upsert.isPending}
                              onSave={makeTaskSaver(task, 'assigned_to')}
                              testId={`task-${task.id}-assigned_to`}
                            />
                            <EditableField
                              kind="date"
                              label="Due"
                              value={task.due_date}
                              saving={saving}
                              disabled={isTemp || upsert.isPending}
                              onSave={makeTaskSaver(task, 'due_date')}
                              testId={`task-${task.id}-due_date`}
                            />
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
