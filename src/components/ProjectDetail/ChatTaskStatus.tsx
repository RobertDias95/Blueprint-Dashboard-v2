import { useTaskOwnership } from '../../hooks/useTaskOwnership';
import { UNASSIGNED_LABEL, type ChatTaskStatusView } from '../../lib/chatTaskStatus';

// ★ fix-603 (P-172): the tail of the green "task made from this message" row —
//   status word · owner · (overdue) due date.
//
// ★ Its own component so the ownership hook mounts ONLY when there is a status
//   to show. Before the migration is applied the row never renders this, so it
//   is byte-for-byte what it was and reads nothing it did not read before.

export default function ChatTaskStatus({
  messageId,
  view,
  projectId,
  permitId,
}: {
  messageId: string;
  view: ChatTaskStatusView;
  projectId: string;
  permitId: number | null;
}) {
  const ownership = useTaskOwnership();
  // ★ Blank reads "Unassigned" — NOT the discipline default the resolver
  //   would fall back to. Four of the eight open chat tasks on prod have no
  //   owner, and the row exists to say so.
  const owner =
    view.assignedTo === null
      ? UNASSIGNED_LABEL
      : (ownership.primaryAssignee({
          assigned_to: view.assignedTo,
          permit_id: permitId,
          project_id: projectId,
        }) ?? view.assignedTo);

  const word = view.done && view.doneOn ? `${view.word} ${view.doneOn}` : view.word;

  return (
    <>
      <span className="text-dim"> · </span>
      <span
        className={view.done ? 'text-dim' : 'text-text'}
        data-testid={`project-chat-task-status-${messageId}`}
        data-done={view.done ? 'true' : 'false'}
      >
        {word}
      </span>
      <span className="text-dim"> · </span>
      <span
        className={view.done ? 'text-dim' : 'text-text'}
        data-testid={`project-chat-task-owner-${messageId}`}
      >
        {owner}
      </span>
      {view.overdueDue && (
        <>
          <span className="text-dim"> · </span>
          <span
            // The same colour My Tasks gives an overdue due date.
            style={{ color: 'var(--color-co)', fontWeight: 700 }}
            data-testid={`project-chat-task-due-${messageId}`}
          >
            due {view.overdueDue}
          </span>
        </>
      )}
    </>
  );
}
