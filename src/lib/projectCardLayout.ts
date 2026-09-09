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
//
// ===========================================================================
// ★★★ fix-507 §A/§B — AND THE WRAP WAS THE WRONG RESOLUTION, FOR ONE REASON
// ===========================================================================
//
// ★★★ IT NEVER FITTED. Measured in Chrome on the shipped app at a 1920
//     viewport, the Project card's body is **406px** against the 475 the pair
//     needs — so the "side by side wherever it fits" branch existed only above
//     a 2560 window and **every real machine got the stacked fallback**. That
//     is P-174, and Bobby's ruling of 2026-09-09 closes it: *"Site data sits
//     beside Dates on every machine."*
//
//     ★ A fallback that is the only state is not a fallback. fix-506's
//       reasoning was right about the arithmetic and wrong about what the
//       arithmetic implied — a wrap only satisfies (ii) if the wide branch is
//       reachable, and this one was not.
//
// ★★★ THE FIX IS WIDTH, NOT ARRANGEMENT. Bobby's own offer paid for it: the
//     permits rail goes 240 → 190 and the row is re-shared 35/31/34 →
//     35.5/35/29.5, which takes the Project card to **478 (476 of body)** at
//     1920 — one pixel of margin, measured. Above the threshold the pair is the
//     mock's two-column grid; below it, it stacks, on a declared container
//     query rather than an accident of wrapping.
//
// ★★ WHAT IT COSTS, STATED HERE BECAUSE IT IS A STOP CONDITION THE PR REPORTS:
//    Team pays 447 → 403, and a project with SIX consultants needs 443 for its
//    band to render 3+3 rather than wrapping to four pill-lines. Side by side
//    AND a 3-across band need 1,423 of row against the 1,385 that exists — a
//    **38px deficit**, carried by Team. Side by side was taken anyway because
//    it is better on BOTH axes: measured, a stacked pair makes the Project card
//    780px tall on `233 31st Ave E`, 17px MORE than the wrapped-band Team it
//    would have been saving.

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

/**
 * ★★ fix-507 STEP 0-2 — THE WIDEST SITE ROW IS `Lot size`, NOT `Lot`.
 *
 * Measured in Chrome: `60 × varies` needs **135** of row and `Lot size · 4,400
 * sf derived` needs **147**. `SITE_VALUE_MIN` is right by 2px and wrong about
 * WHY, and the why is what stops the next person shrinking it — fix-423's rule
 * that a prose reason is load-bearing. The `derived` suffix is fix-488's, and
 * it is a second span that wraps rather than a `whitespace-nowrap` chip, so it
 * fails softly; the floor still has to hold it or every derived lot size prints
 * on two lines.
 */
export const SITE_WIDEST_ROW_MEASURED = 147;

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
 *
 * ★★ fix-507 STEP 0-2 CONFIRMED IT IN CHROME, TO THE PIXEL, and one wrong
 *    method on the way is worth recording. Binary-searching each box's width
 *    until a row reflows said **156** and **291** — 13 and 5 under what is
 *    declared — and both were artefacts: the widest Site row (`Lot size
 *    4,400 sf derived`) is two spans that WRAP, and a search that stops when a
 *    row's height grows stops one step after the row it is measuring has
 *    already given up. Measuring each ROW's required width instead:
 *
 *      Site   `Lot size  4,400 sf derived`  147 + 20 of section padding = 167
 *      Dates  left 56+8+60 · gap 14 · right 70+8+60 = 276 + 20            = 296
 *
 *    ★ So `DATES_CARD_MIN_WIDTH` is exact and `SITE_DATA_MIN_WIDTH` is 2px
 *      conservative, and 475 is the number. ★ It is NOT the `60 × varies` row
 *      `SITE_VALUE_MIN` was sized for — that measures 135, twelve under the
 *      `Lot size` row nobody had suspected. The constant is right; its stated
 *      reason was not, and the reason is the load-bearing half (fix-423).
 */
export const SITE_DATES_SIDE_BY_SIDE_MIN =
  SITE_DATA_MIN_WIDTH + SITE_DATES_GAP + DATES_CARD_MIN_WIDTH;

/**
 * The Project card's own 1px border a side.
 *
 * ★★ AND IT IS **NOT** PART OF THE BREAKPOINT, which cost a render to find out.
 *    A container query measures the container's CONTENT box, not its border
 *    box — so the width the query sees is already the width the pair gets, and
 *    adding the border made the threshold one pixel too high and the pair
 *    stacked at a card width of 478 against a 477 threshold. fix-423 recorded
 *    exactly this for the row's own container ("the switch happens at exactly
 *    OVERVIEW_ROW_MIN_WIDTH of CONTENT box, which is why the padding does not
 *    have to be subtracted here") and I re-learned it one card down. Kept as a
 *    named constant because the DIFFERENCE between card width and body width is
 *    still real everywhere else — it is what makes `PROJECT_CARD_MIN_WIDTH` a
 *    card floor rather than a content floor.
 */
export const PROJECT_CARD_BORDER = 2;

/**
 * ★★★ fix-507 §B — SIDE BY SIDE IS A DECLARED BREAKPOINT NOW, NOT A WRAP.
 *
 * fix-506 resolved the three-way gate with `flex-wrap`: side by side wherever
 * it fits, stacked where it does not. It never fitted. Measured in Chrome on
 * the shipped app at a 1920 viewport, the Project card's body is **406px**
 * against the 475 the pair needs — so **every real machine got the stacked
 * fallback**, which is P-174, and the "where it fits" branch existed only on a
 * 2560 monitor nobody has.
 *
 * ★★★ THE FIX IS WIDTH, NOT ARRANGEMENT. §A's rail and the re-shared row take
 *     the Project card to **478 (476 of body)** at 1920 — one pixel of margin,
 *     measured — and the arrangement becomes what the mock draws: a two-column
 *     grid whose tracks carry the two boxes' own floors.
 *
 * ★★ AND THE FALLBACK BECOMES A QUERY RATHER THAN AN ACCIDENT, which is what
 *    the brief asks for in as many words. A container query on the card reads
 *    the card's OWN width, so it is right in both ribbon states — fix-423's
 *    finding, that a media query cannot see a ribbon that collapses 156px
 *    without the window moving.
 */
export const SITE_DATES_SIDE_BY_SIDE_CARD_MIN = SITE_DATES_SIDE_BY_SIDE_MIN;

/** The container the pair's breakpoint is scoped to — the Project card itself. */
export const PROJECT_CARD_CONTAINER = 'pd-project';

/** The class on the Project card, carrying the containment context. */
export const PROJECT_CARD_CLASS = 'pd-project-card-box';

/** The class on the Site/Dates pair. */
export const SITE_DATES_PAIR_CLASS = 'pd-site-dates';

/** The class on the Site column, which grows a divider when the pair is
 *  side by side (the mock's `.pstrip > .cell { border-right }`). */
export const SITE_DATES_SITE_CLASS = 'pd-site-dates-site-col';

/**
 * The pair's stylesheet.
 *
 * ★ GENERATED IN TS from the constants above, for fix-406's reason: a `?raw`
 *   CSS import is EMPTY under vitest, so a test that reads the rule would pass
 *   against nothing. Same mechanism, same file, as
 *   `OVERVIEW_ROW_RESPONSIVE_CSS`.
 *
 * ★ Stacked is the DEFAULT and side-by-side is the query, so a browser without
 *   container queries degrades to the arrangement that always fits rather than
 *   to one that clips.
 */
export const SITE_DATES_RESPONSIVE_CSS: string = [
  `.${PROJECT_CARD_CLASS}{container-type:inline-size;container-name:${PROJECT_CARD_CONTAINER}}`,
  `.${SITE_DATES_PAIR_CLASS}{display:grid;grid-template-columns:minmax(0,1fr);` +
    `column-gap:${SITE_DATES_GAP}px}`,
  `@container ${PROJECT_CARD_CONTAINER} (min-width:${SITE_DATES_SIDE_BY_SIDE_CARD_MIN}px){`,
  `.${SITE_DATES_PAIR_CLASS}{grid-template-columns:` +
    `minmax(${SITE_DATA_MIN_WIDTH}px,1fr) minmax(${DATES_CARD_MIN_WIDTH}px,1.25fr)}`,
  // ★ The mock's `.pstrip > .cell { border-right }`. No extra padding with it:
  //   the Site box's own `px-2.5` sits to its left and the grid's column gap to
  //   its right, so the rule is centred without spending width the
  //   `SITE_DATES_SIDE_BY_SIDE_MIN` sum has not already counted.
  `.${SITE_DATES_SITE_CLASS}{border-right:1px solid var(--color-border)}`,
  '}',
].join('\n');

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
// ★★★ fix-507 §E — THE MATRIX FILLS ITS BOX, AND NAMES ITS COLUMNS
// ---------------------------------------------------------------------------
//
// Shipped, the matrix is a CSS grid of fixed `45px` type columns, so a
// two-unit project renders a 152px strip inside a 400px card and the rest of
// the box is empty — P-175. The mock is a `table` with `width:100%;
// table-layout:fixed` and a 19% corner cell, so the columns divide whatever
// the card gives them.
//
// ★★ AND THE FLOOR DOES NOT MOVE, which is worth stating because a percentage
//    layout looks like it should have replaced one. At `UNIT_MATRIX_
//    TRANSPOSED_WIDTH` (332) the 19% corner is 63px — one above
//    `UNIT_MATRIX_LABEL_COL` — and each of the six type columns is 44.8, one
//    under `UNIT_MATRIX_TYPE_COL`. The percentage and the pixel derivation
//    describe the same table; the pixels stay the floor because a floor has to
//    be a length (fix-417: an explicit length is the only thing that replaces
//    a track's automatic min-content minimum).

/** The mock's `table.umx th.corner{width:19%}` — the attribute column's share
 *  of the table once it stretches. */
export const UNIT_MATRIX_CORNER_PCT = 19;

/**
 * ★★★ AT OR BELOW THIS MANY UNITS THE TABLE GOES UP A TYPE STEP (`big`).
 *
 * Bobby: *"if you had two, it would fill out the space. If you had six, it
 * would kind of shrink and condense to the space."* Stretching alone gives a
 * two-unit project three very wide columns of very small text; the mock's
 * `.big` answers that with one step of type and padding, so the box reads full
 * rather than merely covered.
 */
export const UNIT_MATRIX_BIG_MAX_TYPES = 4;

/** Whether `n` unit types render at the larger step. */
export function unitMatrixIsBig(typeCount: number): boolean {
  return typeCount <= UNIT_MATRIX_BIG_MAX_TYPES;
}

/** The two type steps, read straight off the mock's final `.v8` block
 *  (`overview_book_v14.html:286-290`). */
export const UNIT_MATRIX_TYPE_STEPS = {
  normal: { cell: 10, header: 10, padY: 5, padX: 6 },
  big: { cell: 11, header: 10.5, padY: 8, padX: 6 },
} as const;

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
// ★★★ fix-507b §G — THE PLAN THUMBNAIL GETS A HEIGHT CAP
// ---------------------------------------------------------------------------
//
// The card's image is `w-full h-auto`, so **the card's height is set by the
// aspect ratio of whatever sheet the indexer happened to grab**. The v14 mock
// draws the plan as a landscape 420 × 300 SVG with no cap, so signing it off
// proved nothing about a portrait sheet — the third instance of
// [[a-mock-measures-a-drawing-not-the-control-you-ship]] in this one feature.
//
// ★★★ MEASURED, not assumed. Every one of the **164** indexed plans was signed
//     out of the `plan-thumbnails` bucket and its natural size read in Chrome
//     (2026-09-09). There are only FOUR distinct sizes, and 97% are one of
//     them:
//
//         1400 × 906   AR 1.545   159   ← the modal sheet
//         1400 × 907   AR 1.544     1
//         1400 × 1082  AR 1.294     2   letter landscape
//         1400 × 2164  AR 0.647     2   PORTRAIT — 1 schematic, 1 marketing
//
//     **162 landscape · 2 portrait · 0 square.** So the cap is insurance for
//     two projects today — but those two render the image at 716px against the
//     modal 300, which is a 416px card on its own, and that is exactly the
//     "row taller than the screen" this ticket is about.
//
// ★★ THE CAP IS DERIVED FROM THE MODAL SHEET, so 97% of cards are unchanged by
//    it: a 1.545 sheet at the reference width renders exactly the cap and is
//    neither scaled nor padded. The other three sizes are `object-fit: contain`
//    inside the same box — scaled DOWN and centred, never cropped, because the
//    title block and north arrow have to survive the preview.

/** The Plan of Record card's width at the fix-507 reference viewport (1920,
 *  ribbon expanded, 190px rail), measured in Chrome: 485. Written here rather
 *  than imported from `overviewCardLayout` because that module derives its
 *  floors from THIS one and the import would be circular — the same reason
 *  `PROJECT_CARD_CHROME` is declared apart and asserted equal by the suite. */
export const POR_CARD_WIDTH_AT_REFERENCE = 485;

/** The image's own width inside that card, after the card border and the
 *  section's `px-2.5`. */
export const POR_IMAGE_WIDTH_AT_REFERENCE =
  POR_CARD_WIDTH_AT_REFERENCE - PROJECT_CARD_CHROME;

/** ★ The aspect ratio of the sheet the indexer produces for 159 of 164 plans —
 *  1400 × 906, measured in the bucket, not guessed from a paper size. */
export const PLAN_SHEET_MODAL_ASPECT = 1400 / 906;

/**
 * ★★★ THE CAP. Derived: what the modal landscape sheet renders at, at the
 * reference card width. ~300px, which is what Bobby's ruling names — and it is
 * a computation, not that number typed.
 */
export const POR_IMAGE_MAX_HEIGHT = Math.round(
  POR_IMAGE_WIDTH_AT_REFERENCE / PLAN_SHEET_MODAL_ASPECT,
);

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
