import { describe, it, expect } from 'vitest';
import {
  MIN_PHASE_SAMPLES,
  PHASE_MAX_DAYS,
  computePhaseDuration,
  isUsablePhaseSample,
  medianOf,
  pairSidesByCycle,
  phaseTrend,
  trendTone,
  type PhaseDurationRow,
  type PhaseSample,
} from '../lib/phaseDurations';

// fix-253: TS mirror of migrations/fix_253_phase_duration_model.sql. No live DB
// in CI, so the SQL's statistics are pinned here (the fix-153 pattern). The
// prod numbers these tests reference were measured on 2026-07-28.

const TODAY = new Date('2026-07-28T12:00:00Z');

function sample(days: number, daysAgo: number): PhaseSample {
  const d = new Date(TODAY.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return { days, endedOn: d.toISOString().slice(0, 10) };
}

describe('fix-253 median, not mean, with the ::numeric cast', () => {
  it('takes the median of a skewed sample, not the average', () => {
    // Skewed hard by two long tails — the mean is dragged, the median is not.
    const values = [5, 6, 7, 8, 9, 200, 400];
    expect(medianOf(values)).toBe(8);
    expect(Math.round(values.reduce((a, b) => a + b, 0) / values.length)).toBe(91);
  });

  it('rounds half away from zero, matching Postgres round(numeric)', () => {
    // round(double precision) is banker's rounding and would give 98 here.
    // fix-249 hit exactly this; the SQL casts to numeric for this reason.
    expect(medianOf([98, 99])).toBe(99);
    expect(medianOf([2, 3])).toBe(3);
  });

  it('reproduces the Seattle BP cycle-1 city median of 72', () => {
    // Shape check against the real cohort's centre.
    const vals = [60, 65, 70, 72, 74, 80, 133];
    expect(medianOf(vals)).toBe(72);
  });
});

describe('fix-253 minimum sample size', () => {
  it('returns insufficient (null median) but still reports n at n=2', () => {
    const r = computePhaseDuration([sample(10, 5), sample(20, 6)], 180, TODAY);
    expect(r.medianDays).toBeNull();
    expect(r.minDays).toBeNull();
    expect(r.maxDays).toBeNull();
    // n is still reported so the UI can say "n=2, need 3" rather than "—".
    expect(r.n).toBe(2);
  });

  it('accepts a cohort at exactly n=3', () => {
    const r = computePhaseDuration(
      [sample(10, 5), sample(20, 6), sample(30, 7)],
      180,
      TODAY,
    );
    expect(r.n).toBe(MIN_PHASE_SAMPLES);
    expect(r.medianDays).toBe(20);
    expect(r.minDays).toBe(10);
    expect(r.maxDays).toBe(30);
  });

  it('never derives a median from a single phase', () => {
    const r = computePhaseDuration([sample(287, 5)], 180, TODAY);
    expect(r.medianDays).toBeNull();
    expect(r.n).toBe(1);
  });
});

describe('fix-253 bad-data guards', () => {
  it('excludes negative spans rather than crashing', () => {
    // Exactly one negative city duration exists on prod today.
    const r = computePhaseDuration(
      [sample(-5, 5), sample(10, 6), sample(20, 7), sample(30, 8)],
      180,
      TODAY,
    );
    expect(r.n).toBe(3);
    expect(r.medianDays).toBe(20);
  });

  it('excludes spans over the 730-day cap', () => {
    const r = computePhaseDuration(
      [sample(PHASE_MAX_DAYS + 1, 5), sample(10, 6), sample(20, 7), sample(30, 8)],
      180,
      TODAY,
    );
    expect(r.n).toBe(3);
  });

  it('keeps zero-day phases — same-day turnarounds are real', () => {
    // 25/305 city and 15/250 ours are zero-day on prod. Dropping them would
    // bias every median upward.
    const r = computePhaseDuration(
      [sample(0, 5), sample(0, 6), sample(6, 7)],
      180,
      TODAY,
    );
    expect(r.n).toBe(3);
    expect(r.medianDays).toBe(0);
  });

  it('treats null/NaN durations as unusable', () => {
    expect(isUsablePhaseSample(null)).toBe(false);
    expect(isUsablePhaseSample(undefined)).toBe(false);
    expect(isUsablePhaseSample(Number.NaN)).toBe(false);
    expect(isUsablePhaseSample(0)).toBe(true);
    expect(isUsablePhaseSample(730)).toBe(true);
    expect(isUsablePhaseSample(731)).toBe(false);
    expect(isUsablePhaseSample(-1)).toBe(false);
  });

  it('an all-bad cohort reports n=0 without throwing', () => {
    const r = computePhaseDuration([sample(-1, 5), sample(999, 6)], 180, TODAY);
    expect(r.n).toBe(0);
    expect(r.medianDays).toBeNull();
    expect(r.recentN).toBe(0);
  });
});

describe('fix-253 recent-window trend', () => {
  it('reports a positive delta for a cohort that slowed down', () => {
    const r = computePhaseDuration(
      [
        // Old and fast.
        sample(10, 400),
        sample(10, 380),
        sample(10, 360),
        // Recent and slow.
        sample(40, 20),
        sample(40, 30),
        sample(40, 40),
      ],
      180,
      TODAY,
    );
    expect(r.medianDays).toBe(25); // all-time median of [10,10,10,40,40,40]
    expect(r.recentMedianDays).toBe(40);
    expect(r.recentN).toBe(3);

    const t = phaseTrend(r);
    expect(t.deltaDays).toBe(15);
    expect(t.direction).toBe('slower');
    expect(trendTone(t)).toBe('bad');
  });

  it('reports a negative delta for a cohort that sped up', () => {
    const r = computePhaseDuration(
      [
        sample(40, 400),
        sample(40, 380),
        sample(40, 360),
        sample(10, 20),
        sample(10, 30),
        sample(10, 40),
      ],
      180,
      TODAY,
    );
    const t = phaseTrend(r);
    expect(t.direction).toBe('faster');
    expect(trendTone(t)).toBe('good');
  });

  it('is unknown when the recent window is under the gate', () => {
    const r = computePhaseDuration(
      [sample(10, 400), sample(10, 380), sample(10, 360), sample(40, 20)],
      180,
      TODAY,
    );
    expect(r.recentN).toBe(1);
    expect(r.recentMedianDays).toBeNull();
    const t = phaseTrend(r);
    expect(t.direction).toBe('unknown');
    expect(t.deltaDays).toBeNull();
  });

  it('the recent window keys off when the phase ENDED', () => {
    // A phase that ended 200 days ago is out of a 180-day window even though
    // it was short.
    const r = computePhaseDuration(
      [sample(5, 200), sample(5, 210), sample(5, 220)],
      180,
      TODAY,
    );
    expect(r.n).toBe(3);
    expect(r.recentN).toBe(0);
  });
});

describe('fix-253 city vs ours pairing', () => {
  function row(
    side: 'city' | 'ours',
    cycleIndex: number,
    medianDays: number,
  ): PhaseDurationRow {
    return {
      type: 'Building Permit',
      juris: 'Seattle',
      cycleIndex,
      side,
      medianDays,
      n: 10,
      minDays: 0,
      maxDays: 100,
      recentMedianDays: medianDays,
      recentN: 5,
    };
  }

  it('pairs the two sides of a cycle onto one row', () => {
    const pairs = pairSidesByCycle([
      row('city', 1, 72),
      row('ours', 1, 24),
      row('city', 2, 25),
      row('ours', 2, 13),
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].cycleIndex).toBe(1);
    expect(pairs[0].city?.medianDays).toBe(72);
    expect(pairs[0].ours?.medianDays).toBe(24);
    expect(pairs[1].city?.medianDays).toBe(25);
    expect(pairs[1].ours?.medianDays).toBe(13);
  });

  it('keeps a cycle that only has one side', () => {
    const pairs = pairSidesByCycle([row('city', 3, 19)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].city?.medianDays).toBe(19);
    expect(pairs[0].ours).toBeNull();
  });

  it('shows the per-round compression the flat model cannot represent', () => {
    // The Seattle BP shape, verified on prod: both sides fall each round.
    const pairs = pairSidesByCycle([
      row('city', 1, 72), row('ours', 1, 24),
      row('city', 2, 25), row('ours', 2, 13),
      row('city', 3, 19), row('ours', 3, 5),
    ]);
    const city = pairs.map((p) => p.city?.medianDays);
    const ours = pairs.map((p) => p.ours?.medianDays);
    expect(city).toEqual([72, 25, 19]);
    expect(ours).toEqual([24, 13, 5]);
    for (let i = 1; i < city.length; i++) {
      expect(city[i]!).toBeLessThan(city[i - 1]!);
      expect(ours[i]!).toBeLessThan(ours[i - 1]!);
    }
  });
});
