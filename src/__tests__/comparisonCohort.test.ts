import { describe, it, expect } from 'vitest';
import {
  comparisonLabelFor,
  deriveComparisonRange,
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
    it('Q2 (Apr 1 – Jun 30) → length-preserving 91-day span ending Mar 31', () => {
      // Brief described the use case as "Q1 vs Q2" but the implementation
      // is length-preserving (matches the "last 30 days" use case and any
      // custom span). Q1 (Jan 1 – Mar 31) is 90 days; Q2 (Apr 1 – Jun 30)
      // is 91 days — they're not actually mirrors. The length-preserving
      // result lands on Dec 31 2025 – Mar 31 2026 (91 days inclusive),
      // shifted one day earlier than the calendar-aligned Q1. The
      // single-day drift is acceptable; calendar-quarter snapping isn't
      // generalizable to arbitrary ranges.
      expect(
        deriveComparisonRange(
          { from: '2026-04-01', to: '2026-06-30' },
          'previous_period',
        ),
      ).toEqual({ from: '2025-12-31', to: '2026-03-31' });
    });

    it('exactly-90-day Q2-ish range → calendar-aligned Q1 cleanly', () => {
      // Apr 1 – Jun 29 is 90 days (= Q1's length). Length-preserving math
      // lands prev exactly on Q1 (Jan 1 – Mar 31). Demonstrates the brief's
      // intent works when the user picks a span that matches the previous
      // calendar period's length.
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
