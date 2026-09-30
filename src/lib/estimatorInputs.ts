import type { DurationClock, DurationStatRow, LadderAnswer, PolicyRow } from './durationLadder';
import { walkLadder } from './durationLadder';

// ===========================================================================
// fix-585 §7 — DEGRADE, NEVER GUESS SILENTLY
// ===========================================================================
//
// Bobby, 2026-09-16: *"What if there are no corrections in the folder, how will
// it estimate? Does it go back to defaults? If a piece of the puzzle is missing
// that makes the picture, how does it fill in that gap to proceed?"*
//
// ★★★ THE HOLE IS THE MAJORITY CASE, not an edge: most permits sitting on a
//     correction have no parsed letter (see the PR for today's count). So every
//     input the forecast needs is resolved here through ONE named chain, and
//     every answer carries
//       1. the RUNG that answered,
//       2. a CONFIDENCE  — measured → learned → policy → assumed,
//       3. what was MISSING on the way down.
//     The sentence for each answer is `inputSentence` in estimatorRouteCopy.ts —
//     the same module that already explains the route, extended, not copied.
//
// ★★★ NO ANCHOR MEANS NO NUMBER. `resolveAnchorDate` bottoming out returns
//     `value: null` and the estimate must not be produced. A bare
//     `today + policy` looks exactly like a number with evidence behind it —
//     the 210-day constant was quietly wrong for months because it always
//     answered.
//
// ★★ NOT WIRED INTO THE WIDGET IN THIS TICKET. projectedApproval.ts is off
//    limits (brief §6) and the client rewire is its own ticket, so a wrong
//    number has one suspect. This module is pure and fully pinned by tests.

export type Confidence = 'measured' | 'learned' | 'policy' | 'assumed';

/** ★ Highest first. A lower rung may never report a higher confidence. */
export const CONFIDENCE_ORDER: readonly Confidence[] = ['measured', 'learned', 'policy', 'assumed'];

export type EstimatorInput =
  | 'correction_items'
  | 'anchor_date'
  | 'city_review'
  | 'our_turnaround'
  | 'city_target';

export interface InputResolution<T> {
  input: EstimatorInput;
  /** `null` = no answer. Only the anchor, the per-cycle clocks and the city
   *  target may end here; the item count never does (and never at zero). */
  value: T | null;
  rung: string;
  confidence: Confidence | null;
  /** The inputs that were absent on the way down, in chain order. */
  missing: string[];
  /** ★ The estimator's gaps and the indexer's gaps are the same rows: an
   *  unparsed letter belongs on `indexer_missing_letter_current`. */
  worklist?: 'indexer_missing_letter';
  /** Ladder detail when a learned/policy rung answered — for the sentence. */
  ladder?: LadderAnswer;
}

// ---------------------------------------------------------------------------
// correction item count
// ---------------------------------------------------------------------------

/** ★ The last-resort assumption when nothing about the letter is known. It is
 *  an ASSUMPTION, labelled as one — never zero, because zero open items reads
 *  as "approved". Deliberately a small nonzero number: it says "there is a
 *  correction round" without pretending to know its size. */
export const ASSUMED_CORRECTION_ITEMS = 5;

export interface CorrectionItemsFacts {
  /** The latest cycle has a correction letter issued (`corr_issued`). */
  letterIssued: boolean;
  /** The letter was parsed into items. `false` with `letterIssued` = UNKNOWN. */
  letterParsed: boolean;
  /** Parsed item count for this cycle (meaningful only when parsed). */
  parsedItems: number;
  /** Parsed counts from this permit's earlier cycles, oldest first. */
  priorCycleItems?: readonly number[];
  /** Learned median items for (type × juris × cycle), when known. */
  cohortMedianItems?: number | null;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

export function resolveCorrectionItems(f: CorrectionItemsFacts): InputResolution<number> {
  if (!f.letterIssued) {
    // No letter this cycle: nothing to count, and nothing is missing.
    return { input: 'correction_items', value: 0, rung: 'no_letter', confidence: 'measured', missing: [] };
  }
  if (f.letterParsed) {
    return { input: 'correction_items', value: f.parsedItems, rung: 'this_letter', confidence: 'measured', missing: [] };
  }
  const missing = ['parsed correction letter'];
  const worklist = 'indexer_missing_letter' as const;
  const prior = (f.priorCycleItems ?? []).filter((n) => Number.isFinite(n) && n > 0);
  if (prior.length > 0) {
    return {
      input: 'correction_items', value: Math.max(1, median(prior)), rung: 'prior_cycles',
      confidence: 'learned', missing, worklist,
    };
  }
  missing.push('earlier letters on this permit');
  if (f.cohortMedianItems != null && f.cohortMedianItems > 0) {
    return {
      input: 'correction_items', value: Math.max(1, Math.round(f.cohortMedianItems)), rung: 'cohort',
      confidence: 'learned', missing, worklist,
    };
  }
  missing.push('history for similar permits');
  return {
    input: 'correction_items', value: ASSUMED_CORRECTION_ITEMS, rung: 'assumption',
    confidence: 'assumed', missing, worklist,
  };
}

// ---------------------------------------------------------------------------
// cycle anchor date
// ---------------------------------------------------------------------------

export interface AnchorFacts {
  /** Cycle 0 `intake_accepted`. */
  intakeAccepted: string | null;
  /** Cycle 1 `submitted`. */
  cycle1Submitted: string | null;
  /** `permits.intake_date`. */
  permitIntakeDate: string | null;
}

export function resolveAnchorDate(f: AnchorFacts): InputResolution<string> {
  if (f.intakeAccepted) {
    return { input: 'anchor_date', value: f.intakeAccepted, rung: 'intake_accepted', confidence: 'measured', missing: [] };
  }
  if (f.cycle1Submitted) {
    return {
      input: 'anchor_date', value: f.cycle1Submitted, rung: 'cycle1_submitted',
      confidence: 'measured', missing: ['intake accepted date'],
    };
  }
  if (f.permitIntakeDate) {
    return {
      input: 'anchor_date', value: f.permitIntakeDate, rung: 'permit_intake_date',
      confidence: 'measured', missing: ['intake accepted date', 'cycle-1 submitted date'],
    };
  }
  // ★★★ The hard rule: no anchor, no number. Not today + policy.
  return {
    input: 'anchor_date', value: null, rung: 'none', confidence: null,
    missing: ['intake accepted date', 'cycle-1 submitted date', 'permit intake date'],
  };
}

// ---------------------------------------------------------------------------
// city review / our turnaround, for one cycle
// ---------------------------------------------------------------------------

export interface ClockFacts {
  clock: Extract<DurationClock, 'city_review' | 'our_turnaround'>;
  type: string;
  juris: string | null;
  cycle: number;
  /** This permit's own completed durations on this clock (any cycle). */
  ownCompleted?: readonly number[];
  /** `bp_learned_durations()` rows. */
  learned: readonly DurationStatRow[];
  policy?: PolicyRow | null;
}

function confidenceForTier(tier: LadderAnswer['tier']): Confidence | null {
  switch (tier) {
    case 'policy':
      return 'policy';
    case 'hardcoded':
      return 'assumed';
    case 'none':
      return null;
    default:
      return 'learned';
  }
}

export function resolveClock(f: ClockFacts): InputResolution<number> {
  const own = (f.ownCompleted ?? []).filter((n) => Number.isFinite(n) && n >= 0);
  if (own.length > 0) {
    return { input: f.clock, value: median(own), rung: 'own_cycles', confidence: 'measured', missing: [] };
  }
  const ladder = walkLadder(f.learned, {
    type: f.type, juris: f.juris, clock: f.clock, cycle: f.cycle, policy: f.policy ?? null,
  });
  return {
    input: f.clock,
    value: ladder.days,
    rung: ladder.tier,
    confidence: confidenceForTier(ladder.tier),
    missing: ladder.days == null
      ? ['completed cycles on this permit', 'history for similar permits']
      : ['completed cycles on this permit'],
    ladder,
  };
}

// ---------------------------------------------------------------------------
// city target
// ---------------------------------------------------------------------------

export interface CityTargetFacts {
  /** The open cycle's stored `city_target`. */
  cityTarget: string | null;
  /** The jurisdiction's measured median slip past its stated target (days).
   *  `null` = not measured. ★ Kirkland meets its target ~5% of the time. */
  jurisSlipDays: number | null;
  /** The open cycle's `submitted` — the start of the city clock. */
  cycleSubmitted: string | null;
  /** The resolved city-review duration for this cycle. */
  cityReview: InputResolution<number>;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resolveCityTarget(f: CityTargetFacts): InputResolution<string> & { rawTargetSetAside: boolean } {
  if (f.cityTarget && f.jurisSlipDays != null) {
    return {
      input: 'city_target', value: addDays(f.cityTarget, Math.max(0, f.jurisSlipDays)),
      rung: 'target_plus_slip', confidence: 'learned', missing: [], rawTargetSetAside: false,
    };
  }
  // ★ A stored target WITHOUT a measured slip is not a forecast input. It is
  //   set aside, and the reader is told so.
  const rawTargetSetAside = Boolean(f.cityTarget);
  const missing = f.cityTarget ? ["the city's measured slip for this jurisdiction"] : ['city target date'];
  if (f.cycleSubmitted && f.cityReview.value != null) {
    return {
      input: 'city_target', value: addDays(f.cycleSubmitted, f.cityReview.value),
      rung: 'city_clock', confidence: f.cityReview.confidence, missing, rawTargetSetAside,
    };
  }
  return {
    input: 'city_target', value: null, rung: 'none', confidence: null,
    missing: [...missing, f.cycleSubmitted ? 'city review duration' : 'cycle submitted date'],
    rawTargetSetAside,
  };
}
