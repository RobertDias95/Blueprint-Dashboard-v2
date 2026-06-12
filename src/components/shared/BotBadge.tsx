import type { AutoEvent } from '../../lib/database.types';

// fix-155: the BOT badge for lifecycle auto-tasks. Renders wherever auto-tasks
// surface (My Tasks cards, Permit Detail task rows). Auto-tasks are the team's
// double-check of what the scraper read — they are NEVER auto-completed, so the
// badge's job is purely to mark provenance + nudge a human to verify and close.

const EVENT_LABEL: Record<AutoEvent, string> = {
  intake_submitted:
    'Auto-task: verify the city accepted the intake submission / fees paid.',
  intake_accepted:
    'Auto-task: verify intake was accepted and reviews are starting.',
  corr_issued: 'Auto-task: corrections issued — send to consultants.',
  resubmitted: 'Auto-task: verify the city accepted the resubmission.',
  number_entry:
    'Auto-task: enter the permit number once the permit has been submitted.',
  scrape_reconcile:
    'Auto-task: the portal and dashboard disagree — reconcile the status (the manual-edit guard kept blocking the scraper).',
};

export default function BotBadge({
  taskId,
  event,
}: {
  taskId: string;
  /** Drives the tooltip; falls back to a generic message when absent. */
  event?: AutoEvent | null;
}) {
  const title =
    (event && EVENT_LABEL[event]) ||
    'Auto-generated lifecycle task — verify it and close it manually.';
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5 flex-shrink-0"
      style={{
        background: 'var(--color-de-bg)',
        color: 'var(--color-de)',
        border: '1px solid var(--color-de)',
      }}
      title={title}
      data-testid={`bot-badge-${taskId}`}
    >
      🤖 BOT
    </span>
  );
}
