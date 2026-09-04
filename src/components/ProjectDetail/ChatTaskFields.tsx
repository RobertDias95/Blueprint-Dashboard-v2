import { useMemo } from 'react';
import { defaultTaskBucket, TASK_BUCKET_LABEL } from '../../lib/permitPhase';
import { useDmDaGroups } from '../../hooks/useDmDaGroups';
import { useProjects } from '../../hooks/useProjects';
import { useTeamMembers, activeMemberNamesOf } from '../../hooks/useTeamMembers';
import { permitChoiceLabel } from '../../hooks/useProjectMessages';
import { findDmForDa } from '../wizard/dmRouting';
import PrimaryAssigneeEditor from '../PrimaryAssigneeEditor';
import TaskDateField from '../TaskDateField';
import { inputStyle } from '../../lib/taskFieldStyles';
import { type PrimaryResolutionContext } from '../../lib/taskTeam';
import {
  disciplineForDraft,
  type ChatTaskDraft,
} from '../../lib/chatTaskDraft';
import type { PermitWithCycles } from '../../lib/database.types';

// fix-334 §5 — the task form, lifted OUT of ChatTaskComposer so two callers can
// share it.
//
// ★★ THE BRIEF SAYS "REUSE THEM, DO NOT BUILD A SECOND FORM", and by fix-334
// there are two places a task gets composed: the post-hoc composer on an already
// posted message (fix-330), and the send composer that creates a message and its
// task together (§5). Copying four fields into the second one is exactly how the
// two would drift — one gains the fix-244 discipline rule, the other does not.
//
// This is the fields ONLY. It is fully controlled and owns no mutation: each
// caller writes through its own path (useCreateTaskFromMessage for the post-hoc
// one, usePostMessage for the one-send one), which is what lets §5's task ride
// in the same mutation as its message.

export default function ChatTaskFields({
  draft,
  onChange,
  projectId,
  permits,
  disabled = false,
  testIdPrefix,
}: {
  draft: ChatTaskDraft;
  onChange: (next: ChatTaskDraft) => void;
  projectId: string;
  // ★ fix-494: cycles are needed for the "→ Permitting" / "→ D&E" label.
  permits: PermitWithCycles[];
  disabled?: boolean;
  testIdPrefix: string;
}) {
  const team = useTeamMembers();
  const dmRows = useDmDaGroups().rows;
  const projectsQ = useProjects();

  const permit = useMemo(
    () => permits.find((p) => p.id === draft.permitId) ?? null,
    [permits, draft.permitId],
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

  return (
    <>
      <Field label="Task">
        <input
          type="text"
          value={draft.text}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          disabled={disabled}
          className="w-full text-[11.5px] px-2 py-1 border rounded outline-none"
          style={inputStyle()}
          aria-label="Task text"
          data-testid={`${testIdPrefix}-text`}
        />
      </Field>

      {/* ★ fix-330: number AND type, because "Building Permit" twice on one
          project is not a choice anybody can make. */}
      <Field label="Permit">
        <select
          value={draft.permitId ?? ''}
          onChange={(e) => onChange({ ...draft, permitId: Number(e.target.value) })}
          disabled={disabled}
          className="w-full text-[11.5px] px-2 py-1 border rounded outline-none"
          style={inputStyle()}
          aria-label="Permit for this task"
          data-testid={`${testIdPrefix}-permit`}
        >
          {permits.map((p) => (
            <option key={p.id} value={p.id}>
              {permitChoiceLabel(p)}
            </option>
          ))}
        </select>
        {/* ★★★ fix-494 (P-155) — SAY WHERE IT WILL LAND, BEFORE SEND.
            Bobby's complaint was that a task arrived in the wrong phase and
            nothing had said which phase it was going to. The phase is decided
            by the same helper the permit screen and the DB trigger use, so this
            label cannot promise one thing and deliver another.

            ★ LABEL ONLY — it is not a control. The phase follows the permit,
              and choosing the permit is the decision the poster is already
              making one line up. */}
        <div
          className="text-[10px] mt-0.5"
          style={{ color: 'var(--color-muted)' }}
          data-testid={`${testIdPrefix}-phase`}
        >
          → {TASK_BUCKET_LABEL[defaultTaskBucket(permit)]}
        </div>
      </Field>

      <div className="flex gap-3 flex-wrap">
        <Field label="Assignee">
          <PrimaryAssigneeEditor
            value={draft.assignedTo}
            discipline={disciplineForDraft(draft)}
            ctx={ctx}
            memberNames={memberNames}
            disabled={disabled}
            onChange={(next) => onChange({ ...draft, assignedTo: next })}
            testIdPrefix={testIdPrefix}
          />
        </Field>
        <Field label="Due">
          <TaskDateField
            value={draft.targetDate}
            onChange={(v) => onChange({ ...draft, targetDate: v })}
            disabled={disabled}
            ariaLabel="Task due date"
            testId={`${testIdPrefix}-due`}
            inputClassName="text-[11px] px-2 py-1 border rounded outline-none font-mono"
            inputStyle={inputStyle()}
          />
        </Field>
      </div>
    </>
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
