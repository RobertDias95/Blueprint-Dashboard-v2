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
  }, [unseenCount, isLoading]);

  return { badge: isLoading ? 0 : unseenCount };
}
