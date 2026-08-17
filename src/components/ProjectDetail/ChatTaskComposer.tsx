import { useMemo, useState } from 'react';
import { useDmDaGroups } from '../../hooks/useDmDaGroups';
import { useProjects } from '../../hooks/useProjects';
import { useTeamMembers, activeMemberNamesOf } from '../../hooks/useTeamMembers';
import {
  anchorPermitIdFor,
  permitChoiceLabel,
  useCreateTaskFromMessage,
} from '../../hooks/useProjectMessages';
import { findDmForDa } from '../wizard/dmRouting';
import PrimaryAssigneeEditor from '../PrimaryAssigneeEditor';
import TaskDateField from '../TaskDateField';
import { inputStyle } from '../../lib/taskFieldStyles';
import {
  disciplineForTeam,
  type PrimaryResolutionContext,
} from '../../lib/taskTeam';
import type { Permit } from '../../lib/database.types';

// fix-330 — create a task from a message, and CHOOSE ITS PERMIT.
//
// Bobby: "if there's a create-a-task button and you can assign it to a permit
// from inside a project chat."
//
// ★★ fix-329 CHOSE FOR HIM. It anchored silently on the project's lowest-id
// Building Permit — which on 3921 (five permits) is the tool guessing wrong four
// times in five and never saying that it guessed. The anchor is still the
// DEFAULT, because it is the right guess more often than any other, but it is
// now a pre-selection somebody can disagree with.
//
// ★ NOT A SECOND TASK FORM. Every control here is the one the rest of the app
// already uses — PrimaryAssigneeEditor for the owner (fix-228), TaskDateField
// for the date (fix-237/258's buffered commit, so a half-typed year can never
// be saved), and useCreateTaskFromMessage → useUpsertTask →
// bp_upsert_permit_task for the write. The permit <select> is the only new
// control, and it exists because no other surface has ever needed one: every
// other task editor is already standing on a permit.
//
// ★ THE COLUMN FOLLOWS THE TEAM (fix-244). disciplineForTeam maps the chosen
// owner to arch/ent exactly as the permit bar does, so a task handed to the
// Schematic Team lands in the design column here too. A named person carries no
// team signal, so it falls back to 'ent' — the same default fix-244's SQL twin
// uses for NULL.

export default function ChatTaskComposer({
  messageId,
  projectId,
  defaultText,
  permits,
  onDone,
  onCancel,
}: {
  messageId: string;
  projectId: string;
  defaultText: string;
  permits: Permit[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const createTask = useCreateTaskFromMessage();
  const team = useTeamMembers();
  const dmRows = useDmDaGroups().rows;
  const projectsQ = useProjects();

  const anchorId = useMemo(() => anchorPermitIdFor(permits), [permits]);
  const [permitId, setPermitId] = useState<number | null>(anchorId);
  const [text, setText] = useState(defaultText);
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [targetDate, setTargetDate] = useState<string | null>(null);

  const permit = useMemo(
    () => permits.find((p) => p.id === permitId) ?? null,
    [permits, permitId],
  );

  const schematicDesigners = useMemo(
    () =>
      projectsQ.data?.find((p) => p.id === projectId)?.schematic_designer ?? [],
    [projectsQ.data, projectId],
  );

  // The same context the permit bar and My Tasks build, from the CHOSEN permit —
  // change the permit and the owner options follow it, because a different
  // permit can carry a different DA and ENT lead.
  const ctx: PrimaryResolutionContext = {
    da: permit?.da ?? null,
    entLead: permit?.ent_lead ?? null,
    dm: findDmForDa(permit?.da ?? '', dmRows),
    schematicDesigners,
  };
  const memberNames = activeMemberNamesOf(team.all);

  const discipline = disciplineForTeam(assignedTo) ?? 'ent';
  const ready = !!permitId && text.trim().length > 0 && !createTask.isPending;

  function submit() {
    if (!permitId || !text.trim()) return;
    createTask.mutate(
      {
        messageId,
        permitId,
        text: text.trim().slice(0, 200),
        discipline,
        assignedTo: assignedTo || null,
        targetDate,
      },
      { onSuccess: onDone },
    );
  }

  return (
    <div
      className="mt-2 rounded-lg border p-2.5 flex flex-col gap-2"
      style={{ borderColor: 'var(--color-de-border)', background: 'var(--color-de-bg)' }}
      data-testid={`chat-task-composer-${messageId}`}
    >
      <Field label="Task">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full text-[11.5px] px-2 py-1 border rounded outline-none"
          style={inputStyle()}
          aria-label="Task text"
          data-testid={`chat-task-text-${messageId}`}
        />
      </Field>

      {/* ★ THE THING THE TICKET IS ABOUT. Number AND type, because "Building
          Permit" twice on one project is not a choice anybody can make. */}
      <Field label="Permit">
        <select
          value={permitId ?? ''}
          onChange={(e) => setPermitId(Number(e.target.value))}
          className="w-full text-[11.5px] px-2 py-1 border rounded outline-none"
          style={inputStyle()}
          aria-label="Permit for this task"
          data-testid={`chat-task-permit-${messageId}`}
        >
          {permits.map((p) => (
            <option key={p.id} value={p.id}>
              {permitChoiceLabel(p)}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex gap-3 flex-wrap">
        <Field label="Assignee">
          <PrimaryAssigneeEditor
            value={assignedTo}
            discipline={discipline}
            ctx={ctx}
            memberNames={memberNames}
            disabled={createTask.isPending}
            onChange={setAssignedTo}
            testIdPrefix={`chat-task-${messageId}`}
          />
        </Field>
        <Field label="Due">
          <TaskDateField
            value={targetDate}
            onChange={setTargetDate}
            disabled={createTask.isPending}
            ariaLabel="Task due date"
            testId={`chat-task-due-${messageId}`}
            inputClassName="text-[11px] px-2 py-1 border rounded outline-none font-mono"
            inputStyle={inputStyle()}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          className="bg-de text-white rounded px-3 py-1 text-[11px] font-bold disabled:opacity-50"
          data-testid={`chat-task-create-${messageId}`}
        >
          Create task
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-dim hover:text-text px-2 py-1"
          data-testid={`chat-task-cancel-${messageId}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5 min-w-0 flex-1">
      <span
        className="text-[8px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--color-dim)' }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
