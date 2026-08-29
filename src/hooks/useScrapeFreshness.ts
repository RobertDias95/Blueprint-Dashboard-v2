import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import {
  SCRAPE_ACTION_PREFIX,
  evaluateScrapeFreshness,
  pacificParts,
  type ScrapeFreshness,
} from '../lib/scrapeFreshness';

// ===========================================================================
// ★★ fix-433 — one indexed row, and a clock that keeps moving
// ===========================================================================
//
// ★★★ ONE ROW, NOT A FEED. `audit_log` holds 14,395 rows and this asks it a
// single question: when did a scrape last write anything? Measured on prod,
// the plan is `Index Scan using audit_log_created_at_idx … Limit 1`, 0.097 ms.
// It must never go through `fetchAllRows` — paging 14k rows to look at the
// first one is the shape this codebase pages for LISTS, and this is not one.
//
// ★★ THE `scrape%` FILTER IS A FILTER, NOT AN INDEX LOOKUP, AND THAT IS FINE.
// 99% of recent audit_log rows are `scrape*`, so the backwards index walk
// stops on its first or second row. There is no index on `action` and this
// ticket does not add one.
//
// ★ RLS does the tenant scoping (`audit_log_tenant_select`:
//   `tenant_id = ANY (auth_tenant_ids())`), so there is no tenant filter in the
//   query — the same posture as every other read here. No view, no RPC, and so
//   nothing that could inherit the `anon` grant posture on this table (P-015,
//   deliberately left alone by this ticket).

/** ISO timestamp of the newest scrape-written `audit_log` row, or null when
 *  the table holds none at all. */
export function useLastScrapeAt() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<string | null>({
    queryKey: queryKeys.lastScrapeAt(tenantId ?? ''),
    enabled: !!tenantId,
    // ★ It does not need to be live to the second — the question is "some time
    //   today", answered once a day. The 5-minute refetch matches
    //   useScraperActivity's, and fix-336's realtime channel already
    //   invalidates the whole `scraper_activity` prefix on any audit_log
    //   change, so a run landing clears the banner without waiting for it.
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('created_at')
        .like('action', `${SCRAPE_ACTION_PREFIX}%`)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as { created_at?: string } | undefined;
      return row?.created_at ?? null;
    },
  });
}

/**
 * ★★★ A CLOCK THAT ADVANCES, because the rule has an hour in it.
 *
 * Somebody who opened the Bridge at 11:40 and left it there must see the
 * banner appear at noon without touching anything. Nothing else in the app
 * re-renders on the passage of time, so the tick lives here — and it lives in
 * the LEAF that consumes it, never in `Chrome`, because a minute tick mounted
 * in the shell would re-render every page in the app once a minute.
 *
 * ★ `focus` AND `visibilitychange` as well as the interval, for fix-424's
 *   reason: a backgrounded installed app's timers are frozen, and a window on
 *   a second monitor never fires `visibilitychange` at all.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const bump = () => setNow(new Date());
    const id = window.setInterval(bump, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', bump);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', bump);
    };
  }, []);
  return now;
}

/**
 * ★★★ THE VERDICT, DERIVED ON EVERY RENDER. No stored state, no alert row,
 * nothing to resolve — see lib/scrapeFreshness for why that is the point.
 *
 * ★ While the query is still loading, `lastScrapeAt` is `undefined` and the
 *   rule would read it as "nothing recorded, ever" and alarm. It must not:
 *   a `null` from the query only ever means a SETTLED "no row exists", so the
 *   unsettled case gets its own reason (`loading`) rather than borrowing one.
 *   Silence during load is the safe direction — fix-395's rule, when unsure,
 *   do not fire.
 */
export function useScrapeFreshness(): ScrapeFreshness {
  const now = useMinuteClock();
  const q = useLastScrapeAt();
  if (!q.isSuccess) {
    return {
      missed: false,
      reason: 'loading',
      lastRun: null,
      todayKey: pacificParts(now).dayKey,
      now,
    };
  }
  return evaluateScrapeFreshness({ lastScrapeAt: q.data, now });
}
