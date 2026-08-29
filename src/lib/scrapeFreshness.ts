// ===========================================================================
// ★★★ fix-433 — "did today's scrape run?", answered in Pacific time
// ===========================================================================
//
// Bobby, 2026-08-29: *"just once a day - if it didnt run, so we know that we
// need to go manually do it. or maybe around mid day, so we can run the morning
// one at least."*
//
// ★★★ THERE IS NO SCHEDULER AND THERE IS NOTHING STORED. The question is asked
// by whoever opens the Bridge, answered from one indexed row, and forgotten.
// The condition is TRUE until a run lands and then it is FALSE — no alert row,
// no "resolved" state, nothing to clean up. That is deliberate: P-069 is the
// open item about warnings that come back after being resolved, and it exists
// because somebody modelled a CONDITION as an EVENT. A derived predicate cannot
// have that bug, because there is no record of it having fired.
//
// ★★★ MIDDAY IS THE DESIGN, NOT A PREFERENCE, AND IT WAS MEASURED. The morning
// scrape is scheduled 07:30 PT. Arrival of the first audit_log row of the day,
// in Pacific, measured on prod 2026-08-29:
//
//     08-19  08:29      08-24  08:39      08-27  10:42
//     08-20  08:31      08-25  08:46      08-28  16:42  ← no morning run at all
//     08-21  08:30      08-26  09:24
//
// So the run is routinely up to 3h12m late and GitHub has dropped whole runs.
// Noon leaves ~4.5 hours of grace — it cannot cry wolf about a late run — and
// it still lands early enough that somebody can trigger a manual run and get
// the day's data. Alarming at 09:00 would be noise; alarming at 17:00 would be
// useless. A noon rule would have fired on 08-28 and stayed quiet every other
// weekday in that window.
//
// ★★★ THE TIMEZONE TRAP IS REAL AND IT IS THE WHOLE REASON THIS FILE EXISTS.
// The last run on 2026-08-28 wrote at 20:11 PT, which is 03:11 UTC on the 29th.
// A UTC "today" would file that run under TOMORROW and then stay silent on the
// 29th — silent on exactly the day it is supposed to speak. Every date question
// here is asked of `Intl.DateTimeFormat` with an explicit `timeZone`, so the
// answer does not depend on where the browser thinks it is. Nothing in this
// file reads `getHours`, `getDay` or `getDate`.
//
// ★★ WEEKDAYS ONLY. The workflow cron is `* * 1-5`; a silent Saturday is the
// system working, not an outage. Checked FIRST, so a weekend is quiet whatever
// else is true.

/** The one timezone this feature is asked in. */
export const PACIFIC_TZ = 'America/Los_Angeles';

/**
 * ★★★ The hour, in Pacific, from which a missing run is worth saying out loud.
 * See the arithmetic above — this number is ~4.5h of grace over a 07:30 cron
 * whose worst observed arrival was 10:42.
 */
export const MISSED_SCRAPE_HOUR_PT = 12;

/** `audit_log.action` values written by a scrape run all share this prefix.
 *  Every run writes 38–506 of them, so the presence of ONE is evidence a run
 *  happened; a run that died before writing anything reads as "did not run",
 *  which is the correct alarm — it needs the same manual re-run. */
export const SCRAPE_ACTION_PREFIX = 'scrape';

/** The `weekday: 'short'` values `en-US` produces. A type, not a runtime
 *  array — nothing iterates the days, the rule only ever asks "is this one of
 *  the two". */
export type PacificWeekday =
  | 'Sun'
  | 'Mon'
  | 'Tue'
  | 'Wed'
  | 'Thu'
  | 'Fri'
  | 'Sat';

export interface PacificParts {
  /** `YYYY-MM-DD` as Pacific sees it — the local-midnight-to-local-midnight
   *  bucket the whole rule is expressed in. */
  dayKey: string;
  /** 0–23, Pacific. */
  hour: number;
  minute: number;
  weekday: PacificWeekday;
}

// ★ Built once. Constructing an Intl formatter is the expensive part, and these
//   are called on every render of the banner.
const PART_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const LONG_DAY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  weekday: 'long',
});

const SHORT_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  month: 'short',
  day: 'numeric',
});

/** Break a moment into the Pacific calendar/clock fields the rule needs.
 *  Host timezone is irrelevant — the formatter carries the zone. */
export function pacificParts(at: Date): PacificParts {
  const parts = PART_FMT.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
    // ★ `% 24` because some ICU builds render midnight as "24" under h23's
    //   older cousins; cheap insurance on a value the whole rule turns on.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: (get('weekday') as PacificWeekday) ?? 'Mon',
  };
}

/** Saturday or Sunday in Pacific. */
export function isPacificWeekend(at: Date): boolean {
  const { weekday } = pacificParts(at);
  return weekday === 'Sat' || weekday === 'Sun';
}

/** Whole calendar days between two `YYYY-MM-DD` keys (b − a). Parsed as UTC
 *  midnights purely as arithmetic on already-Pacific dates — no zone is being
 *  applied here, the keys are the answer already. */
export function dayKeyDiff(a: string, b: string): number {
  const parse = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((parse(b) - parse(a)) / 86_400_000);
}

export type ScrapeFreshnessReason =
  /** The answer has not arrived yet. Distinct from every other silence: it is
   *  the one that is temporary, and it must never be confused with
   *  "nothing has ever been recorded" — see useScrapeFreshness. */
  | 'loading'
  | 'weekend'
  | 'ran_today'
  | 'before_noon'
  | 'missed';

export interface ScrapeFreshness {
  /** The one thing callers act on: say it, or stay quiet. */
  missed: boolean;
  /** WHY it is quiet, so a reader (and a test) can tell the three silences
   *  apart. A boolean alone cannot. */
  reason: ScrapeFreshnessReason;
  /** The last scrape moment, or null when nothing has ever been recorded. */
  lastRun: Date | null;
  /** Pacific `YYYY-MM-DD` for `now` — also the dismissal key, so a dismissal
   *  expires when the day does. */
  todayKey: string;
  /** ★ The moment the verdict was taken, carried WITH the verdict. The wording
   *  ("yesterday at 5:01pm") and the verdict must be computed against the same
   *  instant, or a render that straddles midnight can say "no scrape today"
   *  above a phrase that calls the same run "today". */
  now: Date;
}

export interface ScrapeFreshnessInput {
  /** ISO timestamp of the newest `scrape%` row in `audit_log`, or null. */
  lastScrapeAt: string | null | undefined;
  now: Date;
}

/**
 * ★★★ THE RULE. Evaluated live, every render; nothing is remembered.
 *
 * Quiet on a weekend (the cron does not run), quiet once a run has landed
 * today, quiet before noon Pacific (a late run is not a missing one), and
 * otherwise it says so.
 *
 * ★ Weekend is checked FIRST so a Saturday is quiet regardless of anything
 *   else — including a Friday-evening run that never landed on Saturday.
 */
export function evaluateScrapeFreshness({
  lastScrapeAt,
  now,
}: ScrapeFreshnessInput): ScrapeFreshness {
  const today = pacificParts(now);
  const parsed = lastScrapeAt ? new Date(lastScrapeAt) : null;
  const lastRun =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const base = { lastRun, todayKey: today.dayKey, now };

  if (today.weekday === 'Sat' || today.weekday === 'Sun') {
    return { ...base, missed: false, reason: 'weekend' };
  }
  if (lastRun && pacificParts(lastRun).dayKey === today.dayKey) {
    return { ...base, missed: false, reason: 'ran_today' };
  }
  if (today.hour < MISSED_SCRAPE_HOUR_PT) {
    return { ...base, missed: false, reason: 'before_noon' };
  }
  return { ...base, missed: true, reason: 'missed' };
}

/** "5:01pm" / "8:39am" — Pacific wall-clock, lowercase, no leading zero. */
export function formatPacificClock(at: Date): string {
  const { hour, minute } = pacificParts(at);
  const suffix = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')}${suffix}`;
}

/**
 * ★★★ "yesterday at 5:01pm" — AND THE CLOCK TIME IS THE STORED ONE.
 *
 * The day word is relative (it is how people speak), but the TIME is never
 * computed as an elapsed span: a tab left open overnight would turn "2 hours
 * ago" into a lie, whereas "5:01pm" stays true forever. Anything older than
 * yesterday drops the relative word entirely and names the day.
 */
export function lastScrapePhrase(lastRun: Date | null, now: Date): string | null {
  if (!lastRun) return null;
  const clock = formatPacificClock(lastRun);
  const diff = dayKeyDiff(pacificParts(lastRun).dayKey, pacificParts(now).dayKey);
  if (diff <= 0) return `today at ${clock}`;
  if (diff === 1) return `yesterday at ${clock}`;
  if (diff < 7) return `on ${LONG_DAY_FMT.format(lastRun)} at ${clock}`;
  return `on ${SHORT_DATE_FMT.format(lastRun)} at ${clock}`;
}

/** ★ Plain language, per the brief: not "stale", not "heartbeat", no cron
 *  strings. Somebody who has never heard of GitHub Actions has to be able to
 *  act on this. */
export const MISSED_SCRAPE_HEADLINE = 'No permit scrape has run today.';

/** The second half — when the last one was, or an honest admission that there
 *  is no record of one at all. */
export function missedScrapeDetail(freshness: ScrapeFreshness): string {
  // ★ The instant comes off the verdict, never from a fresh `new Date()` here.
  //   The banner holds a ticking clock and the rule was evaluated against it;
  //   a second, fractionally different reading is how the sentence and the
  //   verdict end up disagreeing across a midnight boundary.
  const phrase = lastScrapePhrase(freshness.lastRun, freshness.now);
  return phrase
    ? `The last one finished ${phrase}.`
    : 'There is no record of an earlier run.';
}

/** What to do about it. Kept separate from the fact so the triage entry can
 *  show it and the one-line banner can stay one line. */
export const MISSED_SCRAPE_ACTION =
  'Nothing has updated the permits today — start a run manually if the day’s data is needed.';

// ===========================================================================
// Session dismissal
// ===========================================================================
//
// ★★ MODULE-LEVEL, NOT COMPONENT STATE, AND fix-424 IS WHY. `AuthGuard` swaps
// the whole shell subtree for "Reconnecting…" on a session verify, which
// unmounts the banner; a dismissal held in `useState` would come back a few
// minutes later on a window left open all day. Held here, a remount re-reads
// the fact.
//
// ★★ KEYED BY THE PACIFIC DAY, so it expires the way the condition does. A tab
// open across midnight that was dismissed yesterday is not dismissed today —
// which is the C3 requirement ("it must return while the condition holds")
// honoured for the one case a page reload would not cover.
let dismissedDayKey: string | null = null;

export function readMissedScrapeDismissal(): string | null {
  return dismissedDayKey;
}

export function dismissMissedScrapeFor(dayKey: string): void {
  dismissedDayKey = dayKey;
}

/** Tests only — the module fact outlives a render tree by design. */
export function resetMissedScrapeDismissal(): void {
  dismissedDayKey = null;
}
