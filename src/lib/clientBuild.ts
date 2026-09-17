// ===========================================================================
// ★★★ fix-589 (P-289) — WHO IS RUNNING WHAT, AND DID THE NOTICE EVER APPEAR
// ===========================================================================
//
// Bobby, 2026-09-16: *"Is there a way to see if others are on a super outdated
// version? Can we make sure the reload is popping up for everyone?"*
//
// **Both answers were NO, and for the same reason: nothing was recorded.**
// fix-587 shipped the stamp, but it rides on `error_reports` only — and a
// stale person's symptom is WRONG NUMBERS, not an error. There were zero error
// rows in the three hours after that ticket merged. `user_activity` is written
// server-side by triggers, so it knows who is active and never what code they
// are running.
//
// ---------------------------------------------------------------------------
// ★★★ AND THE SECOND QUESTION WAS UNANSWERABLE IN PRINCIPLE, NOT JUST IN FACT
// ---------------------------------------------------------------------------
//
// `NewBuildNotice` rendered a ribbon and recorded nothing. **"It never showed"
// and "it showed and was ignored" were indistinguishable** — so no amount of
// looking at the old code could have settled Brittani's case. That is the gap
// this file closes, and it is why the telemetry is not an extra: it is half
// the ticket.
//
// ⚠️ IT IS A HEARTBEAT, NOT ANALYTICS. Who, what build, which surface, when
//    last seen — and the notice's own life at the same grain. No page paths,
//    no actions, no dwell time. The shape enforces it: one row per person per
//    build, UPDATED rather than appended. See
//    `migrations/fix_589_client_build_seen.sql`.
//
// ⚠️ EVERY CALL HERE IS FIRE-AND-FORGET AND SWALLOWS EVERYTHING, on the same
//    argument `errorLogger` makes: this is an enhancement, never a dependency.
//    **The migration ships unapplied** — Bobby applies it — so in production
//    today `bp_record_client_build` does not exist and every call below is a
//    404 that nobody sees. The app must be exactly as correct then as after.

import { supabase } from './supabase';
import { BUILD_SHA, BUILT_AT, buildAgeDays } from './buildInfo';
import { BUILD_CHECK_MIN_GAP_MS } from './appVersion';
import { useAuthStore } from '../stores/authStore';

// ---------------------------------------------------------------------------
// WHICH SURFACE
// ---------------------------------------------------------------------------

export type DisplayMode = 'standalone' | 'browser';

/**
 * Installed app, or a browser tab.
 *
 * ★★★ THE COLUMN THAT WOULD HAVE ANSWERED BRITTANI'S CASE ON DAY ONE. An
 *     installed window and a tab are different windows with different
 *     lifetimes — the installed one is never closed, which is the premise the
 *     whole notice rests on. "Their reload did nothing" and "they reloaded a
 *     window that was already current while the stale one sat behind it" are
 *     different bugs, and nothing recorded which.
 *
 * ★ Anything that is not clearly standalone reads as a tab. A future display
 *   mode must not become a lost heartbeat.
 */
export function currentDisplayMode(win: Window = window): DisplayMode {
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches) return 'standalone';
    // ★ iOS Safari predates display-mode and answers here instead.
    if ((win.navigator as { standalone?: boolean }).standalone === true) {
      return 'standalone';
    }
  } catch {
    // A test renderer with no matchMedia is a tab.
  }
  return 'browser';
}

// ---------------------------------------------------------------------------
// ★★★ §3b — ESCALATE BY AGE, NEVER FORCE
// ---------------------------------------------------------------------------
//
// Bobby's ruling stands and fix-371 wrote it down: **auto-reloading discards
// what somebody is typing, and this tool is buffered forms everywhere.** So
// the notice still only ever offers.
//
// ★★★ BUT A RIBBON THAT LOOKS IDENTICAL ON DAY 1 AND DAY 21 IS ONE A PERSON
//     STOPS SEEING. Brittani was getting it *"multiple times a day"* for three
//     weeks, and it said the same eleven words every time.
//
// ★★ THE LADDER, AND WHY THESE FOUR STEPS:
//
//   `ready`   <1 day   The deploy that just happened. Calm, and deliberately
//                      the SAME copy that shipped in fix-371 — most notices
//                      are this one and nothing is wrong.
//   `dated`   1–2      Says the number out loud for the first time. A day is
//                      when "I'll do it later" has actually cost something.
//   `behind`  3–6      Names the consequence rather than the fact. Three days
//                      spans a weekend, and P-287's whole injury was a screen
//                      quietly showing the wrong count.
//   `stale`   ≥7       A week is not a delay, it is a different application.
//                      Loudest wording, most insistent re-show.
//
// ⛔ NO STEP BLOCKS WORK, and none of them reloads. The only thing that
//    escalates is how loudly it says the number and how soon it comes back
//    after being dismissed — see {@link dismissQuietMs}.

export type NoticeStep = 'ready' | 'dated' | 'behind' | 'stale';

/** The age, in days, at which each step takes over. Exported so a test can
 *  assert the STEP and its boundary rather than the wording. */
export const NOTICE_STEP_DAYS: Readonly<Record<NoticeStep, number>> = {
  ready: 0,
  dated: 1,
  behind: 3,
  stale: 7,
};

/**
 * Which step a bundle of this age is at.
 *
 * ★ An UNKNOWN age (a dev build, a clone with no git) is `ready`. Not knowing
 *   how old something is has never been a reason to shout at anybody.
 */
export function noticeStep(ageDays: number | null | undefined): NoticeStep {
  if (ageDays == null || Number.isNaN(ageDays)) return 'ready';
  if (ageDays >= NOTICE_STEP_DAYS.stale) return 'stale';
  if (ageDays >= NOTICE_STEP_DAYS.behind) return 'behind';
  if (ageDays >= NOTICE_STEP_DAYS.dated) return 'dated';
  return 'ready';
}

/**
 * How long a dismissal is honoured at each step.
 *
 * ★★★ THIS IS THE ESCALATION, AND IT IS THE ONLY MECHANISM THAT TIGHTENS.
 *     Dismissing at `ready` hides the ribbon for the rest of this document's
 *     life — a person who has read it once does not need it again for a deploy
 *     that happened an hour ago. At `stale` the same click buys fifteen
 *     minutes. **Nothing is ever blocked and nothing ever reloads**; the ribbon
 *     simply stops being furniture.
 */
export function dismissQuietMs(step: NoticeStep): number {
  switch (step) {
    case 'ready':
      return Number.POSITIVE_INFINITY;
    case 'dated':
      return 4 * 60 * 60 * 1000;
    case 'behind':
      return 60 * 60 * 1000;
    case 'stale':
      return 15 * 60 * 1000;
  }
}

export interface NoticeCopy {
  headline: string;
  detail: string;
  /** ★ `loud` earns a heavier ribbon. Two tones, not four — a fifth shade of
   *   blue is not what makes somebody read a line. */
  tone: 'calm' | 'loud';
}

/** What the ribbon says at each step. ⚠️ Tests assert the STEP, not this. */
export function noticeCopy(step: NoticeStep, ageDays: number | null): NoticeCopy {
  const days = ageDays == null ? null : Math.max(0, Math.floor(ageDays));
  const age = days === 1 ? '1 day old' : `${days} days old`;
  switch (step) {
    case 'ready':
      return {
        headline: 'A new version of the Bridge is ready.',
        detail:
          'Reload when you are at a good stopping point — nothing reloads on its own.',
        tone: 'calm',
      };
    case 'dated':
      return {
        headline: `A new version is ready. Yours is ${age}.`,
        detail:
          'Reload when you are at a good stopping point — nothing reloads on its own.',
        tone: 'calm',
      };
    case 'behind':
      return {
        headline: `Your version is ${age}.`,
        detail:
          'Screens may be showing you out-of-date numbers. Reload when you can — nothing reloads on its own.',
        tone: 'loud',
      };
    case 'stale':
      return {
        headline: `Your version is ${age} — please reload.`,
        detail:
          'A version this old can show wrong counts and hide fields that already shipped. Nothing reloads on its own; this will keep asking.',
        tone: 'loud',
      };
  }
}

// ---------------------------------------------------------------------------
// THE HEARTBEAT
// ---------------------------------------------------------------------------

export type NoticeEvent = 'shown' | 'dismissed' | 'reloaded';

/**
 * Is somebody signed in?
 *
 * ⚠️ READ DEFENSIVELY, AND THE REASON IS NOT PARANOIA — IT IS MEASURED. Seven
 *    suites mock `stores/authStore` with the HOOK ALONE and no `getState`,
 *    because until now nothing outside a component read this store. A bare
 *    `useAuthStore.getState()` took 45 tests down with
 *    *"getState is not a function"* — the partial-mock trap this repo has now
 *    hit four times (fix-407, fix-442, fix-415).
 *
 * ★ `errorLogger` carries the same shape for the same reason, one file over:
 *   a fixture that mocks `supabase` without an `rpc` must not throw past the
 *   swallow. Unknown reads as "nobody", which writes nothing — the safe answer
 *   for a heartbeat.
 */
function signedIn(): boolean {
  try {
    return !!useAuthStore.getState?.().user;
  } catch {
    return false;
  }
}

/** ★ The floor between two plain heartbeats. Deliberately the SAME constant
 *  the build check already uses, so this adds no new timer and cannot burst:
 *  every heartbeat rides a check that was going to happen anyway. */
let lastHeartbeatAt = 0;

/** Test seam. Module state is per-document in the app and per-file in vitest. */
export function __resetClientBuildHeartbeat(): void {
  lastHeartbeatAt = 0;
}

/**
 * Record that this browser is running this build. Never throws, never awaited
 * by anything on a hot path.
 *
 * ★★★ A NOTICE EVENT IS NEVER RATE-LIMITED, and a plain heartbeat always is.
 *     That is the right way round: heartbeats are frequent and interchangeable,
 *     events are rare and each one is a fact somebody asked a question about.
 */
export function recordClientBuild(
  event?: NoticeEvent,
  now: number = Date.now(),
): Promise<void> {
  // ★★★ SIGNED OUT WRITES NOTHING, AND THAT IS NOT ONLY AN OPTIMISATION.
  //     `bp_record_client_build` returns quietly when `auth.uid()` is null, so
  //     the call would be a wasted round trip on the login screen. The
  //     heartbeat is a fact about a PERSON; with nobody there, there is no fact.
  if (!signedIn()) return Promise.resolve();

  if (!event) {
    if (now - lastHeartbeatAt < BUILD_CHECK_MIN_GAP_MS) return Promise.resolve();
    lastHeartbeatAt = now;
  }

  let pending: Promise<unknown>;
  try {
    // ★ The same defence `errorLogger` carries: a fixture that mocks
    //   `supabase` without an `rpc` must not throw synchronously past the
    //   catch below.
    if (typeof supabase?.rpc !== 'function') {
      pending = Promise.resolve();
    } else {
      pending = Promise.resolve(
        supabase.rpc('bp_record_client_build', {
          p_build: BUILD_SHA,
          p_display_mode: currentDisplayMode(),
          p_built_at: BUILT_AT || null,
          p_user_agent:
            typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 400),
          p_notice_event: event ?? null,
        }),
      );
    }
  } catch (syncErr) {
    pending = Promise.reject(syncErr);
  }

  return pending
    .then(() => undefined)
    .catch((err: unknown) => {
      // ★★ SILENT IN PRODUCTION, AND THAT IS NOT A SHRUG. The migration ships
      //    unapplied, so today this is a 404 on every call. Logging it would
      //    fill Settings → Errors with a message about a feature that is
      //    working exactly as designed — and it would do it through the very
      //    table fix-587 needs to stay readable.
      if (import.meta.env.DEV) {
        console.warn('[clientBuild] bp_record_client_build failed', err);
      }
    });
}

// ---------------------------------------------------------------------------
// READING IT BACK
// ---------------------------------------------------------------------------

export interface ClientBuildRow {
  user_id: string;
  email: string | null;
  name: string | null;
  build: string;
  built_at: string | null;
  display_mode: DisplayMode;
  first_seen_at: string;
  last_seen_at: string;
  notice_shown_count: number;
  notice_first_shown_at: string | null;
  notice_dismissed_at: string | null;
  notice_reloaded_at: string | null;
}

/**
 * How far behind the current build a row is, in whole days, or `null` when
 * either side's build time is unknown.
 *
 * ★ "Current" is the VIEWER'S OWN bundle, not a server opinion — the admin
 *   reading this screen is by definition running something, and comparing to
 *   it is both honest and the thing they can act on. A viewer on a stale
 *   bundle sees small numbers, which is itself a true statement about what
 *   they are looking at.
 */
export function daysBehind(
  row: Pick<ClientBuildRow, 'built_at'>,
  currentBuiltAt: string = BUILT_AT,
): number | null {
  if (!row.built_at || !currentBuiltAt) return null;
  const theirs = Date.parse(row.built_at);
  const ours = Date.parse(currentBuiltAt);
  if (Number.isNaN(theirs) || Number.isNaN(ours)) return null;
  return Math.max(0, Math.floor((ours - theirs) / 86_400_000));
}

/** ★ The same ladder the ribbon climbs, applied to somebody else's row — so
 *  the admin screen and the person's own ribbon cannot disagree about what
 *  "stale" means. */
export function rowStep(row: Pick<ClientBuildRow, 'built_at'>): NoticeStep {
  return noticeStep(buildAgeDaysOf(row.built_at));
}

function buildAgeDaysOf(builtAt: string | null): number | null {
  if (!builtAt) return null;
  const t = Date.parse(builtAt);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** Re-exported so callers need one import for "how old is MY bundle". */
export { buildAgeDays };
