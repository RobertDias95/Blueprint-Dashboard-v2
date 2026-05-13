import type { PermitTask } from '../../lib/database.types';
import type { FilterContext } from '../../lib/myTasksHelpers';

// Q9.5.f Item 5: third pane on MyTasks shows full detail of the
// currently-selected task. Mirrors v1's mt-context panel at index.html:976
// — empty state when nothing is picked, populated detail otherwise.
// Width-fixed (280px) by the grid template in the parent page.

interface Props {
  task: PermitTask | null;
  ctx: FilterContext;
}

const STAGE_FG: Record<string, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
};

const STAGE_LABEL: Record<string, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
};

export default function TaskDetailPanel({ task, ctx }: Props) {
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

  const permit = ctx.permitsById.get(task.permit_id);
  const project = permit ? ctx.projectsById.get(permit.project_id) : null;
  const stage = task.bucket;
  const team = [permit?.ent_lead, permit?.da, permit?.dual_da, permit?.dm]
    .filter(Boolean)
    .join(' · ');

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
          {STAGE_LABEL[stage] ?? stage}
        </span>
        <span className="text-[10px] text-dim flex-1 truncate">
          {project?.address ?? '—'}
        </span>
      </header>
      <div className="p-3 flex flex-col gap-3">
        <DetailField label="Task" value={task.text} prominent />
        <div className="grid grid-cols-2 gap-2">
          <DetailField label="Status" value={task.completion_status ?? 'Open'} />
          <DetailField label="Assignee" value={task.assigned_to ?? '—'} />
          <DetailField label="Target" value={task.target_date ?? '—'} mono />
          <DetailField label="Due" value={task.due_date ?? '—'} mono />
        </div>
        <DetailField
          label="Permit"
          value={
            permit
              ? `${permit.type ?? '—'}${permit.num ? ` · ${permit.num}` : ''}`
              : '—'
          }
        />
        <DetailField label="Jurisdiction" value={project?.juris ?? '—'} />
        {team && <DetailField label="Team" value={team} />}
        {task.cat && <DetailField label="Category" value={task.cat} />}
        {task.cycle_idx != null && (
          <DetailField label="Cycle" value={`Cycle ${task.cycle_idx}`} />
        )}
      </div>
    </aside>
  );
}

function DetailField({
  label,
  value,
  prominent,
  mono,
}: {
  label: string;
  value: string;
  prominent?: boolean;
  mono?: boolean;
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
        className={`mt-0.5 text-[11px] text-text ${mono ? 'font-mono' : ''}`}
        style={{ fontWeight: prominent ? 700 : 500, wordBreak: 'break-word' }}
      >
        {value}
      </div>
    </div>
  );
}
