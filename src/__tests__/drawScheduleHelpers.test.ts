import { describe, it, expect } from 'vitest';
import {
  DS_STATUS_COLORS,
  addWeeks,
  dateToWeekKey,
  getMonday,
  getQuarterLabel,
  getQuarterStart,
  getQuarterWeeks,
  jurisBorder,
  multiMatchAddress,
  rangeOverlapsWeeks,
} from '../lib/drawScheduleHelpers';

// Q6.1: pure-helper tests. Quarter math, week-key Monday alignment, and
// search/overlap predicates the grid relies on.

describe('getMonday', () => {
  it('returns Monday for any day in the week', () => {
    // 2026-04-29 is a Wednesday → Monday is 2026-04-27.
    const wed = new Date(2026, 3, 29); // month is 0-indexed
    expect(getMonday(wed).toISOString().slice(0, 10)).toBe('2026-04-27');
  });

  it('rolls Sunday back to the previous Monday (not forward)', () => {
    // 2026-05-03 is a Sunday → Monday is 2026-04-27.
    const sun = new Date(2026, 4, 3);
    expect(getMonday(sun).toISOString().slice(0, 10)).toBe('2026-04-27');
  });

  it('returns the same day when given a Monday', () => {
    const mon = new Date(2026, 4, 4); // 2026-05-04 is Monday
    expect(getMonday(mon).toISOString().slice(0, 10)).toBe('2026-05-04');
  });
});

describe('dateToWeekKey + addWeeks', () => {
  it('produces YYYY-MM-DD strings', () => {
    expect(dateToWeekKey(new Date(2026, 4, 4))).toBe('2026-05-04');
  });

  it('addWeeks shifts by 7-day increments', () => {
    const start = new Date(2026, 4, 4);
    expect(addWeeks(start, 1).toISOString().slice(0, 10)).toBe('2026-05-11');
    expect(addWeeks(start, -2).toISOString().slice(0, 10)).toBe('2026-04-20');
  });
});

describe('getQuarterStart + getQuarterLabel', () => {
  it('current quarter (offset=0) for May 2026 is Q2', () => {
    const now = new Date(2026, 4, 15); // May 15, 2026
    const qs = getQuarterStart(0, now);
    expect(qs.getFullYear()).toBe(2026);
    expect(qs.getMonth()).toBe(3); // April (Q2 starts in April)
    expect(getQuarterLabel(0, now)).toBe('Q2 2026');
  });

  it('next quarter rolls into Q3 2026', () => {
    const now = new Date(2026, 4, 15);
    expect(getQuarterLabel(1, now)).toBe('Q3 2026');
  });

  it('previous quarter rolls into Q1 2026', () => {
    const now = new Date(2026, 4, 15);
    expect(getQuarterLabel(-1, now)).toBe('Q1 2026');
  });

  it('rolling backward past January goes to Q4 of previous year', () => {
    const now = new Date(2026, 1, 15); // Feb 2026 (Q1)
    expect(getQuarterLabel(-1, now)).toBe('Q4 2025');
  });
});

describe('getQuarterWeeks', () => {
  it('returns ~13 Monday week-keys covering Q2 2026', () => {
    const now = new Date(2026, 4, 15);
    const weeks = getQuarterWeeks(0, now);
    expect(weeks.length).toBeGreaterThanOrEqual(12);
    expect(weeks.length).toBeLessThanOrEqual(14);
    // Every entry should parse to a Monday.
    for (const wk of weeks) {
      const d = new Date(`${wk}T12:00:00`);
      expect(d.getDay()).toBe(1);
    }
  });
});

describe('rangeOverlapsWeeks', () => {
  const weeks = ['2026-04-27', '2026-05-04', '2026-05-11', '2026-05-18'];

  it('returns true for full overlap', () => {
    expect(rangeOverlapsWeeks('2026-05-04', '2026-05-11', weeks)).toBe(true);
  });

  it('returns true for partial overlap (range starts before the quarter)', () => {
    expect(rangeOverlapsWeeks('2026-04-13', '2026-05-04', weeks)).toBe(true);
  });

  it('returns false for ranges entirely before the quarter', () => {
    expect(rangeOverlapsWeeks('2026-03-01', '2026-04-13', weeks)).toBe(false);
  });

  it('returns false when start_week or end_week is null', () => {
    expect(rangeOverlapsWeeks(null, '2026-05-04', weeks)).toBe(false);
    expect(rangeOverlapsWeeks('2026-05-04', null, weeks)).toBe(false);
  });
});

describe('multiMatchAddress', () => {
  it('matches every token (case-insensitive) anywhere in the haystack', () => {
    expect(multiMatchAddress('main 123', '123 Main St')).toBe(true);
    expect(multiMatchAddress('OAK ave', '456 Oak Ave')).toBe(true);
  });

  it('returns false when any token is missing', () => {
    expect(multiMatchAddress('main pine', '123 Main St')).toBe(false);
  });

  it('empty query matches everything', () => {
    expect(multiMatchAddress('', '123 Main St')).toBe(true);
    expect(multiMatchAddress('   ', '123 Main St')).toBe(true);
  });
});

describe('DS_STATUS_COLORS + jurisBorder', () => {
  it('Scheduled has the expected white background', () => {
    expect(DS_STATUS_COLORS.Scheduled.bg).toBe('#ffffff');
  });

  it('Approved is the green status', () => {
    expect(DS_STATUS_COLORS.Approved.bg).toBe('#5abf75');
  });

  it('jurisdiction borders match v1 (Seattle blue, Phoenix red, default green)', () => {
    expect(jurisBorder('Seattle')).toBe('#1d4ed8');
    expect(jurisBorder('PHOENIX')).toBe('#dc2626');
    expect(jurisBorder('Bellevue')).toBe('#16a34a');
    expect(jurisBorder(null)).toBe('#16a34a');
  });
});
