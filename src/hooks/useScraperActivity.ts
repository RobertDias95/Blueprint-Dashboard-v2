import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
// Realtime: subscribes once to postgres_changes on audit_log INSERT,
// then invalidates the bare scraper_activity prefix key so all
// per-tenant variants refetch. Mounted by the NotificationBell so the
// channel teardown lines up with the bell's lifecycle — no global
// state added to useRealtimeInvalidation.

export const SCRAPER_ACTIVITY_DAYS_DEFAULT = 14;
export const SCRAPER_ACTIVITY_ROW_CAP = 300;

export function useScraperActivity(
  days: number = SCRAPER_ACTIVITY_DAYS_DEFAULT,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const queryClient = useQueryClient();
  // fix-28-bug: per-mount unique channel name. The bell (mounted in
  // Chrome) and ActivityPage both call this hook; with a hardcoded
  // channel name, the second mount tried to attach a postgres_changes
  // listener to an already-subscribed channel and Supabase Realtime
  // throws ("cannot add `postgres_changes` callbacks ... after
  // `subscribe()`"). Random suffix computed in useState's lazy
  // initializer is stable across re-renders of the same mount but
  // unique per instance — two mounts = two independent channels.
  // Both still invalidate the same TanStack queryKey on INSERT.
  const [channelName] = useState(
    () => `bp-v2-scraper-activity-${Math.random().toString(36).slice(2, 10)}`,
  );

  // Realtime: any new audit_log INSERT invalidates the cache. The
  // RLS filter on audit_log already restricts visible rows to the
  // caller's tenant, so we don't need to inspect payload.new.
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_log' },
        () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.scraperActivityAll,
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, queryClient, channelName]);

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
