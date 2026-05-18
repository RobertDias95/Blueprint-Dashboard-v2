import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useScraperActivity } from '../hooks/useScraperActivity';
import { countUnreadByIds } from '../lib/scraperActivity';
import {
  migrateLegacyLastSeen,
  useNotificationStore,
} from '../stores/notificationStore';

// fix-27: notification bell in the top nav.
// fix-28: behavior change — clicking the bell now navigates to
// /activity instead of opening an inline popover. Badge math moved
// from a single last-seen timestamp to a per-row read-id Set so the
// activity page's per-row checkboxes can decrement the badge live.
//
// The bell still owns the data-hook subscription (useScraperActivity
// + its Realtime channel). Mounting the bell in Chrome.tsx means
// every page in the app gets live audit-log invalidation for free.

export default function NotificationBell() {
  const { data: rows } = useScraperActivity();
  const all = useMemo(() => rows ?? [], [rows]);

  const readIds = useNotificationStore((s) => s.readIds);
  const unread = useMemo(() => countUnreadByIds(all, readIds), [all, readIds]);

  // One-time migration from the fix-27 timestamp model. Runs as soon
  // as the row list lands; the helper is idempotent past the first
  // run because it deletes the legacy key.
  useEffect(() => {
    if (all.length === 0) return;
    migrateLegacyLastSeen(all);
  }, [all]);

  return (
    <Link
      to="/activity"
      className="relative bg-transparent border border-border text-muted hover:text-text px-2 py-1 rounded-md transition inline-flex items-center"
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
    </Link>
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
