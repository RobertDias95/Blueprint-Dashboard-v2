import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useUpsertTask, useSetTaskAssignees } from "../hooks/useTaskTree";
import { useDmDaGroups } from "../hooks/useDmDaGroups";
import { activeMemberNamesOf } from "../hooks/useTeamMembers";
import { findDmForDa } from "./wizard/dmRouting";
import { usePermits } from "../hooks/usePermits";
import { useProjects } from "../hooks/useProjects";
import CoAssigneeEditor from "./CoAssigneeEditor";
import PrimaryAssigneeEditor from "./PrimaryAssigneeEditor";
import TaskDateField from "./TaskDateField";
import NotesPanel from "./ProjectDetail/NotesPanel";
import { inputStyle } from "../lib/taskFieldStyles";
import {
  resolvePrimaryAssignee,
  type ResolutionContext,
  type PrimaryResolutionContext,
} from "../lib/taskTeam";
import {
  TASK_STATUS_OPTIONS,
  writableStatus,
  type TaskWriteStatus,
} from "../lib/taskStatus";
import {
  WAITING_ON_OPTIONS,
  type MyTaskNode,
  type TeamMember,
} from "../lib/database.types";

// fix-303: LIFTED VERBATIM out of MyTasks.tsx so My Board can use the SAME
// editor rather than growing a second one.
//
// ★ This is the LIVE task detail panel — the one fix-219 fixed after fix-217/218
// hardened the dead TaskDetailPanel.tsx by mistake. It was local to MyTasks,
// which is why the board could not have it without duplicating it. The brief is
// explicit: "do not build a second task-editing path", and down the road the
// board may replace My Tasks entirely, so the editor had to stop belonging to
// one page.
//
// Nothing inside changed in the move. Both callers import this file, so an edit
// made on the board and an edit made in My Tasks are byte-for-byte the same
// write, through the same useUpsertTask / useSetTaskAssignees hooks.

/** Per-phase accent colour, matching the D&E / Permitting toggle. */
const BUCKET_ACCENT: Record<"de" | "pm", string> = {
  de: "var(--color-de)",
  pm: "var(--color-pm)",
};

type Task = MyTaskNode & { bucket?: "de" | "pm" };

/** Lifecycle phase of a task; 'de' before the permit went in, 'pm' after. */
function bucketOf(t: Task): "de" | "pm" {
  return t.bucket === "pm" ? "pm" : "de";
}

export default function TaskDetailEditor({
  task,
  members,
}: {
  task: Task;
  members: TeamMember[];
}) {
  const upsert = useUpsertTask();
  const setAssignees = useSetTaskAssignees();
  const dmRows = useDmDaGroups().rows;
  // fix-228: ent_lead + schematic designers for PRIMARY-owner resolution come
  // from the (cached) permits/projects the app already loads, joined by
  // permit_id / project_id (bp_list_tasks doesn't carry them). DA + DM resolve
  // from permit_da + dm_da_groups as the permit bar does.
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const entLead = useMemo(
    () =>
      permitsQ.data?.find((p) => p.id === task.permit_id)?.ent_lead ?? null,
    [permitsQ.data, task.permit_id],
  );
  const schematicDesigners = useMemo(
    () =>
      projectsQ.data?.find((p) => p.id === task.project_id)?.schematic_designer ??
      [],
    [projectsQ.data, task.project_id],
  );

  // fix-224: assignment = co_assignees (the permit_task_assignees join table),
  // the SAME store the permit bar writes. Role tokens resolve to people for
  // display via the permit's DA (+ dm_da_groups).
  const assigneeCtx: ResolutionContext = {
    da: task.permit_da ?? null,
    dm: findDmForDa(task.permit_da ?? '', dmRows),
    schematicDesigners,
  };
  // fix-228: the PRIMARY owner (assigned_to, fix-222 taxonomy) resolves to a
  // person the SAME way as the permit bar — default = the DA.
  const primaryCtx: PrimaryResolutionContext = {
    da: task.permit_da ?? null,
    entLead,
    dm: findDmForDa(task.permit_da ?? '', dmRows),
    schematicDesigners,
  };
  const primaryPerson = resolvePrimaryAssignee(task.assigned_to, primaryCtx, task.discipline);
  // fix-233: CURRENT team members only (active + non-former) — one shared source.
  const memberNames = activeMemberNamesOf(members);

  // Notes is the only multi-line free-form field — debounce-commit on
  // blur via local draft + onBlur. Every other field commits on change
  // (single click / single pick).
  // fix-294: the notesDraft / notesInitial / commitNotes trio is GONE with the
  // box it fed. permit_tasks.notes is frozen -- nothing in the app writes it
  // any more -- so leaving the commit path here would be a loaded gun: the next
  // person to add a "Notes" field would find a working writer for a column
  // nothing reads.

  function patch(p: Partial<Parameters<typeof upsert.mutate>[0]>) {
    upsert.mutate({
      id: task.id,
      permitId: task.permit_id,
      parentTaskId: task.parent_task_id,
      discipline: task.discipline,
      bucket: task.bucket,
      text: task.text,
      // fix-224: ALWAYS re-send the current start/target dates (the same way the
      // permit-bar editor does) because the update RPC OVERWRITES those two
      // columns. Without this, editing one date (or any other field) would null
      // the untouched date — the cross-view date-erase Jade + Erick reported.
      // The edited field in `p` still overrides these.
      startDate: task.start_date,
      targetDate: task.target_date,
      // Other optional fields stay 3-state (undefined = leave unchanged).
      ...p,
    });
  }

  function commitDate(
    field: 'startDate' | 'targetDate' | 'dueDate' | 'completed',
    value: string,
  ) {
    const trimmed = value.trim();
    if (!trimmed) {
      // Empty input clears the date.
      if (field === 'startDate' || field === 'targetDate') {
        // fix-224: start_date/target_date are OVERWRITE columns — passing null
        // for the edited field clears it, while patch() re-sends the OTHER
        // date's current value so it survives.
        patch({ [field]: null } as Record<typeof field, null>);
      } else {
        // due_date / completed are 3-state — an explicit clear flag is needed.
        const clearKey = (
          { dueDate: 'clearDueDate', completed: 'clearCompleted' } as const
        )[field];
        patch({
          [field]: null,
          [clearKey]: true,
        } as Record<string, unknown>);
      }
      return;
    }
    patch({ [field]: trimmed } as Record<typeof field, string>);
  }

  const isResolved = task.status === 'Resolved';
  const completedValue: string =
    task.done_at && typeof task.done_at === 'string'
      ? task.done_at.slice(0, 10)
      : '';

  return (
    <aside
      className="rounded border flex flex-col"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
        alignSelf: 'start',
      }}
      data-testid="mytasks-detail"
    >
      <header
        className="px-2.5 py-1.5 border-b flex items-center gap-1.5"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <Pill
          label={task.discipline === 'arch' ? 'Architecture' : 'Entitlements'}
          color={task.discipline === 'arch' ? 'var(--color-jv)' : 'var(--color-de)'}
          testid="mytasks-detail-discipline"
        />
        <Pill
          label={bucketOf(task) === 'de' ? 'D&E' : 'Permitting'}
          color={BUCKET_ACCENT[bucketOf(task)]}
          testid="mytasks-detail-bucket"
        />
      </header>

      <div
        className="text-[12px] font-bold px-2.5 py-1.5 border-b"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="mytasks-detail-text"
      >
        {task.text}
      </div>

      <div className="p-2.5 flex flex-col gap-2">
        {/* 1 Project */}
        <FieldRow label="Project">
          <Link
            to={`/project/${task.project_id}`}
            className="text-[11px] underline truncate"
            style={{ color: 'var(--color-de)' }}
            data-testid="task-detail-project"
          >
            {task.project_address}
          </Link>
        </FieldRow>

        {/* 2 Permit (read-only link) */}
        <FieldRow label="Permit">
          <Link
            to={`/project/${task.project_id}`}
            className="text-[11px] underline"
            style={{ color: 'var(--color-muted)' }}
            data-testid="task-detail-permit"
          >
            {task.permit_type ?? '—'}
          </Link>
        </FieldRow>

        {/* fix-228/229: the PRIMARY owner (assigned_to, fix-222 taxonomy) —
            selectable as Design Associate (default → DA) / Entitlements /
            Schematic Team / Design Manager / a specific person; resolves to a
            person the same way the permit bar does. fix-229: the field label
            ("Assignee") aids scanning in this vertical form; the select's option
            already shows "<role> · <person>" so the person isn't shown twice. */}
        <FieldRow label="Assignee">
          <PrimaryAssigneeEditor
            value={task.assigned_to}
            discipline={task.discipline}
            ctx={primaryCtx}
            memberNames={memberNames}
            disabled={upsert.isPending}
            onChange={(next) => patch({ assignedTo: next })}
            testIdPrefix="task-detail"
          />
        </FieldRow>

        {/* 3 Co-assignees (fix-224: co_assignees join table — the single source,
            shared with the permit bar). fix-228: a co-assignee equal to the
            primary is de-duped in the editor. */}
        <FieldRow label="Co-assignees">
          <CoAssigneeEditor
            values={task.co_assignees}
            ctx={assigneeCtx}
            memberNames={memberNames}
            primaryPerson={primaryPerson}
            onChange={(next) =>
              setAssignees.mutate({
                taskId: task.id,
                permitId: task.permit_id,
                assignees: next,
              })
            }
            testIdPrefix="task-detail"
          />
        </FieldRow>

        {/* 4 Waiting On */}
        <FieldRow label="Waiting On">
          <select
            value={task.waiting_on ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') {
                patch({ waitingOn: null, clearWaitingOn: true });
              } else {
                patch({ waitingOn: v });
              }
            }}
            className="text-[11px] px-2 py-1 border rounded outline-none"
            style={inputStyle()}
            data-testid="task-detail-waiting-on"
          >
            <option value="">—</option>
            {WAITING_ON_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </FieldRow>

        {/* 5 Priority — star toggle */}
        <FieldRow label="Priority">
          <button
            type="button"
            onClick={() => patch({ priority: !task.priority })}
            className="text-[14px] leading-none px-1"
            style={{
              color: task.priority ? 'var(--color-co)' : 'var(--color-muted)',
              cursor: 'pointer',
            }}
            data-testid="task-detail-priority"
            data-priority={task.priority ? 'true' : 'false'}
            aria-pressed={!!task.priority}
            title={task.priority ? 'Priority on' : 'Priority off'}
          >
            {task.priority ? '★' : '☆'}
          </button>
        </FieldRow>

        {/* 6 Start Date — fix-229: empty renders a muted "—" that reveals the
            picker (no loud mm/dd/yyyy), shared TaskDateField. */}
        <FieldRow label="Start Date">
          <TaskDateField
            value={task.start_date}
            onChange={(v) => commitDate('startDate', v ?? '')}
            ariaLabel="Start date"
            testId="task-detail-start"
            inputClassName="text-[11px] px-2 py-1 border rounded outline-none font-mono"
            inputStyle={inputStyle()}
          />
        </FieldRow>

        {/* 7 Target Date */}
        <FieldRow label="Target Date">
          <TaskDateField
            value={task.target_date}
            onChange={(v) => commitDate('targetDate', v ?? '')}
            ariaLabel="Target date"
            testId="task-detail-target"
            inputClassName="text-[11px] px-2 py-1 border rounded outline-none font-mono"
            inputStyle={inputStyle()}
          />
        </FieldRow>

        {/* fix-235: Status dropdown — the ONLY control that can move a task
            backward (e.g. Resolved → In Progress). Writes the same
            completion_status field the row checkbox advances; the DB trigger
            keeps done/done_at in sync. */}
        <FieldRow label="Status">
          <select
            value={task.status}
            onChange={(e) => patch({ status: e.target.value as TaskWriteStatus })}
            disabled={upsert.isPending}
            className="text-[11px] px-2 py-1 border rounded outline-none"
            style={inputStyle()}
            data-testid="task-detail-status"
          >
            {TASK_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FieldRow>

        {/* 8 Completed — setting the date stamps done_at AND moves the
            task to Resolved (the upsert RPC's completion_status rule
            doesn't flip status from a date, so do it client-side). */}
        <FieldRow label="Completed">
          <TaskDateField
            value={completedValue || null}
            onChange={(v) => {
              if (!v) {
                patch({
                  completed: null,
                  clearCompleted: true,
                  // Reopen the task — if there's no completion date,
                  // the task can't still be Resolved.
                  status: isResolved ? 'Open' : writableStatus(task.status),
                });
              } else {
                patch({ completed: v, status: 'Resolved' });
              }
            }}
            ariaLabel="Completed date"
            testId="task-detail-completed"
            inputClassName="text-[11px] px-2 py-1 border rounded outline-none font-mono"
            inputStyle={inputStyle()}
          />
        </FieldRow>

        {/* ★ fix-294: 9 Notes — now the PERMIT's notes, not a private field.
            This box used to write permit_tasks.notes, which was rendered on
            exactly one screen: this panel. Nothing on Project Overview, the
            permit detail, or any report ever read it back, so 19 real
            operational notes ("Holding for MHA", "Pending Builder Signature",
            paths to picked-up redlines) were invisible to everyone but the
            person who typed them. Those 19 were migrated onto their permits;
            permit_tasks.notes is now frozen and unwritten, the same treatment
            fix-notes-1 gave the legacy per-permit notes columns.

            It is the same NotesPanel the permit detail and Project Overview
            mount, scoped to this task's permit — so a note typed here appears
            where people actually look, and one typed there appears here. */}
        {/* No "task has no permit" fallback, deliberately: permit_tasks.permit_id
            is NOT NULL and 0 of the 1,057 production rows are without one, so a
            branch for it would be a state that cannot occur — the same kind of
            invented emptiness this ticket is removing. */}
        <div className="flex flex-col gap-0.5" data-testid="task-detail-permit-notes">
          <FieldLabel>Notes on this permit</FieldLabel>
          <NotesPanel projectId={task.project_id} permitId={task.permit_id} />
        </div>
      </div>

      <Link
        // fix-217/218/219: deep-link to the task's PERMIT so Project View
        // auto-selects + scrolls to it, instead of the project top. This is the
        // LIVE My Tasks detail panel (fix-217/218 hardened the unused
        // TaskDetailPanel component). Build the param straight from
        // task.permit_id — the permit pk on the MyTaskNode — so it never
        // depends on resolving a permit object out of a lookup map.
        to={`/project/${task.project_id}${task.permit_id != null ? `?permit=${task.permit_id}` : ''}`}
        className="text-[10px] font-display font-bold px-2.5 py-1.5 border-t text-center no-underline"
        style={{
          background: 'var(--color-s2)',
          borderTopColor: 'var(--color-border)',
          color: 'var(--color-muted)',
        }}
        data-testid="task-detail-open-project"
      >
        → Open in Project View
      </Link>
    </aside>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[8px] font-bold uppercase tracking-wide"
      style={{ color: 'var(--color-dim)' }}
    >
      {children}
    </span>
  );
}

function Pill({
  label,
  color,
  testid,
}: {
  label: string;
  color: string;
  testid: string;
}) {
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase"
      style={{
        background: color,
        color: '#fff',
      }}
      data-testid={testid}
    >
      {label}
    </span>
  );
}

