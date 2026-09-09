import { describe, it, expect } from 'vitest';
import {
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_ROW_MIN_WIDTH,
  overviewMinViewport,
  overviewRowWidthAt,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import {
  DATES_CARD_MIN_WIDTH,
  PROJECT_CARD_MIN_WIDTH,
  SITE_DATA_MIN_WIDTH,
  SITE_DATES_SIDE_BY_SIDE_MIN,
  UNIT_MATRIX_TRANSPOSED_WIDTH,
  unitMatrixWidthFor,
} from '../lib/projectCardLayout';

// ===========================================================================
// ★★★ fix-506 STEP 0-1 — THE ROW, BEFORE AND AFTER, AS ARITHMETIC
// ===========================================================================
//
// The brief asks for the numbers in the PR and this is where they are computed,
// so the PR body and the code cannot drift. Every one is derived; none is typed.
//
//     five cards (fix-475)          three cards (fix-506 §A)
//     row minimum   1,172           904
//     unwrapped from 1,742px        1,474px
//     1600            WRAPPED       ONE LINE
//
// ★★★ AND THE GATE: the mock's side-by-side Site/Dates needs 475px of card
//     body; Project gets 390 at 1920. So the pair WRAPS — side by side where it
//     fits, stacked where it does not, clipped never.

describe('fix-506 — the STEP 0 numbers, derived', () => {
  it('★★★ the row minimum fell 1,172 → 904, and the wrap point 1,742 → 1,474', () => {
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(904);
    expect(overviewMinViewport('expanded')).toBe(1474);
    expect(overviewMinViewport('collapsed')).toBe(1318);
  });

  it('★★★ 1600 fits on ONE line — the brief’s "must not clip" requirement', () => {
    expect(overviewRowWidthAt(1600)).toBeGreaterThanOrEqual(OVERVIEW_ROW_MIN_WIDTH);
    const [por, proj, team] = resolveOverviewWidths(overviewRowWidthAt(1600));
    expect(Math.round(por)).toBe(368);
    expect(Math.round(proj)).toBe(354);
    expect(Math.round(team)).toBe(288);
    // ★ …and Project's body still holds the six-column matrix exactly.
    expect(Math.round(proj) - 22).toBe(UNIT_MATRIX_TRANSPOSED_WIDTH);
  });

  it('★★★ at 1920 the row is within 5px of the v14 mock’s own proportions', () => {
    // `overview_book_v14.html:470` draws `188px 470px 1.05fr 1.15fr`.
    const [por, proj, team] = resolveOverviewWidths(overviewRowWidthAt(1920));
    expect(Math.abs(Math.round(por) - 470)).toBeLessThanOrEqual(5);
    expect(Math.round(proj)).toBe(412);
    expect(Math.round(team)).toBe(452);
    // ★★ The Plan of Record is the widest card, which is Bobby's fix-417
    //    ruling and the thing this row was re-shared to honour.
    expect(por).toBeGreaterThan(proj);
    expect(por).toBeGreaterThan(team);
  });

  it('★★★ THE GATE, as arithmetic: side by side needs 475 and Project gets 390', () => {
    expect(SITE_DATA_MIN_WIDTH).toBe(169);
    expect(DATES_CARD_MIN_WIDTH).toBe(296);
    expect(SITE_DATES_SIDE_BY_SIDE_MIN).toBe(475);

    const projBodyAt = (vw: number) =>
      Math.round(resolveOverviewWidths(overviewRowWidthAt(vw))[1]) - 22;
    expect(projBodyAt(1920)).toBe(390);
    expect(projBodyAt(1920)).toBeLessThan(SITE_DATES_SIDE_BY_SIDE_MIN);
    // ★★★ …AND THE PAIR STACKS RATHER THAN CLIPPING, which is why the floor is
    //     the WIDER BOX rather than the sum. If it could not wrap, the Project
    //     floor would be 497 and the row minimum 1,047 — and 1600 would clip,
    //     which is the gate STEP 0 stopped on.
    expect(PROJECT_CARD_MIN_WIDTH).toBe(354);
    expect(SITE_DATES_SIDE_BY_SIDE_MIN + 22).toBeGreaterThan(
      overviewRowWidthAt(1600) * 0.31,
    );
    // ★ It DOES appear on a wide screen, which is the point of wrapping rather
    //   than choosing: the mock's layout is what a 2560 monitor shows.
    expect(projBodyAt(2560)).toBeGreaterThanOrEqual(SITE_DATES_SIDE_BY_SIDE_MIN);
  });

  it('★★ the transposed matrix, at the counts that exist on prod', () => {
    // 2 types on 59 projects, 3 on 22, 4 on 9, 6 on two — including
    // 403 W Dravus St, the brief's own measurement project.
    expect(unitMatrixWidthFor(2)).toBe(152);
    expect(unitMatrixWidthFor(4)).toBe(242);
    expect(unitMatrixWidthFor(6)).toBe(332);
    expect(UNIT_MATRIX_TRANSPOSED_WIDTH).toBe(unitMatrixWidthFor(6));
  });

  it('★★ every floor is DERIVED and every one states its reason', () => {
    expect(OVERVIEW_CARD_COLUMNS).toHaveLength(3);
    expect(OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.pct, 0)).toBe(100);
    for (const c of OVERVIEW_CARD_COLUMNS) {
      expect(c.minPx, c.key).toBeGreaterThan(0);
      expect(c.floorReason.length, c.key).toBeGreaterThan(40);
      expect(c.floorReason, c.key).toMatch(/HARD|SOFT/);
    }
  });
});
