import { useState } from 'react';
import { useSoundPref } from '../hooks/useSoundPref';
import { ensureDingContext, playDing } from '../lib/alertSound';
import type { SoundPref } from '../lib/desktopAlerts';

// ===========================================================================
// ★★★ fix-369 — where the permission is asked, and why it is asked here
// ===========================================================================
//
// ★★★ A PERMISSION PROMPT ON FIRST PAINT IS THE ONE EVERYBODY DENIES — and a
// denial is STICKY. Chrome will not show the prompt again; the person has to
// find it in site settings, which nobody does. So getting this wrong once
// costs that person the feature permanently, and there is no ship-a-fix-later
// recovery. It is the single decision in this ticket that cannot be undone.
//
// ★★ SO IT IS ASKED FROM A CONTROL THEY CHOSE TO USE, and only from here:
// the person has navigated to the notification centre, found a switch marked
// "Desktop alerts", and clicked it. The browser prompt then arrives as the
// answer to something they just did, which is the only framing under which
// anybody says yes.
//
// ★ The alternative reading of the brief — "ask when they do something that
// implies they want to be told" — was considered and rejected. Every candidate
// action (sending a chat message, being assigned work) implies wanting to be
// told about REPLIES, not wanting a browser dialog mid-task, and getting the
// implication wrong burns the permission for good. A control is slower to find
// and cannot be wrong.
//
// ★★ AND A DENIAL LEAVES EVERYTHING WORKING. The bell, its badge, the taskbar
// count and this centre are the mechanism; a desktop banner is a second
// rendering of what they already show. This component says that out loud when
// permission is denied, because the failure mode otherwise is somebody
// concluding notifications are broken.

const SOUND_LABEL: Record<SoundPref, string> = {
  // ★ The labels name the RULE, not the setting, so nobody has to guess what
  // "All" includes. See lib/desktopAlerts for the sets themselves.
  all: 'Mentions, requests and work assigned to me',
  mentions: 'Mentions and requests only',
  off: 'No sound',
};

const SOUND_ORDER: SoundPref[] = ['all', 'mentions', 'off'];

function currentPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export default function DesktopAlertsControl() {
  const { pref, setPref } = useSoundPref();
  // ★ Seeded from the browser at mount — READ, never requested. Reading
  // `Notification.permission` shows no dialog; only `requestPermission` does,
  // and it is called in exactly one place below, inside a click handler.
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    currentPermission,
  );

  async function askForPermission() {
    if (permission === 'unsupported') return;
    // ★ The click is also the user gesture that unlocks WebAudio. A context
    // built without one is created suspended and plays nothing, silently — so
    // it is built here, on the gesture, rather than at module load.
    ensureDingContext();
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      setPermission(currentPermission());
    }
  }

  function chooseSound(next: SoundPref) {
    setPref(next);
    const ctx = ensureDingContext();
    // ★ Play it. A sound preference you cannot hear while choosing it is a
    // preference set blind — and this is also the gesture that unlocks the
    // context for the alerts that arrive later.
    if (next !== 'off' && ctx) playDing(ctx);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-2.5 flex-none px-2.5 py-2 rounded-md border border-border bg-s2"
      data-testid="desktop-alerts-control"
    >
      <span className="text-[8px] font-extrabold uppercase tracking-wide text-muted">
        Desktop alerts
      </span>

      {permission === 'granted' ? (
        <span className="text-[10.5px] text-muted" data-testid="desktop-alerts-granted">
          On — banners appear while the app is open.
        </span>
      ) : permission === 'denied' ? (
        // ★★ The honest version of a dead end: what is off, that it cannot be
        // turned back on from here, and — the important half — what still
        // works without it.
        <span className="text-[10.5px] text-muted" data-testid="desktop-alerts-denied">
          Blocked in this browser. The bell, the unread count and this page are
          unaffected; turn banners back on in your browser's site settings.
        </span>
      ) : permission === 'unsupported' ? (
        <span className="text-[10.5px] text-muted" data-testid="desktop-alerts-unsupported">
          This browser has no desktop notifications. Everything on this page
          still works.
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void askForPermission()}
          className="text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-de text-de bg-surface hover:bg-de-bg transition"
          data-testid="desktop-alerts-enable"
        >
          Turn on desktop alerts
        </button>
      )}

      <label className="ml-auto flex items-center gap-1.5 text-[10.5px] text-muted">
        Sound
        <select
          value={pref}
          onChange={(e) => chooseSound(e.target.value as SoundPref)}
          className="text-[10.5px] bg-surface border border-border rounded-md px-1.5 py-1 text-text"
          data-testid="desktop-alerts-sound"
        >
          {SOUND_ORDER.map((p) => (
            <option key={p} value={p}>
              {SOUND_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
