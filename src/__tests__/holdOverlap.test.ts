import { describe, it, expect } from 'vitest';
import {
  heldOverlapDays,
  accountableDays,
  hasActiveHold,
  intervalOverlapsHold,
  holdWindows,
} from '../lib/holdOverlap';
import type { ProjectHold } from '../lib/database.types';

// fix-170: the canonical hold-overlap math. Accountable duration =
// (end − start) − (calendar days within [start,end] inside any hold window).
// Active hold → hold_end = today. Overlaps UNIONed (never double-counted).

function w(start: string, end: string | null) {
  return { start, end };
}

const TODAY = '2026-06-20';

describe('hasActiveHold', () => {
  it('true when any hold is open (hold_end null)', () => {
    expect(hasActiveHold([w('2026-06-01', '2026-06-05'), w('2026-06-10', null)])).toBe(true);
  });
  it('false when all holds are closed / empty / null', () => {
    expect(hasActiveHold([w('2026-06-01', '2026-06-05')])).toBe(false);
    expect(hasActiveHold([])).toBe(false);
    expect(hasActiveHold(null)).toBe(false);
  });
  it('reads ProjectHold rows directly', () => {
    const rows = [{ hold_end: null }] as Pick<ProjectHold, 'hold_end'>[];
    expect(hasActiveHold(rows)).toBe(true);
  });
});

describe('holdWindows', () => {
  it('normalizes ProjectHold rows to {start,end}', () => {
    const rows = [
      { hold_start: '2026-06-01', hold_end: '2026-06-05' },
    ] as Pick<ProjectHold, 'hold_start' | 'hold_end'>[];
    expect(holdWindows(rows)).toEqual([{ start: '2026-06-01', end: '2026-06-05' }]);
  });
  it('passes through already-built windows + handles null', () => {
    expect(holdWindows([w('2026-06-01', null)])).toEqual([{ start: '2026-06-01', end: null }]);
    expect(holdWindows(null)).toEqual([]);
  });
});

describe('heldOverlapDays', () => {
  const interval: [string, string] = ['2026-06-01', '2026-07-01']; // 30 days

  it('no holds → 0 overlap', () => {
    expect(heldOverlapDays([], ...interval)).toBe(0);
    expect(heldOverlapDays(null, ...interval)).toBe(0);
  });

  it('hold entirely before the interval → 0', () => {
    expect(heldOverlapDays([w('2026-05-01', '2026-05-20')], ...interval)).toBe(0);
  });

  it('hold entirely after the interval → 0', () => {
    expect(heldOverlapDays([w('2026-07-10', '2026-07-20')], ...interval)).toBe(0);
  });

  it('hold fully inside the interval → its full length', () => {
    // 2026-06-10 .. 2026-06-20 = 10 days
    expect(heldOverlapDays([w('2026-06-10', '2026-06-20')], ...interval)).toBe(10);
  });

  it('hold at the END of the interval (== restart-at-lift): overlap = end − hold_start', () => {
    // hold 2026-06-21 .. 2026-07-01 = 10 days clipped to interval end
    expect(heldOverlapDays([w('2026-06-21', '2026-07-01')], ...interval)).toBe(10);
  });

  it('hold straddling the start edge → clipped to interval start', () => {
    // hold 2026-05-25 .. 2026-06-06 → clipped 2026-06-01..2026-06-06 = 5 days
    expect(heldOverlapDays([w('2026-05-25', '2026-06-06')], ...interval)).toBe(5);
  });

  it('hold straddling the end edge → clipped to interval end', () => {
    // hold 2026-06-25 .. 2026-07-10 → clipped 2026-06-25..2026-07-01 = 6 days
    expect(heldOverlapDays([w('2026-06-25', '2026-07-10')], ...interval)).toBe(6);
  });

  it('multiple disjoint holds → summed', () => {
    expect(
      heldOverlapDays(
        [w('2026-06-05', '2026-06-08'), w('2026-06-20', '2026-06-25')],
        ...interval,
      ),
    ).toBe(3 + 5);
  });

  it('overlapping holds are UNIONed, not double-counted', () => {
    // 2026-06-10..2026-06-20 (10) ∪ 2026-06-15..2026-06-25 (overlaps) = 2026-06-10..2026-06-25 = 15
    expect(
      heldOverlapDays(
        [w('2026-06-10', '2026-06-20'), w('2026-06-15', '2026-06-25')],
        ...interval,
      ),
    ).toBe(15);
  });

  it('active (open) hold resolves end to today', () => {
    // hold 2026-06-10 .. (active) with today 2026-06-20 → 10 days
    expect(heldOverlapDays([w('2026-06-10', null)], ...interval, TODAY)).toBe(10);
  });

  it('active hold clamps to the interval end when today is past it', () => {
    // hold 2026-06-25 .. (active), today after interval end → clipped to end 2026-07-01 = 6
    expect(heldOverlapDays([w('2026-06-25', null)], ...interval, '2026-08-01')).toBe(6);
  });

  it('invalid / missing interval dates → 0', () => {
    expect(heldOverlapDays([w('2026-06-10', '2026-06-20')], null, '2026-07-01')).toBe(0);
    expect(heldOverlapDays([w('2026-06-10', '2026-06-20')], '2026-06-01', null)).toBe(0);
  });

  it('malformed hold window (end before start) is ignored', () => {
    expect(heldOverlapDays([w('2026-06-20', '2026-06-10')], ...interval)).toBe(0);
  });
});

describe('accountableDays', () => {
  const interval: [string, string] = ['2026-06-01', '2026-07-01']; // raw 30

  it('no holds → raw duration unchanged (the common case is untouched)', () => {
    expect(accountableDays([], ...interval)).toBe(30);
    expect(accountableDays(null, ...interval)).toBe(30);
  });

  it('hold in the middle subtracts only the held days', () => {
    // 10 held → 20 accountable
    expect(accountableDays([w('2026-06-10', '2026-06-20')], ...interval)).toBe(20);
  });

  it('hold at the end == restart at lift', () => {
    // held 2026-06-21..2026-07-01 = 10 → accountable 20 (clock effectively restarts at lift)
    expect(accountableDays([w('2026-06-21', '2026-07-01')], ...interval)).toBe(20);
  });

  it('active hold to today subtracts the ongoing held days', () => {
    expect(accountableDays([w('2026-06-10', null)], ...interval, TODAY)).toBe(20);
  });

  it('never negative (hold longer than measured interval)', () => {
    expect(
      accountableDays([w('2026-05-01', '2026-08-01')], ...interval),
    ).toBe(0);
  });

  it('invalid interval → null (mirrors daysBetween)', () => {
    expect(accountableDays([], null, '2026-07-01')).toBeNull();
    expect(accountableDays([], '2026-06-01', undefined)).toBeNull();
  });

  it('zero / negative raw intervals preserved as-is', () => {
    expect(accountableDays([], '2026-06-01', '2026-06-01')).toBe(0);
    expect(accountableDays([], '2026-07-01', '2026-06-01')).toBe(-30);
  });
});

describe('intervalOverlapsHold (effect E gate)', () => {
  const interval: [string, string] = ['2026-06-01', '2026-07-01'];
  it('true when the measured interval touched any hold', () => {
    expect(intervalOverlapsHold([w('2026-06-10', '2026-06-12')], ...interval)).toBe(true);
  });
  it('false when no hold overlaps', () => {
    expect(intervalOverlapsHold([w('2026-05-01', '2026-05-10')], ...interval)).toBe(false);
    expect(intervalOverlapsHold([], ...interval)).toBe(false);
  });
  it('true for an active hold overlapping (end=today)', () => {
    expect(intervalOverlapsHold([w('2026-06-15', null)], ...interval, TODAY)).toBe(true);
  });
});
