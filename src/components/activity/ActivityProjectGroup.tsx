import { useMemo } from 'react';
import type { ScraperActivityRow } from '../../lib/database.types';
import { countUnreadByIds, formatRelativeTime } from '../../lib/scraperActivity';
import ActivityRow from './ActivityRow';

// fix-28: one card per project (address). Header shows address +
// jurisdiction + unread count for this group + collapse caret. Body
// is the row list, sorted desc by created_at (input is already sorted
// at the page level so we don't re-sort).

const JURIS_TINT: Record<string, string> = {
  Seattle: '#2563eb',
  Bellevue: '#059669',
  Kirkland: '#d97706',
  Redmond: '#be185d',
  Edmonds: '#0891b2',
  Bothell: '#dc2626',
  Phoenix: '#ea580c',
  Scottsdale: '#7c3aed',
};

interface Props {
  address: string;
  isUnknown: boolean;
  rows: ScraperActivityRow[];
  summariesById: Map<number, string[]>;
  readIds: Set<number>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onMarkRead: (id: number) => void;
  onMarkUnread: (id: number) => void;
}

export default function ActivityProjectGroup({
  address,
  isUnknown,
  rows,
  summariesById,
  readIds,
  collapsed,
  onToggleCollapsed,
  onMarkRead,
  onMarkUnread,
}: Props) {
  const unread = useMemo(() => countUnreadByIds(rows, readIds), [rows, readIds]);
  // Most-recent activity timestamp drives the "X ago" subtitle.
  const latest = rows[0]?.created_at;
  // Pull the first non-null juris seen in the group for the header tag.
  const juris = useMemo(() => {
    for (const r of rows) if (r.juris) return r.juris;
    return null;
  }, [rows]);
  const jurisTint = juris ? JURIS_TINT[juris] : undefined;

  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-testid={`activity-group-${address}`}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg transition"
        data-testid={`activity-group-toggle-${address}`}
      >
        <span
          className="text-[10px] text-dim w-3 inline-block"
          aria-hidden="true"
        >
          {collapsed ? '▸' : '▾'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className={`text-[13px] font-display font-bold ${
                isUnknown ? 'italic text-dim' : 'text-text'
              } truncate`}
            >
              {address}
            </span>
            {juris && (
              <span
                className="text-[9px] font-bold px-1.5 py-px rounded"
                style={{
                  background: jurisTint ? `${jurisTint}22` : 'var(--color-s2)',
                  color: jurisTint ?? 'var(--color-muted)',
                }}
              >
                {juris}
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted mt-0.5">
            {rows.length} event{rows.length === 1 ? '' : 's'}
            {unread > 0 && (
              <>
                {' · '}
                <span className="font-bold" style={{ color: 'var(--color-co)' }}>
                  {unread} unread
                </span>
              </>
            )}
            {latest && (
              <>
                {' · last '}
                {formatRelativeTime(latest)}
              </>
            )}
          </div>
        </div>
        {unread > 0 && (
          <span
            className="text-[10px] font-extrabold text-white rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center"
            style={{ background: 'var(--color-co, #d97706)' }}
            data-testid={`activity-group-badge-${address}`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="border-t border-border">
          {rows.map((row) => (
            <ActivityRow
              key={row.id}
              row={row}
              summary={summariesById.get(row.id) ?? []}
              isRead={readIds.has(row.id)}
              onMarkRead={onMarkRead}
              onMarkUnread={onMarkUnread}
            />
          ))}
        </div>
      )}
    </div>
  );
}
