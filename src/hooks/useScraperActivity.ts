import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { ScraperActivityRow } from '../lib/database.types';

// fix-27: scraper activity feed for the notification center.
//
// Reads via bp_fetch_scraper_activity RPC (joined to permits + projects
// in SQL — saves a client-side JOIN walk). RLS on the underlying tables
// enforces tenant scoping; the RPC is SECURITY INVOKER so the caller's
// auth.uid() drives auth_tenant_ids(). Cap: 300 rows / 14d default.
//
// Realtime: ★ fix-336 — the app's ONE channel now carries audit_log
// (REALTIME_TABLES.audit_log → scraperActivityAll). This hook opens no channel
// of its own; see the note in the body for what that channel was and why it
// never fired.
//
// ★ fix-326: THIS HOOK IS LIVE AND STAYS. The comment here said it was "mounted
// by the NotificationBell", which was false — that component has not been
// rendered for several tickets and is now deleted. Its real consumers are
// BoardBell (the flip feed and its suppression counts) and ActivityPage.

export const SCRAPER_ACTIVITY_DAYS_DEFAULT = 14;
export const SCRAPER_ACTIVITY_ROW_CAP = 300;

export function useScraperActivity(
  days: number = SCRAPER_ACTIVITY_DAYS_DEFAULT,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  // ★★ fix-336: THE PRIVATE CHANNEL IS GONE, and its table finally works.
  //
  // This hook used to open its own postgres_changes channel on `audit_log`,
  // with a random per-mount name so two mounts would not collide. It had never
  // once fired: `audit_log` was not in the `supabase_realtime` publication, so
  // Postgres emitted nothing for it. The 5-minute `refetchInterval` below is
  // the only reason the flip feed ever moved.
  //
  // fix-336 publishes the table and folds the subscription into the app's ONE
  // channel (REALTIME_TABLES.audit_log → scraperActivityAll, the same key this
  // handler invalidated), which is the brief's rule: do not open one channel
  // per component that happens to need the same table. Two mounts of this hook
  // now cost zero channels instead of two.

  return useQuery<ScraperActivityRow[]>({
    queryKey: queryKeys.scraperActivity(tenantId ?? '', days),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_fetch_scraper_activity', {
        p_days: days,
      });
      if (error) throw error;
      return (data ?? []) as ScraperActivityRow[];
    },
    // Background refetch every 5 min in case a realtime event is missed
    // (e.g. tab was backgrounded when the morning scrape ran).
    refetchInterval: 5 * 60 * 1000,
    staleTime: 30 * 1000,
  });
}
