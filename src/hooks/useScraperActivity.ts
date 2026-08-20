import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { ScraperActivityRow } from '../lib/database.types';
import type { ActivitySummary } from '../lib/activityWindow';

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

/**
 * ★★★ fix-370 — 300 WAS A NINETEEN-HOUR WINDOW WEARING A FOURTEEN-DAY LABEL.
 *
 * MEASURED ON PROD 2026-08-20, before anything was written:
 *
 *     rows matching the RPC's own WHERE over 14 days      1,600
 *     rows it returned                                      300
 *     dropped                                       1,300 (81%)
 *     where the 300th row fell             2026-08-19 15:29 — YESTERDAY
 *
 * ★★★ THE ARITHMETIC BEHIND 1,500, because the brief is right that filtering
 * alone would just have moved the lie to a new number:
 *
 *     showable rows per 14 days, today                       675
 *     worst 14-day window in 60 days of history              799
 *     busiest single day                                     199
 *     THIS CAP                                             1,500
 *
 * So the budget is 1.88x the worst fortnight ever recorded, and daily volume
 * would have to roughly double and STAY doubled for two weeks before it bit.
 * The window is honoured, not merely enlarged — and when it does bite the UI
 * says so (lib/activityWindow.truncationNote), because a capped feed that looks
 * complete is exactly how this went unnoticed for four tickets.
 *
 * ★ Cost, measured: 675 showable rows is ~668 kB of JSON, ~1,014 bytes a row,
 * and the RPC runs in 36 ms. The old 300-row page was ~300 kB.
 */
export const SCRAPER_ACTIVITY_ROW_CAP = 1500;

/**
 * ★★ The SECOND budget, and the reason the first one now works.
 *
 * `scrape_workflow_fetch_recovered` (603/14d) and the two
 * `*_skipped_recent_manual_edit` guards (322/14d) are 58% of all volume, both
 * mean "working as intended", and neither may ever reach a person. They were
 * ranked by recency against real changes and won.
 *
 * ★★★ They are not excluded — fix-336's notification centre lists these rows
 * behind the suppressed count, and deleting them would delete a signal two
 * tickets deliberately built. They get their own budget instead, so they cannot
 * take a slot a status flip needed.
 *
 * ★ 300 is a SAMPLE and is labelled as one. The centre shows 50 per section
 * next to a TRUE count from `bp_scraper_activity_summary`; the rows exist to
 * make the number concrete, not to be an audit trail.
 */
export const SCRAPER_SUPPRESSED_ROW_CAP = 300;

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
        // ★ fix-370: two budgets, passed explicitly. The RPC defaults to these
        // same numbers; sending them keeps the constants above the single place
        // a reader has to look, rather than a comment that has to agree with a
        // DEFAULT in a migration.
        p_limit: SCRAPER_ACTIVITY_ROW_CAP,
        p_suppressed_limit: SCRAPER_SUPPRESSED_ROW_CAP,
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

/**
 * ★★★ fix-370 — THE TRUTH ABOUT THE WINDOW, and it costs one aggregate.
 *
 * The counts on the bell were computed over the fetched page, so they described
 * the page. This returns totals over the WHOLE window, uncapped, from a single
 * index-covered scan that returns no rows — which is what lets "Not shown"
 * state a fact and what lets a truncated list admit it.
 *
 * ★ The query key sits under the same `scraper_activity` prefix as the feed, so
 * fix-336's one realtime channel invalidates both on an `audit_log` change and
 * the number cannot lag the list it describes.
 */
export function useScraperActivitySummary(
  days: number = SCRAPER_ACTIVITY_DAYS_DEFAULT,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ActivitySummary | null>({
    queryKey: queryKeys.scraperActivitySummary(tenantId ?? '', days),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_scraper_activity_summary', {
        p_days: days,
      });
      if (error) throw error;
      const row = (data ?? [])[0] as ActivitySummary | undefined;
      return row ?? null;
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 30 * 1000,
  });
}
