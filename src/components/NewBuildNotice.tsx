import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUILD_CHECK_FIRST_MS,
  BUILD_CHECK_INTERVAL_MS,
  BUILD_CHECK_MIN_GAP_MS,
  fetchDeployedBundleUrl,
  isNewBuildAvailable,
  markNewBuildLive,
  newBuildIsLive,
  reloadOntoNewBuild,
  runningBundleUrl,
} from '../lib/appVersion';
import {
  buildAgeDays,
  dismissQuietMs,
  noticeCopy,
  noticeStep,
  recordClientBuild,
} from '../lib/clientBuild';

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

// ===========================================================================
// ★★★ fix-589 (P-289) — THE NOTICE REPORTS ITSELF, AND IT ESCALATES
// ===========================================================================
//
// Brittani, 2026-09-16: she gets this ribbon *"multiple times a day"*, *"and I
// hit it"* — *"I swear I hit that reload button 4–5x a day."* She ran a bundle
// from before 2026-08-29 for three weeks. **Closing the app entirely and
// reopening it is what finally fixed it.**
//
// ★★★ SO DETECTION WORKS, THE RIBBON RENDERS, THE PERSON ACTS ON IT — AND THE
//     BUNDLE DID NOT CHANGE. Every theory that blames the notice, the poll
//     interval or the person's habits is dead, and `public/sw.js` caches
//     nothing so it is not that either.
//
// ★★★ AND NOTHING IN THE OLD CODE COULD HAVE SETTLED IT. This component
//     rendered a ribbon and recorded nothing — **"it never showed" and "it
//     showed and was ignored" were indistinguishable**, which is why Bobby's
//     second question was unanswerable in principle and not merely in fact.
//     Three things changed here and each one is that gap:
//
//       §3a  every appearance, dismissal and use is recorded, at the grain the
//            question is asked at — per person, per build.
//       §3b  the copy climbs a four-step ladder as the bundle ages, and a
//            dismissal buys less quiet at each step. **No step blocks work and
//            no step reloads.**
//       §3c  the control fetches the document uncached BEFORE reloading onto
//            it, so a cache nobody configured cannot hand the same bundle back.
//            See `reloadOntoNewBuild` for what was measured on the deployed app.
//
// ⚠️ THE HEARTBEAT RIDES THE CHECK THAT WAS ALREADY HAPPENING. No new timer,
//    and `recordClientBuild` shares `BUILD_CHECK_MIN_GAP_MS`, so the three
//    triggers cannot burst it any more than they can burst the check itself.

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

  // ★★★ fix-589 §3b: a dismissal is a PAUSE, never a mute. How long it lasts is
  //     the escalation — see `dismissQuietMs`.
  //
  // ★★ TWO HALVES ON PURPOSE, and the React Compiler is why. `snoozed` is
  //    STATE because render reads it; the deadline is a REF because only
  //    callbacks read it. Deriving the visible answer from `Date.now()` and a
  //    ref during render is exactly the shape lint rejects — the fourth time
  //    this repo has hit it (fix-403, fix-408, fix-426), and the only thing
  //    that catches it is `npm run lint`.
  const [snoozed, setSnoozed] = useState(false);
  const quietUntil = useRef(0);

  // ★ The floor between checks. A ref, not state: it must not re-render
  //   anything, and it must be read at call time rather than closed over.
  const lastCheckAt = useRef(0);

  // ★★ Recorded once per document, not once per render. Without this, the
  //    `shown` count would measure React re-renders rather than appearances —
  //    a number that looks like evidence and is not.
  const reportedShown = useRef(false);

  const check = useCallback(async () => {
    // ★★ THE THREE TRIGGERS SHARE ONE FLOOR. Alt-tabbing between two windows
    //    fires `focus` and `visibilitychange` in quick succession; without this
    //    every pass would cost a fetch. Same reason as fix-371 §1's
    //    REALTIME_VISIBILITY_MIN_GAP_MS.
    const now = Date.now();
    if (now - lastCheckAt.current < BUILD_CHECK_MIN_GAP_MS) return;
    lastCheckAt.current = now;
    // ★★★ fix-589 §A — THE HEARTBEAT. Same moment, same floor, no new timer.
    //     Fire-and-forget: the migration ships unapplied, so this is a 404 in
    //     production today and must be exactly as harmless then as after.
    void recordClientBuild();
    // ★ A dismissal that has run out brings the ribbon back without waiting for
    //   a new deploy — the ribbon is about the bundle being old, and it is.
    if (quietUntil.current && now >= quietUntil.current) {
      quietUntil.current = 0;
      setSnoozed(false);
    }
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
    // ★★★ fix-589 §A — AND ONCE ON LOAD, which is the only heartbeat a person
    //     who opens the app and closes it again ever sends. It is the first
    //     thing the effect does so it does not wait out BUILD_CHECK_FIRST_MS.
    void recordClientBuild();
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

  // ★★ fix-589 §3b — the step is the AGE OF THE BUNDLE THIS DOCUMENT IS
  //    RUNNING, not the age of the deploy that triggered the notice. What
  //    matters to the person is how far behind THEY are.
  const ageDays = buildAgeDays();
  const step = noticeStep(ageDays);
  // ★ Pure: two pieces of state and nothing else. The clock lives in `check`.
  const showing = available && !snoozed;

  // ★★★ §3a — RECORD THE APPEARANCE. In an effect, not in render: this writes
  //     to the network, and a render may be thrown away or replayed.
  useEffect(() => {
    if (!showing || reportedShown.current) return;
    reportedShown.current = true;
    void recordClientBuild('shown');
  }, [showing]);

  if (!showing) return null;

  const copy = noticeCopy(step, ageDays);
  const loud = copy.tone === 'loud';

  return (
    <div
      // ★ `wa` is fix-441 §A's warning family — the EXISTING corrections amber,
      //   aliased so a future edit to it cannot leave this behind. The border
      //   goes through `style` because `--color-wa-border` has no Tailwind
      //   utility in this repo and fix-406's lesson is that an undefined class
      //   looks exactly like a colour somebody chose to make subtle.
      className={`flex items-center gap-2 px-3 py-1.5 border-b text-[11px] text-text ${
        loud ? 'bg-wa-bg' : 'bg-de-bg'
      }`}
      style={{
        borderBottomColor: loud ? 'var(--color-wa-border)' : 'var(--color-de-border)',
      }}
      role="status"
      data-testid="new-build-notice"
      // ★ The step, on the element, so a test can assert the LADDER without
      //   pinning a sentence somebody will want to reword.
      data-step={step}
      data-tone={copy.tone}
    >
      <span className="font-bold">{copy.headline}</span>
      <span className="text-muted">{copy.detail}</span>
      <button
        type="button"
        onClick={() => {
          // ★★ Recorded BEFORE the navigation starts. A reload tears this
          //    document down, so a fire-and-forget after it would be a race
          //    that loses most of the time.
          void recordClientBuild('reloaded');
          void reloadOntoNewBuild();
        }}
        className={`ml-auto font-bold px-2.5 py-1 rounded-md border bg-surface transition ${
          loud ? 'text-wa hover:bg-wa-bg' : 'text-de hover:bg-de-bg'
        }`}
        style={{ borderColor: loud ? 'var(--color-wa)' : 'var(--color-de)' }}
        data-testid="new-build-reload"
      >
        Reload
      </button>
      {/* ★★ fix-589 §3b — DISMISS IS A SNOOZE, AND THE SNOOZE SHORTENS.
          At `ready` it lasts the rest of this document's life; at `stale` it
          buys fifteen minutes. It is here so that "was it ignored?" becomes a
          recorded answer instead of a guess — and because a ribbon somebody
          cannot put down for one minute is one they learn to read past. */}
      <button
        type="button"
        onClick={() => {
          quietUntil.current = Date.now() + dismissQuietMs(step);
          // ★ So the NEXT appearance is counted as one. The count is of
          //   appearances, and this ribbon is about to stop being one.
          reportedShown.current = false;
          void recordClientBuild('dismissed');
          setSnoozed(true);
        }}
        className="font-bold px-2 py-1 rounded-md text-muted hover:text-text transition"
        title="Hide this for now — it will come back"
        data-testid="new-build-dismiss"
      >
        Later
      </button>
    </div>
  );
}
