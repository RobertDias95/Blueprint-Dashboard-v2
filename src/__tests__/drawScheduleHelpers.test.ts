import { describe, it, expect } from 'vitest';
import {
  DS_STATUS_COLORS,
  addWeeks,
  addWeeksToWeekKey,
  computeNpSegments,
  dateToWeekKey,
  decideDrop,
  findNpConflictsForDrop,
  formatWeekRange,
  getMonday,
  getQuarterLabel,
  getQuarterStart,
  getQuarterWeeks,
  jurisBorder,
  multiMatchAddress,
  planPushDown,
  rangeOverlapsWeeks,
  weekRangeOverlap,
  blockTier,
  blockOverflow,
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

describe('planPushDown (Q6.2.b cascade math)', () => {
  it('returns empty plan when no other blocks overlap with the anchor', () => {
    const blocks = [
      { projectId: 'far', startWeek: '2026-08-03', endWeek: '2026-08-17' },
    ];
    expect(planPushDown(blocks, '2026-05-04', '2026-05-18')).toEqual([]);
  });

  it('skips blocks that are entirely BEFORE the anchor', () => {
    const blocks = [
      { projectId: 'before', startWeek: '2026-04-06', endWeek: '2026-04-20' },
    ];
    expect(planPushDown(blocks, '2026-05-04', '2026-05-18')).toEqual([]);
  });

  it('pushes a single overlapping block immediately after the anchor end, preserving duration', () => {
    // Anchor at W5–W7 (3 weeks). Conflict at W6–W9 (4 weeks).
    // Expected: pushed to W8–W11 (still 4 weeks).
    const blocks = [
      { projectId: 'conflict', startWeek: '2026-05-11', endWeek: '2026-06-01' },
    ];
    const plan = planPushDown(blocks, '2026-05-04', '2026-05-18');
    expect(plan).toEqual([
      {
        projectId: 'conflict',
        newStartWeek: '2026-05-25',
        newEndWeek: '2026-06-15', // 25 + 3 weeks = June 15
      },
    ]);
  });

  it('cascades: pushing block A forces an overlap with block B → B pushed too', () => {
    // Anchor at 2026-05-04–2026-05-04 (1 week).
    // Block A at 2026-05-04–2026-05-11 (2 weeks) → must push.
    // Block B at 2026-05-18–2026-05-18 (1 week) → originally NOT overlapping
    // anchor, but after A is pushed to 2026-05-11–2026-05-18, B at 05-18
    // overlaps with A's new end → B also pushed.
    const blocks = [
      { projectId: 'A', startWeek: '2026-05-04', endWeek: '2026-05-11' },
      { projectId: 'B', startWeek: '2026-05-18', endWeek: '2026-05-18' },
    ];
    const plan = planPushDown(blocks, '2026-05-04', '2026-05-04');
    expect(plan).toEqual([
      {
        projectId: 'A',
        newStartWeek: '2026-05-11',
        newEndWeek: '2026-05-18',
      },
      {
        projectId: 'B',
        newStartWeek: '2026-05-25',
        newEndWeek: '2026-05-25',
      },
    ]);
  });

  it('leaves blocks AFTER the anchor end alone if they do not overlap the frontier', () => {
    const blocks = [
      // Anchor will end at 2026-05-18; this block starts well after.
      { projectId: 'far-after', startWeek: '2026-07-13', endWeek: '2026-07-27' },
    ];
    expect(planPushDown(blocks, '2026-05-04', '2026-05-18')).toEqual([]);
  });

  it('processes blocks in current-start order (so the cascade is deterministic)', () => {
    // Provide blocks in REVERSE start order; planner must sort them.
    // Anchor W04–W11. A overlaps anchor on its leading edge; B sits right
    // after A's original position. After pushing A, B then overlaps too.
    const blocks = [
      { projectId: 'B', startWeek: '2026-05-18', endWeek: '2026-05-25' },
      { projectId: 'A', startWeek: '2026-05-11', endWeek: '2026-05-18' },
    ];
    const plan = planPushDown(blocks, '2026-05-04', '2026-05-11');
    // Sorted: A (W11) first, then B (W18).
    // A: overlaps [W04, W11] → push. dur=1 week. new=W18–W25. frontier=W25.
    // B: overlaps [W04, W25] (B.start=W18 ≤ W25) → push. dur=1 week.
    //    new=W25+1wk=2026-06-01, end=2026-06-01.
    expect(plan.map((p) => p.projectId)).toEqual(['A', 'B']);
    expect(plan[0]).toEqual({
      projectId: 'A',
      newStartWeek: '2026-05-18',
      newEndWeek: '2026-05-25',
    });
    expect(plan[1]).toEqual({
      projectId: 'B',
      newStartWeek: '2026-06-01',
      // B's original duration was 1 week-shift (W18 → W25). Preserved:
      // new_start=2026-06-01 → new_end=2026-06-01 + 1 week = 2026-06-08.
      newEndWeek: '2026-06-08',
    });
  });
});

describe('findNpConflictsForDrop (Q6.2.d)', () => {
  const npBlocks = [
    {
      id: 'vac-1',
      daName: 'Trevor',
      type: 'Vacation',
      label: 'Vacation',
      startWeek: '2026-04-27',
      endWeek: '2026-05-04',
    },
    {
      id: 'redesign-1',
      daName: 'Trevor',
      type: 'Redesign',
      label: 'Redesign sprint',
      startWeek: '2026-06-15',
      endWeek: '2026-06-29',
    },
  ];

  it('returns empty when target range overlaps no NP blocks', () => {
    expect(findNpConflictsForDrop(npBlocks, '2026-08-03', '2026-08-17')).toEqual([]);
  });

  it('returns the single NP block the drop overlaps', () => {
    const result = findNpConflictsForDrop(npBlocks, '2026-05-04', '2026-05-11');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('vac-1');
  });

  it('returns multiple NP blocks when the range spans several', () => {
    const result = findNpConflictsForDrop(npBlocks, '2026-05-04', '2026-06-22');
    expect(result.map((n) => n.id).sort()).toEqual(['redesign-1', 'vac-1']);
  });

  it('treats touching boundaries as overlap (consistent with project overlap predicate)', () => {
    // Drop ends exactly on the NP's start week.
    expect(findNpConflictsForDrop(npBlocks, '2026-04-20', '2026-04-27')).toHaveLength(1);
  });
});

describe('computeNpSegments (Q6.2.e NP clipping)', () => {
  // 5-week quarter for these tests.
  const weeks = [
    '2026-05-04',
    '2026-05-11',
    '2026-05-18',
    '2026-05-25',
    '2026-06-01',
  ];

  it('no overlap → returns the full NP range as one segment', () => {
    const segs = computeNpSegments(
      '2026-05-04',
      '2026-05-18',
      [{ startWeek: '2026-09-01', endWeek: '2026-09-08' }],
      weeks,
    );
    expect(segs).toEqual([
      { startWeek: '2026-05-04', endWeek: '2026-05-18' },
    ]);
  });

  it('project fully covers NP → returns []', () => {
    const segs = computeNpSegments(
      '2026-05-11',
      '2026-05-18',
      [{ startWeek: '2026-05-04', endWeek: '2026-05-25' }],
      weeks,
    );
    expect(segs).toEqual([]);
  });

  it('project covers the START of the NP → tail segment visible', () => {
    // Common case Bobby cited: weeks 1–N covered, "vacation ends week X" stays readable.
    const segs = computeNpSegments(
      '2026-05-04',
      '2026-05-25',
      [{ startWeek: '2026-05-04', endWeek: '2026-05-11' }],
      weeks,
    );
    expect(segs).toEqual([
      { startWeek: '2026-05-18', endWeek: '2026-05-25' },
    ]);
  });

  it('project covers the MIDDLE of the NP → two segments (head + tail)', () => {
    const segs = computeNpSegments(
      '2026-05-04',
      '2026-06-01',
      [{ startWeek: '2026-05-11', endWeek: '2026-05-18' }],
      weeks,
    );
    expect(segs).toEqual([
      { startWeek: '2026-05-04', endWeek: '2026-05-04' },
      { startWeek: '2026-05-25', endWeek: '2026-06-01' },
    ]);
  });

  it('two projects splitting the NP into three segments', () => {
    const segs = computeNpSegments(
      '2026-05-04',
      '2026-06-01',
      [
        { startWeek: '2026-05-11', endWeek: '2026-05-11' },
        { startWeek: '2026-05-25', endWeek: '2026-05-25' },
      ],
      weeks,
    );
    expect(segs).toEqual([
      { startWeek: '2026-05-04', endWeek: '2026-05-04' },
      { startWeek: '2026-05-18', endWeek: '2026-05-18' },
      { startWeek: '2026-06-01', endWeek: '2026-06-01' },
    ]);
  });

  it('NP extends outside the visible quarter → clips to visible weeks only', () => {
    const segs = computeNpSegments(
      '2026-04-01', // before quarter
      '2026-05-18', // mid-quarter
      [],
      weeks,
    );
    expect(segs).toEqual([
      { startWeek: '2026-05-04', endWeek: '2026-05-18' },
    ]);
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

describe('formatWeekRange (fix-25-feat-c)', () => {
  it('returns "M/D — M/D" Monday → Friday for a same-month week', () => {
    expect(formatWeekRange('2026-05-25')).toBe('5/25 — 5/29');
  });

  it('handles month boundaries cleanly', () => {
    // Week of June 29 2026: Mon 6/29, Fri 7/3 (crosses month boundary).
    expect(formatWeekRange('2026-06-29')).toBe('6/29 — 7/3');
  });

  it('handles year boundaries cleanly', () => {
    // Week of Dec 29 2025: Mon 12/29, Fri 1/2/2026.
    expect(formatWeekRange('2025-12-29')).toBe('12/29 — 1/2');
  });

  it('renders single-digit months and days without zero-padding', () => {
    // Week of Jan 5 2026: Mon 1/5, Fri 1/9.
    expect(formatWeekRange('2026-01-05')).toBe('1/5 — 1/9');
  });
});

// fix-DS-legibility: short-block tier + quarter-overlap classification.
describe('blockTier', () => {
  it('1 visible week -> xs', () => {
    expect(blockTier(1)).toBe('xs');
    expect(blockTier(0)).toBe('xs'); // clamp guard
  });
  it('2 visible weeks -> sm', () => {
    expect(blockTier(2)).toBe('sm');
  });
  it('3+ visible weeks -> default', () => {
    expect(blockTier(3)).toBe('default');
    expect(blockTier(13)).toBe('default');
  });
});

describe('blockOverflow', () => {
  const weeks = ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27'];
  it('fully contained -> null', () => {
    expect(blockOverflow('2026-04-13', '2026-04-20', weeks)).toBeNull();
    // exact window edges still count as contained
    expect(blockOverflow('2026-04-06', '2026-04-27', weeks)).toBeNull();
  });
  it('starts before the window -> tail', () => {
    expect(blockOverflow('2026-03-30', '2026-04-20', weeks)).toBe('tail');
  });
  it('ends after the window (starts within) -> head', () => {
    expect(blockOverflow('2026-04-20', '2026-05-04', weeks)).toBe('head');
  });
  it('starts before AND ends after -> tail takes precedence', () => {
    expect(blockOverflow('2026-03-30', '2026-05-04', weeks)).toBe('tail');
  });
  it('empty weeks -> null (no window to classify against)', () => {
    expect(blockOverflow('2026-04-13', '2026-04-20', [])).toBeNull();
  });
});
