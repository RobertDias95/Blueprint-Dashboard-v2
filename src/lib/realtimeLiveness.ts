import type { RealtimeStatus } from '../stores/realtimeStore';

// ===========================================================================
// ★★★ fix-371 §1 — liveness that does not depend on being told
// ===========================================================================
//
// Bobby: *"for the app, i have to refresh it to get live notifications"*.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT THE BRIEF SAID, AND WHAT THE SOURCE ACTUALLY SAYS
// ---------------------------------------------------------------------------
//
// The brief's §1 proposed that a silently-dying socket leaves `status` at
// SUBSCRIBED, so `degraded` stays false and neither the poll nor the focus
// refresh ever runs. It also said, correctly, to verify that before fixing it.
//
// ★★★ IT IS NOT WHAT HAPPENS. Read in @supabase/realtime-js 2.105.4 and its
// bundled phoenix client, the close path is:
//
//   phoenix/socket.js:547  onConnClose(event)
//                            → triggerChanError(event)                (:550)
//   phoenix/socket.js:576  triggerChanError → for every channel not already
//                            errored/leaving/closed:
//                            channel.trigger(CHANNEL_EVENTS.error)    (:579)
//   phoenix/channel.js:134 onError(callback) is bound to that event
//   RealtimeChannel.js:137 _onError → callback(CHANNEL_ERROR)
//
// So a dropped socket DOES report itself, `setStatus('CHANNEL_ERROR')` runs,
// and `degraded` does flip to true. The premise is wrong and the fix must not
// rest on it.
//
// ---------------------------------------------------------------------------
// ★★★ SO WHY DOES REFRESHING FIX IT? BECAUSE EVERY RECOVERY PATH IS INERT
// EXACTLY WHEN IT IS NEEDED. Measured in this repo, not inferred:
// ---------------------------------------------------------------------------
//
//   1. The fallback poll is `window.setInterval`. Chrome throttles timers in a
//      backgrounded page to once a minute and FREEZES them entirely in a
//      backgrounded installed app — which is precisely the state Bobby's window
//      is in while he is doing something else.
//
//   2. `refetchOnWindowFocus: false` is set globally (App.tsx:116), so bringing
//      the window forward refetches nothing on its own.
//
//   3. `refetchIntervalInBackground` is set NOWHERE in src/ (0 occurrences), so
//      every `refetchInterval` in the app — including useScraperActivity's five
//      minutes, which feeds the bell and fix-369's banners — is paused whenever
//      the window is unfocused.
//
//   4. `visibilitychange` is listened for NOWHERE in src/ (0 occurrences). The
//      only focus listener there is lives inside the `degraded` branch and
//      uses `focus`, which an installed app restored from the background does
//      not reliably fire.
//
// ★★★ Put together: while the app is in the background the socket is the only
// live path, and when the person comes back NOTHING refetches — whatever
// `status` says. That is "I have to refresh it", exactly, and it does not
// require the socket to have lied about anything.
//
// ---------------------------------------------------------------------------
// ★★ THE RULE THIS FILE ENCODES
// ---------------------------------------------------------------------------
//
// Liveness is measured by ARRIVALS, not by claims. If nothing has arrived and
// nothing has been fetched for longer than a person would tolerate, the wire is
// treated as dead and rebuilt — no matter what it says about itself. A socket
// that is genuinely fine pays one extra invalidation every few minutes of
// silence; a socket that is quietly dead is repaired without anybody noticing
// it broke. That trade is the whole design.

/** ★ How long the app may go with nothing arriving and nothing refetched before
 *  the wire is rebuilt. Three minutes: long enough that a genuinely quiet
 *  stretch is not churned, short enough that "I looked and it was stale" does
 *  not happen — the feed's own background poll is five. */
export const REALTIME_STALE_MS = 180_000;

/** ★ Coming back to the window is a catch-up, not a rebuild. This is the floor
 *  between two of them, so alt-tabbing quickly does not refetch on every pass. */
export const REALTIME_VISIBILITY_MIN_GAP_MS = 10_000;

export interface LivenessInput {
  now: number;
  /** The last moment anything arrived OR anything was deliberately refetched. */
  lastSyncAt: number;
  /** What the socket CLAIMS. Deliberately not the deciding input. */
  status: RealtimeStatus;
  /** Whether the document is visible. Nothing is decided while it is not. */
  visible: boolean;
}

/**
 * ★ 'catch_up'    — invalidate the realtime key set once.
 * ★ 'resubscribe' — tear the channel down, build it again, and catch up.
 * ★ 'none'        — leave it alone.
 */
export type LivenessAction = 'none' | 'catch_up' | 'resubscribe';

/**
 * ★★★ THE WATCHDOG, AND `status` IS NOT AN INPUT TO ITS DECISION.
 *
 * It is in the signature so the intent is legible and so a test can prove the
 * point: pass SUBSCRIBED with a stale clock and it still rebuilds. A wire that
 * is only known to be dead when it announces its own death is the failure this
 * ticket exists to end.
 */
export function livenessAction(input: LivenessInput): LivenessAction {
  // ★ Hidden means frozen: timers do not fire, and a decision taken here would
  // be taken on a clock that stopped. Everything waits for the return, which is
  // the moment a person is looking anyway.
  if (!input.visible) return 'none';
  const silentFor = input.now - input.lastSyncAt;
  if (silentFor >= REALTIME_STALE_MS) return 'resubscribe';
  return 'none';
}

/**
 * ★★ Returning to the window ALWAYS catches up — this is not gated on
 * `degraded`, and that is the change.
 *
 * The old focus listener existed only while the socket had reported a problem,
 * which is the one case that was already handled. The case that was not is a
 * socket that reconnected while the app was hidden: it is SUBSCRIBED, it is
 * genuinely live, and the cache still holds whatever it held before the gap,
 * because postgres_changes are not replayed. fix-336's rule — every
 * (re)subscribe invalidates once — has the same reason and this is the same
 * rule applied to the window instead of to the socket.
 *
 * ★ Scoped to the realtime key set by its caller, never a global
 * `refetchOnWindowFocus`. fix-336 declined to reverse that and this ticket is
 * not the place either.
 */
export function shouldCatchUpOnVisible(
  now: number,
  lastSyncAt: number,
  minGapMs: number = REALTIME_VISIBILITY_MIN_GAP_MS,
): boolean {
  return now - lastSyncAt >= minGapMs;
}
