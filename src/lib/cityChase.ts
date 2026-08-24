import { AGING_LADDER, cityTargetChaseable, nextBusinessDay } from './boardAging';
import {
  TERMINAL_NEGATIVE_STATUSES,
  TERMINAL_POSITIVE_STATUSES,
} from './permitTerminalStatus';

// ===========================================================================
// ★★★ fix-395 — THE CHASE IS A PROMPT NOBODY OWNS. MAKE IT A TASK.
// ===========================================================================
//
// From the register: fix-305b, the 7-day chase task, never built. And the
// incident that makes it real: BLD2026-0770 sat 41 days with nobody answering
// the city.
//
// fix-305 built the ladder — `cityTargetChaseable` (the city's target plus one
// BUSINESS day of grace) and the board's "blocked on you, go chase" section.
// But a prompt is something you LOOK AT, and the person who needed to look was
// not looking. The fix is the one the lifecycle engine already uses everywhere
// else: when the condition persists, mint a real task with a real owner.
//
// ---------------------------------------------------------------------------
// ★★★ WHERE THE 7-DAY CLOCK LIVES: NOWHERE. IT IS DERIVED, NOT STORED.
// ---------------------------------------------------------------------------
//
// "Continuously chaseable" sounds like it needs a state table tracking when the
// condition started and whether it ever lapsed. It does not, and the reason is
// worth stating because it is what makes this ticket cheap:
//
//   ★★★ CHASEABILITY IS MONOTONIC IN `today`. `cityTargetChaseable(target, t)`
//   is `t >= nextBusinessDay(target)`. Once true for a given target it can
//   NEVER become false again while that target stands. So the only thing that
//   can break continuity is the TARGET CHANGING — and that is exactly what the
//   anchor keys on.
//
// The clock therefore lives in the data: the day it first became true is
// `nextBusinessDay(city_target)`, computable from the target alone, with no
// history and nothing to keep in sync. `chaseableSince` below is that day.
//
// ★★ THE 7 DAYS RIDE ON TOP OF THE LADDER, they do not replace it. The rung is
// `AGING_LADDER.task` (7) — fix-305's own constant, imported rather than
// restated — applied to the CHASEABLE clock rather than to the target date.
// The two differ by the grace: a Friday target is chaseable on Monday, so day 7
// of chaseable is day 10 after the target.
//
// ★★★ AND THE GRACE/WEEKEND RULES ARE NOT REIMPLEMENTED HERE. `nextBusinessDay`
// and `cityTargetChaseable` are imported from boardAging. One concept, one
// function — if the city ever changes what grace means, it changes in one file
// and this follows automatically.

/** The `permit_tasks.auto_event` value for a chase task. */
export const CITY_CHASE_EVENT = 'city_target_chase';

/**
 * ★★★ THE DAY-ONE RULE, AND IT IS fix-305'S OWN.
 *
 * Measured on prod 2026-08-24: 20 permits are chaseable 7+ days TODAY and pass
 * every silence gate. A first sweep run would mint all 20 at once — 16 of them
 * onto Miles. That is fix-337's wall of red re-served as a to-do list, and it
 * is how a good feature gets ignored inside a week.
 *
 * So the engine ships LIVE FOR NEW CROSSINGS ONLY: a permit mints only if it
 * FIRST became chaseable strictly after this epoch. The 20 that are already
 * past the trigger are reported to Bobby and minted by nobody.
 *
 * ★★ This is not a new idea — it is `AGING_DEPLOY_EPOCH` / `mayCreateTask` from
 * boardAging.ts, which exists for exactly this reason ("nothing auto-creates a
 * task retroactively"). Same rule, same shape, one rung further along.
 *
 * ★ A date, not a timestamp, because `chaseableSince` is a date. Comparison is
 * strictly greater-than: a target that became chaseable ON the epoch is part of
 * the pre-existing population, not a new crossing.
 */
export const CITY_CHASE_EPOCH = '2026-08-24';

/**
 * ★ The day a city target FIRST became chaseable — the start of the 7-day
 * clock. One business day after the target, weekend-aware, straight from
 * fix-305.
 */
export function chaseableSince(cityTarget: string): string {
  return nextBusinessDay(cityTarget);
}

/** Whole days a target has been chaseable, as of `today`. Negative before the
 *  grace expires; callers gate on `cityTargetChaseable` first. */
export function daysChaseable(cityTarget: string, today: string): number {
  const a = Date.parse(`${chaseableSince(cityTarget)}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Whole days since the city's target itself — what the task TITLE says, and
 *  deliberately not what the trigger measures. "target was X, N days ago" is
 *  ordinary English about the target; the trigger counts chaseable days. */
export function daysSinceTarget(cityTarget: string, today: string): number {
  const a = Date.parse(`${cityTarget}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// ★★★ THE STATUS VOCABULARY — TWO ENUMERATED CLOSED SETS, NEVER A SUBSTRING
// ---------------------------------------------------------------------------
//
// fix-388's rule, applied again: status vocabulary is scraper output and
// jurisdiction-specific, so a fuzzy match (/review|correct/) is how a future
// status quietly changes hundreds of rows with nobody reviewing it. Every value
// below was read off prod on 2026-08-24 with its unissued-with-a-city-target
// count, and classified one at a time.
//
// ★★★ AND THE ASYMMETRY IS THE OPPOSITE OF fix-388'S, ON PURPOSE.
//
// fix-388 erred toward NOISE: an unlisted status keeps its chips firing,
// because a false chip is merely annoying while a silently killed true chip is
// invisible. A TASK IS NOT A CHIP. It lands on a named person's list, competes
// with 212 already-overdue tasks, and a wrong one costs that person's trust in
// the whole feature. So here, WHEN UNSURE, DO NOT MINT.
//
// ★★ Nothing is hidden by that choice: fix-305's ladder prompt still shows
// every one of these on the board, ranked by age, exactly as it does today.
// Withholding the ESCALATION is not withholding the information.

/**
 * ★★★ Statuses that mean THE CITY HAS ALREADY PRODUCED ITS ANSWER for this
 * round. There is nothing to chase: the ball is on our side of the net.
 *
 * Read as: "the city could not be saying this unless it had finished looking."
 */
export const STATUS_CITY_HAS_RESPONDED: ReadonlySet<string> = new Set([
  // ★★★ The corrections family — 50 unissued permits carry a city target
  // between them, the single largest group. The city reviewed and handed work
  // back; chasing it would be asking for something we already have.
  'Corrections Required', // 37
  'Awaiting Information', // 11
  'Awaiting Corrections', // 2
  'Additional Info Requested', // 0 with a target, but the same act
  // The city finished this round and said so.
  'Reviews Completed', // 5
  'Final Reviews Completed', // 1
  'Ready To Issue', // 1
  'Approved - Additional Information', // 1
  // ★★ Land use publication. A LU application is published for comment only
  // AFTER the city accepts it, so publication IS the city's answer to the
  // review target. 16 permits — the second largest group, and the one most
  // likely to be argued with, which is why it is called out rather than buried.
  'Published', // 14
  'Ready for Publication', // 2
  // ★ The city asked us for a document. Same shape as the corrections family:
  // an ask is an answer.
  'Document Required', // 1
  // ★★ Terminal-NEGATIVE. 'Withdrawn' is composed from fix-388's set below;
  // 'Application Withdrawn' is a SECOND prod spelling that fix-388's set does
  // not carry (1 permit). It is listed here rather than added to
  // permitTerminalStatus.ts, because widening that set would change board
  // behaviour well beyond this ticket. Reported, not silently fixed.
  'Application Withdrawn', // 1
  // ★ Finished at the portal in the last sense the vocabulary has.
  'Finaled',
  // ★★ And every terminal-POSITIVE status by construction — a permit the city
  // has finished with has self-evidently answered. Composed from
  // permitTerminalStatus.ts rather than re-typed, so the two cannot drift.
  ...TERMINAL_POSITIVE_STATUSES,
  ...TERMINAL_NEGATIVE_STATUSES,
]);

/**
 * ★★ Statuses that mean the set is NOT WITH THE CITY YET, so a city review
 * target on the row is contradictory data rather than a promise to chase.
 *
 * ★ These are fix-388's own TRUE positives for "has the set gone in" — the
 * statuses it was careful NOT to absorb. 5 permits carry both a pre-submittal
 * status and a city target today; chasing the city on a set we have not filed
 * would be the most embarrassing possible false alarm.
 *
 * ★ 'Initiated' is ambiguous — fix-388 left it out of its set for exactly that
 * reason. Under this file's inverted asymmetry, ambiguous means DO NOT MINT, so
 * it is listed here.
 */
export const STATUS_NOT_WITH_CITY: ReadonlySet<string> = new Set([
  'Pre-Submittal — GO', // 4
  'Pre-Submittal — Kickoff', // 1
  'Ready for Intake', // 0 with a target — booked is not submitted (fix-388)
  'Scheduled', // 0 with a target — a slot in a calendar, not a delivery
  'Initiated', // 2 — ambiguous, so withheld
]);

/** ★ Does the city still owe us a review on this status? Exact match after
 *  trimming, case-sensitive on purpose: the scraper writes these strings
 *  verbatim, so a case difference means a NEW status somebody should look at
 *  rather than one to silently absorb. A status in NEITHER set is one the city
 *  is still working (`Reviews In Process`, `In Review`, `Under Review`,
 *  `Applied`, `In Process`, `Application Completed`, `Corrections Submitted`)
 *  and IS chaseable. */
export function cityOwesReview(status: string | null | undefined): boolean {
  const s = (status ?? '').trim();
  if (!s) return true; // a blank status hides nothing; the other gates decide
  return !STATUS_CITY_HAS_RESPONDED.has(s) && !STATUS_NOT_WITH_CITY.has(s);
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Why a permit did NOT get a chase task. `null` means it did. */
export type ChaseBlockReason =
  | 'no_target'
  | 'not_yet_chaseable'
  | 'below_ladder'
  | 'pre_epoch'
  | 'issued'
  | 'city_responded'
  | 'sub_permit'
  | 'held'
  | 'cancelled'
  | 'backfill';

export interface ChaseInput {
  /** The permit's CURRENT (latest) cycle target. */
  cityTarget: string | null | undefined;
  status: string | null | undefined;
  /** Dates win over status, boardAging's own rule. */
  approvalDate?: string | null;
  actualIssue?: string | null;
  /** The current cycle's corrections date — the city answered this round. */
  corrIssued?: string | null;
  /** fix-305's ladder skips these; so does the escalation. */
  isSubPermit?: boolean;
  /** fix-390/391 — held at EITHER scope. */
  isHeld?: boolean;
  /** fix-262 */
  isCancelledProject?: boolean;
  /** fix-386 — `projects.is_backfill`. NULL means NOT RECORDED, never false. */
  isBackfillProject?: boolean | null;
  today: string;
  /** Overridable for tests; defaults to the shipped epoch. */
  epoch?: string;
}

export interface ChaseDecision {
  mint: boolean;
  reason: ChaseBlockReason | null;
  daysChaseable: number;
  daysSinceTarget: number;
  /** The idempotency anchor — the city_target VALUE, per fix-298. */
  anchor: string | null;
}

/**
 * ★★★ Should this permit get a chase task today?
 *
 * ★★ THE ORDER OF THE GATES IS THE RULE, and it runs cheapest-and-most-certain
 * first so that the `reason` a caller reads back is the most informative one.
 * The silence gates (fix-390/391 hold, fix-262 cancel, fix-386 backfill) sit
 * BELOW the "is there anything to chase at all" gates on purpose: a held permit
 * with no target was never a candidate, and reporting it as `held` would
 * overstate what the hold is doing.
 *
 * ★★★ EVERY GATE COMPOSES — none of them replaces another. A permit must clear
 * all ten to mint.
 */
export function chaseDecision(input: ChaseInput): ChaseDecision {
  const target = (input.cityTarget ?? '').trim() || null;
  const nil: ChaseDecision = {
    mint: false,
    reason: 'no_target',
    daysChaseable: 0,
    daysSinceTarget: 0,
    anchor: null,
  };
  if (!target) return nil;

  const dc = daysChaseable(target, input.today);
  const dst = daysSinceTarget(target, input.today);
  const no = (reason: ChaseBlockReason): ChaseDecision => ({
    mint: false,
    reason,
    daysChaseable: dc,
    daysSinceTarget: dst,
    anchor: target,
  });

  // 1. The grace has to have expired at all — fix-305's predicate, called.
  if (!cityTargetChaseable(target, input.today)) return no('not_yet_chaseable');
  // 2. ...and then the ladder's task rung, on the chaseable clock.
  if (dc < AGING_LADDER.task) return no('below_ladder');
  // 3. ★★★ The day-one rule. New crossings only.
  if (chaseableSince(target) <= (input.epoch ?? CITY_CHASE_EPOCH)) {
    return no('pre_epoch');
  }
  // 4. Issued is finished, whatever anything else says (boardAging's rule, and
  //    bp_create_lifecycle_task refuses these independently anyway).
  if (input.actualIssue) return no('issued');
  // 5. ★★ The city has answered — by DATE first, then by status. Approval and
  //    corrections are dates the city wrote; the status set is the half fix-388
  //    proved the board was ignoring.
  if (input.approvalDate) return no('city_responded');
  if (input.corrIssued) return no('city_responded');
  if (!cityOwesReview(input.status)) return no('city_responded');
  // 6. ★ Sub-permits: whatever the ladder does. buildAging skips them
  //    (`parent_permit_id != null`), so the escalation skips them too.
  if (input.isSubPermit) return no('sub_permit');
  // 7-9. ★★★ THE SILENCE GATES COMPOSE. A paused or dead permit is not
  //    chaseable — you cannot be late for work that is deliberately stopped.
  if (input.isHeld) return no('held');
  if (input.isCancelledProject) return no('cancelled');
  // ★ fix-386: nullable means NOT RECORDED. Only an explicit `true` suppresses;
  //   null and false both mint.
  if (input.isBackfillProject === true) return no('backfill');

  return { mint: true, reason: null, daysChaseable: dc, daysSinceTarget: dst, anchor: target };
}

/**
 * The task title. ★ Mirrors the SQL in
 * migrations/fix_395_city_target_chase_task.sql — the twin a test pins.
 *
 * ★ "N days ago" counts from the TARGET, not from the chaseable day: it is
 * ordinary English about the date it names, and a reader comparing the two
 * numbers would rightly be confused if "target was 12 Aug" were followed by a
 * count that started on the 13th.
 */
export function chaseTaskTitle(
  cityTarget: string,
  today: string,
  numLabel: string,
): string {
  const n = daysSinceTarget(cityTarget, today);
  return `Chase the city — target was ${cityTarget}, ${n} day${n === 1 ? '' : 's'} ago — ${numLabel}`;
}
