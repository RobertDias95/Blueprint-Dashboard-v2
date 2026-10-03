import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adjustForCorrections,
  correctionSignalFor,
  REVIEWER_CORRECTIONS_STATUS,
  reviewerBucketFor,
  wilsonLowerBound,
  type CorrectionOddsPayload,
  type CorrectionSignal,
} from '../lib/correctionOdds';
import { computeProjectedApproval } from '../lib/projectedApproval';
import { correctionSentence, reanchorSentences, routeSentence } from '../lib/estimatorRouteCopy';
import type { LearnedEstimate } from '../lib/scheduleBenchmarks';
import { SCHEDULE_DEFAULTS } from '../lib/scheduleBenchmarks';
import type { Permit, PermitCycle } from '../lib/database.types';

// ===========================================================================
// fix-622 (P-300 items 1 and 3) — the estimate reads the reviewers when the
// letter isn't read · it never points at a date that has passed
// ===========================================================================

const read = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8').split('\r\n').join('\n');
const SQL = read('migrations/fix_622_correction_odds_reviewers_and_lateness.sql').replace(/--.*$/gm, '');

const TODAY = '2026-10-02';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1, project_id: 'p1', type: 'Building Permit', stage_override: null, status: null,
    num: null, da: null, dm: null, ent_lead: null, dual_da: null, target_submit: null,
    dd_start: null, dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null, kickoff_date: null,
    corr_rounds: null, permit_owner: null, architect: null, nickname: null,
    struct_address: null, portal_url: null,
    ...over,
  } as Permit;
}

function cyc(over: Partial<PermitCycle> & { cycle_index: number }): PermitCycle {
  return {
    id: `c-${over.cycle_index}`, permit_id: 1, submitted: null, city_target: null,
    corr_issued: null, resubmitted: null, intake_accepted: null,
    created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    ...over,
  } as PermitCycle;
}

function learned(over: Partial<LearnedEstimate> = {}): LearnedEstimate {
  return {
    source: 'test', sampleCount: 5, dateRange: '', goToSubmit: null, avgIntakeToApproval: null,
    cityReview1: 30, corrResponse1: 21, cityReview2: 30, corrResponse2: 21,
    cityReview3: SCHEDULE_DEFAULTS.cityReview3, corrResponse3: SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: SCHEDULE_DEFAULTS.cityReview4, corrResponse4: SCHEDULE_DEFAULTS.corrResponse4,
    cr1Count: 5, cr2Count: 5, cr3Count: 0, cr4Count: 0,
    co1Count: 5, co2Count: 5, co3Count: 0, co4Count: 0,
    avgCycles: 2, mostLikelyCycle: 2, cycleDist: { 1: 0, 2: 0, 3: 0, 4: 0 },
    isAllTime: false, isCrossJuris: false, recencyTier: 'last_180d' as const,
    ...over,
  } as LearnedEstimate;
}

const PAYLOAD: CorrectionOddsPayload = {
  cells: [{ type: 'Building Permit', juris: 'Seattle', bucket: '4-6', resolved_rounds: 40, approved_next: 14 }],
  permits: [
    // a letter AND reviewers — the letter must win
    { permit_id: 10, round: 2, correction_count: 5, reviewer_count: 1 },
    // no letter, 2 reviewers — the reviewers answer
    { permit_id: 11, round: 1, correction_count: null, reviewer_count: 2 },
    // no letter, 3 reviewers — reviewer cell says "one more round"
    { permit_id: 12, round: 1, correction_count: null, reviewer_count: 3 },
    // neither
    { permit_id: 13, round: 1, correction_count: null, reviewer_count: null },
    // reviewer count 0 is NOT a signal
    { permit_id: 14, round: 1, correction_count: null, reviewer_count: 0 },
  ],
  reviewer_cells: [
    { type: 'Building Permit', juris: 'Kirkland', bucket: '2', resolved_rounds: 5, approved_next: 5 },
    { type: 'Building Permit', juris: 'Kirkland', bucket: '3', resolved_rounds: 21, approved_next: 3 },
    { type: 'Building Permit', juris: 'Seattle', bucket: '1', resolved_rounds: 4, approved_next: 2 },
  ],
  lateness: [
    { type: 'Building Permit', juris: 'Seattle', late_rounds: 39, typical_days: 6, window_tier: '90d' },
  ],
};
const BP = (id: number) => ({ id, type: 'Building Permit' });

// ---------------------------------------------------------------------------
describe('fix-622 §A: when the letter isn\'t read, the reviewers answer', () => {
  it('★★★ the status vocabulary is pinned: "asked for corrections" = corrections_required only', () => {
    expect(REVIEWER_CORRECTIONS_STATUS).toBe('corrections_required');
    expect(SQL).toMatch(/count\(\*\) FILTER \(WHERE r\.current_status = 'corrections_required'\) AS n_rev/);
    // the closed set of 7 measured on 2026-10-03, recorded in the migration
    for (const s of ['approved', 'corrections_required', 'in_review', 'not_required', 'in_process', 'pending', 'assigned']) {
      expect(read('migrations/fix_622_correction_odds_reviewers_and_lateness.sql')).toContain(s);
    }
  });

  it('★★★ bucket thresholds 1 · 2 · 3 · 4+ — the TS twin of the SQL CASE', () => {
    expect([1, 2, 3, 4, 5, 12].map(reviewerBucketFor)).toEqual(['1', '2', '3', '4+', '4+', '4+']);
    expect(SQL).toMatch(/CASE WHEN n_rev >= 4 THEN '4\+' ELSE n_rev::text END AS bucket/);
    // ★ zero reviewers is NO signal, in SQL and in TS
    expect(SQL).toMatch(/NULLIF\(rv\.n_rev, 0\) AS n_rev/);
    expect(correctionSignalFor(PAYLOAD, BP(14), 'Kirkland')?.reviewerCount).toBeNull();
  });

  it('★★★ the LETTER WINS over the reviewers', () => {
    const sig = correctionSignalFor(PAYLOAD, BP(10), 'Seattle')!;
    const r = adjustForCorrections({ targetCycle: 3, currentReviewCycle: 3, signal: sig, overridden: false });
    expect(r.facts?.correctionSource).toBe('letter');
    expect(r.facts?.correctionCount).toBe(5);
    expect(r.facts?.correctionBucket).toBe('4–6');
  });

  it('★★★ no letter → the reviewer cell, same cautious rule (next round the last)', () => {
    const sig = correctionSignalFor(PAYLOAD, BP(11), 'Kirkland')!;
    const r = adjustForCorrections({ targetCycle: 3, currentReviewCycle: 2, signal: sig, overridden: false });
    // 5 of 5 → cautious 80% lower bound
    expect(Math.round(wilsonLowerBound(5, 5) * 100)).toBe(r.facts?.nextRoundChancePct);
    expect(r.facts).toMatchObject({ correctionAdjust: 'next_round_last', correctionSource: 'reviewers', reviewerCount: 2 });
    expect(r.targetCycle).toBe(2); // round 1 + 1
    expect(correctionSentence(r.facts!)).toBe(
      `2 reviewers asked for corrections (the letter hasn't been read); past odds of approval next round ${r.facts?.nextRoundChancePct}% (read cautiously, 5 Kirkland Building Permits rounds) — planned the next round as the last.`,
    );
  });

  it('★★ …and a low reviewer cell plans one more round', () => {
    const sig = correctionSignalFor(PAYLOAD, BP(12), 'Kirkland')!;
    const r = adjustForCorrections({ targetCycle: 2, currentReviewCycle: 2, signal: sig, overridden: false });
    expect(r.facts).toMatchObject({ correctionAdjust: 'one_more_round', correctionSource: 'reviewers' });
    expect(r.targetCycle).toBe(3); // round 1 + 2
    expect(correctionSentence(r.facts!)).toMatch(/^3 reviewers asked for corrections .* — planned one more round\.$/);
  });

  it('★★★ neither signal → unchanged, and it says so', () => {
    const sig = correctionSignalFor(PAYLOAD, BP(13), 'Kirkland')!;
    const r = adjustForCorrections({ targetCycle: 3, currentReviewCycle: 2, signal: sig, overridden: false });
    expect(r.targetCycle).toBe(3);
    expect(correctionSentence(r.facts!)).toBe(
      "The last correction letter hasn't been read and no reviewer is marked as asking for corrections, so neither is used.",
    );
  });

  it('★★★ no cross-city borrowing: Seattle 2 reviewers never reads Kirkland\'s cell', () => {
    const sig = correctionSignalFor(PAYLOAD, BP(11), 'Seattle')!;
    expect(sig.reviewerCell).toBeNull();
    const r = adjustForCorrections({ targetCycle: 3, currentReviewCycle: 2, signal: sig, overridden: false });
    expect(r).toMatchObject({ targetCycle: 3, facts: { correctionAdjust: 'no_history', correctionSource: 'reviewers' } });
    expect(correctionSentence(r.facts!)).toBe(
      "2 reviewers asked for corrections (the letter hasn't been read), but no past Seattle Building Permits rounds had that many yet, so it isn't used.",
    );
  });

  it('★★ a hand-set cycle still wins', () => {
    const sig = correctionSignalFor(PAYLOAD, BP(12), 'Kirkland')!;
    expect(adjustForCorrections({ targetCycle: 2, currentReviewCycle: 2, signal: sig, overridden: true }))
      .toEqual({ targetCycle: 2, facts: null });
  });

  it('★★★ before the migration (no new keys) everything reads as "no signal"', () => {
    const old: CorrectionOddsPayload = { cells: PAYLOAD.cells, permits: [{ permit_id: 11, round: 1, correction_count: null }] };
    const sig = correctionSignalFor(old, BP(11), 'Kirkland')!;
    expect(sig.reviewerCount).toBeNull();
    expect(sig.cityLateness).toBeNull();
    expect(adjustForCorrections({ targetCycle: 3, currentReviewCycle: 2, signal: sig, overridden: false }).facts?.correctionAdjust)
      .toBe('unknown_letter');
    // and a permit with no round and no lateness gets no signal at all
    expect(correctionSignalFor(old, BP(99), 'Kirkland')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('fix-622 §B: never point at a date that has passed', () => {
  // cycle 2 in review at the city, past its own review date (Sep 26)
  const inReviewPastCityDate = [
    cyc({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-07-01', resubmitted: '2026-08-01' }),
    cyc({ cycle_index: 2, submitted: '2026-08-01', city_target: '2026-09-26' }),
  ];
  const lateSignal = (typicalDays: number | null): CorrectionSignal => ({
    round: 0, count: null, cellLabel: 'Seattle Building Permits', cell: null,
    cityLateness: typicalDays ? { typicalDays, lateRounds: 39 } : null,
  });

  it('★★★ (a) a past city date re-anchors at today + this city\'s typical lateness, and says why', () => {
    const r = computeProjectedApproval({ permit: permit(), cycles: inReviewPastCityDate, learnedEstimate: learned(), correctionSignal: lateSignal(6) });
    expect(r.routeFacts?.reanchors).toEqual([
      { kind: 'city_late', daysLate: 6, due: '2026-09-26', plannedDays: 6, lateRounds: 39 },
    ]);
    expect(r.projection).toBe('2026-10-15'); // today + 6, + the 7-day approval buffer
    expect(reanchorSentences(r.routeFacts!)).toBe(
      'City is 6 days past its own review date (due Sep 26) — planned 6 days from today, how late this city typically runs once past due (39 late rounds).',
    );
    expect(routeSentence(r.route, r.routeFacts)).toContain('City is 6 days past its own review date (due Sep 26)');
  });

  it('★★ (a) with no history for this city → today, and said so', () => {
    const r = computeProjectedApproval({ permit: permit(), cycles: inReviewPastCityDate, learnedEstimate: learned(), correctionSignal: lateSignal(null) });
    expect(r.projection).toBe('2026-10-09');
    expect(reanchorSentences(r.routeFacts!)).toBe('City is 6 days past its own review date (due Sep 26) — planned from today.');
  });

  it('★★ (a) a city date still ahead is used as-is — nothing to say', () => {
    const cycles = [inReviewPastCityDate[0]!, cyc({ cycle_index: 2, submitted: '2026-08-01', city_target: '2026-10-20' })];
    const r = computeProjectedApproval({ permit: permit(), cycles, learnedEstimate: learned(), correctionSignal: lateSignal(6) });
    expect(r.projection).toBe('2026-10-27');
    expect(r.routeFacts?.reanchors).toBeUndefined();
  });

  it('★★★ (b) our resubmittal past the usual turnaround re-anchors at today, and says why', () => {
    const cycles = [cyc({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-07-01' })];
    const r = computeProjectedApproval({ permit: permit(), cycles, learnedEstimate: learned() });
    expect(r.rounds?.resubmitted1).toBe(TODAY);
    expect(r.routeFacts?.reanchors).toEqual([{ kind: 'resub_late', daysLate: 72, due: '2026-07-22' }]);
    expect(reanchorSentences(r.routeFacts!)).toBe('Our resubmittal is 72 days past the usual turnaround — planned from today.');
    expect(r.projection).toBe('2026-11-08'); // today + city review 2 (30) + 7
  });

  it('★★ (b) a turnaround still running keeps its own date — the anchor is NOT re-floored', () => {
    // corrections 7 days ago, 21-day turnaround → due Oct 16, not "21 days from today"
    const cycles = [cyc({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-09-25' })];
    const r = computeProjectedApproval({ permit: permit(), cycles, learnedEstimate: learned() });
    expect(r.rounds?.resubmitted1).toBe('2026-10-16');
    expect(r.routeFacts?.reanchors).toBeUndefined();
  });

  it('★★★ no projected date is ever before today', () => {
    const scenarios: PermitCycle[][] = [
      inReviewPastCityDate,
      [cyc({ cycle_index: 1, submitted: '2025-01-01', corr_issued: '2025-02-01' })],
      [cyc({ cycle_index: 1, submitted: '2025-01-01', city_target: '2025-02-01' })],
      [cyc({ cycle_index: 1, submitted: '2025-01-01', corr_issued: '2025-02-01', resubmitted: '2025-03-01' }),
        cyc({ cycle_index: 2, submitted: '2025-03-01', city_target: '2025-04-01' })],
      [cyc({ cycle_index: 1, submitted: '2025-01-01' })],
    ];
    for (const cycles of scenarios) {
      for (const mlc of [1, 2, 3, 4]) {
        const r = computeProjectedApproval({ permit: permit(), cycles, learnedEstimate: learned({ mostLikelyCycle: mlc }), correctionSignal: lateSignal(6) });
        expect(r.projection! >= TODAY, JSON.stringify({ cycles, mlc, p: r.projection })).toBe(true);
        const actual = new Set(cycles.flatMap((c) => [c.corr_issued, c.resubmitted]).filter(Boolean));
        for (const d of Object.values(r.rounds ?? {})) {
          if (!d || actual.has(d)) continue;
          expect(d >= TODAY, `round ${d}`).toBe(true);
        }
      }
    }
  });

  it('★★★ (c) a correction arriving where approval was expected re-forecasts at once', () => {
    const before = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-08-03' })],
      learnedEstimate: learned({ mostLikelyCycle: 1 }),
    });
    const after = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-08-03', corr_issued: '2026-10-01' })],
      learnedEstimate: learned({ mostLikelyCycle: 1 }),
    });
    expect(before.targetCycle).toBe(1);
    expect(after.targetCycle).toBe(2);
    expect(after.rounds?.corrIssued1).toBe('2026-10-01');
    expect(after.rounds?.resubmitted1).toBe('2026-10-22'); // the corrections date + 21
    expect(after.projection! > before.projection!).toBe(true);
  });

  it('★★ the lateness comes from the ONE learner (fix-585), never a percentile here', () => {
    const odds = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.bp_correction_odds()'));
    expect(odds).not.toMatch(/percentile_cont|\bavg\s*\(/i);
    expect(odds).toMatch(/public\.bp_duration_stats\(t\.tenant_id, NULL, 'city_late'\)/);
    expect(SQL).toMatch(/SELECT b\.ptype, b\.pjuris, pc\.cycle_index, 'city_late'/);
  });

  it('★ no cross-city lateness', () => {
    expect(correctionSignalFor(PAYLOAD, BP(13), 'Kirkland')?.cityLateness).toBeNull();
    expect(correctionSignalFor(PAYLOAD, BP(13), 'Seattle')?.cityLateness).toEqual({ typicalDays: 6, lateRounds: 39 });
  });
});
