import { describe, it, expect } from 'vitest';
import {
  EARLIEST_QUARTER,
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
  // ★★★ SUPERSEDED BY fix-470 §2 (P-123), NOT MISTAKEN. This read
  //     `expect(opts).toHaveLength(17)` — the -8..+8 window. `forward` still
  //     defaults to 8 and that half is unchanged; what expired is `back`
  //     defaulting to 8, because **a history floor is a date, not an offset**.
  //     Eight quarters back from 2026-Q3 happens to be 2024-Q3 today, and
  //     becomes 2024-Q4 next quarter — the year Bobby is about to enter would
  //     have silently left the dropdown with no error and no migration.
  it('fix-470: defaults to the ABSOLUTE floor back, and 8 forward', () => {
    const opts = buildQuarterOptions(may2026);
    expect(opts[0]).toBe(EARLIEST_QUARTER);
    expect(opts[opts.length - 1]).toBe('2028-Q2'); // 2026-Q2 + 8
    // 2023-Q1 … 2028-Q2 inclusive.
    expect(opts).toHaveLength(22);
  });

  // -------------------------------------------------------------------------
  // ★★★ fix-470 §2 (P-123) — the floor is absolute
  // -------------------------------------------------------------------------
  //
  // Bobby, 2026-09-01: *"we are going to backfill 2024 data. can we make the
  // drawschedule editor go back to 2024."* Ruled: floor at 2023-Q1 — *"leave
  // room to go back further"*, so it is set once for both years rather than
  // moved twice.
  //
  // ★ Checked against prod: earliest `go_date` 2024-09-25, earliest
  //   `draw_schedule.start_week` 2024-12-30. A 2023-Q1 floor clears everything
  //   that exists and everything named as coming.

  it('★★★ the first entry is 2023-Q1 regardless of `now`', () => {
    for (const d of [
      new Date('2026-01-04T12:00:00Z'),
      new Date('2026-05-16T12:00:00Z'),
      new Date('2026-11-30T12:00:00Z'),
    ]) {
      expect(buildQuarterOptions(d)[0]).toBe('2023-Q1');
    }
  });

  it('★★★ THE REGRESSION THIS TICKET EXISTS FOR: still 2023-Q1 in 2027-Q2', () => {
    // ★★ A ROLLING FLOOR PASSES EVERY TEST WRITTEN AT A SINGLE POINT IN TIME.
    //    Under the old `back = 8`, this date yields a 2025-Q2 floor and 2024 —
    //    the data Bobby is entering this month — is simply gone from the
    //    dropdown. This is the assertion the old shape cannot pass.
    const opts = buildQuarterOptions(new Date('2027-05-16T12:00:00Z'));
    expect(opts[0]).toBe('2023-Q1');
    expect(opts).toContain('2024-Q1');
    expect(opts).toContain('2024-Q4');
  });

  it('★★ the last entry is always now + 8 — `forward` stays rolling', () => {
    // ★ The asymmetry is the point: you plan FORWARD from where you stand, so
    //   a fixed future ceiling would be the same bug mirrored. History does
    //   not recede; the future does move.
    expect(buildQuarterOptions(may2026).at(-1)).toBe('2028-Q2');
    expect(buildQuarterOptions(new Date('2027-05-16T12:00:00Z')).at(-1)).toBe(
      '2029-Q2',
    );
    expect(buildQuarterOptions(may2026, undefined, 2).at(-1)).toBe('2026-Q4');
  });

  it('★★ an explicit `back` override still behaves exactly as before', () => {
    // ★ Kept as an OVERRIDE rather than deleted, so the window-around-a-date
    //   meaning survives for any caller that wants it — and so the case above
    //   keeps its original meaning rather than being rewritten.
    const opts = buildQuarterOptions(may2026, 4, 4);
    expect(opts).toHaveLength(9);
    expect(opts[0]).toBe('2025-Q2');
    expect(opts[8]).toBe('2027-Q2');
    // ★ An override may legitimately reach BELOW the floor — it is opting out.
    expect(buildQuarterOptions(may2026, 20, 0)[0]).toBe('2021-Q2');
  });

  it('★ the floor is a real quarter string, and it is before everything on prod', () => {
    expect(EARLIEST_QUARTER).toBe('2023-Q1');
    // Earliest real data measured on prod 2026-09-01.
    expect(EARLIEST_QUARTER < '2024-Q3').toBe(true); // earliest go_date
    expect(EARLIEST_QUARTER < '2024-Q4').toBe(true); // earliest start_week
  });
});
