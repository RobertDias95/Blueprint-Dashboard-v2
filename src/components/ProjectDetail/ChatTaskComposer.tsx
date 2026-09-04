import { useMemo, useState } from 'react';
import {
  anchorPermitIdFor,
  useCreateTaskFromMessage,
} from '../../hooks/useProjectMessages';
import ChatTaskFields from './ChatTaskFields';
import {
  disciplineForDraft,
  emptyTaskDraft,
  taskDraftIsReady,
  type ChatTaskDraft,
} from '../../lib/chatTaskDraft';
import type { PermitWithCycles } from '../../lib/database.types';

// fix-330 — create a task from a message ALREADY POSTED, and choose its permit.
//
// ★★ fix-329 CHOSE FOR HIM. It anchored silently on the project's lowest-id
// Building Permit — which on 3921 (five permits) is the tool guessing wrong four
// times in five and never saying that it guessed. The anchor is still the
// DEFAULT; it is now a pre-selection somebody can disagree with.
//
// ★ fix-334 §5 added a SECOND place a task gets composed — alongside a message,
// in one send. The four fields moved into <ChatTaskFields> so both share one
// form rather than drifting; this component keeps the post-hoc write path
// (useCreateTaskFromMessage) and the panel chrome.
//
// ★ Still not a second task form: the owner is PrimaryAssigneeEditor (fix-228),
// the date is TaskDateField (fix-237/258's buffered commit), the write is
// useUpsertTask → bp_upsert_permit_task, and the column follows the team
// (fix-244).

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
  // ★ fix-494: cycles are needed for the task's phase — see lib/permitPhase.
  permits: PermitWithCycles[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const createTask = useCreateTaskFromMessage();
  const anchorId = useMemo(() => anchorPermitIdFor(permits), [permits]);
  const [draft, setDraft] = useState<ChatTaskDraft>(() =>
    emptyTaskDraft(anchorId, defaultText),
  );

  const ready = taskDraftIsReady(draft) && !createTask.isPending;

  function submit() {
    if (!ready || draft.permitId == null) return;
    createTask.mutate(
      {
        messageId,
        permitId: draft.permitId,
        text: draft.text.trim().slice(0, 200),
        discipline: disciplineForDraft(draft),
        assignedTo: draft.assignedTo || null,
        targetDate: draft.targetDate,
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
      <ChatTaskFields
        draft={draft}
        onChange={setDraft}
        projectId={projectId}
        permits={permits}
        disabled={createTask.isPending}
        testIdPrefix={`chat-task-${messageId}`}
      />
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
