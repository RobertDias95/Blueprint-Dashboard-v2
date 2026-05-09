import { useMemo } from 'react';
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

// Q3 + Q4: Single-project view. Q3 wired editable permit-level fields. Q4
// adds editable cycles (5 date columns + add/delete) and a tasks section
// per permit (3 buckets: de/pm/co + add/delete). All writes are row-level
// OCC via the bp_upsert_*_row / bp_delete_*_row RPCs.

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

  return (
    <div className="space-y-6">
      <header>
        <Link
          to="/projects"
          className="text-[11px] text-muted hover:text-text transition"
        >
          ← Project View
        </Link>
        <h1 className="text-xl font-display font-black text-text mt-1">
          {project?.address ?? '...'}
        </h1>
        <div className="text-[11px] text-muted font-mono mt-1">
          {project?.juris ?? '—'}
          {project?.notes && (
            <span className="ml-2 text-dim">· {project.notes}</span>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-xs font-display font-extrabold uppercase tracking-wide text-text mb-3">
          Permits
        </h2>
        {isLoading ? (
          <SkeletonRows count={3} rowClassName="h-24" />
        ) : (permitsQ.data ?? []).length === 0 ? (
          <div className="text-sm text-dim italic px-2 py-6 text-center bg-surface border border-border rounded-xl">
            No permits on this project yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {(permitsQ.data ?? []).map((permit) => (
              <PermitDetailRow
                key={permit.id}
                permit={permit}
                projectId={project!.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
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
