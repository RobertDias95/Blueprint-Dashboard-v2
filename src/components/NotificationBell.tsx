import { useEffect, useMemo, useRef, useState } from 'react';
import { useScraperActivity } from '../hooks/useScraperActivity';
import {
  categorizeAction,
  countUnread,
  formatRelativeTime,
  groupActivityByRun,
  summarizeActivity,
  type ActivityCategory,
} from '../lib/scraperActivity';
import type { ScraperActivityRow } from '../lib/database.types';

// fix-27: notification center. Bell icon in top nav opens a popover
// listing recent scraper + manual-correction activity. Unread state
// is persisted in localStorage (bp_notif_last_seen_at). The query
// invalidation is wired in useScraperActivity — clicking the bell
// just toggles the panel, not refetches.

const LAST_SEEN_KEY = 'bp_notif_last_seen_at';
const FILTER_LABELS: Record<ActivityCategory | 'all', string> = {
  all: 'All',
  change: 'Changes',
  cycle: 'Cycles',
  skipped: 'Skipped',
  other: 'Other',
};
const FILTERS: Array<ActivityCategory | 'all'> = [
  'all',
  'change',
  'cycle',
  'skipped',
];

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

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<ActivityCategory | 'all'>('all');
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_SEEN_KEY);
    } catch {
      return null;
    }
  });
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const { data: rows, isLoading, error, refetch } = useScraperActivity();
  const all = useMemo(() => rows ?? [], [rows]);
  const unread = useMemo(() => countUnread(all, lastSeenAt), [all, lastSeenAt]);

  const filtered = useMemo(() => {
    if (filter === 'all') return all;
    return all.filter((r) => categorizeAction(r.action) === filter);
  }, [all, filter]);
  const groups = useMemo(() => groupActivityByRun(filtered), [filtered]);

  // Close panel on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function markAllRead() {
    const now = new Date().toISOString();
    try {
      localStorage.setItem(LAST_SEEN_KEY, now);
    } catch {
      // localStorage may be unavailable in private mode — state-only
      // update still clears the badge for the current session.
    }
    setLastSeenAt(now);
  }

  return (
    <div className="relative" data-testid="notification-bell-wrap">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative bg-transparent border border-border text-muted hover:text-text px-2 py-1 rounded-md transition"
        title="Recent activity"
        data-testid="notification-bell-button"
      >
        <BellIcon />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 text-[9px] font-extrabold text-white rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center"
            style={{ background: 'var(--color-co, #d97706)' }}
            data-testid="notification-bell-badge"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-2 w-[440px] max-w-[92vw] rounded-lg border bg-surface shadow-2xl z-50 flex flex-col"
          style={{
            borderColor: 'var(--color-border)',
            maxHeight: 'min(640px, 80vh)',
          }}
          data-testid="notification-panel"
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="text-[12px] font-extrabold text-text uppercase tracking-wider">
              Activity
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => refetch()}
                className="text-[10px] text-muted hover:text-text"
                title="Refresh"
              >
                ↻
              </button>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] text-de hover:underline font-display font-bold"
                  data-testid="notification-mark-read"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Filter chips */}
          <div
            className="flex items-center gap-1 px-3 py-1.5 border-b overflow-x-auto"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {FILTERS.map((f) => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition whitespace-nowrap ${
                    active
                      ? 'bg-de text-white border-de'
                      : 'bg-transparent text-muted border-border hover:text-text'
                  }`}
                  data-testid={`notification-filter-${f}`}
                >
                  {FILTER_LABELS[f]}
                </button>
              );
            })}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {error ? (
              <div className="px-3 py-4 text-xs text-co" data-testid="notification-error">
                Failed to load activity — {error.message}
              </div>
            ) : isLoading && all.length === 0 ? (
              <div className="px-3 py-4 text-xs text-dim italic">Loading…</div>
            ) : filtered.length === 0 ? (
              <div
                className="px-3 py-8 text-xs text-dim italic text-center"
                data-testid="notification-empty"
              >
                No recent activity
                {filter !== 'all' && (
                  <>
                    {' '}
                    <button
                      onClick={() => setFilter('all')}
                      className="underline ml-1"
                    >
                      Show all
                    </button>
                  </>
                )}
              </div>
            ) : (
              groups.map((g, gi) => (
                <ActivityGroupBlock
                  key={`${g.anchor}-${gi}`}
                  anchor={g.anchor}
                  rows={g.rows}
                  lastSeenAt={lastSeenAt}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityGroupBlock({
  anchor,
  rows,
  lastSeenAt,
}: {
  anchor: string;
  rows: ScraperActivityRow[];
  lastSeenAt: string | null;
}) {
  return (
    <div>
      <div
        className="px-3 py-1 text-[9px] uppercase tracking-wider text-dim font-display font-bold border-b sticky top-0 bg-surface"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {formatRelativeTime(anchor)} · {rows.length} event
        {rows.length === 1 ? '' : 's'}
      </div>
      {rows.map((r) => (
        <ActivityRowItem key={r.id} row={r} lastSeenAt={lastSeenAt} />
      ))}
    </div>
  );
}

function ActivityRowItem({
  row,
  lastSeenAt,
}: {
  row: ScraperActivityRow;
  lastSeenAt: string | null;
}) {
  const unread =
    !lastSeenAt ||
    new Date(row.created_at).getTime() > new Date(lastSeenAt).getTime();
  const skipped =
    row.action === 'scrape_skipped_recent_manual_edit' ||
    row.action === 'scrape_cycle_skipped_recent_manual_edit' ||
    row.action === 'scrape_skipped';

  const phrases = summarizeActivity(row);
  const jurisTint = row.juris ? JURIS_TINT[row.juris] : undefined;

  return (
    <div
      className={`px-3 py-2 border-b text-[11px] ${
        skipped ? 'opacity-60' : ''
      } ${unread ? 'bg-de/5' : ''}`}
      style={{
        borderColor: 'var(--color-border)',
        borderLeft: unread ? '3px solid var(--color-de)' : '3px solid transparent',
      }}
      data-testid={`notification-row-${row.id}`}
    >
      <div className="flex items-baseline gap-2 mb-0.5">
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
        {row.juris && (
          <span
            className="text-[9px] font-bold px-1.5 py-px rounded"
            style={{
              background: jurisTint ? `${jurisTint}22` : 'var(--color-s2)',
              color: jurisTint ?? 'var(--color-muted)',
            }}
          >
            {row.juris}
          </span>
        )}
        <span className="ml-auto text-[9px] text-dim">
          {formatRelativeTime(row.created_at)}
        </span>
      </div>
      {row.address && (
        <div className="text-[10px] text-muted truncate">{row.address}</div>
      )}
      <ul className="mt-0.5 space-y-0.5">
        {phrases.map((p, i) => (
          <li key={i} className="text-[11px] text-text leading-snug">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
