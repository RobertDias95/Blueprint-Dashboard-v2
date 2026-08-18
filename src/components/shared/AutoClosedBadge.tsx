// ★★ fix-337 §2 — "a person looking at a completed task should be able to tell
// it was cleared by the system because the permit moved on."
//
// ★ The BOT badge (fix-155) says why a task was CREATED and explicitly promises
// that auto-tasks are "NEVER auto-completed". That promise has an exception
// now, and it needs its own mark rather than a second meaning bolted onto the
// first — a task can carry both, and they say different things: 🤖 the scraper
// raised this, ⏱ the system closed it.
//
// ★ It renders on RESOLVED rows only, because that is the only state in which
// the sentence is true. Nothing else in the app writes the column.

const REASON_LABEL: Record<string, string> = {
  permit_issued:
    'Closed automatically: the permit was issued, so this work no longer applies. Nobody ticked it — reopen it if it still matters.',
};

export default function AutoClosedBadge({
  taskId,
  reason,
}: {
  taskId: string;
  reason?: string | null;
}) {
  if (!reason) return null;
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5 flex-shrink-0"
      style={{
        background: 'var(--color-s2)',
        color: 'var(--color-muted)',
        border: '1px solid var(--color-border)',
      }}
      title={REASON_LABEL[reason] ?? 'Closed automatically by the system.'}
      data-testid={`auto-closed-badge-${taskId}`}
      data-reason={reason}
    >
      ⏱ SYSTEM
    </span>
  );
}
