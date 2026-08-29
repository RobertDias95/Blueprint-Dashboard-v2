import { useEffect, useRef } from 'react';
import { useBoardNotifications } from './useBoardNotifications';
import { useSoundPref } from './useSoundPref';
import { bannerBody, bannerTag, planAlerts } from '../lib/desktopAlerts';
import { playDing } from '../lib/alertSound';
import { targetHref } from '../lib/notificationTargets';
import { appServiceWorker } from '../lib/serviceWorker';

// ===========================================================================
// ★★★ fix-369 — the driver: one model, three renderings
// ===========================================================================
//
// ★★★ EVERY FACT IN THIS FILE COMES FROM `useBoardNotifications`. There is no
// query here, no supabase import, no second definition of "unread". The bell's
// badge, the notification centre, the desktop banner and the taskbar count are
// four renderings of ONE list — which is why they cannot disagree, and why
// this hook is about thirty lines of real work.
//
// ★ Mounted once, in the shell, because two mounts would announce everything
// twice. Chrome is the only component that is always present and never
// remounts on navigation.

/** ★ Read fresh each time rather than held in state. Permission is owned by
 *  the browser and can change from browser UI with no event we would see, so
 *  a cached copy is a copy that goes stale silently. */
function permissionNow(): NotificationPermission | null {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  return Notification.permission;
}

/** ★★ THE BADGE, AND IT MUST REACH ZERO.
 *
 *  fix-307's lesson, restated by the brief: the old bell counted outstanding
 *  work, never reached zero, and stopped being read. `setAppBadge(0)` is
 *  specified to show a badge with no number rather than none, so zero CLEARS
 *  instead of setting — that one line is the difference between a signal and a
 *  permanent decoration on the taskbar. */
function applyBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch?.(() => {});
    else void nav.clearAppBadge?.()?.catch?.(() => {});
  } catch {
    /* ★ No badge support, or a browser that refuses. Nothing else is affected. */
  }
}

// ===========================================================================
// ★★★ fix-432 — THE BELL SAID 2 AND THE TASKBAR SAID 35
// ===========================================================================
//
// Miles, 2026-08-26, with a screenshot of both at once. Bobby ruled the bell
// canonical: *"what the notification bell says is what the app should
// display."*
//
// ---------------------------------------------------------------------------
// ★★★ THE DIAGNOSIS, AND IT FALSIFIES THE OBVIOUS EXPLANATION
// ---------------------------------------------------------------------------
//
// The brief's leading hypothesis was a badge counting raw audit rows over a
// wide window against a bell counting grouped-and-unread items — 782 flip rows
// in 14 days would make 35 against 2 look inevitable. **It is not what is
// happening, and there is no second count anywhere in the app.**
//
//   the bell    BoardBell.tsx:168   `const actionable = unseen.length`
//   the badge   this file           `applyBadge(unseenCount)`
//                                   useBoardNotifications: `unseenCount: unseen.length`
//
// ONE hook, ONE array, ONE `.length`. SCOPE A1 was already true — fix-369 built
// it that way and this file's own header says so. Nothing here computes a key,
// so fix-430's new `flip:<project>:<run>` generation cannot have stranded it
// either.
//
// ★★★ THE BUG IS NOT WHAT IS COUNTED. IT IS THAT THE OS KEEPS THE LAST NUMBER
// IT WAS PUSHED, FOREVER, AND ALMOST NOTHING EVER PUSHES A NEW ONE.
//
// `setAppBadge` writes to the operating system, not to a React tree. It
// survives the tab closing, the app closing, and signing out. And the only
// thing that pushed a new value was an effect keyed on `[unseenCount,
// isLoading]`, which:
//
//   1. NEVER RAN AFTER SIGN-OUT OR CLOSE. The driver is mounted in Chrome,
//      which lives inside AuthGuard, so signing out unmounts it and leaves
//      whatever number was last showing on the taskbar permanently.
//   2. NEVER RE-ASSERTED ITSELF ON RETURN. `refetchOnWindowFocus` is false
//      globally (App.tsx:136) and a backgrounded installed app's timers are
//      FROZEN (measured in fix-424, from fix-371 §1). So a window that comes
//      back to a changed world refetches nothing, `unseenCount` does not
//      change, the effect does not re-run, and the stale OS value stands.
//
// ★★ SO THE WRONG NUMBER WAS THE BADGE — 35 is a true count of some earlier
// moment, still on screen. The bell's 2 is live. **The bell is not hiding
// anything, so SCOPE B is not triggered and its filter is untouched.**
//
// ★ The fix is therefore about WHEN the number is pushed, never about what it
//   is: re-assert on every return to the window, and clear on the way out.

/** ★ Push the badge again whenever somebody comes back to the window.
 *
 *  ★★ TWO EVENTS, NOT ONE — fix-424's finding, and it cost that ticket the
 *  whole ticket. `visibilitychange` fires when a tab is switched to or an
 *  installed app is restored; it does NOT fire when a window that was already
 *  on screen is merely clicked into, which is a second monitor. They cover
 *  different surfaces and a stale badge needs both. */
const RETURN_EVENTS = ['visibilitychange', 'focus'] as const;

export interface DesktopAlertsState {
  /** What the taskbar was last asked to show. Exposed for the test, and for
   *  the control, which says the count out loud so a person can see the badge
   *  is being driven even on a machine that does not render one. */
  badge: number;
}

export function useDesktopAlerts(): DesktopAlertsState {
  const { unseen, unseenCount, isLoading } = useBoardNotifications();
  const { pref } = useSoundPref();

  // ★★ `null` is "no pass has run yet", which is NOT the same as "nothing was
  // waiting" — see planAlerts for why the first pass must announce nothing.
  // A ref, not state: this changes as a CONSEQUENCE of a render's data and
  // must not cause another one. Written only inside the effect, which keeps it
  // clear of the React Compiler rule that bit fix-350 twice.
  const announced = useRef<ReadonlySet<string> | null>(null);

  // ★ `pref` is a DEPENDENCY, not a ref. Mirroring it into one would be a ref
  // written during render, which the React Compiler rejects outright — the
  // rule that cost fix-350 two attempts. Re-running on a preference change is
  // harmless anyway: by then every current key is already announced, so the
  // pass produces no banners and no sound.
  useEffect(() => {
    if (isLoading) return;
    const plan = planAlerts(unseen, announced.current, pref);
    announced.current = plan.announced;
    if (plan.banners.length === 0) return;

    // ★★ THE SOUND IS INDEPENDENT OF THE PERMISSION, deliberately. Someone who
    // has denied banners but left the sound on still gets told something
    // arrived; the bell tells them what. Coupling them would mean a denial
    // silently removed a second feature they never refused.
    if (plan.ding) playDing();

    if (permissionNow() !== 'granted') return;
    void (async () => {
      const reg = await appServiceWorker();
      if (!reg) return;
      for (const item of plan.banners) {
        try {
          await reg.showNotification(item.title, {
            body: bannerBody(item),
            // ★ fix-351's square mark. The banner is drawn on the OS's own
            // surface, so this one keeps its transparency happily — it is the
            // TASKBAR TILE that needed a ground, not this.
            icon: '/bridge-app-192.png',
            badge: '/bridge-app-64.png',
            tag: bannerTag(item),
            // ★★ SILENT AT THE OS LEVEL, ALWAYS. The OS's own notification
            // sound is not this app's sound rule — it would ding for a
            // reaction digest, which is the one thing fix-360 spent a ticket
            // making quiet. The ding above is the only sound this app makes.
            silent: true,
            // ★★ fix-362's target, unchanged. The banner lands where the
            // notification centre's row lands, because it is the same item and
            // the same function.
            data: { url: targetHref(item), key: item.key },
          });
        } catch {
          /* One banner failing must not stop the rest. */
        }
      }
    })();
  }, [unseen, isLoading, pref]);

  useEffect(() => {
    if (isLoading) return;
    applyBadge(unseenCount);
    // ★★★ AND AGAIN ON EVERY RETURN. Without this the OS keeps the last number
    //     it was pushed while the app was frozen or closed — which is exactly
    //     what Miles photographed. Re-pushing the SAME value is free and
    //     idempotent; the alternative is a badge that is only ever correct at
    //     the instant the count happens to change.
    const reassert = () => {
      if (document.visibilityState === 'visible') applyBadge(unseenCount);
    };
    for (const evt of RETURN_EVENTS) {
      const t: EventTarget = evt === 'focus' ? window : document;
      t.addEventListener(evt, reassert);
    }
    return () => {
      for (const evt of RETURN_EVENTS) {
        const t: EventTarget = evt === 'focus' ? window : document;
        t.removeEventListener(evt, reassert);
      }
    };
  }, [unseenCount, isLoading]);

  // ★★★ AND IT CLEARS ON THE WAY OUT (SCOPE A2). This driver is mounted in
  //     Chrome, which lives inside AuthGuard — so signing out unmounts it, and
  //     before fix-432 that left the last count sitting on the taskbar of a
  //     machine nobody is signed in on. A badge that outlives its session is
  //     not a stale number, it is somebody else's number.
  //
  // ★ Its own effect with an empty dependency list, so it fires ONLY at true
  //   unmount and never on a count change.
  useEffect(() => () => applyBadge(0), []);

  return { badge: isLoading ? 0 : unseenCount };
}
