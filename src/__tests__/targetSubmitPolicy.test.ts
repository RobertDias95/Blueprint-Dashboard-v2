import { describe, it, expect } from 'vitest';
import {
  computeTargetSubmitBenchmark,
  deriveProjectionFlags,
  describeBenchmark,
  isTargetSubmitProjected,
  medianDays,
  roundHalfAwayFromZero,
  type BenchmarkSample,
} from '../lib/targetSubmitPolicy';

// fix-249 → ★★★ fix-680: TS mirror of migrations/fix_680_target_submit_learns.sql
// (bp_target_submit_benchmark / bp_learn_target_submit_days). There is no live
// DB in CI, so the SQL's decision logic is pinned here (the fix-153 mirror
// pattern). fix-680 REVERSED fix-249's "policy beats learner": history first —
// the median of the 5 most recent submittals — and the Settings number only
// as the starting point while there is no history.

/** A sample submitted on `date` with the given anchor→submit gap. */
function sample(permitId: number, days: number, date: string): BenchmarkSample {
  return { permitId, days, recencyDate: date };
}

describe('fix-680 precedence: history first, then the starting number, then nothing', () => {
  it('uses history even when a Settings number exists (fix-249 reversed)', () => {
    const b = computeTargetSubmitBenchmark([sample(1, 182, '2026-06-01')], 3);
    expect(b.windowLabel).toBe('learned');
    expect(b.medianDays).toBe(182);
    expect(b.n).toBe(1);
  });

  it('falls back to the starting number only where there is no history', () => {
    const b = computeTargetSubmitBenchmark([], 14);
    expect(b).toEqual({
      medianDays: 14,
      n: 0,
      minDays: null,
      maxDays: null,
      windowLabel: 'starting',
      totalSamples: 0,
    });
  });

  it('a starting number of 0 is a number, not an absence', () => {
    expect(computeTargetSubmitBenchmark([], 0).medianDays).toBe(0);
    expect(computeTargetSubmitBenchmark([], 0).windowLabel).toBe('starting');
  });

  it('no history and no starting number → none (no automatic target)', () => {
    const b = computeTargetSubmitBenchmark([], null);
    expect(b.windowLabel).toBe('none');
    expect(b.medianDays).toBeNull();
    expect(b.n).toBeNull();
  });
});

describe('fix-680 median of the 5 most recent', () => {
  it('odd count: the middle value', () => {
    const b = computeTargetSubmitBenchmark(
      [
        sample(1, 8, '2026-01-01'),
        sample(2, 23, '2026-02-01'),
        sample(3, 70, '2026-03-01'),
        sample(4, 75, '2026-04-01'),
        sample(5, 122, '2026-05-01'),
      ],
      3,
    );
    expect(b.medianDays).toBe(70);
    expect(b.n).toBe(5);
    expect(b.minDays).toBe(8);
    expect(b.maxDays).toBe(122);
  });

  it('even count: the average of the middle two, rounded half away from zero', () => {
    const b = computeTargetSubmitBenchmark(
      [
        sample(1, 10, '2026-01-01'),
        sample(2, 20, '2026-02-01'),
        sample(3, 31, '2026-03-01'),
        sample(4, 40, '2026-04-01'),
      ],
      null,
    );
    expect(b.medianDays).toBe(26); // (20 + 31) / 2 = 25.5 → 26
    expect(b.n).toBe(4);
  });

  it('only the 5 newest count — older submittals are on record but not in the median', () => {
    const b = computeTargetSubmitBenchmark(
      [
        sample(1, 300, '2025-01-01'),
        sample(2, 310, '2025-02-01'),
        sample(3, 10, '2026-01-01'),
        sample(4, 12, '2026-02-01'),
        sample(5, 14, '2026-03-01'),
        sample(6, 16, '2026-04-01'),
        sample(7, 18, '2026-05-01'),
      ],
      null,
    );
    expect(b.medianDays).toBe(14);
    expect(b.n).toBe(5);
    expect(b.totalSamples).toBe(7);
    expect(b.maxDays).toBe(18);
  });

  it('a same-day tie is broken by permit id, newest first (the SQL ORDER BY)', () => {
    // Six submittals on one day: ids 6..2 are the "5 most recent".
    const same = [1, 2, 3, 4, 5, 6].map((id) => sample(id, id === 1 ? 999 : id * 10, '2026-05-01'));
    const b = computeTargetSubmitBenchmark(same, null);
    expect(b.n).toBe(5);
    expect(b.maxDays).toBe(60);
    expect(b.medianDays).toBe(40);
  });

  it('drops samples beyond the symmetric outlier cap', () => {
    const b = computeTargetSubmitBenchmark(
      [sample(1, 10, '2026-01-01'), sample(2, 20, '2026-02-01'), sample(3, 900, '2026-03-01')],
      null,
    );
    expect(b.totalSamples).toBe(2);
    expect(b.medianDays).toBe(15);
  });

  it("the TRAO cohort's median is 99 (Postgres rounding), not the mean 107", () => {
    const cohort = [8, 23, 70, 75, 122, 167, 191, 196];
    expect(medianDays(cohort)).toBe(99);
    expect(Math.round(cohort.reduce((a, b) => a + b, 0) / cohort.length)).toBe(107);
  });

  it('rounds half AWAY FROM ZERO, matching Postgres round(numeric)', () => {
    expect(roundHalfAwayFromZero(98.5)).toBe(99);
    expect(roundHalfAwayFromZero(-98.5)).toBe(-99);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });

  it('returns null for an empty cohort', () => {
    expect(medianDays([])).toBeNull();
  });
});

describe('projection flag — keyed by ANCHOR (fix-680)', () => {
  const REAL = {
    c0Intake: '2026-03-01',
    c1Resub: '2026-05-01',
    actualIssue: '2026-09-01',
    bpTarget: '2026-02-01',
  };

  it('flags bp_c1_resub targets as projected while the BP cycle-1 resubmit is absent', () => {
    const flags = deriveProjectionFlags({ ...REAL, c1Resub: null });
    expect(flags.c1Projected).toBe(true);
    expect(isTargetSubmitProjected('bp_c1_resub', flags)).toBe(true);
  });

  it('clears the flag once a real resubmit exists', () => {
    const flags = deriveProjectionFlags(REAL);
    expect(flags.c1Projected).toBe(false);
    expect(isTargetSubmitProjected('bp_c1_resub', flags)).toBe(false);
  });

  it('a projected intake poisons the c1 and issue anchors downstream', () => {
    const flags = deriveProjectionFlags({ ...REAL, c0Intake: null });
    expect(flags.intakeProjected).toBe(true);
    expect(flags.c1Projected).toBe(true);
    expect(flags.issueProjected).toBe(true);
    expect(isTargetSubmitProjected('bp_c0_intake', flags)).toBe(true);
    expect(isTargetSubmitProjected('bp_actual_issue', flags)).toBe(true);
  });

  it('never flags an anchor on a real recorded date', () => {
    const flags = deriveProjectionFlags({ ...REAL, c0Intake: null });
    for (const a of ['go_date', 'dd_end', 'created', 'mirror_bp', 'none'] as const) {
      expect(isTargetSubmitProjected(a, flags)).toBe(false);
    }
  });

  it('a permit that has actually been submitted is never a projection', () => {
    const flags = deriveProjectionFlags({ ...REAL, c1Resub: null });
    expect(isTargetSubmitProjected('bp_c1_resub', flags, true)).toBe(false);
  });

  it('nothing is projected when there is no usable intake anchor at all', () => {
    const flags = deriveProjectionFlags({
      c0Intake: null,
      c1Resub: null,
      actualIssue: null,
      bpTarget: null,
    });
    expect(flags).toEqual({
      intakeProjected: false,
      c1Projected: false,
      issueProjected: false,
    });
  });
});

describe('fix-680 readout: where the number came from', () => {
  it('learned: says the median and how many', () => {
    const b = computeTargetSubmitBenchmark(
      [sample(1, 10, '2026-01-01'), sample(2, 12, '2026-02-01'), sample(3, 14, '2026-03-01')],
      30,
    );
    const r = describeBenchmark(b, 'go_date');
    expect(r.tier).toBe('learned');
    expect(r.text).toBe('learned: GO+12d (median of last 3)');
  });

  it('learned from one submittal says so', () => {
    const b = computeTargetSubmitBenchmark([sample(1, 287, '2026-01-01')], 75);
    expect(describeBenchmark(b, 'bp_c1_resub').text).toBe('learned: BP c1 resub+287d (our 1 submittal)');
  });

  it('negative days print with their own sign', () => {
    const b = computeTargetSubmitBenchmark([sample(1, -28, '2026-01-01')], null);
    expect(describeBenchmark(b, 'go_date').text).toBe('learned: GO-28d (our 1 submittal)');
  });

  it('starting number: says there is no history in this city yet', () => {
    const r = describeBenchmark(computeTargetSubmitBenchmark([], 14), 'go_date');
    expect(r.tier).toBe('starting');
    expect(r.text).toBe('starting number: GO+14d (no history in this city yet)');
  });

  it('none: says there is no number', () => {
    const r = describeBenchmark(computeTargetSubmitBenchmark([], null), 'created');
    expect(r.tier).toBe('none');
    expect(r.text).toBe('no history and no starting number');
  });
});
