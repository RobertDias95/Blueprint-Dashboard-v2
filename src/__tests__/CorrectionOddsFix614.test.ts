import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeProjectedApproval } from '../lib/projectedApproval';
import { SCHEDULE_DEFAULTS, type LearnedEstimate } from '../lib/scheduleBenchmarks';
import type { Permit, PermitCycle, PermitCycleReviewer } from '../lib/database.types';
import {
  CAUTIOUS_Z,
  NEXT_ROUND_LAST_AT,
  adjustForCorrections,
  bucketFor,
  correctionSignalFor,
  wilsonLowerBound,
  type CorrectionOddsPayload,
  type CorrectionSignal,
} from '../lib/correctionOdds';
import { correctionSentence, routeSentence } from '../lib/estimatorRouteCopy';

// ===========================================================================
// fix-614 (P-300 item 2) — the estimate reacts to the correction count
// ===========================================================================
//
// Ruled 2026-09-30: the CAUTIOUS end — the 80 % Wilson lower bound. ≥ 50 % →
// the next round is planned as the last; < 50 % → one more round after it.

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'migrations/fix_614_correction_odds.sql'),
  'utf8',
).replace(/\r\n?/g, '\n');
const SQL = MIGRATION.split('\n').map((l) => (l.includes('--') ? l.slice(0, l.indexOf('--')) : l)).join('\n');

describe('fix-614 — the cautious chance (80 % Wilson lower bound)', () => {
  it('★★★ z is the one-sided 80 % value and the decision line is 50 %', () => {
    expect(CAUTIOUS_Z).toBe(1.2816);
    expect(NEXT_ROUND_LAST_AT).toBe(0.5);
  });

  it("★★★ the brief's five buckets (Cowork 2026-09-30) — within a point; its counts are back-derived from rounded %", () => {
    const pct = (s: number, n: number) => Math.round(100 * wilsonLowerBound(s, n));
    // "1 · 32 rounds · 66 %" → cautious 55 % → next round last
    expect(Math.abs(pct(21, 32) - 55)).toBeLessThanOrEqual(1);
    // "2–3 · 35 · 57 %" → 46 % → +1
    expect(pct(20, 35)).toBe(46);
    // "4–6 · 41 · 37 %" → 28 %
    expect(pct(15, 41)).toBe(28);
    // "7–10 · 41 · 17 %" → 11 %
    expect(pct(7, 41)).toBe(11);
    // "11+ · 48 · 15 %" → 10 %
    expect(Math.abs(pct(7, 48) - 10)).toBeLessThanOrEqual(1);
  });

  it('★★ exact values for exact counts (re-measured on prod 2026-10-01)', () => {
    const pct1 = (s: number, n: number) => Math.round(1000 * wilsonLowerBound(s, n)) / 10;
    expect(pct1(20, 32)).toBe(51.2); // Seattle BP, 1 correction → ≥ 50 %
    expect(pct1(16, 27)).toBe(47); // Seattle BP, 2–3 → < 50 %
    expect(pct1(3, 3)).toBe(64.6); // Kirkland BP, 2–3: thin, so wide, so cautious
    expect(wilsonLowerBound(0, 15)).toBe(0);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('★★ a thin cell is cautious on its own: 1-of-1 is nowhere near 100 %', () => {
    expect(wilsonLowerBound(1, 1)).toBeLessThan(0.4);
  });
});

describe('fix-614 — buckets are the SQL\'s buckets', () => {
  it('★★★ bucketFor matches the CASE in bp_correction_odds', () => {
    expect([1, 2, 3, 4, 6, 7, 10, 11, 40].map(bucketFor)).toEqual([
      '1', '2-3', '2-3', '4-6', '4-6', '7-10', '7-10', '11+', '11+',
    ]);
    expect(bucketFor(0)).toBe('1');
    expect(SQL).toMatch(
      /CASE WHEN n_corr <= 1\s+THEN '1'\s+WHEN n_corr <= 3\s+THEN '2-3'\s+WHEN n_corr <= 6\s+THEN '4-6'\s+WHEN n_corr <= 10\s+THEN '7-10'\s+ELSE '11\+' END AS bucket/,
    );
  });
});

// ---------------------------------------------------------------------------
// the signal and the one step
// ---------------------------------------------------------------------------

const PAYLOAD: CorrectionOddsPayload = {
  cells: [
    { type: 'Building Permit', juris: 'Seattle', bucket: '1', resolved_rounds: 32, approved_next: 20 },
    { type: 'Building Permit', juris: 'Seattle', bucket: '4-6', resolved_rounds: 41, approved_next: 15 },
  ],
  permits: [
    { permit_id: 1, round: 2, correction_count: 1 },
    { permit_id: 2, round: 2, correction_count: 5 },
    { permit_id: 3, round: 2, correction_count: null },
    { permit_id: 4, round: 1, correction_count: 5 },
  ],
};

describe('fix-614 — the signal never borrows another city', () => {
  it('★★★ Kirkland gets NO cell even though Seattle has one for the same bucket', () => {
    const s = correctionSignalFor(PAYLOAD, { id: 4, type: 'Building Permit' }, 'Kirkland')!;
    expect(s.cell).toBeNull();
    expect(s.cellLabel).toBe('Kirkland Building Permits');
  });

  it('★★★ a missing letter is UNKNOWN (null), never zero', () => {
    const s = correctionSignalFor(PAYLOAD, { id: 3, type: 'Building Permit' }, 'Seattle')!;
    expect(s.count).toBeNull();
    expect(s.cell).toBeNull();
  });

  it('★ a permit with no round, or no payload, has no signal', () => {
    expect(correctionSignalFor(PAYLOAD, { id: 99, type: 'Building Permit' }, 'Seattle')).toBeNull();
    expect(correctionSignalFor(null, { id: 1, type: 'Building Permit' }, 'Seattle')).toBeNull();
  });
});

const sig = (id: number, juris = 'Seattle') =>
  correctionSignalFor(PAYLOAD, { id, type: 'Building Permit' }, juris) as CorrectionSignal;

describe('fix-614 — adjustForCorrections, alone', () => {
  it('★★★ ≥ 50 % pulls the target to N+1 — BELOW the most-likely cycle', () => {
    const r = adjustForCorrections({ targetCycle: 4, currentReviewCycle: 3, signal: sig(1), overridden: false });
    expect(r.targetCycle).toBe(3); // N = 2 → 3, below the learner's 4
    expect(r.facts).toMatchObject({ correctionAdjust: 'next_round_last', nextRoundChancePct: 51, cellRounds: 32 });
  });

  it('★★★ < 50 % pushes to N+2', () => {
    const r = adjustForCorrections({ targetCycle: 3, currentReviewCycle: 3, signal: sig(2), overridden: false });
    expect(r.targetCycle).toBe(4);
    expect(r.facts).toMatchObject({ correctionAdjust: 'one_more_round', correctionCount: 5, correctionBucket: '4–6' });
    // …and never pulls an already-later target back
    expect(adjustForCorrections({ targetCycle: 6, currentReviewCycle: 3, signal: sig(2), overridden: false }).targetCycle).toBe(6);
  });

  it('★★★ a hand-set cycle wins — nothing moves and nothing is said', () => {
    expect(adjustForCorrections({ targetCycle: 2, currentReviewCycle: 3, signal: sig(2), overridden: true })).toEqual({
      targetCycle: 2,
      facts: null,
    });
  });

  it('★★★ unknown letter → unchanged, and says so', () => {
    expect(adjustForCorrections({ targetCycle: 4, currentReviewCycle: 3, signal: sig(3), overridden: false })).toEqual({
      targetCycle: 4,
      facts: { correctionAdjust: 'unknown_letter', cellLabel: 'Seattle Building Permits' },
    });
  });

  it('★★★ empty cell (no history for this city) → unchanged, and says so', () => {
    const r = adjustForCorrections({ targetCycle: 4, currentReviewCycle: 2, signal: sig(4, 'Kirkland'), overridden: false });
    expect(r.targetCycle).toBe(4);
    expect(r.facts).toMatchObject({ correctionAdjust: 'no_history', cellLabel: 'Kirkland Building Permits' });
  });
});

// ---------------------------------------------------------------------------
// inside computeProjectedApproval
// ---------------------------------------------------------------------------

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1, project_id: 'p1', type: 'Building Permit', stage_override: null, status: null, num: null,
    da: null, dm: null, ent_lead: null, dual_da: null, target_submit: null, dd_start: null, dd_end: null,
    expected_issue: null, actual_issue: null, approval_date: null, intake_date: null, notes: null,
    cycle_model: null, view_cycle: null, kickoff_date: null, corr_rounds: null, permit_owner: null,
    architect: null, nickname: null, struct_address: null, portal_url: null, ...over,
  } as Permit;
}
function cyc(over: Partial<PermitCycle> & { cycle_index: number }): PermitCycle {
  return {
    id: `c-${over.cycle_index}`, permit_id: 1, submitted: null, city_target: null, corr_issued: null,
    resubmitted: null, intake_accepted: null, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    ...over,
  } as PermitCycle;
}
function learned(over: Partial<LearnedEstimate> = {}): LearnedEstimate {
  return {
    source: 'Last 180d · Building Permit · Seattle', sampleCount: 30, dateRange: '', goToSubmit: null, avgIntakeToApproval: null,
    cityReview1: SCHEDULE_DEFAULTS.cityReview1, corrResponse1: SCHEDULE_DEFAULTS.corrResponse1,
    cityReview2: SCHEDULE_DEFAULTS.cityReview2, corrResponse2: SCHEDULE_DEFAULTS.corrResponse2,
    cityReview3: SCHEDULE_DEFAULTS.cityReview3, corrResponse3: SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: SCHEDULE_DEFAULTS.cityReview4, corrResponse4: SCHEDULE_DEFAULTS.corrResponse4,
    cr1Count: 0, cr2Count: 0, cr3Count: 0, cr4Count: 0, co1Count: 0, co2Count: 0, co3Count: 0, co4Count: 0,
    avgCycles: 3, mostLikelyCycle: 4, cycleDist: { 1: 0, 2: 5, 3: 10, 4: 15 }, isAllTime: false, isCrossJuris: false,
    recencyTier: 'last_180d' as const, ...over,
  } as LearnedEstimate;
}

/** A permit two rounds in: cycles 1 and 2 have corrections, cycle 2 resubmitted. */
const TWO_ROUNDS = [
  cyc({ cycle_index: 1, submitted: '2026-01-05', corr_issued: '2026-03-01', resubmitted: '2026-03-20' }),
  cyc({ cycle_index: 2, submitted: '2026-03-20', corr_issued: '2026-04-20', resubmitted: '2026-05-01' }),
];

function project(signal?: CorrectionSignal | null, over: Record<string, unknown> = {}) {
  return computeProjectedApproval({
    permit: permit(),
    cycles: TWO_ROUNDS,
    learnedEstimate: learned(),
    correctionSignal: signal,
    ...over,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('fix-614 — computeProjectedApproval', () => {
  it('★★★ no signal → byte-for-byte the projection it was', () => {
    const a = project(undefined);
    const b = project(null);
    expect(b).toEqual(a);
    expect(a.targetCycle).toBe(4); // the learner's most likely
    expect(a.routeFacts?.correctionAdjust).toBeUndefined();
  });

  it('★★★ 1 correction (≥ 50 %) → next round is the last: target 3, EARLIER than the learner\'s 4', () => {
    const base = project(undefined);
    const r = project(sig(1));
    expect(r.targetCycle).toBe(3);
    expect(r.projection! < base.projection!).toBe(true);
    expect(r.routeFacts).toMatchObject({ correctionAdjust: 'next_round_last', nextRoundChancePct: 51 });
  });

  it('★★★ 5 corrections (< 50 %) → one more round after the next: target max(4, N+2 = 4)', () => {
    const r = project(sig(2), { learnedEstimate: learned({ mostLikelyCycle: 3 }) });
    expect(r.targetCycle).toBe(4);
    expect(r.routeFacts?.correctionAdjust).toBe('one_more_round');
  });

  it('★★★ a hand-set cycle wins', () => {
    const r = project(sig(1), { targetCycleOverride: 4 });
    expect(r.targetCycle).toBe(4);
    expect(r.route).toBe('walk_override');
    expect(r.routeFacts?.correctionAdjust).toBeUndefined();
  });

  it('★★★ unknown letter / empty cell → same date as no signal, and the adjust is named', () => {
    const base = project(undefined);
    const u = project(sig(3));
    expect(u.projection).toBe(base.projection);
    expect(u.routeFacts?.correctionAdjust).toBe('unknown_letter');
    const k = project(sig(4, 'Kirkland'));
    expect(k.projection).toBe(base.projection);
    expect(k.routeFacts?.correctionAdjust).toBe('no_history');
  });

  it('★★ the reviewer bump (fix-32) still applies ON TOP of a pulled-in target', () => {
    const reviewers = [{ permit_id: 1, cycle_index: 2, current_status: 'corrections_required' }] as unknown as PermitCycleReviewer[];
    const r = project(sig(1), { permitReviewers: reviewers, learnedEstimate: learned({ mostLikelyCycle: 2 }) });
    expect(r.targetCycle).toBe(3);
    expect(r.routeFacts?.reviewerBumpCycle).toBe(2);
  });

  it('★★★ an approved permit is untouched — the actual date, no adjust', () => {
    const r = project(sig(2), { permit: permit({ approval_date: '2026-04-30' }) });
    expect(r.isActual).toBe(true);
    expect(r.routeFacts?.correctionAdjust).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §C — the words
// ---------------------------------------------------------------------------

describe('fix-614 §C — the sentence', () => {
  it('★★★ one more round — the cautious %, the cell, the bucket, the sample', () => {
    expect(
      correctionSentence({
        correctionAdjust: 'one_more_round', correctionCount: 4, nextRoundChancePct: 28, cellRounds: 41,
        cellLabel: 'Seattle Building Permits', correctionBucket: '4–6',
      }),
    ).toBe(
      'Last round had 4 corrections. Past Seattle Building Permits with 4–6 got approved the next round ' +
        'about 28% of the time, read cautiously (41 rounds), so this plans one more round.',
    );
  });

  it('★★★ next round last — and "1 correction" is singular', () => {
    expect(
      correctionSentence({
        correctionAdjust: 'next_round_last', correctionCount: 1, nextRoundChancePct: 51, cellRounds: 32,
        cellLabel: 'Seattle Building Permits', correctionBucket: '1',
      }),
    ).toBe(
      'Last round had 1 correction. Past Seattle Building Permits with 1 got approved the next round ' +
        'about 51% of the time, read cautiously (32 rounds), so this plans for the next round to be the last.',
    );
  });

  it('★★★ unknown letter and no history say the count is not used', () => {
    expect(correctionSentence({ correctionAdjust: 'unknown_letter', cellLabel: 'x' })).toBe(
      "The last correction letter hasn't been read yet, so the count isn't used.",
    );
    expect(correctionSentence({ correctionAdjust: 'no_history', cellLabel: 'Kirkland Building Permits' })).toBe(
      "No past rounds for Kirkland Building Permits yet, so the count isn't used.",
    );
  });

  it('★★ it rides on the walk sentence the footnote already prints — and only when there is something to say', () => {
    const r = project(sig(1));
    const s = routeSentence(r.route, r.routeFacts, { type: 'Building Permit', juris: 'Seattle' })!;
    expect(s).toContain('so this plans for the next round to be the last.');
    const plain = project(undefined);
    expect(routeSentence(plain.route, plain.routeFacts, { type: 'Building Permit', juris: 'Seattle' })).not.toContain('Last round had');
  });

  it('★ the banned vocabulary still holds', () => {
    for (const a of ['next_round_last', 'one_more_round', 'unknown_letter', 'no_history'] as const) {
      const t = correctionSentence({
        correctionAdjust: a, correctionCount: 3, nextRoundChancePct: 40, cellRounds: 9, cellLabel: 'Seattle Building Permits',
        correctionBucket: '2–3',
      })!;
      expect(t).not.toMatch(/learner|holistic|walked|derived|buffer|✓|undefined|NaN/i);
    }
  });
});

// ---------------------------------------------------------------------------
// §A — the migration file
// ---------------------------------------------------------------------------

describe('fix-614 §A — bp_correction_odds()', () => {
  it('★★★ additive only: no UPDATE / DELETE / DROP / INSERT / ALTER', () => {
    expect(SQL).not.toMatch(/\b(UPDATE|DELETE|DROP|INSERT|ALTER|TRUNCATE)\b/i);
  });

  it('★★★ STABLE + SECURITY DEFINER, tenant-scoped', () => {
    expect(SQL).toMatch(/RETURNS jsonb\s+LANGUAGE sql\s+STABLE\s+SECURITY DEFINER/);
    expect(SQL).toContain('WHERE p.tenant_id = ANY (public.auth_tenant_ids())');
  });

  it('★★★ authenticated only — never anon, never PUBLIC', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.bp_correction_odds() FROM PUBLIC, anon;');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.bp_correction_odds() TO authenticated;');
    // (`public.` the schema is not PUBLIC the role)
    expect(SQL).not.toMatch(/GRANT[^;]*\b(anon|PUBLIC)\b(?!\.)/i);
  });

  it('★★ a missing letter stays NULL (LEFT JOIN, no COALESCE to zero)', () => {
    expect(SQL).toContain('LEFT JOIN letters l ON l.permit_id = k.permit_id AND l.n = k.n');
    expect(SQL).not.toMatch(/COALESCE\(\s*l\.n_corr/i);
  });
});
