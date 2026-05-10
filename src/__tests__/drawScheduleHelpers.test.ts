import { describe, it, expect } from 'vitest';
import {
  DS_STATUS_COLORS,
  addWeeks,
  addWeeksToWeekKey,
  dateToWeekKey,
  decideDrop,
  getMonday,
  getQuarterLabel,
  getQuarterStart,
  getQuarterWeeks,
  jurisBorder,
  multiMatchAddress,
  rangeOverlapsWeeks,
  weekRangeOverlap,
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

describe('addWeeksToWeekKey', () => {
  it('shifts forward by N weeks (preserves Monday alignment)', () => {
    expect(addWeeksToWeekKey('2026-05-04', 1)).toBe('2026-05-11');
    expect(addWeeksToWeekKey('2026-05-04', 4)).toBe('2026-06-01');
  });

  it('shifts backward when N is negative', () => {
    expect(addWeeksToWeekKey('2026-05-11', -2)).toBe('2026-04-27');
  });

  it('crosses year boundaries cleanly', () => {
    expect(addWeeksToWeekKey('2025-12-29', 1)).toBe('2026-01-05');
  });
});

describe('weekRangeOverlap', () => {
  it('returns true when ranges fully overlap', () => {
    expect(weekRangeOverlap('2026-05-04', '2026-05-18', '2026-05-04', '2026-05-18')).toBe(true);
  });

  it('returns true when ranges partially overlap (right edge)', () => {
    expect(weekRangeOverlap('2026-05-04', '2026-05-18', '2026-05-11', '2026-05-25')).toBe(true);
  });

  it('returns true when one range fully contains the other', () => {
    expect(weekRangeOverlap('2026-05-04', '2026-06-15', '2026-05-18', '2026-05-25')).toBe(true);
  });

  it('returns true when ranges touch on a single boundary week', () => {
    expect(weekRangeOverlap('2026-05-04', '2026-05-11', '2026-05-11', '2026-05-18')).toBe(true);
  });

  it('returns false when ranges are fully disjoint', () => {
    expect(weekRangeOverlap('2026-05-04', '2026-05-11', '2026-05-25', '2026-06-08')).toBe(false);
  });
});

describe('decideDrop', () => {
  const blocks = [
    { projectId: 'anchor', startWeek: '2026-05-04', endWeek: '2026-05-18' },
    { projectId: 'other-1', startWeek: '2026-06-01', endWeek: '2026-06-15' },
    { projectId: 'other-2', startWeek: '2026-07-13', endWeek: '2026-07-27' },
  ];

  it('returns save when target range does not overlap any other block', () => {
    expect(decideDrop(blocks, 'anchor', '2026-08-03', '2026-08-17')).toEqual({
      kind: 'save',
    });
  });

  it('ignores the anchor itself when checking overlap', () => {
    // Dropping anchor onto its own current range is not a conflict.
    expect(decideDrop(blocks, 'anchor', '2026-05-04', '2026-05-18')).toEqual({
      kind: 'save',
    });
  });

  it('returns overlap with the conflicting project ids when ranges collide', () => {
    const result = decideDrop(blocks, 'anchor', '2026-06-08', '2026-06-22');
    expect(result.kind).toBe('overlap');
    if (result.kind === 'overlap') {
      expect(result.conflictingProjectIds).toEqual(['other-1']);
    }
  });

  it('captures multiple conflicts when target range spans several blocks', () => {
    const result = decideDrop(blocks, 'anchor', '2026-06-01', '2026-07-27');
    expect(result.kind).toBe('overlap');
    if (result.kind === 'overlap') {
      expect(result.conflictingProjectIds.sort()).toEqual(['other-1', 'other-2']);
    }
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
