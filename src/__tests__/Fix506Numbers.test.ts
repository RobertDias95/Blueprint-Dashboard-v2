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
  PROJECT_CARD_BORDER,
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

// ===========================================================================
// ★★★ SUPERSEDED IN PART BY fix-507 — AND KEPT, BECAUSE IT WAS NOT WRONG
// ===========================================================================
//
// Three of fix-506's numbers moved on 2026-09-09, and NONE of them moved
// because fix-506 measured badly. They moved because Bobby ruled twice more:
//
//   · the permits rail pays for the Site/Dates pair, 240 → 190 (§A), and
//     fix-507's STEP 0 found a 15px pillbox scrollbar nobody had counted, so
//     the shell chrome is 535 rather than 570 and every row width gains 35;
//   · the pair sits side by side on every machine (§B), so the row is
//     re-shared 35/31/34 → 35.5/35/29.5 and Project's 390 of body becomes 476.
//
// ★★★ fix-506's CENTRAL FINDING SURVIVES INTACT AND IS WHY §B COULD SHIP: the
//     pair needs **475**, and it is confirmed to the pixel in Chrome below.
//     What fix-506 could not do was make the Project card that wide — the row
//     had 1350 to share and the rail was holding 240 of it. See Fix507Numbers
//     for the row as it stands.
describe('fix-506 — the STEP 0 numbers, derived', () => {
  it('★★★ the row minimum fell 1,172 → 904, and 904 is UNTOUCHED by fix-507', () => {
    // ★ THE FLOORS DID NOT MOVE. fix-507 re-shared the row and narrowed the
    //   chrome; neither touches what the three cards need at their narrowest,
    //   which is the number fix-506 actually won.
    // ★★★ AND fix-508 MOVED IT AGAIN, UPWARDS — 904 → 996. Not a re-measure:
    //     the Plan of Record's floor stopped being *"14px above Project's"* and
    //     became the width its own capped thumbnail uses (486), which is the
    //     fix-417 rank being retired in favour of a floor
    //     (D-2026-09-09-plan-of-record-keeps-a-floor-not-a-rank).
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(996);
    expect(overviewMinViewport('expanded')).toBe(1531);
    expect(overviewMinViewport('collapsed')).toBe(1375);
  });

  it('★★★ 1600 fits on ONE line — the brief’s "must not clip" requirement', () => {
    expect(overviewRowWidthAt(1600)).toBeGreaterThanOrEqual(OVERVIEW_ROW_MIN_WIDTH);
    const [por, proj, team] = resolveOverviewWidths(overviewRowWidthAt(1600));
    // ★ fix-508: 486 / 330 / 229 at 1600 — the Plan of Record and Project both
    //   on their floors, Team taking what is left. The point fix-506 was making
    //   survives whole: 1600 runs on ONE line.
    expect(Math.round(por)).toBe(486);
    expect(Math.round(proj)).toBe(330);
    expect(Math.round(team)).toBe(229);
    // ★ …and Project's body still holds the six-column matrix, with room now.
    expect(Math.round(proj) - 22).toBeGreaterThanOrEqual(UNIT_MATRIX_TRANSPOSED_WIDTH);
  });

  it('★★★ at 1920 the row is the mock’s shape, re-shared for the pair', () => {
    // `overview_book_v14.html:470` draws `188px 470px 1.05fr 1.15fr`.
    // ★★★ fix-507 §B DEPARTS FROM THE DRAWING ON PURPOSE, AND SAYS WHERE. The
    //     mock's 470 was a Plan of Record column with no Site/Dates requirement
    //     on its neighbour; Bobby's 2026-09-09 ruling adds one, and Project is
    //     the card that has to be wide enough for it. 485 / 478 / 403 at 1920,
    //     measured in Chrome. What the mock still rules — PoR the widest — is
    //     asserted below, unchanged.
    // ★★★ fix-508 RE-SHARES IT AGAIN AND RETIRES THE RANK. Bobby's P-193:
    //     Project 20% narrower, the freed width to Team. 486 / 382 / 497, and
    //     TEAM is the widest card now — expected, not a violation
    //     (D-2026-09-09). See Fix508Numbers for why the rank was shorthand for
    //     a grievance this ticket settles directly.
    const [por, proj, team] = resolveOverviewWidths(overviewRowWidthAt(1920));
    expect(Math.round(por)).toBe(486);
    expect(Math.round(proj)).toBe(382);
    expect(Math.round(team)).toBe(497);
    expect(team).toBeGreaterThan(por);
  });

  it('★★★ THE GATE: 475 was right, and fix-507 §A/§B paid it rather than wrapping', () => {
    // ★★★ THE MEASUREMENT SURVIVES UNCHANGED, and fix-507 STEP 0 confirmed it
    //     in Chrome row by row: the widest Site row (`Lot size 4,400 sf
    //     derived`) needs 147 + 20 of section padding, and the Dates card's two
    //     quadrant columns need 124 + 14 + 138 + 20. 169 and 296, to the pixel.
    // ★★★ AND fix-508 §B WITHDREW THE GATE RATHER THAN PAYING IT. The 296 is
    //     the two-by-two quadrant grid; one column of the same rows is 156, and
    //     the pair falls 475 → 320. The measurement above was right about the
    //     card it measured — that card no longer exists.
    expect(SITE_DATA_MIN_WIDTH).toBe(154);
    expect(DATES_CARD_MIN_WIDTH).toBe(156);
    expect(SITE_DATES_SIDE_BY_SIDE_MIN).toBe(320);

    // ★★★ THE PAIR LOSES THE BORDER, NOT THE PADDING, and fix-506's helper had
    //     it the other way. `SiteAndDates` is the Project card's DIRECT child,
    //     so the width it gets is the card minus its 1px border a side; the
    //     `px-2.5` is inside each box and is already counted in
    //     SITE_DATA_MIN_WIDTH and DATES_CARD_MIN_WIDTH. Subtracting the full
    //     22 of card chrome double-counted it and made the gate look 20px
    //     worse than it was — which changes none of fix-506's conclusions
    //     (390 or 410, both are under 475), and matters now because §B is
    //     deciding a breakpoint on this number.
    const projBodyAt = (vw: number) =>
      Math.round(resolveOverviewWidths(overviewRowWidthAt(vw))[1]) -
      PROJECT_CARD_BORDER;
    // ★★★ AND THIS IS THE LINE THAT INVERTED. fix-506 measured 390 of Project
    //     body at 1920 against the 475 the pair needs, and resolved it by
    //     WRAPPING — side by side wherever it fits, stacked where it does not.
    //     It never fitted: 390 is what every real machine got, which is P-174.
    //     §A's rail and §B's re-share make it **476**, so the pair sits side by
    //     side at 1920 and the fallback becomes a declared breakpoint instead
    //     of the only state.
    expect(projBodyAt(1920)).toBe(380);
    expect(projBodyAt(1920)).toBeGreaterThanOrEqual(SITE_DATES_SIDE_BY_SIDE_MIN);
    // ★★ THE FLOOR IS STILL THE WIDER BOX, NOT THE SUM, and that has not
    //    changed with the arrangement: the pair STACKS below the breakpoint
    //    rather than clipping, so what the card must never be narrower than is
    //    296, not 475. Making the sum a floor would put the row minimum at
    //    1,047 and 1600 would clip — the gate fix-506's STEP 0 stopped on.
    // ★★★ INVERTED BY fix-508 §B: the pair can no longer wrap at 1600 (Bobby's
    //     ruling), so the side-by-side sum IS the floor — and what makes that
    //     affordable is that the sum collapsed to 320. The floor is 34px SMALLER
    //     than the one fix-506 shipped while holding a REQUIREMENT fix-506
    //     called impossible.
    expect(PROJECT_CARD_MIN_WIDTH).toBe(330);
    // ★ …and 1600 now FITS it, with the ruled 8px of margin.
    expect(projBodyAt(1600)).toBeGreaterThanOrEqual(SITE_DATES_SIDE_BY_SIDE_MIN);
  });

  it('★★ the transposed matrix, at the counts that exist on prod', () => {
    // 2 types on 59 projects, 3 on 22, 4 on 9, 6 on two — including
    // 403 W Dravus St, the brief's own measurement project.
    // ★ fix-508 §C shrank the padding: 152/242/332 → 123/195/267.
    expect(unitMatrixWidthFor(2)).toBe(123);
    expect(unitMatrixWidthFor(4)).toBe(195);
    expect(unitMatrixWidthFor(6)).toBe(267);
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
