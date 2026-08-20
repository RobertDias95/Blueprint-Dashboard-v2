import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { REALTIME_TABLES } from '../lib/queryKeys';
import { useRealtimeStore } from '../stores/realtimeStore';
import {
  livenessAction,
  shouldCatchUpOnVisible,
} from '../lib/realtimeLiveness';

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

/** How often the watchdog looks. Not how long it waits before acting - see
 *  REALTIME_STALE_MS for that. Frequent enough that the check lands promptly
 *  after a window is restored, cheap enough to be free. */
export const REALTIME_WATCHDOG_TICK_MS = 20_000;

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const setStatus = useRealtimeStore((s) => s.setStatus);
  const noteEvent = useRealtimeStore((s) => s.noteEvent);

  // *** fix-371: THE CLOCK LIVENESS IS ACTUALLY MEASURED ON.
  //
  // Stamped by an arriving payload and by every catch-up we perform, so it
  // answers "when did this app last know it was current" - which is the
  // question, and is not the same as "what does the socket say about itself".
  // A ref, not state: it is written from timers and listeners and must not
  // re-render anything.
  //
  // Initialised to 0 and stamped on mount INSIDE the effect: Date.now() in a
  // render is an impure call, which the React Compiler rejects outright - the
  // same class of rule that cost fix-350 two attempts.
  const lastSyncAt = useRef(0);

  // Bumped to rebuild the channel. The main effect depends on it, so a change
  // tears the old channel down through its own cleanup and builds a new one -
  // no imperative re-subscribe path that could drift from the mount path.
  const [generation, setGeneration] = useState(0);

  const catchUp = useCallback(() => {
    if (queryClient.isMutating() > 0) return;
    invalidateAllRealtimeKeys(queryClient);
    lastSyncAt.current = Date.now();
  }, [queryClient]);

  useEffect(() => {
    // Mount is a legitimate "last known current": every query behind these keys
    // fetches on mount, so the app is as current as it can be at this instant.
    lastSyncAt.current = Date.now();
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
            // fix-371: the same stamp the watchdog reads. An arrival is the
            // only direct evidence the wire is alive.
            lastSyncAt.current = Date.now();
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
        lastSyncAt.current = Date.now();
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
    // `generation` is the rebuild trigger; see the watchdog below.
  }, [queryClient, setStatus, noteEvent, generation]);

  // -------------------------------------------------------------------------
  // *** fix-371 section 1 - THE WATCHDOG, AND IT DOES NOT ASK THE SOCKET
  // -------------------------------------------------------------------------
  //
  // *** THE BRIEF'S PREMISE WAS WRONG AND IT IS WORTH SAYING WHERE.
  // It proposed that a silently-dying socket leaves `status` at SUBSCRIBED so
  // nothing recovers. Read in @supabase/realtime-js 2.105.4: phoenix
  // socket.js:547 `onConnClose` -> :550 `triggerChanError` -> :579
  // `channel.trigger(CHANNEL_EVENTS.error)` -> RealtimeChannel.js:137 ->
  // `callback('CHANNEL_ERROR')`. The socket DOES report itself and `degraded`
  // DOES flip. See lib/realtimeLiveness for the full trace.
  //
  // *** WHAT ACTUALLY EXPLAINS THE SYMPTOM is that every recovery path this
  // app has is inert exactly when it is needed, and all four are measurable in
  // this repo rather than inferred:
  //
  //   - the fallback below is a setInterval, and Chrome freezes timers in a
  //     backgrounded installed app;
  //   - `refetchOnWindowFocus: false` globally (App.tsx:116);
  //   - `refetchIntervalInBackground` appears NOWHERE, so every refetchInterval
  //     in the app - the bell's five-minute one included - is paused while the
  //     window is unfocused;
  //   - `visibilitychange` appeared NOWHERE before this ticket, and the one
  //     focus listener lived inside the degraded branch.
  //
  // So the app comes back from the background and refetches nothing, whatever
  // the socket says. Refreshing is the only thing that ever worked.
  //
  // ** THE FIX IS MEASURED ON ARRIVALS. If nothing has arrived and nothing has
  // been refetched for REALTIME_STALE_MS while the window is visible, the wire
  // is rebuilt - SUBSCRIBED or not. A healthy socket pays one extra
  // invalidation per quiet stretch; a quietly dead one is repaired.
  useEffect(() => {
    const tick = () => {
      const action = livenessAction({
        now: Date.now(),
        lastSyncAt: lastSyncAt.current,
        status: useRealtimeStore.getState().status,
        visible:
          typeof document === 'undefined' || document.visibilityState === 'visible',
      });
      if (action === 'none') return;
      // Stamp BEFORE acting, so a rebuild that takes a moment to attach cannot
      // trigger a second one on the next tick.
      lastSyncAt.current = Date.now();
      catchUp();
      if (action === 'resubscribe') setGeneration((g) => g + 1);
    };
    const id = window.setInterval(tick, REALTIME_WATCHDOG_TICK_MS);

    // ** AND THE RETURN TO THE WINDOW, UNCONDITIONALLY.
    //
    // `visibilitychange` rather than `focus`: an installed app restored from
    // the background fires the first reliably and the second not at all on some
    // platforms. Not gated on `degraded`, which is the actual change - the
    // degraded case was the one already handled. A socket that reconnected
    // while the app was hidden is SUBSCRIBED, genuinely live, and holding a
    // cache from before the gap, because postgres_changes are never replayed.
    //
    // Scoped to the realtime key set, never a global refetchOnWindowFocus.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (shouldCatchUpOnVisible(Date.now(), lastSyncAt.current)) catchUp();
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [catchUp]);

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
    // fix-371: the focus listener that used to live here is gone, replaced by
    // an UNCONDITIONAL visibilitychange catch-up above. It was gated on
    // `degraded`, which is the case that was already covered; the one that was
    // not is a socket that looks perfectly healthy over a cache from before the
    // gap. Keeping both would mean two listeners racing to invalidate the same
    // keys on the same event.
    return () => {
      window.clearInterval(id);
    };
  }, [degraded, queryClient]);
}
