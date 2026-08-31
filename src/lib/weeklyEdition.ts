import { pacificParts, dayKeyDiff } from './scrapeFreshness';

// ===========================================================================
// ★★★ fix-463 §B1 (P-108) — THE EDITION, AND IT FIRES ON A CLOCK
// ===========================================================================
//
// Bobby, on why a login cannot be the trigger:
//   *"the tool is, like, always logged in… if they don't ever restart their PC,
//    then they're technically not logging in. Is there a way that this can fire
//    automatically, like Wednesday at midnight, so that when they wake up their
//    computer that's the first thing that they see on the bridge until they
//    acknowledge it?"*
//
// ★★★ SO AN EDITION IS NOT A ROW ANYBODY CREATES. It is a NAME derived from the
// clock: the Wednesday that has most recently begun in Pacific. Nothing has to
// run at midnight, nothing can fail to run, and a tab that was open all week
// computes the same name as a browser opened fresh on Thursday. A scheduled job
// would have introduced a thing that can silently not happen.
//
// ---------------------------------------------------------------------------
// ★★★ WHY PACIFIC AND NOT UTC, MEASURED
// ---------------------------------------------------------------------------
// A UTC week boundary publishes Wednesday's edition at **5pm Pacific on
// Tuesday** — the meeting has not happened, and the people it is for are still
// working through Tuesday. fix-433 shipped this app's first timezone handling
// for the same class of mistake ("a UTC today goes silent on exactly the day it
// must speak"), and its `pacificParts` is reused here rather than a second
// zone-aware path being written.

/** ★ The edition key: the ISO date of the Wednesday whose 00:00 Pacific has
 *  most recently passed. `2026-09-02` names the edition that begins on
 *  Wednesday 2 September and stays current until the next Wednesday. */
export type EditionKey = string;

/**
 * The edition current at `now`.
 *
 * ★★ IT IS THE MOST RECENT WEDNESDAY, INCLUSIVE OF TODAY. On Wednesday itself
 * — at 00:01 or at 23:59 — the answer is today, because the edition begins at
 * Wednesday 00:00 Pacific. On Tuesday it is still LAST Wednesday's, which is
 * the property that keeps a UTC-evening-Tuesday clock from publishing early.
 */
export function currentEdition(now: Date = new Date()): EditionKey {
  const { dayKey, weekday } = pacificParts(now);
  // Days since the most recent Wednesday, 0 when today IS Wednesday.
  const back: Record<string, number> = {
    Wed: 0,
    Thu: 1,
    Fri: 2,
    Sat: 3,
    Sun: 4,
    Mon: 5,
    Tue: 6,
  };
  const days = back[weekday] ?? 0;
  return shiftDayKey(dayKey, -days);
}

/** ★ `YYYY-MM-DD` arithmetic on a key that is ALREADY Pacific. Parsed as a UTC
 *  midnight purely so the arithmetic is exact — no zone is being applied, the
 *  key is the answer already. Same reasoning as `dayKeyDiff`. */
export function shiftDayKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * ★★★ §B3 — THE ACKNOWLEDGEMENT KEY, AND IT REUSES `board_item_reads`.
 *
 * fix-307's table is per-user, own-rows-only, SELECT + INSERT, and idempotent
 * (`ON CONFLICT DO NOTHING` — reading twice is the same fact). That is exactly
 * the shape this needs, so no second table and no migration.
 *
 * ★★ fix-350 created `whats_new_reads` as a SEPARATE table rather than a
 * `whatsnew:<id>` key here, and its reason does not apply: it needed a real FK
 * cascade to an entry row. **An edition has no row to cascade from** — it is a
 * name computed from the clock — so the namespaced key is right, and inventing
 * a table would be a second mechanism for one fact.
 *
 * ★ SERVER-SIDE, NEVER `localStorage`: Bobby works on more than one machine,
 * and an acknowledgement stuck in one browser re-shows the modal on the next.
 */
export function editionReadKey(edition: EditionKey): string {
  return `weekly-update:${edition}`;
}

/** How many days into the edition we are — for "published Wednesday, it is now
 *  Friday" copy. Never negative. */
export function editionAgeDays(
  edition: EditionKey,
  now: Date = new Date(),
): number {
  return Math.max(0, dayKeyDiff(edition, pacificParts(now).dayKey));
}
