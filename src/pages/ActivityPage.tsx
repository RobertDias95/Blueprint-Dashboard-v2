import { useEffect, useMemo, useState } from 'react';
import { useScraperActivity } from '../hooks/useScraperActivity';
import {
  categorizeAction,
  countUnreadByIds,
  groupActivityByProject,
  matchesEntFilter,
  matchesSearch,
  summarizeActivity,
  UNKNOWN_ADDRESS_LABEL,
  type ActivityCategory,
} from '../lib/scraperActivity';
import {
  migrateLegacyLastSeen,
  useNotificationStore,
} from '../stores/notificationStore';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ActivityToolbar from '../components/activity/ActivityToolbar';
import ActivityProjectGroup from '../components/activity/ActivityProjectGroup';

// fix-28: full activity page. The bell now navigates here; this page
// owns the search, ent filter, category chips, and per-row read state.
//
// State lives in three places:
//   - search / category / ent filter / collapsed groups → local state
//     (no URL persistence yet — keep it scrollable + scoped to one
//     session). Ent selection IS persisted to localStorage so each
//     teammate's filter sticks across reloads.
//   - readIds → useNotificationStore (also drives the bell badge).
//   - rows → useScraperActivity (TanStack Query + Realtime).

const ENT_FILTER_STORAGE_KEY = 'bp_activity_ent_filter';
const SEARCH_DEBOUNCE_MS = 150;

// Authoritative ent set surfaced as filter options. Sourced from the
// rows themselves below; this constant is the fallback when the
// initial render has no rows yet.
const DEFAULT_ENT_OPTIONS = ['Bobby', 'Briana', 'Miles'];

function loadEntFilter(): Set<string> | null {
  try {
    const raw = localStorage.getItem(ENT_FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === 'string'));
    }
  } catch {
    // ignore
  }
  return null;
}

function saveEntFilter(set: Set<string>) {
  try {
    localStorage.setItem(
      ENT_FILTER_STORAGE_KEY,
      JSON.stringify(Array.from(set)),
    );
  } catch {
    // ignore — localStorage may be unavailable
  }
}

export default function ActivityPage() {
  const { data: rows, isLoading, error, refetch } = useScraperActivity();
  const all = useMemo(() => rows ?? [], [rows]);

  // One-time migration from fix-27's last-seen timestamp.
  useEffect(() => {
    if (all.length === 0) return;
    migrateLegacyLastSeen(all);
  }, [all]);

  const readIds = useNotificationStore((s) => s.readIds);
  const markRead = useNotificationStore((s) => s.markRead);
  const markUnread = useNotificationStore((s) => s.markUnread);
  const markManyRead = useNotificationStore((s) => s.markManyRead);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const [category, setCategory] = useState<ActivityCategory | 'all'>('all');

  // Ent options surface from the rows + fallback to defaults. Stored
  // selection is persisted; defaults to "all".
  const entOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_ENT_OPTIONS);
    for (const r of all) {
      if (r.ent_lead && r.ent_lead.trim() !== '') set.add(r.ent_lead);
    }
    return Array.from(set).sort();
  }, [all]);

  const [selectedEnts, setSelectedEnts] = useState<Set<string>>(() => {
    const loaded = loadEntFilter();
    if (loaded) return loaded;
    return new Set(DEFAULT_ENT_OPTIONS);
  });
  useEffect(() => {
    saveEntFilter(selectedEnts);
  }, [selectedEnts]);

  // Pre-compute summaries once per row — feeds both search matching
  // and rendering. Stable reference per row id keeps deeper memos
  // honest in React.
  const summariesById = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const r of all) m.set(r.id, summarizeActivity(r));
    return m;
  }, [all]);

  const filtered = useMemo(() => {
    return all.filter((row) => {
      if (category !== 'all' && categorizeAction(row.action) !== category) {
        return false;
      }
      if (!matchesEntFilter(row, selectedEnts, entOptions)) return false;
      const summary = summariesById.get(row.id) ?? [];
      if (!matchesSearch(row, debouncedSearch, summary)) return false;
      return true;
    });
  }, [all, category, debouncedSearch, selectedEnts, entOptions, summariesById]);

  const groups = useMemo(() => groupActivityByProject(filtered), [filtered]);

  // Header counters — based on FILTERED rows so the "Mark all read"
  // button only affects what the user can currently see.
  const visibleUnread = useMemo(
    () => countUnreadByIds(filtered, readIds),
    [filtered, readIds],
  );
  const totalUnread = useMemo(
    () => countUnreadByIds(all, readIds),
    [all, readIds],
  );

  // Collapsed state per group (address). Default: expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggleCollapsed(address: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  }

  function clearAllFilters() {
    setSearch('');
    setCategory('all');
    setSelectedEnts(new Set(entOptions));
  }

  function markAllVisibleRead() {
    if (filtered.length === 0) return;
    markManyRead(filtered.map((r) => r.id));
  }

  if (error) {
    return (
      <QueryError
        title="Activity failed to load"
        error={error}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="activity-page">
      {/* Header */}
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-extrabold text-text">Activity</h1>
          <span className="text-[11px] text-muted">
            {totalUnread} unread · {all.length} event
            {all.length === 1 ? '' : 's'} in the last 14 days
          </span>
        </div>
        <button
          onClick={markAllVisibleRead}
          disabled={visibleUnread === 0}
          className="text-[11px] font-display font-bold px-3 py-1.5 rounded border border-de text-de bg-de/5 hover:bg-de/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="activity-mark-all-read"
        >
          Mark all read
          {visibleUnread > 0 && (
            <span className="ml-1 opacity-70">({visibleUnread})</span>
          )}
        </button>
      </div>

      {/* Toolbar — sticky on scroll */}
      <div className="sticky top-[52px] z-10 -mx-6 px-6 py-2 bg-bg border-b border-border">
        <ActivityToolbar
          search={search}
          onSearchChange={setSearch}
          category={category}
          onCategoryChange={setCategory}
          entOptions={entOptions}
          selectedEnts={selectedEnts}
          onSelectedEntsChange={setSelectedEnts}
          onClearFilters={clearAllFilters}
          totalCount={all.length}
          visibleCount={filtered.length}
        />
      </div>

      {/* Body */}
      {isLoading && all.length === 0 ? (
        <SkeletonRows count={5} rowClassName="h-20" />
      ) : filtered.length === 0 ? (
        <EmptyState
          totalCount={all.length}
          onClearFilters={clearAllFilters}
        />
      ) : (
        <div className="space-y-3" data-testid="activity-groups">
          {Array.from(groups.entries()).map(([address, groupRows]) => (
            <ActivityProjectGroup
              key={address}
              address={address}
              isUnknown={address === UNKNOWN_ADDRESS_LABEL}
              rows={groupRows}
              summariesById={summariesById}
              readIds={readIds}
              collapsed={collapsed.has(address)}
              onToggleCollapsed={() => toggleCollapsed(address)}
              onMarkRead={markRead}
              onMarkUnread={markUnread}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  totalCount,
  onClearFilters,
}: {
  totalCount: number;
  onClearFilters: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-surface px-4 py-12 text-center"
      data-testid="activity-empty"
    >
      <div className="text-sm font-display font-bold text-text mb-1">
        No activity matches
      </div>
      <div className="text-xs text-muted mb-3">
        {totalCount === 0
          ? "There's no scraper activity in the last 14 days yet."
          : `${totalCount} event${totalCount === 1 ? '' : 's'} hidden by your filters.`}
      </div>
      {totalCount > 0 && (
        <button
          onClick={onClearFilters}
          className="text-[11px] font-display font-bold px-3 py-1.5 rounded border border-de text-de bg-de/5 hover:bg-de/10 transition"
          data-testid="activity-clear-filters"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
