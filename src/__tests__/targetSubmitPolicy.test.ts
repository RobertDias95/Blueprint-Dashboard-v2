import { describe, it, expect } from 'vitest';
import {
  MIN_BENCHMARK_SAMPLES,
  computeTargetSubmitBenchmark,
  deriveProjectionFlags,
  describeBenchmarkGap,
  isTargetSubmitProjected,
  medianDays,
  resolveTargetSubmitDays,
  roundHalfAwayFromZero,
  type BenchmarkSample,
} from '../lib/targetSubmitPolicy';
import { anchorFor } from '../lib/targetSubmitLearner';

// fix-249: TS mirror of migrations/fix_249_target_submit_policy_beats_learner.sql.
// There is no live DB in CI, so the SQL's decision logic is pinned here (the
// fix-153 mirror pattern). The prod behaviour these tests encode was verified
// against the real database on 2026-07-28 before the migration was written.

const TODAY = new Date('2026-07-28T12:00:00Z');

/** Build a sample n days ago with the given anchor→submit gap. */
function sample(days: number, daysAgo: number): BenchmarkSample {
  const d = new Date(TODAY.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return { days, recencyDate: d.toISOString().slice(0, 10) };
}

describe('fix-249 precedence: policy beats the learner', () => {
  it('uses the configured policy even when the learner has rich history', () => {
    // The bug: the learner returned first, so this policy value never applied.
    const r = resolveTargetSubmitDays({
      policyDays: 3,
      learnerDays: 182,
      hardcodedDays: 10,
    });
    expect(r.days).toBe(3);
    expect(r.source).toBe('policy');
  });

  it('falls through to the learner only where no policy row exists', () => {
    const r = resolveTargetSubmitDays({
      policyDays: null,
      learnerDays: 182,
      hardcodedDays: 10,
    });
    expect(r.days).toBe(182);
    expect(r.source).toBe('learner');
  });

  it('falls through to the hardcoded default when both are absent', () => {
    const r = resolveTargetSubmitDays({
      policyDays: null,
      learnerDays: null,
      hardcodedDays: 10,
    });
    expect(r.days).toBe(10);
    expect(r.source).toBe('hardcoded');
  });

  it('treats a policy offset of 0 as configured, not as absent', () => {
    // Guards against a `policyDays || fallback` regression — 0 is a real,
    // meaningful offset ("submit the same day as the anchor").
    const r = resolveTargetSubmitDays({
      policyDays: 0,
      learnerDays: 182,
      hardcodedDays: 10,
    });
    expect(r.days).toBe(0);
    expect(r.source).toBe('policy');
  });

  it('a negative policy offset (submit before the anchor) still wins', () => {
    const r = resolveTargetSubmitDays({
      policyDays: -5,
      learnerDays: 40,
      hardcodedDays: 10,
    });
    expect(r.days).toBe(-5);
    expect(r.source).toBe('policy');
  });
});

describe('fix-249 median, not average', () => {
  it("uses the median of Bobby's real TRAO/Seattle cohort, not the mean", () => {
    // Verified on prod 2026-07-28 — this is the actual all-time TRAO history:
    const cohort = [8, 23, 70, 75, 122, 167, 191, 196];
    // mean = 852/8 = 106.5 -> 107. The median is what we want.
    expect(medianDays(cohort)).toBe(99);
    expect(Math.round(cohort.reduce((a, b) => a + b, 0) / cohort.length)).toBe(
      107,
    );
  });

  it('rounds half AWAY FROM ZERO, matching Postgres round(numeric)', () => {
    // The SQL casts percentile_cont to numeric precisely because
    // round(double precision) uses banker's rounding and would give 98.
    expect(roundHalfAwayFromZero(98.5)).toBe(99);
    expect(roundHalfAwayFromZero(-98.5)).toBe(-99);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });

  it('handles odd-sized cohorts without averaging', () => {
    expect(medianDays([8, 23, 70, 75, 122])).toBe(70);
  });

  it('returns null for an empty cohort', () => {
    expect(medianDays([])).toBeNull();
  });
});

describe('fix-249 minimum sample size', () => {
  it('rejects a window with n=2 and falls through to a wider one', () => {
    // Exactly the shape of the live bug: a 180d window holding two permits
    // (167 and 196 days) produced the 182 that overrode Bobby's policy.
    const samples = [
      sample(167, 100),
      sample(196, 150),
      // older — only reachable in the 365d window
      sample(8, 300),
      sample(23, 320),
    ];
    const b = computeTargetSubmitBenchmark(samples, TODAY);
    expect(b.windowLabel).toBe('last_365d');
    expect(b.n).toBe(4);
    // median of [8,23,167,196] = (23+167)/2 = 95
    expect(b.medianDays).toBe(95);
  });

  it('accepts a window at exactly n=3', () => {
    const samples = [sample(10, 10), sample(20, 20), sample(30, 30)];
    const b = computeTargetSubmitBenchmark(samples, TODAY);
    expect(b.windowLabel).toBe('last_90d');
    expect(b.n).toBe(MIN_BENCHMARK_SAMPLES);
    expect(b.medianDays).toBe(20);
  });

  it('reports insufficient (null n) when no window reaches the gate', () => {
    const b = computeTargetSubmitBenchmark(
      [sample(167, 100), sample(196, 150)],
      TODAY,
    );
    expect(b.windowLabel).toBe('insufficient');
    expect(b.n).toBeNull();
    expect(b.medianDays).toBeNull();
    // ...but the raw count is still reported so the UI can be specific.
    expect(b.totalSamples).toBe(2);
  });

  it('never returns a benchmark built on a single permit', () => {
    // The IPR bug: one permit produced the 287-day offset.
    const b = computeTargetSubmitBenchmark([sample(287, 30)], TODAY);
    expect(b.medianDays).toBeNull();
    expect(b.n).toBeNull();
    expect(b.totalSamples).toBe(1);
  });

  it('drops samples beyond the symmetric outlier cap', () => {
    const b = computeTargetSubmitBenchmark(
      [sample(10, 10), sample(20, 20), sample(900, 30)],
      TODAY,
    );
    expect(b.totalSamples).toBe(2);
    expect(b.n).toBeNull();
  });

  it('prefers the freshest window that clears the gate', () => {
    const samples = [
      sample(10, 10),
      sample(12, 20),
      sample(14, 30),
      sample(200, 300),
      sample(210, 320),
    ];
    const b = computeTargetSubmitBenchmark(samples, TODAY);
    expect(b.windowLabel).toBe('last_90d');
    expect(b.medianDays).toBe(12);
    expect(b.totalSamples).toBe(5);
  });
});

describe('fix-249 anchors are unchanged', () => {
  // Regression guard: fix-249 flips precedence and adds a benchmark. It must
  // NOT re-anchor anything. IPR/ULS in particular stay on the BP cycle-1
  // resubmit — Bobby was asked directly and chose to keep it.
  it.each([
    ['Building Permit', 'dd_end'],
    ['Demolition', 'bp_c0_intake'],
    ['IPR', 'bp_c1_resub'],
    ['ULS', 'bp_c1_resub'],
    ['Condo', 'bp_actual_issue'],
    ['ECA Waiver', 'go_date'],
    ['PAR/Pre-Sub', 'go_date'],
    ['SDOT Tree', 'go_date'],
    ['TRAO', 'go_date'],
    ['LBA', 'go_date'],
    ['Short Plat', 'go_date'],
    ['SIP', 'go_date'],
    ['Grading / Clearing', 'mirror_bp'],
    ['LSM', 'mirror_bp'],
  ])('%s stays anchored to %s', (type, expected) => {
    expect(anchorFor(type)).toBe(expected);
  });
});

describe('fix-249 Corliss regression', () => {
  // 4017 Corliss Ave N, Seattle, GO 2026-07-17.
  //
  // NOTE ON THE BRIEF: the brief cited TRAO stored as 2027-01-15 via a learned
  // 182. That was true when the bug was found, but by 2026-07-28 that row had
  // been set to target_submit_is_manual = true (stored 2026-08-19), so the
  // live row is no longer engine-driven and fix-249 will not touch it. The
  // rule the example was demonstrating is what's pinned here.
  const GO = new Date('2026-07-17T12:00:00Z');

  function plusDays(d: Date, n: number): string {
    return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
  }

  it('TRAO with policy +3 lands on GO+3, not on the learned 182', () => {
    const resolved = resolveTargetSubmitDays({
      policyDays: 3, // target_submit_formulas TRAO = 3
      learnerDays: 182, // what the 180d/n=2 window produced
      hardcodedDays: 10,
    });
    expect(resolved.days).toBe(3);
    expect(plusDays(GO, resolved.days as number)).toBe('2026-07-20');
    // The old behaviour, pinned so the regression is unmistakable:
    expect(plusDays(GO, 182)).toBe('2027-01-15');
  });

  it('IPR chain: policy replaces both fabricated learner hops', () => {
    // Verified on prod. BP target 2026-09-07 (manual, hand-typed).
    const bpTarget = new Date('2026-09-07T12:00:00Z');
    // Old: +89 (learned c1_resub_offset) then +287 (learned IPR, n=1).
    const oldC1 = plusDays(bpTarget, 89);
    expect(oldC1).toBe('2026-12-05');
    expect(plusDays(new Date(`${oldC1}T12:00:00Z`), 287)).toBe('2027-09-18');

    // New: c1_resub_offset_days is NULL, so 210/3 = 70; IPR policy = 75.
    const newC1 = plusDays(bpTarget, Math.floor(210 / 3));
    expect(newC1).toBe('2026-11-16');
    expect(plusDays(new Date(`${newC1}T12:00:00Z`), 75)).toBe('2027-01-30');
  });
});

describe('fix-249 projection flag', () => {
  const REAL = {
    c0Intake: '2026-03-01',
    c1Resub: '2026-05-01',
    actualIssue: '2026-09-01',
    bpTarget: '2026-02-01',
  };

  it('flags IPR/ULS as projected while the BP cycle-1 resubmit is absent', () => {
    const flags = deriveProjectionFlags({ ...REAL, c1Resub: null });
    expect(flags.c1Projected).toBe(true);
    expect(isTargetSubmitProjected('IPR', flags)).toBe(true);
    expect(isTargetSubmitProjected('ULS', flags)).toBe(true);
  });

  it('clears the flag once a real resubmit exists', () => {
    const flags = deriveProjectionFlags(REAL);
    expect(flags.c1Projected).toBe(false);
    expect(isTargetSubmitProjected('IPR', flags)).toBe(false);
    expect(isTargetSubmitProjected('ULS', flags)).toBe(false);
  });

  it('a projected intake poisons the c1 and issue anchors downstream', () => {
    const flags = deriveProjectionFlags({ ...REAL, c0Intake: null });
    expect(flags.intakeProjected).toBe(true);
    expect(flags.c1Projected).toBe(true);
    expect(flags.issueProjected).toBe(true);
    expect(isTargetSubmitProjected('Demolition', flags)).toBe(true);
    expect(isTargetSubmitProjected('Condo', flags)).toBe(true);
  });

  it('never flags go_date-anchored types — GO is a real recorded date', () => {
    const flags = deriveProjectionFlags({ ...REAL, c0Intake: null });
    for (const t of ['TRAO', 'SDOT Tree', 'PAR/Pre-Sub', 'ECA Waiver', 'LBA']) {
      expect(isTargetSubmitProjected(t, flags)).toBe(false);
    }
  });

  it('a permit that has actually been submitted is never a projection', () => {
    const flags = deriveProjectionFlags({ ...REAL, c1Resub: null });
    expect(isTargetSubmitProjected('IPR', flags, true)).toBe(false);
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

describe('fix-249 benchmark gap formatting', () => {
  it('reports the gap and flags history that overruns the standard', () => {
    const b = computeTargetSubmitBenchmark(
      [8, 23, 70, 75, 122, 167, 191, 196].map((d, i) => sample(d, 30 + i * 40)),
      TODAY,
    );
    const gap = describeBenchmarkGap(b, 3, 'go_date');
    expect(gap.deltaDays).toBe((b.medianDays as number) - 3);
    expect(gap.tone).toBe('over');
    expect(gap.text).toContain('vs target');
    expect(gap.text).toContain(`n=${b.n}`);
  });

  it('stays neutral when history meets or beats the standard', () => {
    const b = computeTargetSubmitBenchmark(
      [sample(10, 10), sample(12, 20), sample(14, 30)],
      TODAY,
    );
    const gap = describeBenchmarkGap(b, 30, 'go_date');
    expect(gap.tone).toBe('neutral');
    expect(gap.deltaDays).toBeLessThan(0);
  });

  it('says "not enough history" instead of printing a thin median', () => {
    const b = computeTargetSubmitBenchmark([sample(287, 30)], TODAY);
    const gap = describeBenchmarkGap(b, 75, 'bp_c1_resub');
    expect(gap.text).toContain('not enough history');
    expect(gap.text).not.toContain('287');
    expect(gap.deltaDays).toBeNull();
  });

  it('omits the comparison when no policy offset is configured', () => {
    const b = computeTargetSubmitBenchmark(
      [sample(10, 10), sample(12, 20), sample(14, 30)],
      TODAY,
    );
    const gap = describeBenchmarkGap(b, null, 'go_date');
    expect(gap.deltaDays).toBeNull();
    expect(gap.text).toContain('n=3');
    expect(gap.text).not.toContain('vs target');
  });
});
