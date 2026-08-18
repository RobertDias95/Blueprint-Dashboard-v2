import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { REALTIME_TABLES } from '../lib/queryKeys';
import { useRealtimeStore } from '../stores/realtimeStore';

// Q2: Single Realtime channel that listens to changes on the tables the app
// reads and invalidates the matching TanStack Query keys. Architectural
// primitive #3: realtime is the canonical sync. Realtime → invalidate →
// refetch.
//
// Mounted once at the app root (App.tsx). Tearing down the channel on unmount
// is important because Supabase's per-connection limit is real.
//
// ===========================================================================
// ★★★ fix-336 — WHY THIS WAS NOT ACTUALLY LIVE
// ===========================================================================
//
// Bobby: "Is the notification center giving live updates versus on refresh? If
// that has not been fixed, that is the next thing up because that is vital."
//
// ★★ THE SUBSCRIPTIONS WERE REAL AND THE PUBLICATION WAS NOT. This hook has
// asked for postgres_changes on 14 tables since Q2 — but SIX of them were not
// in the `supabase_realtime` publication, so Postgres never emitted their
// changes and those handlers had never fired once. Nothing errors in that
// case: an unpublished table is simply silent. The worst of the six was
// `audit_log`, which carries every scraper status flip — the single largest
// source of board items — so the bell's biggest feed refreshed only on the
// 5-minute poll inside useScraperActivity.
//
// migrations/fix_336_realtime_publication.sql publishes the three that feed the
// notification model (audit_log, permit_milestone_acks, board_item_reads).
//
// ★ THE OTHER THREE ARE STILL SILENT, deliberately and on the record:
// permit_cycle_reviewers, error_reports, project_holds, vendor_report_state and
// external_team_directory are subscribed here but unpublished. This ticket's
// rule is the minimum set that feeds notifications, not all 27 tables; each of
// those has its own refetch path and none of them reaches the bell. They are
// named in the PR rather than quietly fixed, because publishing a table is a
// decision about what streams to every client and it should be made per table.
//
// ★★ AND THE SOCKET NOW REPORTS ITSELF. `subscribe()` was called with no
// callback, so CHANNEL_ERROR / TIMED_OUT / CLOSED went nowhere and a dead wire
// was indistinguishable from a quiet afternoon. Three things follow:
//
//   1. STATUS IS STATE (stores/realtimeStore), and the bell and the
//      notification centre both show it.
//   2. WHILE DEGRADED, A 60-SECOND POLL invalidates the same keys the socket
//      would have. Slower than live, honest about it, and it stops the moment
//      the channel attaches.
//   3. EVERY (RE)SUBSCRIBE INVALIDATES ONCE. Anything that changed while the
//      socket was down was missed, so re-attaching without a catch-up would
//      leave a stale cache looking freshly live.
//
// ★ INVALIDATE, NEVER MERGE. The payload is a trigger, not data: the existing
// queries are the single read model (fix-307's rule), and building state from
// socket payloads would be a second read model that drifts. Nothing here reads
// `payload.new`.

/** How often the fallback poll runs while the socket is not attached. */
export const REALTIME_FALLBACK_MS = 60_000;

/** Every bare-prefix key any realtime table maps to, deduped. The fallback
 *  poll and the catch-up on (re)subscribe both invalidate exactly this set —
 *  the same keys the socket would have, so the two paths cannot diverge. */
export function allRealtimeKeys(): readonly (readonly string[])[] {
  const seen = new Map<string, readonly string[]>();
  for (const keys of Object.values(REALTIME_TABLES)) {
    for (const key of keys) seen.set(JSON.stringify(key), key);
  }
  return [...seen.values()];
}

/** Invalidate everything realtime is responsible for. Used by the fallback
 *  poll, the catch-up on (re)subscribe, and the degraded-mode focus refresh. */
export function invalidateAllRealtimeKeys(queryClient: QueryClient): void {
  for (const key of allRealtimeKeys()) {
    queryClient.invalidateQueries({ queryKey: key });
  }
}

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const setStatus = useRealtimeStore((s) => s.setStatus);
  const noteEvent = useRealtimeStore((s) => s.noteEvent);

  useEffect(() => {
    let channel = supabase.channel('bp-v2-realtime');

    (Object.keys(REALTIME_TABLES) as (keyof typeof REALTIME_TABLES)[]).forEach(
      (table) => {
        const keys = REALTIME_TABLES[table];
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          () => {
            // ★ fix-336: recorded even when the invalidation is skipped below —
            // "the socket is delivering" and "we acted on it" are different
            // facts, and the one the status line needs is the first.
            noteEvent(Date.now());
            // fix-39 Track B: don't invalidate (→ refetch) while a mutation is
            // in flight. A realtime event landing mid-mutation would refetch
            // the pre-commit row and clobber the optimistic edit — the silent
            // "approval_date goes blank" race. The mutation's own onSuccess
            // merges the authoritative row; the next realtime event (after the
            // mutation settles) re-syncs everything else.
            if (queryClient.isMutating() > 0) return;
            keys.forEach((key) => {
              queryClient.invalidateQueries({ queryKey: key });
            });
          },
        );
      },
    );

    // ★★ fix-336: the status callback. `err` is only populated on
    // CHANNEL_ERROR; the status alone is what the UI needs.
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setStatus('SUBSCRIBED');
        // ★ THE CATCH-UP. Whatever changed while we were not attached was
        // missed, and a socket that reconnects into a stale cache is the same
        // lie as one that never connected.
        invalidateAllRealtimeKeys(queryClient);
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setStatus(status);
      }
    });

    return () => {
      setStatus('CLOSED');
      void supabase.removeChannel(channel);
    };
  }, [queryClient, setStatus, noteEvent]);

  // ★★ THE FALLBACK, and it only runs when it is needed. A poll that runs
  // alongside a working socket is just load; a socket with no poll behind it is
  // a feature that fails silently. This is the second, so it is conditioned on
  // the first having failed.
  const degraded = useRealtimeStore((s) => s.status !== 'SUBSCRIBED');
  useEffect(() => {
    if (!degraded) return;
    const id = window.setInterval(() => {
      if (queryClient.isMutating() > 0) return;
      invalidateAllRealtimeKeys(queryClient);
    }, REALTIME_FALLBACK_MS);
    // ★ And a refresh when the tab comes back, because a minute is a long time
    // to look at a stale screen you just switched to. Scoped to the degraded
    // case on purpose: the app sets refetchOnWindowFocus:false globally
    // (App.tsx) and this ticket is not the place to reverse that for every
    // query in the app.
    const onFocus = () => {
      if (queryClient.isMutating() > 0) return;
      invalidateAllRealtimeKeys(queryClient);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [degraded, queryClient]);
}
