import { describe, it, expect } from 'vitest';
import {
  buildQuarterOptions,
  formatQuarter,
  isMemberActiveInQuarter,
  quarterOffsetToString,
  quarterStringToOffset,
} from '../lib/teamQuarterHelpers';

// fix-25-feat-b: helpers that mirror the SQL predicate
// bp_member_active_in_quarter and convert between quarter offsets and
// 'YYYY-Qn' strings. Pin the boundary cases so the filter on the Draw
// Schedule grid stays consistent across edges (start === viewed, end
// === viewed, NULL on either side, etc.).

describe('formatQuarter', () => {
  it('builds YYYY-Qn from year + 0-based quarter index', () => {
    expect(formatQuarter(2026, 0)).toBe('2026-Q1');
    expect(formatQuarter(2026, 3)).toBe('2026-Q4');
    expect(formatQuarter(2024, 1)).toBe('2024-Q2');
  });
});

describe('quarterOffsetToString', () => {
  const may2026 = new Date('2026-05-16T12:00:00Z'); // Q2 2026
  it('returns current quarter for offset=0', () => {
    expect(quarterOffsetToString(0, may2026)).toBe('2026-Q2');
  });
  it('handles positive offsets within the same year', () => {
    expect(quarterOffsetToString(1, may2026)).toBe('2026-Q3');
    expect(quarterOffsetToString(2, may2026)).toBe('2026-Q4');
  });
  it('rolls forward across year boundary', () => {
    expect(quarterOffsetToString(3, may2026)).toBe('2027-Q1');
    expect(quarterOffsetToString(7, may2026)).toBe('2028-Q1');
  });
  it('rolls backward across year boundary', () => {
    expect(quarterOffsetToString(-1, may2026)).toBe('2026-Q1');
    expect(quarterOffsetToString(-2, may2026)).toBe('2025-Q4');
    expect(quarterOffsetToString(-5, may2026)).toBe('2025-Q1');
  });
});

describe('quarterStringToOffset', () => {
  const may2026 = new Date('2026-05-16T12:00:00Z'); // Q2 2026
  it('is the inverse of quarterOffsetToString', () => {
    for (const offset of [-5, -2, -1, 0, 1, 2, 3, 7]) {
      const str = quarterOffsetToString(offset, may2026);
      expect(quarterStringToOffset(str, may2026)).toBe(offset);
    }
  });
  it('returns 0 for malformed input', () => {
    expect(quarterStringToOffset('not-a-quarter', may2026)).toBe(0);
    expect(quarterStringToOffset('2026-Q9', may2026)).toBe(0);
  });
});

describe('isMemberActiveInQuarter (mirrors bp_member_active_in_quarter)', () => {
  it('returns true when both range bounds are NULL', () => {
    expect(isMemberActiveInQuarter(null, null, '2026-Q2')).toBe(true);
  });
  it('returns true at the start boundary', () => {
    expect(isMemberActiveInQuarter('2026-Q1', null, '2026-Q1')).toBe(true);
  });
  it('returns true at the end boundary', () => {
    expect(isMemberActiveInQuarter(null, '2026-Q2', '2026-Q2')).toBe(true);
  });
  it('returns false before the start', () => {
    expect(isMemberActiveInQuarter('2026-Q1', null, '2025-Q4')).toBe(false);
  });
  it('returns false after the end', () => {
    expect(isMemberActiveInQuarter(null, '2026-Q2', '2026-Q3')).toBe(false);
  });
  it('returns true inside a finite range', () => {
    expect(isMemberActiveInQuarter('2026-Q1', '2026-Q3', '2026-Q2')).toBe(true);
  });
  it('returns false outside a finite range', () => {
    expect(isMemberActiveInQuarter('2026-Q1', '2026-Q3', '2026-Q4')).toBe(false);
    expect(isMemberActiveInQuarter('2026-Q1', '2026-Q3', '2025-Q4')).toBe(false);
  });
});

describe('buildQuarterOptions', () => {
  const may2026 = new Date('2026-05-16T12:00:00Z');
  it('produces an ordered, deduped list around now', () => {
    const opts = buildQuarterOptions(may2026, 4, 4);
    expect(opts).toHaveLength(9); // -4..+4 = 9
    expect(opts[0]).toBe('2025-Q2'); // 4 quarters before Q2-2026
    expect(opts[4]).toBe('2026-Q2'); // center
    expect(opts[8]).toBe('2027-Q2'); // 4 quarters after
  });
  it('defaults to back=8, forward=8', () => {
    const opts = buildQuarterOptions(may2026);
    expect(opts).toHaveLength(17);
  });
});
