import { describe, it, expect } from 'vitest';
import {
  ASSUMED_CORRECTION_ITEMS,
  CONFIDENCE_ORDER,
  resolveAnchorDate,
  resolveCityTarget,
  resolveClock,
  resolveCorrectionItems,
  type Confidence,
} from '../lib/estimatorInputs';
import { inputSentence } from '../lib/estimatorRouteCopy';
import type { DurationStatRow } from '../lib/durationLadder';

// fix-585 §7 — DEGRADE, NEVER GUESS SILENTLY. Every assertion here is on the
// RUNG and the CONFIDENCE, not only the number: a coincidence must not pass.

const rank = (c: Confidence | null) => (c == null ? Infinity : CONFIDENCE_ORDER.indexOf(c));

const UNPARSED = { letterIssued: true, letterParsed: false, parsedItems: 0 } as const;

describe('fix-585 §7 — correction item count', () => {
  it('★★★ a corr_issued cycle with NO parsed items still resolves, and the sentence says ASSUMED', () => {
    const r = resolveCorrectionItems(UNPARSED);
    expect(r.value).not.toBeNull();
    expect(r.rung).toBe('assumption');
    expect(r.confidence).toBe('assumed');
    expect(inputSentence(r)).toMatch(/was assumed/);
    expect(inputSentence(r)).toMatch(/not been parsed/);
  });

  it('★★★ …and it NEVER assumes zero open items (zero would say "approved")', () => {
    expect(resolveCorrectionItems(UNPARSED).value).toBe(ASSUMED_CORRECTION_ITEMS);
    expect(ASSUMED_CORRECTION_ITEMS).toBeGreaterThan(0);
    // even when every fallback source is zero
    const r = resolveCorrectionItems({ ...UNPARSED, priorCycleItems: [0, 0], cohortMedianItems: 0 });
    expect(r.value).toBeGreaterThan(0);
  });

  it('★★★ an unparsed letter is a FINDING: it points at the indexer worklist', () => {
    expect(resolveCorrectionItems(UNPARSED).worklist).toBe('indexer_missing_letter');
    expect(resolveCorrectionItems({ ...UNPARSED, priorCycleItems: [7] }).worklist).toBe('indexer_missing_letter');
    expect(resolveCorrectionItems({ letterIssued: true, letterParsed: true, parsedItems: 9 }).worklist).toBeUndefined();
  });

  it('★★ the chain in order: this letter → prior cycles → cohort → assumption', () => {
    const steps = [
      resolveCorrectionItems({ letterIssued: true, letterParsed: true, parsedItems: 9, priorCycleItems: [4], cohortMedianItems: 12 }),
      resolveCorrectionItems({ ...UNPARSED, priorCycleItems: [4, 6, 8], cohortMedianItems: 12 }),
      resolveCorrectionItems({ ...UNPARSED, cohortMedianItems: 12 }),
      resolveCorrectionItems(UNPARSED),
    ];
    expect(steps.map((s) => s.rung)).toEqual(['this_letter', 'prior_cycles', 'cohort', 'assumption']);
    expect(steps.map((s) => s.value)).toEqual([9, 6, 12, ASSUMED_CORRECTION_ITEMS]);
    // ★★ confidence never rises as the chain falls
    for (let i = 1; i < steps.length; i++) {
      expect(rank(steps[i]!.confidence)).toBeGreaterThanOrEqual(rank(steps[i - 1]!.confidence));
    }
    expect(steps[0]!.confidence).toBe('measured');
    expect(steps[3]!.confidence).toBe('assumed');
  });
});

describe('fix-585 §7 — NO ANCHOR MEANS NO NUMBER', () => {
  it('★★★ no anchor of any kind → no value, and the missing inputs are named', () => {
    const r = resolveAnchorDate({ intakeAccepted: null, cycle1Submitted: null, permitIntakeDate: null });
    expect(r.value).toBeNull(); // the absence, not a today + policy fallback
    expect(r.confidence).toBeNull();
    expect(r.missing).toEqual(['intake accepted date', 'cycle-1 submitted date', 'permit intake date']);
    const s = inputSentence(r);
    expect(s).toMatch(/^Not enough to estimate/);
    expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}|\bdays\b/);
  });

  it('★★ the chain in order: intake_accepted → cycle-1 submitted → permit intake date', () => {
    const all = { intakeAccepted: '2026-01-05', cycle1Submitted: '2026-01-02', permitIntakeDate: '2026-01-01' };
    expect(resolveAnchorDate(all)).toMatchObject({ rung: 'intake_accepted', value: '2026-01-05' });
    expect(resolveAnchorDate({ ...all, intakeAccepted: null })).toMatchObject({ rung: 'cycle1_submitted', value: '2026-01-02' });
    expect(resolveAnchorDate({ ...all, intakeAccepted: null, cycle1Submitted: null })).toMatchObject({
      rung: 'permit_intake_date', value: '2026-01-01',
    });
  });
});

const row = (p: Partial<DurationStatRow>): DurationStatRow => ({
  type: 'Building Permit', juris: 'Seattle', cycle_index: 1, clock: 'city_review',
  scope: 'type_juris_cycle', window_tier: '90d', n: 10, median_days: 63, ...p,
});

describe('fix-585 §7 — the two clocks', () => {
  const base = { type: 'Building Permit', juris: 'Seattle', cycle: 1 } as const;

  it('★★★ confidence falls with the rung: own cycles → learned → policy/none', () => {
    const own = resolveClock({ ...base, clock: 'city_review', ownCompleted: [50, 60, 70], learned: [row({})] });
    const learned = resolveClock({ ...base, clock: 'city_review', learned: [row({})] });
    const none = resolveClock({ ...base, clock: 'city_review', learned: [] });
    expect([own.rung, learned.rung, none.rung]).toEqual(['own_cycles', 'type_juris_cycle', 'none']);
    expect([own.confidence, learned.confidence, none.confidence]).toEqual(['measured', 'learned', null]);
    expect(none.value).toBeNull();
  });

  it('★★ one past permit is not called a median', () => {
    const r = resolveClock({
      ...base, juris: 'Kirkland', clock: 'city_review',
      learned: [row({ juris: 'Kirkland', scope: 'type_juris', cycle_index: null, window_tier: 'all', n: 1, median_days: 40 })],
    });
    expect(r).toMatchObject({ value: 40, rung: 'type_juris', confidence: 'learned' });
    const text = inputSentence(r, { type: 'Building Permit', juris: 'Kirkland', cycle: 1 });
    expect(text).not.toMatch(/median/);
    expect(text).toMatch(/only past permit on record/);
  });

  it('★★ OUR turnaround learned at cycle 4 is floored at 3 and says where it came from', () => {
    const r = resolveClock({
      ...base, cycle: 4, clock: 'our_turnaround',
      learned: [row({ clock: 'our_turnaround', cycle_index: 4, median_days: 0, n: 15 })],
    });
    expect(r.value).toBe(3);
    expect(inputSentence(r, { type: 'Building Permit', juris: 'Seattle', cycle: 4 })).toBe(
      'Our turnaround time is the median of 15 Building Permits in Seattle at cycle 4 (last 90 days).',
    );
  });
});

describe('fix-585 §7 — city target is not a forecast input unadjusted', () => {
  const review = resolveClock({ type: 'Building Permit', juris: 'Kirkland', cycle: 1, clock: 'city_review', learned: [row({ juris: 'Kirkland' })] });

  it('★★★ a stored target with a measured slip is moved out by it', () => {
    const r = resolveCityTarget({ cityTarget: '2026-10-01', jurisSlipDays: 16, cycleSubmitted: '2026-08-01', cityReview: review });
    expect(r).toMatchObject({ rung: 'target_plus_slip', value: '2026-10-17', rawTargetSetAside: false });
  });

  it('★★★ a stored target WITHOUT a slip is set aside — and the sentence says so', () => {
    const r = resolveCityTarget({ cityTarget: '2026-10-01', jurisSlipDays: null, cycleSubmitted: '2026-08-01', cityReview: review });
    expect(r.value).not.toBe('2026-10-01');
    expect(r).toMatchObject({ rung: 'city_clock', value: '2026-10-03', rawTargetSetAside: true });
    expect(inputSentence(r)).toMatch(/stated target was set aside/);
  });
});

describe('fix-585 §7 — the banned vocabulary holds for the new sentences too', () => {
  it('★★★ no "learner", "holistic", "walked", "derived", "buffer", or bare ✓', () => {
    const samples = [
      resolveCorrectionItems(UNPARSED),
      resolveCorrectionItems({ ...UNPARSED, priorCycleItems: [3] }),
      resolveCorrectionItems({ ...UNPARSED, cohortMedianItems: 3 }),
      resolveAnchorDate({ intakeAccepted: null, cycle1Submitted: null, permitIntakeDate: null }),
      resolveAnchorDate({ intakeAccepted: null, cycle1Submitted: '2026-01-01', permitIntakeDate: null }),
      resolveClock({ type: 'ULS', juris: 'Seattle', cycle: 1, clock: 'city_review', learned: [] }),
      resolveClock({ type: 'ULS', juris: 'Seattle', cycle: 1, clock: 'city_review', learned: [row({ type: 'ULS', scope: 'type_juris', cycle_index: null })] }),
    ];
    for (const s of samples) {
      const text = inputSentence(s, { type: 'ULS', juris: 'Seattle', cycle: 1 });
      expect(text).not.toMatch(/learner|holistic|walked|derived|buffer|✓/i);
      expect(text).not.toMatch(/undefined|null|NaN/);
    }
  });
});
