import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUILD_CHECK_FIRST_MS,
  BUILD_CHECK_INTERVAL_MS,
  BUILD_CHECK_MIN_GAP_MS,
  fetchDeployedBundleUrl,
  isNewBuildAvailable,
  markNewBuildLive,
  newBuildIsLive,
  runningBundleUrl,
} from '../lib/appVersion';

// ===========================================================================
// ★★ fix-371 §4 — a line that says a new version is ready, and a control
// ===========================================================================
//
// ★★★ IT OFFERS, IT NEVER ACTS. Reloading somebody's window discards what they
// were typing — a mid-sentence chat post, a date they were halfway through
// changing. The brief forbids an auto-reload and it is right to: being a day
// behind is a smaller problem than losing a paragraph.
//
// ★ It renders NOTHING until there is something to say, so the shell is
// unchanged for everybody on the current build — which is everybody, most of
// the time. See lib/appVersion for why this needs no build step and no version
// file.

export default function NewBuildNotice() {
  // ★★★ fix-424: SEEDED FROM THE MODULE-LEVEL FACT, not from `false`.
  //
  // A deploy that has been seen is permanent for the life of the document —
  // lib/appVersion says so in as many words and fix-372's banner already reads
  // it. This component discovered the fact and then kept it in component state,
  // so a remount of the shell subtree silently took the notice back down.
  // AuthGuard swaps that subtree for "Loading…" / "Reconnecting…" on a session
  // verify, which is a thing that happens to a window left open all day.
  const [available, setAvailable] = useState(newBuildIsLive);

  // ★ The floor between checks. A ref, not state: it must not re-render
  //   anything, and it must be read at call time rather than closed over.
  const lastCheckAt = useRef(0);

  const check = useCallback(async () => {
    // ★★ THE THREE TRIGGERS SHARE ONE FLOOR. Alt-tabbing between two windows
    //    fires `focus` and `visibilitychange` in quick succession; without this
    //    every pass would cost a fetch. Same reason as fix-371 §1's
    //    REALTIME_VISIBILITY_MIN_GAP_MS.
    const now = Date.now();
    if (now - lastCheckAt.current < BUILD_CHECK_MIN_GAP_MS) return;
    lastCheckAt.current = now;
    const running = runningBundleUrl();
    if (!running) return;
    const deployed = await fetchDeployedBundleUrl();
    // ★ Only ever set to true. Once a new build is out there, hiding the notice
    // again because one later fetch failed would be worse than leaving it up.
    if (isNewBuildAvailable(running, deployed)) {
      // fix-372 section 6 reads this to explain a mutation that died on the wire.
      markNewBuildLive();
      setAvailable(true);
    }
  }, []);

  useEffect(() => {
    // The first check is DEFERRED, for two reasons. It keeps a request off the
    // initial paint, and calling `check` straight from the effect body is a
    // synchronous setState inside an effect - which the React Compiler rejects,
    // the same family of rule that cost fix-350 two attempts.
    const first = window.setTimeout(() => void check(), BUILD_CHECK_FIRST_MS);
    const id = window.setInterval(() => void check(), BUILD_CHECK_INTERVAL_MS);
    // ★ …and when the window comes back, because that is when somebody is
    // there to read it. Same event fix-371 §1 uses for the same reason: a
    // backgrounded app's timers are frozen — in a backgrounded INSTALLED app
    // they stop entirely, which is why this event, and not the poll, is what
    // reaches the installed app at all.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    // ★★★ fix-424 — AND WHEN THE WINDOW IS FOCUSED, WHICH IS A DIFFERENT EVENT.
    //
    // `visibilitychange` fires when a tab is switched to or an installed app is
    // restored. It does NOT fire when a window that was already on screen is
    // clicked into — a second monitor, a side-by-side split — because nothing
    // about its visibility changed. Those windows had no event at all and were
    // left waiting out the whole poll interval. fix-371 §1 chose
    // `visibilitychange` over `focus` for the installed app and was right to;
    // the mistake was treating them as alternatives. They cover different
    // surfaces and the notice needs both.
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [check]);

  if (!available) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 bg-de-bg border-b border-de-border text-[11px] text-text"
      role="status"
      data-testid="new-build-notice"
    >
      <span className="font-bold">A new version of the Bridge is ready.</span>
      <span className="text-muted">
        Reload when you are at a good stopping point — nothing reloads on its own.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="ml-auto font-bold px-2.5 py-1 rounded-md border border-de text-de bg-surface hover:bg-de-bg transition"
        data-testid="new-build-reload"
      >
        Reload
      </button>
    </div>
  );
}
