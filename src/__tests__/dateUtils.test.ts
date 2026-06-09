import { describe, it, expect } from 'vitest';
import { snapToMonday, addDays, quarterToDateRange } from '../lib/dateUtils';

// fix-141: pins snapToMonday so it stays byte-for-byte aligned with the SQL
// snap_to_monday_forward() helper (migrations/fix_141_*). The week used for the
// weekday round-trip is 2026-06-15 (Mon) .. 2026-06-21 (Sun) — the same week as
// the 6605 57th Ave NE forward-snap target.

// 2026-06-15 = Monday, then Tue..Sun follow.
const MON = '2026-06-15';
const TUE = '2026-06-16';
const WED = '2026-06-17';
const THU = '2026-06-18';
const FRI = '2026-06-19';
const SAT = '2026-06-20';
const SUN = '2026-06-21';

describe('snapToMonday — forward (default)', () => {
  it('leaves a Monday unchanged', () => {
    expect(snapToMonday(MON)).toBe(MON);
    expect(snapToMonday(MON, 'forward')).toBe(MON);
  });
  it('snaps every other weekday to the NEXT Monday', () => {
    const NEXT_MON = '2026-06-22';
    expect(snapToMonday(TUE, 'forward')).toBe(NEXT_MON); // +6
    expect(snapToMonday(WED, 'forward')).toBe(NEXT_MON); // +5
    expect(snapToMonday(THU, 'forward')).toBe(NEXT_MON); // +4
    expect(snapToMonday(FRI, 'forward')).toBe(NEXT_MON); // +3
    expect(snapToMonday(SAT, 'forward')).toBe(NEXT_MON); // +2
    expect(snapToMonday(SUN, 'forward')).toBe(NEXT_MON); // +1
  });
  it('pins the 6605 scenario: Sat 2026-06-13 → Mon 2026-06-15', () => {
    expect(snapToMonday('2026-06-13', 'forward')).toBe('2026-06-15');
  });
});

describe('snapToMonday — back', () => {
  it('leaves a Monday unchanged', () => {
    expect(snapToMonday(MON, 'back')).toBe(MON);
  });
  it('snaps every other weekday to the PREVIOUS Monday', () => {
    expect(snapToMonday(TUE, 'back')).toBe(MON); // -1
    expect(snapToMonday(WED, 'back')).toBe(MON); // -2
    expect(snapToMonday(THU, 'back')).toBe(MON); // -3
    expect(snapToMonday(FRI, 'back')).toBe(MON); // -4
    expect(snapToMonday(SAT, 'back')).toBe(MON); // -5
    expect(snapToMonday(SUN, 'back')).toBe(MON); // -6
  });
});

describe('snapToMonday — nearest (smaller absolute offset, tie→forward)', () => {
  it('Monday stays Monday (0 offset)', () => {
    expect(snapToMonday(MON, 'nearest')).toBe(MON);
  });
  it('Tue/Wed/Thu round back (closer to the previous Monday)', () => {
    expect(snapToMonday(TUE, 'nearest')).toBe(MON); // back 1 < fwd 6
    expect(snapToMonday(WED, 'nearest')).toBe(MON); // back 2 < fwd 5
    expect(snapToMonday(THU, 'nearest')).toBe(MON); // back 3 < fwd 4
  });
  it('Fri/Sat/Sun round forward (closer to the next Monday)', () => {
    const NEXT_MON = '2026-06-22';
    expect(snapToMonday(FRI, 'nearest')).toBe(NEXT_MON); // fwd 3 < back 4
    expect(snapToMonday(SAT, 'nearest')).toBe(NEXT_MON); // fwd 2 < back 5
    expect(snapToMonday(SUN, 'nearest')).toBe(NEXT_MON); // fwd 1 < back 6
  });
});

describe('snapToMonday — input handling', () => {
  it('accepts a Date and a string identically', () => {
    // Construct the Date in local time on the same Y-M-D; parseUtcNoon
    // re-anchors so the calendar day is preserved regardless of timezone.
    const asDate = new Date(2026, 5, 20); // 2026-06-20 (Sat), local
    expect(snapToMonday(asDate, 'forward')).toBe('2026-06-22');
    expect(snapToMonday(SAT, 'forward')).toBe('2026-06-22');
  });
  it('ignores a time component on the string', () => {
    expect(snapToMonday('2026-06-20T23:59:59Z', 'forward')).toBe('2026-06-22');
  });
  it('returns null for null / undefined / empty / invalid', () => {
    expect(snapToMonday(null)).toBeNull();
    expect(snapToMonday(undefined)).toBeNull();
    expect(snapToMonday('')).toBeNull();
    expect(snapToMonday('   ')).toBeNull();
    expect(snapToMonday('not-a-date')).toBeNull();
    expect(snapToMonday('2026-13-40')).toBeNull(); // overflow must not coerce
    expect(snapToMonday(new Date('nope'))).toBeNull();
  });
  it('does not drift across a day boundary (tz-safe)', () => {
    // Every weekday of the same week forward-snaps to the one Monday.
    for (const d of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      const snapped = snapToMonday(d, 'forward');
      expect(snapped === MON || snapped === '2026-06-22').toBe(true);
    }
  });
});

describe('addDays', () => {
  it('adds days tz-safely and returns ISO', () => {
    expect(addDays('2026-06-15', 4)).toBe('2026-06-19'); // Mon → Fri
    expect(addDays('2026-06-15', 0)).toBe('2026-06-15');
    expect(addDays('2026-06-15', -3)).toBe('2026-06-12');
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01'); // month rollover
  });
  it('computes the Friday of a Monday end-week (Monday + 4)', () => {
    // The dd_end convention: Friday = the end-week Monday + 4.
    expect(addDays(snapToMonday('2026-07-13', 'back'), 4)).toBe('2026-07-17');
  });
  it('returns null for bad input', () => {
    expect(addDays(null, 4)).toBeNull();
    expect(addDays('', 4)).toBeNull();
    expect(addDays('garbage', 4)).toBeNull();
  });
});

describe('quarterToDateRange', () => {
  it('maps each quarter to its inclusive ISO bounds', () => {
    expect(quarterToDateRange('2026-Q1')).toEqual({
      start: '2026-01-01',
      end: '2026-03-31',
    });
    expect(quarterToDateRange('2026-Q2')).toEqual({
      start: '2026-04-01',
      end: '2026-06-30',
    });
    expect(quarterToDateRange('2026-Q3')).toEqual({
      start: '2026-07-01',
      end: '2026-09-30',
    });
    expect(quarterToDateRange('2026-Q4')).toEqual({
      start: '2026-10-01',
      end: '2026-12-31',
    });
  });
  it('respects the year', () => {
    expect(quarterToDateRange('2024-Q1')).toEqual({
      start: '2024-01-01',
      end: '2024-03-31',
    });
  });
  it('returns null for invalid quarters', () => {
    expect(quarterToDateRange('2026-Q5')).toBeNull();
    expect(quarterToDateRange('2026-Q0')).toBeNull();
    expect(quarterToDateRange('2026-1')).toBeNull();
    expect(quarterToDateRange('Q1-2026')).toBeNull();
    expect(quarterToDateRange('')).toBeNull();
    expect(quarterToDateRange(null)).toBeNull();
    expect(quarterToDateRange(undefined)).toBeNull();
  });
});
