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
import { activeElementIsInput, shouldAutoReload } from '../lib/autoReload';
import { appIsMutating } from '../lib/appQueryClient';
import { isAnythingDirty } from '../lib/dirtyRegistry';

// ===========================================================================
// ★★ fix-371 §4 — a line that says a new version is ready, and a control
// ===========================================================================
//
// ★★★ IT OFFERS, IT NEVER ACTS. Reloading somebody's window discards what they
// were typing — a mid-sentence chat post, a date they were halfway through
// changing. The brief forbids an auto-reload and it is right to: being a day
// behind is a smaller problem than losing a paragraph.
//
// ⚠️⚠️ **NARROWLY SUPERSEDED BY fix-595 (P-292), 2026-09-29 — AND THE SENTENCE
//       ABOVE IS KEPT BECAUSE IT IS STILL TRUE.** Bobby did not overturn the
//       reasoning; he narrowed its scope. fix-371 was refusing a reload that
//       could interrupt somebody mid-sentence. fix-595 reloads **only at the one
//       moment nothing can be lost** — on return to a window left idle for half
//       an hour, with nothing unsaved, nothing in flight, and no caret in a
//       field. *"Losing a paragraph"* is exactly what the four conditions in
//       `lib/autoReload.ts` exist to make impossible. See §2 there.
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

// ===========================================================================
// ★★★ fix-595 (P-292) — THE STALE APP CATCHES UP WHEN YOU COME BACK
// ===========================================================================
//
// fix-589's heartbeat settled what was actually wrong: **14 of 14 people who
// pressed Reload moved build**, and the people stuck four builds behind had the
// ribbon on screen the whole time — `notice_shown_count = 1`, never dismissed.
// **Re-showing it will not help.** The cause is that an installed app never
// restarts and a quiet ribbon is easy to live with.
//
// ★★★ SO THE RELOAD RIDES THE RETURN, NOT A TIMER. The same `visibilitychange`
//     and `focus` handlers that already exist now also record WHEN the window
//     went away, and when it comes back they ask `shouldAutoReload`. No new
//     event, no new timer — and a timer could not have worked anyway, because
//     Chrome throttles them in a hidden tab and stops them entirely in a
//     backgrounded installed app, which is the exact population this is for.
//
// ★ WHAT IT DOES NOT DO: reload while the window is visible and in use, reload
//   on a timer, or special-case the installed app. Browser tabs and standalone
//   get the same rule.

/** ★ The running bundle as a latch key. Never `null` — see `autoTriedForBuild`. */
function buildKey(): string {
  return runningBundleUrl() ?? '(no module script)';
}

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

  // ═════════════════════════════════════════════════════════════════════════
  // ★★★ fix-595 §2 — THE AWAY CLOCK, AND THE ONE-ATTEMPT LATCH
  // ═════════════════════════════════════════════════════════════════════════
  //
  // ★★★ A TIMESTAMP, NOT A TIMER. `appVersion.ts` already records why: Chrome
  //     throttles `setInterval` in a hidden tab and stops it entirely in a
  //     backgrounded installed app. A 30-minute `setTimeout` would fire late or
  //     never on the exact devices this ticket is about. So the hide/blur stamp
  //     is written down and the arithmetic happens on the way back.
  //
  // ★ `0` means "not away" — the window has been here the whole time, so there
  //   is no return to ride.
  const awaySince = useRef(0);
  /** ★ The build we have already tried to reload onto, so a server that keeps
   *  serving the same bundle cannot produce a reload loop. Condition 4.
   *
   *  ★★★ COMPARED AS A KEY, NOT AS THE URL ITSELF. `runningBundleUrl()` is
   *      documented to return `null` *"in a context with no module script (a
   *      test renderer, an unusual host)"* — and `null === null` would have read
   *      as **already tried** on the very first return, latching the feature off
   *      before it ever ran. `buildKey()` never returns `null`, so the initial
   *      ref value cannot collide with a real answer, and an attempt made in
   *      that same host still latches. */
  const autoTriedForBuild = useRef<string | null>(null);

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

  // ═══════════════════════════════════════════════════════════════════════
  // ★★★ fix-595 §2 — THE DECISION, IN ONE PLACE
  // ═══════════════════════════════════════════════════════════════════════
  //
  // ★★★ THE CHECK IS AWAITED FIRST, and that ordering is the whole reason this
  //     works for the people it is for. Somebody coming back after a night away
  //     has a document whose `newBuildIsLive()` is still false — the deploy
  //     happened while they were gone and nothing has looked yet. Deciding before
  //     the check would decline every single time, for exactly the population
  //     the ticket exists to reach.
  //
  // ★ `check()` has its own 10-second floor, so the await is usually a no-op and
  //   never a second fetch.
  const maybeAutoReload = useCallback(
    async (awayMs: number) => {
      await check();
      const decision = {
        newBuild: newBuildIsLive(),
        awayMs,
        // ★ Three independent readings of "something would be lost" — see
        //   `lib/autoReload` for why the caret test is the net under the other two.
        dirty: isAnythingDirty(),
        // ★ `false` outside the app (a bare test mount) — there is nothing
        //   around it to be mutating anything. See `lib/appQueryClient`.
        mutating: appIsMutating(),
        activeIsInput: activeElementIsInput(),
        // ★★ Condition 4, latched against the BUILD rather than the return, so a
        //    genuinely new deploy is still eligible and a failed one is not
        //    retried on every alt-tab for the rest of the day.
        triedThisBuild: autoTriedForBuild.current === buildKey(),
      };
      if (!shouldAutoReload(decision)) {
        // ★★★ §2: *"If 1 + 2 hold but 3 fails: do nothing new; the ribbon is
        //     already there. Log nothing."* A person who has just walked back to
        //     their desk does not need a message about a reload that did not
        //     happen, and a log line per alt-tab would drown the one signal
        //     fix-589 built.
        return;
      }
      autoTriedForBuild.current = buildKey();
      // ★★ RECORDED BEFORE THE NAVIGATION, for fix-589's reason exactly: the
      //    reload tears this document down, so a fire-and-forget afterwards is a
      //    race that loses most of the time. `recordClientBuild` swallows its own
      //    failures, so an unapplied migration — today's state — costs nothing and
      //    **does not block the reload**.
      // ★★★ …AND THE `.catch` IS NOT BELT-AND-BRACES. §3 requires the reload to
      //     happen *"if the RPC rejects the new event"*, which is today's state:
      //     the migration ships unapplied and `bp_record_client_build` raises
      //     22023 for an event it does not know. `recordClientBuild` does swallow
      //     its own failures — but that is an invariant of ANOTHER module, and an
      //     `await` on a promise that rejects would skip the line below and
      //     silently turn this feature off. The requirement is enforced HERE,
      //     where it is stated. Asserted in `AutoReloadOnReturnLiveFix595`.
      await recordClientBuild('auto_reloaded').catch(() => undefined);
      void reloadOntoNewBuild();
    },
    [check],
  );

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
    // ═══════════════════════════════════════════════════════════════════════
    // ★★★ fix-595 §2 — THE RETURN IS THE MOMENT, SO THE LEAVING IS RECORDED
    // ═══════════════════════════════════════════════════════════════════════
    //
    // ★ Stamped only on the FIRST leave of a stretch. `blur` then `hidden` fires
    //   twice for one act of walking away, and resetting the stamp on the second
    //   would quietly restart the clock — a bug that would make the feature
    //   simply never trigger, with nothing on screen to say so.
    const markAway = () => {
      if (awaySince.current === 0) awaySince.current = Date.now();
    };
    /** Coming back: measure, decide, and only then act. */
    const onReturn = () => {
      const leftAt = awaySince.current;
      awaySince.current = 0;
      void check();
      if (leftAt === 0) return;
      void maybeAutoReload(Date.now() - leftAt);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') onReturn();
      else markAway();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('blur', markAway);
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
    const onFocus = () => onReturn();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('blur', markAway);
      window.removeEventListener('focus', onFocus);
    };
  }, [check, maybeAutoReload]);

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
