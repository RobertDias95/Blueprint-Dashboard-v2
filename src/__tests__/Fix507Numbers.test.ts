import { describe, it, expect } from 'vitest';
import {
  OVERVIEW_ROW_MIN_WIDTH,
  PERMITS_RAIL_NO_TRUNCATION_WIDTH,
  PERMITS_RAIL_WIDTH,
  SHELL_CHROME_PX,
  overviewMinViewport,
  overviewRowWidthAt,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import {
  DATES_CARD_MIN_WIDTH,
  PLAN_SHEET_MODAL_ASPECT,
  POR_IMAGE_MAX_HEIGHT,
  POR_IMAGE_WIDTH_AT_REFERENCE,
  PROJECT_CARD_BORDER,
  PROJECT_CARD_MIN_WIDTH,
  SITE_DATA_MIN_WIDTH,
  SITE_DATES_RESPONSIVE_CSS,
  SITE_DATES_SIDE_BY_SIDE_CARD_MIN,
  SITE_DATES_SIDE_BY_SIDE_MIN,
  UNIT_MATRIX_BIG_MAX_TYPES,
  UNIT_MATRIX_CORNER_PCT,
  UNIT_MATRIX_TRANSPOSED_WIDTH,
  unitMatrixIsBig,
} from '../lib/projectCardLayout';
import {
  CONSULTANT_PILL_COMPACT_MIN,
  consultantRowSplit,
} from '../lib/projectCardLayout';
import {
  TEAM_GRID_CARD_MIN,
  TEAM_GRID_CSS,
  TEAM_GRID_CHAT_MIN,
  TEAM_GRID_COLUMN_1_MIN,
} from '../lib/teamCardLayout';

// ===========================================================================
// ★★★ fix-507 STEP 0 — BOTH AXES, MEASURED TOGETHER, BEFORE AND AFTER
// ===========================================================================
//
// ★★★ THE STANDING LESSON THIS TICKET EXISTS TO OBEY: *a ticket that optimises
//     one axis must state what it did to the other, IN THE SAME MEASUREMENT, or
//     the regression ships.* fix-506 was a WIDTH ticket and won on width — row
//     minimum 1,172 → 904 — and paid for it in HEIGHT, deliberately and in
//     writing, and **nobody measured the height**. Bobby's first look at the
//     shipped screen found Schedule Health below the fold, the Site/Dates pair
//     stacked, the units matrix in a narrow strip and the Team card stacked.
//
// Everything below is DERIVED from the same modules the app renders from. The
// heights beside them are Chrome measurements of the live app at a 1920
// viewport, signed in, on the two projects the brief names — recorded here so
// the PR body and the code cannot drift.
//
// ---------------------------------------------------------------------------
// THE ROW, AT 1920, BEFORE AND AFTER (Chrome, live app, ribbon expanded)
// ---------------------------------------------------------------------------
//
//                                 BEFORE            AFTER
//   row width                     1335              1385
//   Plan of Record          460 w · 411 h     485 w · 428 h
//   Project                 408 w · 603/605 h 478 w · 533/605 h
//   Team                    447 w · 773/721 h 403 w · 617/763 h
//   ROW HEIGHT (the max)     773 · 721         617 · 763
//   Site/Dates              STACKED, both     SIDE BY SIDE, both
//   top of Schedule Health   791 · 739         635 · 781
//
//   (two figures = `233 31st Ave E` · `403 W Dravus St`)
//
// ---------------------------------------------------------------------------
// ★★★ AND THE DEFICIT, WHICH IS A STOP CONDITION AND IS NOT SILENTLY ABSORBED
// ---------------------------------------------------------------------------
//
// §B and a 3-across consultant band cannot both hold at 1920. Measured:
//
//   Project must be 477 (475 of pair + 2 of border)          §B, ruling 1
//   Plan of Record must exceed it — 483                      fix-417's ruling
//   Team must be 443 for 6 pills to render 3+3               measured in Chrome
//   + two 10px gaps                                          = 1423
//   the row HAS                                              = 1385
//                                                            ---------------
//   deficit                                                       38px
//
// So on a six-consultant project the band wraps to four pill-lines instead of
// two and Team costs 152px more height than it would at 443. **Config chosen
// and why:** side by side anyway, because it is strictly better on BOTH axes —
// a stacked pair makes the PROJECT card 780px tall on `233 31st Ave E`, which
// is 17px MORE than the wrapped-band Team it would be saving. Measured, not
// assumed. The levers that would close the 38px are Bobby's and are sized in
// the PR.

describe('fix-507 §A — the permits rail, and the box nobody had counted', () => {
  it('★★★ the rail is 190, declared once and read by both files', () => {
    expect(PERMITS_RAIL_WIDTH).toBe(190);
    expect(SHELL_CHROME_PX.permitsRail).toBe(PERMITS_RAIL_WIDTH);
  });

  it('★★★ STEP 0-3: 190 truncates the stage word, and 217 is where it stops', () => {
    // ★★★ REPORTED, NOT SILENTLY SUBSTITUTED, which is what the brief asked
    //     for. A rail row's content box is `width − 29` (the aside's 1px border
    //     a side, the row's 3px stage accent, its `px-3`). Measured in Chrome
    //     on `233 31st Ave E`:
    //
    //       `SDOTTRLA0002500 ↗`                102   fits at 190
    //       `Target: 2026-10-16`               106   fits at 190
    //       `PAR/Pre-Sub · Issued`             120   fits at 190
    //       `Building Permit · Corrections`    173   TRUNCATES  (rail 202)
    //       `Grading / Clearing · Corrections` 188   TRUNCATES  (rail 217)
    //
    // ★ What 190 costs is the SECONDARY half of the type line. The permit
    //   number, the date line and the stage's own colour dot are untouched, and
    //   `Grading / Clearing` is 7 permits on prod.
    expect(PERMITS_RAIL_NO_TRUNCATION_WIDTH).toBe(217);
    expect(PERMITS_RAIL_WIDTH).toBeLessThan(PERMITS_RAIL_NO_TRUNCATION_WIDTH);
    // The widest measured line, against what 190 gives a row.
    expect(190 - 29).toBe(161);
    expect(PERMITS_RAIL_NO_TRUNCATION_WIDTH - 29).toBe(188);
  });

  it('★★★ the pillbox scrollbar is the EIGHTH box, and it was never counted', () => {
    // ★★★ `pd-right-pillbox` is `overflow-y-auto` and its content is taller
    //     than the pane on every project, so a 15px vertical scrollbar is
    //     always there. Measured in Chrome at 1920: pillbox 1384 wide, CONTENT
    //     box 1367, row 1335 — not the 1350 this module used to compute. A
    //     scrollbar lives BETWEEN the border box and the content box, which is
    //     why no `getBoundingClientRect` shows it.
    expect(SHELL_CHROME_PX.pillboxScrollbar).toBe(15);
    const chrome =
      SHELL_CHROME_PX.ribbonExpanded +
      SHELL_CHROME_PX.shellPadding +
      SHELL_CHROME_PX.pageRowPadding +
      SHELL_CHROME_PX.permitsRail +
      SHELL_CHROME_PX.permitsRailGap +
      SHELL_CHROME_PX.pillboxBorder +
      SHELL_CHROME_PX.pillboxScrollbar +
      SHELL_CHROME_PX.headerPadding;
    expect(chrome).toBe(535);
    // ★ …and the row width that produces, checked against Chrome at both
    //   viewports the brief names.
    expect(overviewRowWidthAt(1920)).toBe(1385);
    expect(overviewRowWidthAt(1600)).toBe(1065);
  });

  it('★★★ SUPERSEDED by fix-508 — the FLOORS moved, and the chrome did not', () => {
    // ★ fix-507's point was that its 35px came from the CHROME and left the
    //   floors alone. fix-508 does the opposite: the chrome is untouched (the
    //   rail stays at 190 — §E changes it for readability only) and two floors
    //   move — the Plan of Record's up to its capped thumbnail's width (486),
    //   Project's down to the pair (330).
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(996);
    expect(overviewMinViewport('expanded')).toBe(1531);
    expect(overviewRowWidthAt(1920)).toBe(1385);
  });
});

describe('fix-507 §B — Site data beside Dates, on a declared breakpoint', () => {
  it('★★★ the pair needs 475, confirmed row by row in Chrome', () => {
    // ★★★ SUPERSEDED by fix-508 §A/§B, and BOTH halves for the same reason:
    //     each was a measurement of a component being redrawn one ticket later.
    //       · Site's binding row was `Lot size 4,400 sf derived` (147); §A takes
    //         the suffix off the face and `Lot 100 × varies` (134) binds.
    //       · Dates was a two-by-two quadrant grid (296); §B makes it one
    //         column (156).
    //     The pair falls 475 → 320 — which is the 155px two earlier fix-508
    //     briefs were trying to find 77 of by tightening the rail.
    expect(SITE_DATA_MIN_WIDTH).toBe(154);
    expect(DATES_CARD_MIN_WIDTH).toBe(156);
    expect(SITE_DATES_SIDE_BY_SIDE_MIN).toBe(320);
  });

  it('★★★ …and at 1920 the Project card finally has it — 476 of body', () => {
    const bodyAt = (vw: number) =>
      Math.round(resolveOverviewWidths(overviewRowWidthAt(vw))[1]) -
      PROJECT_CARD_BORDER;
    // ★ 390 before fix-507; 476 after it; **380** after fix-508 took 20% of
    //   the card's width for Team. The card is NARROWER and the pair fits by
    //   60px rather than by one, because §B shrank what the pair needs.
    expect(bodyAt(1920)).toBe(380);
    expect(bodyAt(1920) - SITE_DATES_SIDE_BY_SIDE_MIN).toBe(60);
  });

  it('★★★ SUPERSEDED: 1600 is NOT short any more — §B withdrew the deficit', () => {
    // ★★★ fix-507 reported 77px and priced three levers. **None was taken.**
    //     Two later fix-508 briefs were written around them and both were
    //     voided, because all three priced against a Dates card that fix-508 §B
    //     deletes: two label tracks and two date tracks become one of each, the
    //     pair falls 475 → 320, and the requirement fits with room.
    const bodyAt1600 =
      Math.round(resolveOverviewWidths(overviewRowWidthAt(1600))[1]) - PROJECT_CARD_BORDER;
    expect(bodyAt1600).toBe(328);
    expect(bodyAt1600).toBeGreaterThanOrEqual(SITE_DATES_SIDE_BY_SIDE_MIN);
    expect(bodyAt1600 - SITE_DATES_SIDE_BY_SIDE_MIN).toBe(8);
    // ★ The rail is UNTOUCHED at 190 — fix-507's first lever, explicitly not
    //   spent, which is why the truncation it costs did not get worse.
    expect(PERMITS_RAIL_WIDTH).toBe(190);
  });

  it('★★★ the breakpoint is the card’s CONTENT box, and the rule says so', () => {
    // ★★ A container query measures the container's content box, so the card's
    //    own border is NOT in the threshold. Getting that wrong cost a render:
    //    at a 478px card with a 477 threshold the pair stacked, because the
    //    query saw 476. fix-423 recorded the same thing one level up.
    expect(SITE_DATES_SIDE_BY_SIDE_CARD_MIN).toBe(SITE_DATES_SIDE_BY_SIDE_MIN);
    // ★ Generated in TS, because a `?raw` CSS import is EMPTY under vitest
    //   (fix-406) — so assert the parse found something, then the numbers.
    expect(SITE_DATES_RESPONSIVE_CSS.length).toBeGreaterThan(200);
    expect(SITE_DATES_RESPONSIVE_CSS).toContain(
      `(min-width:${SITE_DATES_SIDE_BY_SIDE_CARD_MIN}px)`,
    );
    // ★ The tracks carry the boxes' OWN floors, which is what stops either box
    //   being squeezed under the width it was measured at.
    expect(SITE_DATES_RESPONSIVE_CSS).toContain(
      `minmax(${SITE_DATA_MIN_WIDTH}px,1fr) minmax(${DATES_CARD_MIN_WIDTH}px,1.25fr)`,
    );
    // ★★ STACKED IS THE DEFAULT and side-by-side is the query, so a browser
    //    without container queries degrades to the arrangement that always
    //    fits rather than to one that clips.
    expect(SITE_DATES_RESPONSIVE_CSS).toContain(
      'grid-template-columns:minmax(0,1fr)',
    );
  });

  it('★★★ SUPERSEDED: the Project floor IS the sum now, and it still shrank', () => {
    // ★★★ fix-506/507 floored the card at the WIDER BOX because the pair could
    //     wrap. Bobby's ruling removes the wrap at 1600, so the sum is the
    //     floor — and the reason that is affordable is that the sum collapsed:
    //     330 against the 354 the wider-box rule produced.
    expect(PROJECT_CARD_MIN_WIDTH).toBe(330);
    expect(PROJECT_CARD_MIN_WIDTH).toBeLessThan(354);
    expect(PROJECT_CARD_MIN_WIDTH).toBeGreaterThan(SITE_DATES_SIDE_BY_SIDE_MIN);
    // ★ …and the matrix, which had bound it since fix-422, no longer does.
    expect(UNIT_MATRIX_TRANSPOSED_WIDTH + 22).toBeLessThan(PROJECT_CARD_MIN_WIDTH);
  });
});

describe('fix-507 §C — the Team card’s three columns', () => {
  it('★★★ the threshold is derived — and fix-508 §F4 re-derived the chat half', () => {
    expect(TEAM_GRID_COLUMN_1_MIN).toBe(110);
    // ★★★ 150 → 103. fix-507 set 150 as a judgement about a PREVIEW; §F4 moved
    //     the `Chat · N →` button into the cell, and a `whitespace-nowrap`
    //     control in an `overflow-hidden` card CLIPS rather than reflowing. The
    //     floor is the button, measured at its widest face.
    expect(TEAM_GRID_CHAT_MIN).toBe(103);
    expect(TEAM_GRID_CARD_MIN).toBe(TEAM_GRID_COLUMN_1_MIN + TEAM_GRID_CHAT_MIN);
    const teamAt1920 = Math.round(resolveOverviewWidths(overviewRowWidthAt(1920))[2]);
    expect(teamAt1920).toBe(497);
    expect(teamAt1920).toBeGreaterThanOrEqual(TEAM_GRID_CARD_MIN);
  });

  it('★★★ stacked is the DEFAULT and the three columns are the query', () => {
    expect(TEAM_GRID_CSS.length).toBeGreaterThan(200);
    expect(TEAM_GRID_CSS).toContain(`(min-width:${TEAM_GRID_CARD_MIN}px)`);
    // ★ The default rule is a flex COLUMN — byte-for-byte the card fix-506
    //   shipped — and the grid only appears inside the query.
    expect(TEAM_GRID_CSS).toContain('display:flex;flex-direction:column');
    expect(TEAM_GRID_CSS).toContain('grid-column:2/3;grid-row:1/3');
  });

  it('★★★ SUPERSEDED: the 38px deficit is gone, and the band renders 3+3 again', () => {
    // ★★★ fix-507 reported that side by side AND a 3-across six-consultant band
    //     needed 1,423 of row against 1,385. fix-508 pays it from two directions
    //     at once and neither is one of the levers fix-507 priced:
    //       · §F1's three-line pill drops the pill floor 140 → 96, because the
    //         firm no longer shares a line with the status button;
    //       · P-193 moves 20% of the Project card to Team, 403 → 497.
    expect(CONSULTANT_PILL_COMPACT_MIN).toBe(96);
    expect(consultantRowSplit(6)).toEqual({ top: 3, bottom: 3 });
    const teamAt1920 = Math.round(resolveOverviewWidths(overviewRowWidthAt(1920))[2]);
    expect(3 * CONSULTANT_PILL_COMPACT_MIN).toBeLessThanOrEqual(teamAt1920 - 22);
    // ★ Confirmed in Chrome on `233 31st Ave E`, the six-consultant project:
    //   the band renders 213px (two rows of three) where it wrapped to 337.
  });
});

describe('fix-507 §E — the units matrix fills its box', () => {
  it('★★★ 19% corner and pixel floors still describe the SAME table — at 267', () => {
    expect(UNIT_MATRIX_CORNER_PCT).toBe(19);
    const corner = (UNIT_MATRIX_TRANSPOSED_WIDTH * UNIT_MATRIX_CORNER_PCT) / 100;
    // ★ fix-508 §C shrinks the padding, so the table is 267 rather than 332 —
    //   and the two derivations still agree, which is the property this test
    //   exists for rather than the pair of numbers it used to hold.
    expect(Math.round(corner)).toBe(51);
    expect(Math.round((UNIT_MATRIX_TRANSPOSED_WIDTH - corner) / 6)).toBe(36);
  });

  it('★★★ `big` applies at 4 units and fewer, and not at 5+', () => {
    expect(UNIT_MATRIX_BIG_MAX_TYPES).toBe(4);
    for (const n of [1, 2, 3, 4]) expect(unitMatrixIsBig(n), String(n)).toBe(true);
    for (const n of [5, 6, 7]) expect(unitMatrixIsBig(n), String(n)).toBe(false);
  });
});

describe('fix-507b §G — the plan thumbnail’s height cap', () => {
  it('★★★ the cap is DERIVED from the modal sheet, not typed', () => {
    // ★★★ Every one of the 164 indexed plans was signed out of the
    //     `plan-thumbnails` bucket and its natural size read in Chrome on
    //     2026-09-09. FOUR distinct sizes exist:
    //
    //       1400 × 906   AR 1.545   159   ← the modal sheet
    //       1400 × 907   AR 1.544     1
    //       1400 × 1082  AR 1.294     2   letter landscape
    //       1400 × 2164  AR 0.647     2   PORTRAIT
    //
    //     **162 landscape · 2 portrait · 0 square.**
    expect(PLAN_SHEET_MODAL_ASPECT).toBeCloseTo(1400 / 906, 6);
    expect(POR_IMAGE_MAX_HEIGHT).toBe(
      Math.round(POR_IMAGE_WIDTH_AT_REFERENCE / PLAN_SHEET_MODAL_ASPECT),
    );
    expect(POR_IMAGE_MAX_HEIGHT).toBe(300);
  });

  it('★★★ 97% of plans are unchanged by it, and the outliers stop being 716px', () => {
    const at = (aspect: number) =>
      Math.round(POR_IMAGE_WIDTH_AT_REFERENCE / aspect);
    // The modal sheet renders exactly the cap: neither scaled nor padded.
    expect(at(1400 / 906)).toBe(POR_IMAGE_MAX_HEIGHT);
    // Letter landscape is 358 uncapped — it scales DOWN and centres, no crop.
    expect(at(1400 / 1082)).toBeGreaterThan(POR_IMAGE_MAX_HEIGHT);
    // ★★★ AND THE ONE THAT MATTERS: a portrait sheet was 716px of card, on its
    //     own, on a row this ticket is trying to get above the fold.
    expect(at(1400 / 2164)).toBe(716);
    expect(at(1400 / 2164) - POR_IMAGE_MAX_HEIGHT).toBe(416);
  });
});
