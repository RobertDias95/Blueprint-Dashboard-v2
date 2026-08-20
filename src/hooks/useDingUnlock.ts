import { useEffect } from 'react';
import { unlockDing } from '../lib/alertSound';

// ===========================================================================
// ★★★ fix-371 §2 — unlock the sound on the gesture that already happens
// ===========================================================================
//
// Bobby: *"i don't think i am hearing the sound every time i get a
// notification"*.
//
// ★★★ THE CAUSE WAS NOT THE AUTOPLAY POLICY, IT WAS THAT NO CONTEXT EXISTED.
// fix-369's `playDing()` defaulted to a module-level `shared`, and the only two
// callers of `ensureDingContext()` were inside `DesktopAlertsControl`'s click
// handlers. Every reload starts with `shared === null`, so unless the person
// went to /notifications and clicked something, the driver called `playDing()`
// on every arriving notification and it returned on its first line — no sound
// at all, not a quiet one. See lib/alertSound for the rest of it.
//
// ★★ THE FIX IS TO STOP REQUIRING A SPECIAL GESTURE. Browsers want *a* user
// gesture before audio; they do not care which one. A person using this app
// clicks something within seconds of opening it, so that click is the unlock.
// One listener, fired once, removed immediately.
//
// ★ WHY IT SURVIVES AN IDLE. Chrome's autoplay gate is per-DOCUMENT and sticky:
// once the page has had a gesture, `resume()` succeeds from a timer for the
// rest of that document's life. So the click that arms this also licenses every
// ding for the session, however long the app then sits idle. A reload clears
// both the module state and the sticky activation — and arms this again.
//
// ★ `pointerdown`, not `click`: it fires earlier, it covers touch and pen, and
// it still counts as activation. `keydown` is there for the person who tabs.

/** The events any of which is a user gesture good enough to unlock audio. */
export const DING_UNLOCK_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * Arms a one-shot unlock. Mounted once, in the shell.
 *
 * ★ It does NOT create the context on load and leave it suspended in the hope
 * of resuming later — it waits for the gesture and resumes inside it, which is
 * the thing browsers actually license.
 */
export function useDingUnlock(): void {
  useEffect(() => {
    let done = false;
    const onGesture = () => {
      if (done) return;
      done = true;
      remove();
      // ★ The result is observed inside unlockDing and recorded as dingState,
      // so a browser that refuses is a fact the control can show rather than a
      // silence nobody can explain.
      void unlockDing();
    };
    const remove = () => {
      for (const type of DING_UNLOCK_EVENTS) {
        window.removeEventListener(type, onGesture);
      }
    };
    for (const type of DING_UNLOCK_EVENTS) {
      // ★ Passive: this never calls preventDefault, and saying so keeps it off
      // the critical path of the click it is listening to.
      window.addEventListener(type, onGesture, { passive: true });
    }
    return remove;
  }, []);
}
