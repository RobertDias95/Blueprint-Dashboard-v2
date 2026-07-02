import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUpsertPermitTask } from '../../hooks/useUpsertPermitTask';
import type { PermitTask, Stage } from '../../lib/database.types';
import type { FilterContext } from '../../lib/myTasksHelpers';
import { STAGE_LABEL } from '../../lib/stageLabel';

// Q9.5.f-fix-2 B: editable task detail. Mirrors v1 renderTaskDetail at
// index.html:5171-5203 but adapted to v2's unified schema — no priority
// column, no notes column (both punted in Q1c/Q3b). Every editable field
// writes through useUpsertPermitTask with OCC; the hook owns the toast
// + cache invalidation, so this panel just patches and forgets.

const STAGE_FG: Record<string, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
};

// fix-105: STAGE_LABEL is the shared map from src/lib/stageLabel.ts.
// task.bucket is typed as `string` in the schema; the call site casts
// to Stage so the shared Record<Stage, string> indexes type-safely.
// The bucket strings in practice ('de', 'pm', 'co') are all valid
// Stage values; the `?? stage` fallback below handles anything
// unexpected gracefully (same as the pre-fix behavior).

const COMPLETION_OPTIONS = ['Open', 'In Progress', 'Resolved'] as const;

interface Props {
  task: PermitTask | null;
  ctx: FilterContext;
  /** All distinct task.assigned_to values across the unfiltered task set —
   *  feeds the Assigned To select beyond the two internal labels. */
  assigneeOptions: string[];
}

export default function TaskDetailPanel({ task, ctx, assigneeOptions }: Props) {
  if (!task) {
    return (
      <aside
        className="border border-border rounded-lg bg-surface p-4 text-center"
        data-testid="mt-task-detail-empty"
      >
        <div className="text-[11px] text-dim italic">
          Click a task to view details
        </div>
      </aside>
    );
  }
  // key forces a fresh editor state when the user picks a different task
  return (
    <Editor key={task.id} task={task} ctx={ctx} assigneeOptions={assigneeOptions} />
  );
}

function Editor({
  task,
  ctx,
  assigneeOptions,
}: {
  task: PermitTask;
  ctx: FilterContext;
  assigneeOptions: string[];
}) {
  const upsert = useUpsertPermitTask();
  const permit = ctx.permitsById.get(task.permit_id);
  const project = permit ? ctx.projectsById.get(permit.project_id) : null;
  const stage = task.bucket;

  // Q9.5.f-fix-2 B: text + assignee inputs use blur-commit (so the user
  // can type freely without firing a mutation per keystroke). Dates and
  // the completion-status select commit on change — those are quick picks
  // and the user expects them to apply immediately.
  const [textDraft, setTextDraft] = useState(task.text);
  const [assigneeDraft, setAssigneeDraft] = useState(task.assigned_to ?? '');

  // Value-prop sync — pull new task fields into local drafts when the
  // panel switches to a different task. Same pattern as DateCell; the
  // lint rule flags it as a cascading-render risk but it's the correct
  // shape for "controlled input keyed by external selection".
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTextDraft(task.text);
  }, [task.id, task.text]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAssigneeDraft(task.assigned_to ?? '');
  }, [task.id, task.assigned_to]);

  function patch(p: Parameters<typeof upsert.mutate>[0]['patch']) {
    upsert.mutate({ op: 'update', permitId: task.permit_id, task, patch: p });
  }

  function commitText() {
    const next = textDraft.trim();
    if (!next || next === task.text) return;
    patch({ text: next });
  }
  function commitAssignee() {
    const next = assigneeDraft.trim();
    if (next === (task.assigned_to ?? '')) return;
    patch({ assigned_to: next || null });
  }

  // Assignee dropdown options: union of the two internal labels + every
  // distinct assigned_to value seen in the data + the current draft (so a
  // freshly-typed name doesn't disappear if it's not yet committed).
  const dropdownOptions = Array.from(
    new Set(
      ['Entitlements', 'Architecture', ...assigneeOptions, assigneeDraft].filter(
        Boolean,
      ),
    ),
  );

  return (
    <aside
      className="border border-border rounded-lg bg-surface overflow-y-auto"
      style={{ alignSelf: 'start' }}
      data-testid="mt-task-detail"
    >
      <header
        className="px-3 py-2 border-b flex items-center gap-2"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-wide"
          style={{ color: STAGE_FG[stage] ?? 'var(--color-muted)' }}
        >
          {STAGE_LABEL[stage as Stage] ?? stage}
        </span>
        <span className="text-[10px] text-dim flex-1 truncate" title={project?.address}>
          {project?.address ?? '—'}
        </span>
      </header>

      <div className="p-3 flex flex-col gap-3">
        {/* Task text — multi-line, blur-commit */}
        <div>
          <FieldLabel>Task</FieldLabel>
          <textarea
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={commitText}
            rows={3}
            className="w-full mt-0.5 text-[12px] px-2 py-1 border rounded outline-none resize-vertical"
            style={{
              background: 'var(--color-bg)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
              fontWeight: 600,
            }}
            data-testid="mt-detail-text"
          />
        </div>

        {/* Status + Assignee */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Status</FieldLabel>
            <select
              value={task.completion_status ?? 'Open'}
              onChange={(e) => patch({ completion_status: e.target.value })}
              className="w-full mt-0.5 text-[11px] px-2 py-1 border rounded outline-none"
              style={{
                background: 'var(--color-bg)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="mt-detail-status"
            >
              {COMPLETION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Assigned To</FieldLabel>
            <input
              list="mt-assignee-options"
              value={assigneeDraft}
              onChange={(e) => setAssigneeDraft(e.target.value)}
              onBlur={commitAssignee}
              className="w-full mt-0.5 text-[11px] px-2 py-1 border rounded outline-none"
              style={{
                background: 'var(--color-bg)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="mt-detail-assignee"
            />
            <datalist id="mt-assignee-options">
              {dropdownOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
        </div>

        {/* Date row — Start / Target / Due. All commit onChange. */}
        <div className="grid grid-cols-3 gap-2">
          <DateField
            label="Start"
            value={task.start_date ?? ''}
            onCommit={(v) => patch({ start_date: v || null })}
            tone="text"
            testId="mt-detail-start"
          />
          <DateField
            label="Target"
            value={task.target_date ?? ''}
            onCommit={(v) => patch({ target_date: v || null })}
            tone="de"
            testId="mt-detail-target"
          />
          <DateField
            label="Due"
            value={task.due_date ?? ''}
            onCommit={(v) => patch({ due_date: v || null })}
            tone="pm"
            testId="mt-detail-due"
          />
        </div>

        {/* Permit + Project metadata (read-only) */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t" style={{ borderTopColor: 'var(--color-border)' }}>
          <ReadOnly label="Permit" value={permit ? `${permit.type ?? '—'}${permit.num ? ` · ${permit.num}` : ''}` : '—'} />
          <ReadOnly label="Jurisdiction" value={project?.juris ?? '—'} />
        </div>
        {permit && (
          <div className="grid grid-cols-3 gap-2">
            <ReadOnly label="ENT" value={permit.ent_lead ?? '—'} small />
            <ReadOnly
              label="DA"
              value={
                [permit.da, permit.dual_da].filter(Boolean).join(' / ') || '—'
              }
              small
            />
            <ReadOnly label="DM" value={permit.dm ?? '—'} small />
          </div>
        )}

        {project && (
          <Link
            // fix-217: deep-link to the task's PERMIT so Project View auto-selects
            // + scrolls to it (its tasks/corrections on screen), instead of the
            // project top. `permit` is always set when `project` resolves here;
            // the guard keeps the link project-top-only if that ever changes.
            to={`/project/${project.id}${permit ? `?permit=${permit.id}` : ''}`}
            className="mt-1 text-[11px] px-3 py-1.5 rounded border text-center font-display font-bold transition no-underline"
            style={{
              background: 'var(--color-s2)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-muted)',
            }}
            data-testid="mt-detail-open-project"
          >
            → Open in Project View
          </Link>
        )}
      </div>
    </aside>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[8px] font-bold uppercase tracking-wide"
      style={{ color: 'var(--color-dim)' }}
    >
      {children}
    </div>
  );
}

function DateField({
  label,
  value,
  onCommit,
  tone,
  testId,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  tone: 'text' | 'de' | 'pm';
  testId: string;
}) {
  const accent =
    tone === 'de'
      ? 'var(--color-de)'
      : tone === 'pm'
        ? 'var(--color-pm)'
        : 'var(--color-text)';
  return (
    <div>
      <div
        className="text-[8px] font-bold uppercase tracking-wide"
        style={{ color: accent }}
      >
        {label}
      </div>
      <input
        type="date"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        className="w-full mt-0.5 text-[11px] px-2 py-1 border rounded outline-none font-mono"
        style={{
          background: 'var(--color-bg)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text)',
        }}
        data-testid={testId}
      />
    </div>
  );
}

function ReadOnly({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[8px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--color-dim)' }}
      >
        {label}
      </div>
      <div
        className={`mt-0.5 ${small ? 'text-[10px]' : 'text-[11px]'} text-text`}
        style={{ wordBreak: 'break-word' }}
      >
        {value}
      </div>
    </div>
  );
}
