// ===========================================================================
// fix-614 (P-300 item 2) — THE ESTIMATE REACTS TO THE CORRECTION COUNT
// ===========================================================================
//
// Bobby, 2026-09-29: *"we got one correction this cycle, so the likelihood of
// it getting approved the next cycle is like 80 or 90%… whereas on cycle three,
// if we still had three reviewers and five or ten corrections, the chances of
// getting it approved the next round might be lower. So then it needs to create
// that next cycle."*
// Ruled 2026-09-30: *"i would likely be on the conservative side of
// percentages."* → the CAUTIOUS end of each percentage: the 80 % Wilson lower
// bound (z = 1.2816).
//
//   cautious chance ≥ 50 % → plan for the next round to be the last
//                             (the date can come EARLIER than the generic
//                             most-likely-cycle — the update Bobby described)
//   cautious chance < 50 % → plan one more round after the next
//
// ★★ RULES ALREADY RULED, encoded here and nowhere else:
//   · the cell is permit type × jurisdiction × bucket — never another city's
//     history (D-2026-05-20). A thin cell's wide range makes it cautious on its
//     own; an EMPTY cell → no adjustment ("no history for this city yet").
//   · a missing letter is UNKNOWN, never zero → no adjustment, and it says so.
//   · a hand-set target cycle always wins (fix-493).
//
// The history comes from `bp_correction_odds()` (migrations/fix_614_*); this
// module is pure so every rule above is unit-tested without a database.

/** One-sided 80 % — the cautious end of the range. */
export const CAUTIOUS_Z = 1.2816;

/** The decision line: at or above → the next round is planned as the last. */
export const NEXT_ROUND_LAST_AT = 0.5;

export type CorrectionBucket = '1' | '2-3' | '4-6' | '7-10' | '11+';

/** In words, for the sentence ("4–6"). */
export const BUCKET_WORDS: Readonly<Record<CorrectionBucket, string>> = {
  '1': '1',
  '2-3': '2–3',
  '4-6': '4–6',
  '7-10': '7–10',
  '11+': '11 or more',
};

/** ★ The twin of the SQL CASE in bp_correction_odds — a test pins both.
 *  A parsed letter with no correction items sits in the fewest bucket. */
export function bucketFor(count: number): CorrectionBucket {
  if (count <= 1) return '1';
  if (count <= 3) return '2-3';
  if (count <= 6) return '4-6';
  if (count <= 10) return '7-10';
  return '11+';
}

/** Wilson score lower bound for `successes` of `n`. 0 when n is 0. */
export function wilsonLowerBound(successes: number, n: number, z: number = CAUTIOUS_Z): number {
  if (n <= 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

// ---------------------------------------------------------------------------
// the payload and the per-permit signal
// ---------------------------------------------------------------------------

export interface CorrectionOddsCell {
  type: string;
  juris: string;
  bucket: CorrectionBucket;
  resolved_rounds: number;
  approved_next: number;
}

export interface CorrectionOddsPermit {
  permit_id: number;
  round: number;
  /** NULL = no parsed letter for that round (UNKNOWN, never zero). */
  correction_count: number | null;
}

export interface CorrectionOddsPayload {
  cells: CorrectionOddsCell[];
  permits: CorrectionOddsPermit[];
}

/** What the projection needs about one permit. */
export interface CorrectionSignal {
  /** The latest round N with corrections. */
  round: number;
  /** NULL = unknown (no parsed letter). */
  count: number | null;
  /** "Seattle Building Permits". */
  cellLabel: string;
  /** This permit's cell for its bucket; null when unknown or no history. */
  cell: { bucket: CorrectionBucket; resolvedRounds: number; approvedNext: number } | null;
}

export function cellLabelFor(type: string, juris: string): string {
  return `${juris} ${type}s`;
}

/** Build one permit's signal from the one-call payload. `null` when the permit
 *  has no correction round (nothing to react to). */
export function correctionSignalFor(
  payload: CorrectionOddsPayload | null | undefined,
  permit: { id: number; type: string | null },
  juris: string | null | undefined,
): CorrectionSignal | null {
  if (!payload || !permit.type) return null;
  const row = payload.permits.find((p) => p.permit_id === permit.id);
  if (!row) return null;
  const j = (juris ?? '').trim();
  const cellLabel = j ? cellLabelFor(permit.type, j) : `${permit.type}s`;
  if (row.correction_count == null) {
    return { round: row.round, count: null, cellLabel, cell: null };
  }
  const bucket = bucketFor(row.correction_count);
  const c = j
    ? payload.cells.find((x) => x.type === permit.type && x.juris === j && x.bucket === bucket)
    : undefined;
  return {
    round: row.round,
    count: row.correction_count,
    cellLabel,
    cell: c ? { bucket, resolvedRounds: c.resolved_rounds, approvedNext: c.approved_next } : null,
  };
}

// ---------------------------------------------------------------------------
// the one step the projection takes
// ---------------------------------------------------------------------------

export type CorrectionAdjust =
  | 'next_round_last'
  | 'one_more_round'
  | 'unknown_letter'
  | 'no_history';

export interface CorrectionFacts {
  correctionAdjust: CorrectionAdjust;
  correctionCount?: number;
  /** The cautious chance, as a whole percent. */
  nextRoundChancePct?: number;
  cellRounds?: number;
  cellLabel: string;
  /** "4–6" — the bucket the count fell in. */
  correctionBucket?: string;
}

export interface CorrectionAdjustInput {
  targetCycle: number;
  currentReviewCycle: number;
  signal: CorrectionSignal | null | undefined;
  /** A hand-set target cycle (fix-493) — always wins. */
  overridden: boolean;
}

/**
 * ★★★ The one step. Returns the (possibly) moved target cycle and what to say.
 * `facts: null` = nothing to say (no round, or the person set the cycle).
 */
export function adjustForCorrections(
  input: CorrectionAdjustInput,
): { targetCycle: number; facts: CorrectionFacts | null } {
  const { signal } = input;
  if (!signal || input.overridden) return { targetCycle: input.targetCycle, facts: null };

  if (signal.count == null) {
    return {
      targetCycle: input.targetCycle,
      facts: { correctionAdjust: 'unknown_letter', cellLabel: signal.cellLabel },
    };
  }
  if (!signal.cell || signal.cell.resolvedRounds <= 0) {
    return {
      targetCycle: input.targetCycle,
      facts: {
        correctionAdjust: 'no_history',
        correctionCount: signal.count,
        cellLabel: signal.cellLabel,
      },
    };
  }

  const chance = wilsonLowerBound(signal.cell.approvedNext, signal.cell.resolvedRounds);
  const base: Omit<CorrectionFacts, 'correctionAdjust'> = {
    correctionCount: signal.count,
    nextRoundChancePct: Math.round(chance * 100),
    cellRounds: signal.cell.resolvedRounds,
    cellLabel: signal.cellLabel,
    correctionBucket: BUCKET_WORDS[signal.cell.bucket],
  };
  const n = signal.round;
  if (chance >= NEXT_ROUND_LAST_AT) {
    // ★ May come in BELOW the generic most-likely cycle — that is the point.
    return {
      targetCycle: Math.max(input.currentReviewCycle, n + 1),
      facts: { correctionAdjust: 'next_round_last', ...base },
    };
  }
  return {
    targetCycle: Math.max(input.targetCycle, n + 2),
    facts: { correctionAdjust: 'one_more_round', ...base },
  };
}
