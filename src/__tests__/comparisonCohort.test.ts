import { describe, it, expect } from 'vitest';
import {
  activeComparePreset,
  applyComparePreset,
  comparisonLabelFor,
  comparisonLabelForRange,
  deriveComparisonRange,
  formatCompareNumber,
  legacyCompareToRange,
  rangeForPreset,
} from '../lib/comparisonCohort';

describe('deriveComparisonRange', () => {
  describe("mode='off' or empty input", () => {
    it("mode='off' returns null", () => {
      expect(
        deriveComparisonRange({ from: '2026-04-01', to: '2026-06-30' }, 'off'),
      ).toBeNull();
    });

    it('null currentRange returns null', () => {
      expect(deriveComparisonRange(null, 'previous_period')).toBeNull();
      expect(deriveComparisonRange(null, 'previous_year')).toBeNull();
    });

    it("missing from/to returns null", () => {
      expect(
        deriveComparisonRange({ from: '', to: '2026-06-30' }, 'previous_period'),
      ).toBeNull();
      expect(
        deriveComparisonRange({ from: '2026-04-01', to: '' }, 'previous_period'),
      ).toBeNull();
    });
  });

  describe("mode='previous_period'", () => {
    it('fix-115-a: Q2 (Apr 1 – Jun 30) snaps to Q1 (Jan 1 – Mar 31) calendar-aligned', () => {
      // Pre-fix-115-a the length-preserving math returned Dec 31 2025 –
      // Mar 31 2026 (91-day mirror, off by one from the calendar quarter).
      // The full-quarter detector now snaps to Q1.
      expect(
        deriveComparisonRange(
          { from: '2026-04-01', to: '2026-06-30' },
          'previous_period',
        ),
      ).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    });

    it('fix-115-a: Q1 (Jan 1 – Mar 31 2026) snaps to Q4 of the prior year (Oct 1 – Dec 31 2025)', () => {
      // Year-boundary quarter rollover.
      expect(
        deriveComparisonRange(
          { from: '2026-01-01', to: '2026-03-31' },
          'previous_period',
        ),
      ).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    });

    it('fix-115-a: full calendar month (June 2026) snaps to the previous month (May 2026)', () => {
      // Brief's headline demonstration scenario.
      expect(
        deriveComparisonRange(
          { from: '2026-06-01', to: '2026-06-30' },
          'previous_period',
        ),
      ).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    });

    it("fix-115-a: Feb 2026 (non-leap, 28d) snaps to Jan 2026 (31d) — month length doesn't matter", () => {
      // Confirms the snap pulls the previous calendar month's actual
      // length, not a copy of the current month's length.
      expect(
        deriveComparisonRange(
          { from: '2026-02-01', to: '2026-02-28' },
          'previous_period',
        ),
      ).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    });

    it('fix-115-a: Feb 2024 (leap year, 29d) snaps to Jan 2024 (31d)', () => {
      // Confirms leap-year February's last day (29) is detected correctly
      // via lastDayOfMonth. A naïve "always 28" check would miss this.
      expect(
        deriveComparisonRange(
          { from: '2024-02-01', to: '2024-02-29' },
          'previous_period',
        ),
      ).toEqual({ from: '2024-01-01', to: '2024-01-31' });
    });

    it('fix-115-a: full year (2026) snaps to the previous year (2025)', () => {
      expect(
        deriveComparisonRange(
          { from: '2026-01-01', to: '2026-12-31' },
          'previous_period',
        ),
      ).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    });

    it('fix-115-a: January (year-boundary month) snaps to December of the prior year', () => {
      expect(
        deriveComparisonRange(
          { from: '2026-01-01', to: '2026-01-31' },
          'previous_period',
        ),
      ).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    });

    it('fix-115-a: custom range (Jun 5 – Jun 28) does NOT snap — falls through to length-preserving math', () => {
      // Boundary detectors require EXACT alignment. A partial-month range
      // keeps the length-preserving mirror because the user's intent is
      // ambiguous — they didn't pick a calendar period.
      // Length = 24 days. prev.to = Jun 4. prev.from = Jun 5 - 24 = May 12.
      expect(
        deriveComparisonRange(
          { from: '2026-06-05', to: '2026-06-28' },
          'previous_period',
        ),
      ).toEqual({ from: '2026-05-12', to: '2026-06-04' });
    });

    it('fix-115-a: month-start range that does NOT end on month-end falls through to length-preserving', () => {
      // Apr 1 – Jun 29 is the brief's "exactly-90-day Q2-ish" case. Day-1
      // start passes the first check but Jun 29 ≠ Jun 30 fails the
      // full-month / full-quarter detectors. Length-preserving 90-day
      // mirror lands cleanly on Q1 Jan 1 – Mar 31 by coincidence.
      expect(
        deriveComparisonRange(
          { from: '2026-04-01', to: '2026-06-29' },
          'previous_period',
        ),
      ).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    });

    it('"last 30 days" range → the 30 days before that', () => {
      // Current: May 16 – Jun 14 (30 days). Comparison: Apr 16 – May 15.
      expect(
        deriveComparisonRange(
          { from: '2026-05-16', to: '2026-06-14' },
          'previous_period',
        ),
      ).toEqual({ from: '2026-04-16', to: '2026-05-15' });
    });

    it('1-day current range → 1-day previous range (the day before)', () => {
      // Edge case: from === to. Length = 1, prev = single day before.
      expect(
        deriveComparisonRange(
          { from: '2026-06-15', to: '2026-06-15' },
          'previous_period',
        ),
      ).toEqual({ from: '2026-06-14', to: '2026-06-14' });
    });

    it('honors calendar-month boundaries correctly across year flip', () => {
      // Current: Jan 1 – Feb 28 2026 (59 days). Comparison rolls into 2025.
      // prev.to = 2025-12-31, prev.from = prev.to - 58 days = 2025-11-03.
      expect(
        deriveComparisonRange(
          { from: '2026-01-01', to: '2026-02-28' },
          'previous_period',
        ),
      ).toEqual({ from: '2025-11-03', to: '2025-12-31' });
    });
  });

  describe("mode='previous_year'", () => {
    it('shifts both endpoints back exactly 365 days', () => {
      // Apr 1 – Jun 30 2026 → Apr 1 – Jun 30 2025 (no leap correction).
      expect(
        deriveComparisonRange(
          { from: '2026-04-01', to: '2026-06-30' },
          'previous_year',
        ),
      ).toEqual({ from: '2025-04-01', to: '2025-06-30' });
    });

    it('preserves the span length across the 1-year shift', () => {
      // A 12-month window (366 days, leap-year span) shifted by 365 days
      // lands one day shy of the prior-year same-day endpoint, matching
      // the documented "subDays(365)" semantics.
      const current = { from: '2026-01-01', to: '2026-12-31' };
      const result = deriveComparisonRange(current, 'previous_year');
      expect(result).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    });
  });
});

describe('comparisonLabelFor', () => {
  it("returns an empty string when mode='off' or range is null", () => {
    expect(comparisonLabelFor('off', { from: '2026-04-01', to: '2026-06-30' })).toBe(
      '',
    );
    expect(comparisonLabelFor('previous_period', null)).toBe('');
  });

  it("formats the previous_period label with the resolved range", () => {
    expect(
      comparisonLabelFor('previous_period', {
        from: '2026-01-01',
        to: '2026-03-31',
      }),
    ).toBe('vs prev period (2026-01-01 – 2026-03-31)');
  });

  it("formats the previous_year label with the resolved range", () => {
    expect(
      comparisonLabelFor('previous_year', {
        from: '2025-04-01',
        to: '2025-06-30',
      }),
    ).toBe('vs prev year (2025-04-01 – 2025-06-30)');
  });
});

// fix-124-a: float precision in JS comparison math leaks into the UI as
// 0.19999999%; formatCompareNumber kills the trail without losing signal.
// Pin the noisy float boundaries that motivated this fix.
describe('formatCompareNumber (fix-124-a)', () => {
  it('rounds 0.19999999 down to 0.2 (the canonical leak)', () => {
    expect(formatCompareNumber(0.19999999)).toBe(0.2);
  });

  it('rounds 67.33333 to 67.3 (mid-precision aggregate)', () => {
    expect(formatCompareNumber(67.33333)).toBe(67.3);
  });

  it('rounds 0.30000000000000004 to 0.3 (the JS 0.1 + 0.2 classic)', () => {
    expect(formatCompareNumber(0.1 + 0.2)).toBe(0.3);
    expect(formatCompareNumber(0.30000000000000004)).toBe(0.3);
  });

  it('preserves a clean -2.7 (already 1-decimal)', () => {
    expect(formatCompareNumber(-2.7)).toBe(-2.7);
  });

  it('rounds 0 to 0', () => {
    expect(formatCompareNumber(0)).toBe(0);
  });

  it('rounds clean integer 25 to 25 (no trailing .0 on whole numbers)', () => {
    // The helper returns NUMBER, so 25 stringifies to "25", not "25.0".
    expect(formatCompareNumber(25)).toBe(25);
    expect(String(formatCompareNumber(25))).toBe('25');
  });

  it('rounds-half-to-even via the *10 trick (12.45 → 12.5)', () => {
    // Math.round is round-half-up at the *10 boundary; 12.45 * 10 = 124.5
    // which rounds up to 125 → 12.5. Pin so a future "use toFixed" refactor
    // doesn't silently switch the half-rounding rule.
    expect(formatCompareNumber(12.45)).toBe(12.5);
  });
});

// fix-124-b: preset chip date math + active detection.
//
// "today" is anchored at midday-UTC in each test so the math doesn't drift
// across DST edges (same convention as deriveComparisonRange).
describe('rangeForPreset (fix-124-b)', () => {
  function todayAt(y: number, m1: number, d: number): Date {
    return new Date(Date.UTC(y, m1 - 1, d, 12, 0, 0));
  }

  describe('this_month_vs_last', () => {
    it('mid-month 2026-06-05 → 2026-06-01 .. 2026-06-30', () => {
      expect(rangeForPreset('this_month_vs_last', todayAt(2026, 6, 5))).toEqual({
        from: '2026-06-01',
        to: '2026-06-30',
      });
    });

    it('Feb on a leap year emits the 29th', () => {
      expect(rangeForPreset('this_month_vs_last', todayAt(2024, 2, 10))).toEqual({
        from: '2024-02-01',
        to: '2024-02-29',
      });
    });
  });

  describe('this_quarter_vs_last (Bobby spec example)', () => {
    it('2026-06-05 → Q2 2026 (2026-04-01 .. 2026-06-30)', () => {
      expect(
        rangeForPreset('this_quarter_vs_last', todayAt(2026, 6, 5)),
      ).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    });

    it('Jan → Q1 (Jan 1 – Mar 31)', () => {
      expect(
        rangeForPreset('this_quarter_vs_last', todayAt(2026, 1, 15)),
      ).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    });

    it('Oct → Q4 (Oct 1 – Dec 31)', () => {
      expect(
        rangeForPreset('this_quarter_vs_last', todayAt(2026, 10, 2)),
      ).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    });
  });

  describe('this_year_vs_last', () => {
    it('any day in 2026 → 2026-01-01 .. 2026-12-31', () => {
      expect(
        rangeForPreset('this_year_vs_last', todayAt(2026, 6, 5)),
      ).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    });
  });

  describe('last_30/60/90_d_vs_prior', () => {
    it('last_30d on 2026-06-05 → 2026-05-07 .. 2026-06-05 (inclusive 30d)', () => {
      // 2026-06-05 minus 29 days = 2026-05-07; 29 + the endpoint = 30 days inclusive.
      expect(
        rangeForPreset('last_30d_vs_prior', todayAt(2026, 6, 5)),
      ).toEqual({ from: '2026-05-07', to: '2026-06-05' });
    });

    it('last_60d on 2026-06-05 → 2026-04-07 .. 2026-06-05', () => {
      expect(
        rangeForPreset('last_60d_vs_prior', todayAt(2026, 6, 5)),
      ).toEqual({ from: '2026-04-07', to: '2026-06-05' });
    });

    it('last_90d on 2026-06-05 → 2026-03-08 .. 2026-06-05', () => {
      expect(
        rangeForPreset('last_90d_vs_prior', todayAt(2026, 6, 5)),
      ).toEqual({ from: '2026-03-08', to: '2026-06-05' });
    });
  });

  describe('activeComparePreset', () => {
    const today = todayAt(2026, 6, 5);

    it('returns null when compareTo is off', () => {
      expect(
        activeComparePreset(
          { from: '2026-04-01', to: '2026-06-30' },
          'off',
          today,
        ),
      ).toBeNull();
    });

    it('returns null when compareTo is previous_year (no preset uses it)', () => {
      expect(
        activeComparePreset(
          { from: '2026-04-01', to: '2026-06-30' },
          'previous_year',
          today,
        ),
      ).toBeNull();
    });

    it('matches this_quarter_vs_last on (2026-04-01, 2026-06-30, previous_period)', () => {
      expect(
        activeComparePreset(
          { from: '2026-04-01', to: '2026-06-30' },
          'previous_period',
          today,
        ),
      ).toBe('this_quarter_vs_last');
    });

    it('matches last_60d_vs_prior on (2026-04-07, 2026-06-05, previous_period)', () => {
      expect(
        activeComparePreset(
          { from: '2026-04-07', to: '2026-06-05' },
          'previous_period',
          today,
        ),
      ).toBe('last_60d_vs_prior');
    });

    it('returns null on a custom slice that matches no preset', () => {
      expect(
        activeComparePreset(
          { from: '2026-04-02', to: '2026-06-30' }, // off by one day from this_quarter
          'previous_period',
          today,
        ),
      ).toBeNull();
    });
  });
});

// ============================================================
// fix-137-a: new explicit-Period-B compare model
// ============================================================

describe('applyComparePreset', () => {
  // System knows "today" = 2026-05-15 (matches the test harness anchor).
  const today = new Date('2026-05-15T12:00:00Z');

  it('this_month_vs_last → May 2026 vs Apr 2026', () => {
    const pair = applyComparePreset('this_month_vs_last', today);
    expect(pair.periodA).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(pair.periodB).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  it('this_quarter_vs_last → Q2 2026 vs Q1 2026 (calendar snap)', () => {
    const pair = applyComparePreset('this_quarter_vs_last', today);
    expect(pair.periodA).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(pair.periodB).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('this_year_vs_last → 2026 vs 2025 (calendar snap)', () => {
    const pair = applyComparePreset('this_year_vs_last', today);
    expect(pair.periodA).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(pair.periodB).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('last_30d_vs_prior → 30-day window ending today vs the 30 days before that', () => {
    const pair = applyComparePreset('last_30d_vs_prior', today);
    // 30 days inclusive ending 2026-05-15 → 2026-04-16 ... 2026-05-15.
    expect(pair.periodA).toEqual({ from: '2026-04-16', to: '2026-05-15' });
    // Length-mirror (NOT a calendar snap — the window isn't a calendar month).
    expect(pair.periodB).toEqual({ from: '2026-03-17', to: '2026-04-15' });
  });

  it('last_60d_vs_prior length-mirrors a 60-day window', () => {
    const pair = applyComparePreset('last_60d_vs_prior', today);
    expect(pair.periodA.to).toBe('2026-05-15');
    expect(pair.periodB.to).toBe(
      // periodA.from - 1 day
      '2026-03-16',
    );
  });

  it('last_90d_vs_prior length-mirrors a 90-day window', () => {
    const pair = applyComparePreset('last_90d_vs_prior', today);
    expect(pair.periodA.to).toBe('2026-05-15');
    // periodA.from = 90d back inclusive = 2026-02-15; periodB.to = 2026-02-14.
    expect(pair.periodA.from).toBe('2026-02-15');
    expect(pair.periodB.to).toBe('2026-02-14');
  });
});

describe('legacyCompareToRange — URL bookmark migration', () => {
  it('"previous_period" + Q2 2026 → Q1 2026 (calendar snap)', () => {
    const range = legacyCompareToRange(
      { from: '2026-04-01', to: '2026-06-30' },
      'previous_period',
    );
    expect(range).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('"previous_year" + Apr 2026 → 1-year-prior (365-day shift)', () => {
    const range = legacyCompareToRange(
      { from: '2026-04-01', to: '2026-04-30' },
      'previous_year',
    );
    // 365-day shift via the legacy helper.
    expect(range?.from).toBe('2025-04-01');
    expect(range?.to).toBe('2025-04-30');
  });

  it('"off" → null', () => {
    expect(
      legacyCompareToRange({ from: '2026-04-01', to: '2026-04-30' }, 'off'),
    ).toBeNull();
  });

  it('null compareTo → null', () => {
    expect(
      legacyCompareToRange({ from: '2026-04-01', to: '2026-04-30' }, null),
    ).toBeNull();
  });

  it('unknown compareTo value → null (defensive)', () => {
    expect(
      legacyCompareToRange(
        { from: '2026-04-01', to: '2026-04-30' },
        'previous_decade',
      ),
    ).toBeNull();
  });

  it('null currentRange → null', () => {
    expect(legacyCompareToRange(null, 'previous_period')).toBeNull();
  });
});

describe('comparisonLabelForRange', () => {
  it('formats a range as "vs from – to"', () => {
    expect(
      comparisonLabelForRange({ from: '2026-01-01', to: '2026-03-31' }),
    ).toBe('vs 2026-01-01 – 2026-03-31');
  });

  it('null range → empty string', () => {
    expect(comparisonLabelForRange(null)).toBe('');
  });
});
