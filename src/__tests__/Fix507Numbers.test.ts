import { describe, it, expect } from 'vitest';
import {
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_GRID_GAP,
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

  it('★ the floors did not move, so the row minimum is still 904', () => {
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(904);
    expect(overviewMinViewport('expanded')).toBe(1439);
  });
});

describe('fix-507 §B — Site data beside Dates, on a declared breakpoint', () => {
  it('★★★ the pair needs 475, confirmed row by row in Chrome', () => {
    // Site:  `Lot size  4,400 sf derived`  147 + 20 of section padding
    // Dates: 56+8+60 · gap 14 · 70+8+60    276 + 20 of section padding
    expect(SITE_DATA_MIN_WIDTH).toBe(169);
    expect(DATES_CARD_MIN_WIDTH).toBe(296);
    expect(SITE_DATES_SIDE_BY_SIDE_MIN).toBe(475);
  });

  it('★★★ …and at 1920 the Project card finally has it — 476 of body', () => {
    const bodyAt = (vw: number) =>
      Math.round(resolveOverviewWidths(overviewRowWidthAt(vw))[1]) -
      PROJECT_CARD_BORDER;
    // ★ 390 before this ticket. Every real machine got the stacked fallback,
    //   which is P-174.
    expect(bodyAt(1920)).toBe(476);
    expect(bodyAt(1920)).toBeGreaterThanOrEqual(SITE_DATES_SIDE_BY_SIDE_MIN);
  });

  it('★★★ STOP CONDITION: 1600 is still short, and here is by how much', () => {
    // ★★★ The brief's first STOP: *"If a 190px rail still leaves the Site/Dates
    //     pair short at 1600, stop."* It does. At 1600 the row is 1065 and the
    //     pair needs a Project card of 477 with a Plan of Record above it
    //     (fix-417) and a Team card that can still hold ONE consultant pill:
    const projectNeeded = SITE_DATES_SIDE_BY_SIDE_MIN + PROJECT_CARD_BORDER;
    const porNeeded = projectNeeded + 6; // the smallest lead that stays "widest"
    const teamFloor = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'team')!.minPx;
    const rowNeeded = projectNeeded + porNeeded + teamFloor + 2 * OVERVIEW_GRID_GAP;
    expect(rowNeeded).toBe(1142);
    expect(overviewRowWidthAt(1600)).toBe(1065);
    expect(rowNeeded - overviewRowWidthAt(1600)).toBe(77);
    // ★ …so it STACKS at 1600, which is the one permitted fallback and is a
    //   declared breakpoint rather than an accident of wrapping.
    const bodyAt1600 =
      Math.round(resolveOverviewWidths(overviewRowWidthAt(1600))[1]) -
      PROJECT_CARD_BORDER;
    expect(bodyAt1600).toBeLessThan(SITE_DATES_SIDE_BY_SIDE_MIN);
    // ★★★ AND THE VIEWPORT WHERE IT DOES APPEAR, so the report carries a
    //     number rather than "somewhere above 1600". **1917** — which is 1920
    //     with THREE PIXELS to spare, and worth knowing before anybody spends
    //     them. Bobby's ruling 3 asked for side by side at 1600 and up; what
    //     the shell can actually pay for is 1917 and up.
    //     ★ It is a SHARE, so this is a cliff and not a fade: below it the pair
    //       stacks completely.
    const bodyAtVw = (vw: number) =>
      Math.round(resolveOverviewWidths(overviewRowWidthAt(vw))[1]) -
      PROJECT_CARD_BORDER;
    let firstFitting = 1600;
    while (firstFitting < 2560 && bodyAtVw(firstFitting) < SITE_DATES_SIDE_BY_SIDE_MIN) {
      firstFitting += 1;
    }
    expect(firstFitting).toBe(1917);
    expect(bodyAtVw(1916)).toBeLessThan(SITE_DATES_SIDE_BY_SIDE_MIN);
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

  it('★ the Project FLOOR is still the wider BOX, not the sum', () => {
    // If the sum were the floor the row minimum would be 1,047 and 1600 would
    // clip — the gate fix-506's STEP 0 stopped on. The pair stacks below the
    // breakpoint, so the card never has to hold both at once.
    expect(PROJECT_CARD_MIN_WIDTH).toBe(
      UNIT_MATRIX_TRANSPOSED_WIDTH + 22,
    );
    expect(PROJECT_CARD_MIN_WIDTH).toBeLessThan(SITE_DATES_SIDE_BY_SIDE_MIN);
  });
});

describe('fix-507 §C — the Team card’s three columns', () => {
  it('★★★ the threshold is derived from what each cell needs', () => {
    expect(TEAM_GRID_COLUMN_1_MIN).toBeGreaterThan(0);
    expect(TEAM_GRID_CHAT_MIN).toBe(150);
    expect(TEAM_GRID_CARD_MIN).toBe(TEAM_GRID_COLUMN_1_MIN + TEAM_GRID_CHAT_MIN);
    // ★ …and Team clears it at 1920 (403 of card) and does NOT at its floor,
    //   which is the whole reason this is a query and not a floor: a
    //   three-column grid at 162px hands the chat cell ~95px.
    const teamAt1920 = Math.round(
      resolveOverviewWidths(overviewRowWidthAt(1920))[2],
    );
    expect(teamAt1920).toBe(403);
    expect(teamAt1920).toBeGreaterThanOrEqual(TEAM_GRID_CARD_MIN);
    const teamFloor = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'team')!.minPx;
    expect(teamFloor).toBeLessThan(TEAM_GRID_CARD_MIN);
  });

  it('★★★ stacked is the DEFAULT and the three columns are the query', () => {
    expect(TEAM_GRID_CSS.length).toBeGreaterThan(200);
    expect(TEAM_GRID_CSS).toContain(`(min-width:${TEAM_GRID_CARD_MIN}px)`);
    // ★ The default rule is a flex COLUMN — byte-for-byte the card fix-506
    //   shipped — and the grid only appears inside the query.
    expect(TEAM_GRID_CSS).toContain('display:flex;flex-direction:column');
    expect(TEAM_GRID_CSS).toContain('grid-column:2/3;grid-row:1/3');
  });

  it('★★★ THE DEFICIT §D reports: 38px, and the card carrying it is Team', () => {
    // ★★★ The brief's third STOP: *"If getting Schedule Health above the fold
    //     at 1920 × 1080 needs more than the Team regrid in §C, stop and report
    //     what the remaining deficit is and which card is carrying it."*
    //
    // Team needs 443 for a six-consultant band to render 3+3 — three pills at
    // their declared minimum plus the card's chrome, confirmed in Chrome
    // (the band is 185px at a 444px card and 337px at 437).
    const teamForThreeAcross = 3 * CONSULTANT_PILL_COMPACT_MIN + 22;
    expect(teamForThreeAcross).toBe(442);
    expect(consultantRowSplit(6)).toEqual({ top: 3, bottom: 3 });

    const projectNeeded = SITE_DATES_SIDE_BY_SIDE_MIN + PROJECT_CARD_BORDER;
    const rowNeeded =
      projectNeeded + (projectNeeded + 6) + teamForThreeAcross + 2 * OVERVIEW_GRID_GAP;
    expect(rowNeeded).toBe(1422);
    expect(rowNeeded - overviewRowWidthAt(1920)).toBe(37);
    // ★★ 37px on the derived numbers, 38 on the Chrome measurement (the band
    //    flips between a 437 and a 444 card). Either way it is a ~40px hole and
    //    it is the Team card that is short.
  });
});

describe('fix-507 §E — the units matrix fills its box', () => {
  it('★★★ 19% corner and pixel floors describe the SAME table at 332', () => {
    expect(UNIT_MATRIX_CORNER_PCT).toBe(19);
    const corner = (UNIT_MATRIX_TRANSPOSED_WIDTH * UNIT_MATRIX_CORNER_PCT) / 100;
    // ★ The 19% corner at the floor is 63px — one above UNIT_MATRIX_LABEL_COL —
    //   and the six type columns are 44.8 each, one under UNIT_MATRIX_TYPE_COL.
    //   The percentage layout and the pixel derivation are the same table, which
    //   is why the FLOOR does not move when the table starts stretching.
    expect(Math.round(corner)).toBe(63);
    expect(
      Math.round((UNIT_MATRIX_TRANSPOSED_WIDTH - corner) / 6),
    ).toBe(45);
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
