// ===========================================================================
// ★★★ fix-506 §B/§C/§D (P-139) — THE PROJECT CARD'S INTERIOR, IN PIXELS
// ===========================================================================
//
// The v14 mock puts three things inside one Project card: **Site data**, the
// **Dates** card beside it, and the **units matrix** spanning both underneath.
// This file is what each of those three costs, derived from its own parts, so
// `overviewCardLayout` can floor the column at what it actually holds rather
// than at a number somebody typed.
//
// ★★★ THE GATE THIS TICKET'S STEP 0 FIRED LIVES HERE. Measured in Chrome
//     (`harness/overview-v14-fit-506.html`, re-runnable):
//
//         Site data alone                      161
//         Dates card alone                     296
//         Site + Dates SIDE BY SIDE            471   <- what the mock draws
//         Site + Dates STACKED                 296
//         units matrix at 2 / 4 / 6 types  152 / 243 / 333
//
//     ★★ THE UNITS MATRIX IS NOT THE CONSTRAINT — the brief expected it to be.
//        The Dates pair is. And the app's Project column gets **390px at 1920**
//        under the mock's own `470px · 1.05fr · 1.15fr` proportions, because
//        the mock is drawn on a 188px permits rail and a 200px ribbon while the
//        app ships 240 and 212 ([[a-mock-measures-a-drawing-not-the-control-
//        you-ship]]). 390 against 471: side by side does not fit.
//
// ★★★ SO THE PAIR WRAPS RATHER THAN CLIPS, AND THAT IS THE WHOLE RESOLUTION.
//
//     Three ruled constraints cannot all hold at the app's shell:
//       (i)   the Plan of Record is the widest card       (Bobby, fix-417)
//       (ii)  Site data and Dates sit side by side        (the v14 mock)
//       (iii) nothing clips at 1600                       (this brief)
//     Any two are satisfiable; all three are not — that is arithmetic, not a
//     preference, and it is why STEP 0 stopped.
//
//     A `flex-wrap` pair with declared bases keeps (i) and (iii) always, and
//     gives (ii) at every width where it genuinely fits: the two boxes sit side
//     by side when the card can hold `SITE_DATA_MIN + gap + DATES_CARD_MIN`,
//     and stack when it cannot. No breakpoint to get wrong, no clipping, and
//     the mock's layout is what a wide screen actually shows.
//
//     ★ It is the SAME mechanism fix-423 chose for the row itself and for the
//       Team card's two-up Internal block: declare the grouping with a floor
//       and let it wrap. `OverviewCard` is `overflow-hidden`, so the
//       alternative is not a squeeze — it is a silent truncation (fix-422).

/** `OverviewCard`'s body padding (`px-2.5` = 20) plus 1px of border a side.
 *  ★ Importing `overviewCardLayout.OVERVIEW_CARD_CHROME` would be circular —
 *  that module derives its floors from this one — so the two are declared
 *  apart and asserted equal by the fix-506 suite. */
export const PROJECT_CARD_CHROME = 22;

// ---------------------------------------------------------------------------
// §C — SITE DATA
// ---------------------------------------------------------------------------

/** The label column. ★ The mock's `.pstrip .f .l{width:52px}`, and it holds
 *  `Lot size` — the longest of Zone / Lot / Lot size / Corner / Alley / Units /
 *  Reuse / Tags — at 10.5px with room to spare. */
export const SITE_LABEL_WIDTH = 52;

/** The `gap-2` between a label and its value. */
export const SITE_LABEL_GAP = 8;

/**
 * ★★ WHAT THE WIDEST SITE VALUE NEEDS, AND IT IS NOT AN ADDRESS.
 *
 * `Lot` prints `60 × varies` — a mono number, the separator, and the `varies`
 * chip — which measures 89px at 10.5px and does NOT wrap (the chip is
 * `whitespace-nowrap`). The Reuse row's address is longer but is a link that
 * ellipsises, and Tags are chips that wrap to a second line; neither is a
 * floor. Measured, like every number in this file.
 */
export const SITE_VALUE_MIN = 89;

/** What the Site data box needs before it truncates. ★ The card's 1px border
 *  is counted once for the whole card, not once per box inside it. */
export const SITE_DATA_MIN_WIDTH =
  SITE_LABEL_WIDTH + SITE_LABEL_GAP + SITE_VALUE_MIN + PROJECT_CARD_CHROME - 2;

// ---------------------------------------------------------------------------
// §B — THE DATES CARD
// ---------------------------------------------------------------------------
//
// Two columns by two rows, exactly as the mock:
//
//     GO date · Closing              |  SD start · SD end
//     DD start · Consultant · DD end |  Accepted · ACQ target · Est. approval
//
// ★ Read-only text (fix-506 makes the overview read-only), so these are label
//   widths and mono DATE widths — not `MILESTONE_DATE_INPUT_MIN`. That is the
//   one place this card is cheaper than the Milestones card it replaces: a
//   native date input costs 100px and cannot reflow (fix-423's finding); a
//   printed `07/06/2026` costs 60.

/** The left column's label track. ★ `Consultant` is the longest of GO date /
 *  Closing / DD start / Consultant / DD end. The mock gives both columns 70px;
 *  the left one does not need it. */
export const DATES_LABEL_WIDTH_LEFT = 56;

/** The right column's label track. ★ Sized for `Est. approval`, and it must
 *  hold `Approved` too — which is shorter, so §I's flip never re-flows the
 *  card. */
export const DATES_LABEL_WIDTH_RIGHT = 70;

/** The `gap-2` between a label and its date. */
export const DATES_LABEL_GAP = 8;

/** ★ `07/06/2026` at the card's 10.5px tabular mono. Measured — and this is
 *  what a printed date costs against the 100px an editable one does. */
export const DATES_VALUE_MIN = 60;

/** The mock's `.dgrid{column-gap:14px}` between the two quadrant columns. */
export const DATES_COLUMN_GAP = 14;

/** What the Dates box needs before a date wraps under its label. */
export const DATES_CARD_MIN_WIDTH =
  DATES_LABEL_WIDTH_LEFT +
  DATES_LABEL_GAP +
  DATES_VALUE_MIN +
  DATES_COLUMN_GAP +
  DATES_LABEL_WIDTH_RIGHT +
  DATES_LABEL_GAP +
  DATES_VALUE_MIN +
  PROJECT_CARD_CHROME -
  2;

/** The `gap-2.5` between Site data and Dates when they sit side by side. */
export const SITE_DATES_GAP = 10;

/**
 * ★★★ THE WIDTH AT WHICH THE MOCK'S SIDE-BY-SIDE LAYOUT APPEARS.
 *
 * Above this the Project card's body holds both boxes on one line; below it
 * they stack. Declared rather than typed into a class so the harness, the
 * stylesheet and the test all read one number.
 */
export const SITE_DATES_SIDE_BY_SIDE_MIN =
  SITE_DATA_MIN_WIDTH + SITE_DATES_GAP + DATES_CARD_MIN_WIDTH;

// ---------------------------------------------------------------------------
// §D — THE TRANSPOSED UNITS MATRIX
// ---------------------------------------------------------------------------
//
// ★★★ THE TRANSPOSE IS WHAT BUYS `Size (sf)` THE COLUMN fix-488 COULD NOT
//     AFFORD. fix-488 §B built P-150's ninth column, measured it at +38px of
//     matrix and +76px of row minimum, and REVERTED it: the wrapped row then
//     needed 736px against the 710 a 1280 window gives. Turning the matrix
//     ninety degrees makes an attribute a ROW, so `Size (sf)` costs 16px of
//     HEIGHT and nothing at all of width. The constraint expired; the field
//     ships.
//
// ★★ AND THE COST MOVED TO THE UNIT COUNT. Each unit TYPE is a column now, so
//    width grows with how many types a project has — 2 on 59 prod projects, 4
//    on 9, and 6 on two of them (including 403 W Dravus St, the brief's own
//    measurement project). Six is what the floor is built for.

/** The attribute column. ★ `Roof deck` and `Size (sf)` are the longest of the
 *  eight attribute names, at 9.5px. */
export const UNIT_MATRIX_LABEL_COL = 62;

/**
 * One unit-type column.
 *
 * ★ It holds two different widest things and the larger wins: a value —
 * `1,850` in tabular mono at 10.5px — and the HEADER, which is the type name.
 * `Cottages` is the longest registry value; off-registry free text ellipsises,
 * exactly as `UNIT_ROW_COLUMNS.label` already rules. 45px with the cell's
 * `px-2` either side.
 */
export const UNIT_MATRIX_TYPE_COL = 45;

/** How many type columns the floor is built to hold without clipping. ★ Prod's
 *  maximum today is 6; a seventh wraps the row rather than truncating the card,
 *  because `OverviewCard` is `overflow-hidden` (fix-422). */
export const UNIT_MATRIX_MAX_TYPE_COLUMNS = 6;

/** What the transposed matrix costs at `n` unit types. */
export function unitMatrixWidthFor(typeCount: number): number {
  return UNIT_MATRIX_LABEL_COL + Math.max(1, typeCount) * UNIT_MATRIX_TYPE_COL;
}

/** The widest the matrix is built to render — the Project floor's other
 *  binding part. */
export const UNIT_MATRIX_TRANSPOSED_WIDTH = unitMatrixWidthFor(
  UNIT_MATRIX_MAX_TYPE_COLUMNS,
);

// ---------------------------------------------------------------------------
// THE CARD'S FLOOR
// ---------------------------------------------------------------------------

/**
 * ★★★ WHAT THE PROJECT CARD NEEDS, AND WHY IT IS A `max` OF TWO THINGS.
 *
 * The matrix spans the card's full width, so it binds directly. The Site/Dates
 * pair binds only at its STACKED width — because it wraps — which is
 * `DATES_CARD_MIN_WIDTH`, the wider of the two boxes. If the pair could not
 * wrap this would be `SITE_DATES_SIDE_BY_SIDE_MIN` and the row would not fit at
 * 1600; that difference is the whole of §A's argument.
 */
export const PROJECT_CARD_MIN_WIDTH =
  Math.max(
    UNIT_MATRIX_TRANSPOSED_WIDTH,
    Math.max(SITE_DATA_MIN_WIDTH, DATES_CARD_MIN_WIDTH),
  ) + PROJECT_CARD_CHROME;

// ---------------------------------------------------------------------------
// §E — THE PLAN OF RECORD CARD
// ---------------------------------------------------------------------------

/** One of the two set buttons: `Marketing · External` at 10px bold, plus the
 *  share glyph at its right end and the button's own `px-1.5`. */
export const POR_BUTTON_MIN_WIDTH = 136;

/** The `gap-1.5` between the two buttons. */
export const POR_BUTTON_GAP = 6;

/** What the Plan of Record card needs to put both buttons on one line. ★ They
 *  are a PAIR — `Marketing · Internal` and `Marketing · External` are read
 *  against each other, and stacking them reads as two unrelated controls. */
export const POR_CARD_MIN_WIDTH =
  2 * POR_BUTTON_MIN_WIDTH + POR_BUTTON_GAP + PROJECT_CARD_CHROME;

// ---------------------------------------------------------------------------
// §F — THE COMPACT CONSULTANT PILL
// ---------------------------------------------------------------------------
//
// ★★★ THE PILL LEFT ITS OWN CARD AND JOINED A GRID, WHICH CHANGED WHAT IT MAY
//     COST. fix-475 measured a pill in a 144px COLUMN — one pill per line, as
//     many lines as there are consultants. v14 puts `ceil(n/2)` of them ACROSS
//     the Team card, so at eight consultants four share the card's width. Four
//     times fix-475's 144 is 576px against the ~290 the Team column gets at
//     1600: the stacked-date pill cannot be the grid pill.
//
// ★★★ SO THE TWO DATES GO BACK SIDE BY SIDE — AS TEXT — AND STAY EDITABLE IN A
//     FLOATING PANEL. Bobby's ruling is *"a consultant's status and two dates
//     stay editable on the overview"*, and it says nothing about the control.
//     A `BufferedDateInput` is 103px (fix-475's Chrome measurement) and two of
//     them cannot share a 96px cell; two PRINTED dates measure 36px each. So
//     the pill prints them, and clicking either one opens a floating editor —
//     the pattern `BuilderOwnerDisclosure` already uses on this same row —
//     anchored to the pill and sized independently of it, so the control keeps
//     its honest 103px.
//
//     ★ The alternative, sending the dates to Project Data, would have made the
//       overview read-only in the one place Bobby carved an exception. The
//       panel keeps the exception AND the width.

/** A printed `05/01` under its `EST REC` caption, at the pill's 8 / 9.5px. */
export const CONSULTANT_DATE_TEXT_MIN = 36;

/** The `gap-1.5` between the two date slots. */
export const CONSULTANT_DATE_TEXT_GAP = 6;

/** The status control. ★ It is a BUTTON now, not the 104px `<select>` that
 *  `CONSULTANT_STATUS_WIDTH` measures: P-164 turned the click into a confirm,
 *  and a button sized for `RECEIVED` at 8.5px extrabold is 56. */
export const CONSULTANT_STATUS_BUTTON_WIDTH = 56;

/** The firm name's own minimum before its ellipsis stops being readable. */
export const CONSULTANT_FIRM_MIN = 60;

/** `.cbody` padding (8+8) plus the pill's 1px border a side. */
export const CONSULTANT_PILL_CHROME_COMPACT = 18;

/**
 * What one pill in the grid needs.
 *
 * ★ The DISCIPLINE is not in this sum. The mock's `.pill .d` is a caption on
 *   its own line above `.pill .firm`, which is the flex row holding the firm
 *   and the status apart — so the brief's *"discipline · firm · status on one
 *   line"* is a grouping, and the mock (which wins on layout) draws it as two.
 *   Counting the discipline as a third item on that line would put the pill at
 *   174 and the Team floor 68px above what 1600 can give.
 */
export const CONSULTANT_PILL_COMPACT_MIN =
  Math.max(
    2 * CONSULTANT_DATE_TEXT_MIN + CONSULTANT_DATE_TEXT_GAP,
    CONSULTANT_STATUS_BUTTON_WIDTH + CONSULTANT_DATE_TEXT_GAP + CONSULTANT_FIRM_MIN,
  ) + CONSULTANT_PILL_CHROME_COMPACT;

/**
 * ★★★ THE CONSULTANT BAND'S FLOOR IS **ONE** PILL, AND THAT IS DELIBERATE.
 *
 * The ruled split — *"5 goes 3+2, 7 goes 4+3"* — is the layout's TARGET,
 * declared with flex bases so it renders at every width that holds it. It is
 * not a floor, because a floor is *what the card needs before it breaks*, and
 * a band that wraps to fewer columns has not broken: it degrades to exactly the
 * one-pill-per-line list fix-475 shipped and main renders today.
 *
 * ★★ FLOORING IT AT FOUR PILLS WOULD COST THE WHOLE TICKET. 4 × 140 + gaps is
 *    578px of Team card against the ~290 the column gets at 1600, which puts
 *    `OVERVIEW_ROW_MIN_WIDTH` at ~1320 and wraps the row at every width Bobby
 *    works at — the sideways-scroll family of defects fix-417 → fix-423 exists
 *    to keep closed. Two across costs 302 and still misses. So the band asks
 *    for one pill and takes as many as it is given.
 */
export const CONSULTANT_BAND_MIN_WIDTH = CONSULTANT_PILL_COMPACT_MIN;

/** How many pills the top row takes at `n` consultants — `ceil(n/2)`, with
 *  Bobby's minimum of four slots applied first. */
export function consultantRowSplit(count: number): { top: number; bottom: number } {
  const n = Math.max(4, count);
  const top = Math.ceil(n / 2);
  return { top, bottom: n - top };
}
