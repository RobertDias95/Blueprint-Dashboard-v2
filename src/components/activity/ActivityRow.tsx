import type { ScraperActivityRow } from '../../lib/database.types';
import { formatRelativeTime } from '../../lib/scraperActivity';

// fix-28: one row inside a project group. Same one-line summary the
// bell used to render in fix-27, with a "mark read" checkbox on the
// right. Skipped rows render dimmed; unread rows get an accent border.

interface Props {
  row: ScraperActivityRow;
  summary: string[];
  isRead: boolean;
  onMarkRead: (id: number) => void;
  onMarkUnread: (id: number) => void;
}

export default function ActivityRow({
  row,
  summary,
  isRead,
  onMarkRead,
  onMarkUnread,
}: Props) {
  const unread = !isRead;
  const skipped =
    row.action === 'scrape_skipped_recent_manual_edit' ||
    row.action === 'scrape_cycle_skipped_recent_manual_edit' ||
    row.action === 'scrape_skipped';

  function onToggle() {
    if (isRead) onMarkUnread(row.id);
    else onMarkRead(row.id);
  }

  return (
    <div
      className={`flex items-start gap-3 px-4 py-2.5 border-b last:border-b-0 text-[11px] ${
        skipped ? 'opacity-60' : ''
      } ${unread ? 'bg-de/5' : ''}`}
      style={{
        borderColor: 'var(--color-border)',
        borderLeft: unread ? '3px solid var(--color-de)' : '3px solid transparent',
      }}
      data-testid={`activity-row-${row.id}`}
      data-unread={unread ? 'true' : undefined}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
          {row.permit_num && (
            <span className="font-mono text-[10px] text-text font-bold">
              {row.permit_num}
            </span>
          )}
          {row.permit_type && (
            <span className="text-[9px] uppercase tracking-wide text-dim">
              {row.permit_type}
            </span>
          )}
          {row.ent_lead && (
            <span className="text-[9px] uppercase tracking-wide text-muted">
              Lead: {row.ent_lead}
            </span>
          )}
          <span className="ml-auto text-[9px] text-dim">
            {formatRelativeTime(row.created_at)}
          </span>
        </div>
        <ul className="space-y-0.5">
          {summary.map((p, i) => (
            <li key={i} className="text-[11px] text-text leading-snug">
              {p}
            </li>
          ))}
        </ul>
      </div>
      <label
        className="flex items-center self-stretch pl-1 cursor-pointer"
        title={isRead ? 'Mark unread' : 'Mark read'}
      >
        <input
          type="checkbox"
          checked={isRead}
          onChange={onToggle}
          className="cursor-pointer"
          data-testid={`activity-row-check-${row.id}`}
          aria-label={isRead ? 'Mark unread' : 'Mark read'}
        />
      </label>
    </div>
  );
}
