import { useEffect } from 'react';
import { touchPresence } from '../lib/deliveryReceipts';

// ★★★ fix-650 §B — "somebody is here", for the delivery check.
//
// Mounted once, in Chrome (always present, never remounts on navigation).
// `touchPresence` writes at most every 5 minutes and only while the document
// is VISIBLE, so a forgotten background tab never counts as a person.
//
// ★ A 60-second tick plus the two return events. The tick is throttled or
//   frozen in a hidden tab — which is fine, a hidden tab writes nothing anyway —
//   and `visibilitychange` + `focus` catch the return (fix-424: they cover
//   different surfaces, so both).
const TICK_MS = 60_000;
const RETURN_EVENTS = ['visibilitychange', 'focus'] as const;

export function usePresenceHeartbeat(): void {
  useEffect(() => {
    touchPresence();
    const id = window.setInterval(() => touchPresence(), TICK_MS);
    const onReturn = () => touchPresence();
    for (const evt of RETURN_EVENTS) {
      const t: EventTarget = evt === 'focus' ? window : document;
      t.addEventListener(evt, onReturn);
    }
    return () => {
      window.clearInterval(id);
      for (const evt of RETURN_EVENTS) {
        const t: EventTarget = evt === 'focus' ? window : document;
        t.removeEventListener(evt, onReturn);
      }
    };
  }, []);
}
