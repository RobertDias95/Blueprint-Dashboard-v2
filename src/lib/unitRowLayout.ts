// ===========================================================================
// ★★★ fix-422 — THE UNIT MATRIX: ONE HEADER ROW, ONE ROW PER UNIT TYPE
// ===========================================================================
//
// Bobby, 2026-08-27:
//
//   *"When you have more than two different unit dimensions, the page gets way
//    too vertically long, and it stretches out milestones, team, design plan of
//    record, builder/owner… go back to horizontal."*
//
//   *"For type, the box is way too wide — we only need it as wide as duplex or
//    cottage."* · *"Width, roughly three numbers, and depth three numbers.
//    Quantity and stories, one number. And then we just need to do the
//    abbreviation above that."* · *"Parking can be like P … Stalls could just be
//    like S. Roof deck could be RD, and it just needs to show a Y."* · *"I don't
//    think we need the X between width and depth."*
//
// ---------------------------------------------------------------------------
// ★★★ THIS REVERSES fix-418's VERTICAL COLUMN, AND fix-418 WAS NOT WRONG
// ---------------------------------------------------------------------------
//
// The sequence, so the next reader does not think anybody was flailing:
//
//   fix-412  laid the fields across in ONE declared grid, because the header
//            strip and the row were two lists of widths that had drifted four
//            ways. That ruling — one declaration, a header over its own control
//            — is still in force and this file is still it.
//   fix-417  wrapped that row in `overflow-x` because at 620px it was setting
//            the width of the whole page.
//   fix-418  went VERTICAL, which removed the scrollbar at source.
//   fix-422  goes back to horizontal, because vertical solved the width by
//            spending HEIGHT — and height is shared with four other cards.
//
// ★★ WHAT ACTUALLY CHANGED BETWEEN fix-418 AND HERE IS THE COLUMN COUNT.
// fix-412's row was **ten** columns and 620px because Label was 84, Work was 74
// and Parking was 104 — it spelled everything out. This matrix is **nine**
// columns and 274px because Bobby asked for abbreviations, letter codes and no
// `×` separator, and because Work left the grid entirely (see below). A
// horizontal row was never the problem; 620px of it was.
//
// ★★★ AND THE SCROLLER STAYS DELETED. fix-417 §B's `overflow-x` container is
// NOT coming back — that is the thing this whole sequence exists to remove. The
// matrix is narrow enough to fit, and `overviewCardLayout` gives the PROJECT
// card a floor DERIVED from `UNIT_MATRIX_WIDTH` so the card can never be
// narrower than the thing inside it. Those two numbers are one decision in two
// files, exactly as fix-417's floor and its scroller were.

export interface UnitRowColumn {
  /** Matches the `unit_types` key it edits, where there is one. */
  key: string;
  /**
   * The header text — an ABBREVIATION now, per Bobby.
   *
   * ★ `#` for stalls is MINE, not his: he said *"Stalls could just be like S"*,
   *   and an `S` header would sit one column from a parking cell reading `S`
   *   for surface. Two different `S`es on one row, 46px apart, is the exact
   *   class of ambiguity fix-411 §3 removed the bare "Deck" for. Flagged in the
   *   PR so he can overrule it.
   */
  header: string;
  /** Fixed px width. */
  width: number;
  /**
   * ★★★ PLAIN LANGUAGE, ON HOVER **AND** ON KEYBOARD FOCUS.
   *
   * Bobby: *"If someone hovered their cursor over QTY, or STY, or P, or S,
   * there'd be a summary of what that is."*
   *
   * ★★ A `title` attribute is a MOUSE-ONLY affordance. It never fires for
   * somebody tabbing the form and it never fires on a tablet, so an
   * abbreviation-only header would be unreadable to both. The header renders as
   * a focusable element with this string as both `title` and its accessible
   * name, and the suite asserts the focus half — the half that gets forgotten.
   */
  tooltip: string;
}

/**
 * ★★★ THE COLUMNS, IN BOBBY'S ORDER, SIZED TO WHAT THEY HOLD.
 *
 * Type · W · D · Qty · Sty · P · # · RD, then the remove control.
 *
 * ★★ `work_scope` IS NOT HERE ANY MORE, and that is Scope 7 rather than an
 * omission. It has THREE states and the third is "not yet answered" — which
 * cannot honestly be a letter, because every letter in a one-glyph cell reads
 * as an answer. It renders as a chip under the row that owns it, Remodel-only,
 * exactly as fix-418 scoped it. See `UNIT_ROW_SUPPRESSED_ON_NO_WORK` below:
 * leaving the grid did not change what it gates.
 *
 * ★ Every width below is sized at the 9px semibold these cells render at
 *   (~5.4px per digit, ~14px for a select's chevron, 6px of cell padding).
 */
export const UNIT_ROW_COLUMNS: readonly UnitRowColumn[] = [
  {
    key: 'label',
    header: 'Type',
    // ★★ 52px, and Bobby set it: *"we only need it as wide as duplex or
    //    cottage."* `Duplex` (6) and `Cottages` (8) are the two he named;
    //    `Cottages` is the longest of the eight registry values (SFR, Cottages,
    //    Duplex, Condo, ADU, DADU, SFR+ADU, Remodel) and fits at 52 with the
    //    chevron. 9 of 235 prod rows carry off-registry free text — the longest
    //    is "SFR w/ Accessory Units" at 22 characters — and those TRUNCATE with
    //    the full label on hover (Scope 8). Sizing the column for nine rows
    //    would tax the other 226 and every project that has none of them.
    width: 52,
    tooltip: 'The unit type these numbers describe. The list comes from Settings.',
  },
  {
    key: 'width_ft',
    header: 'W',
    // ★ Bobby said "roughly three numbers". It is sized for FOUR glyphs because
    //   prod holds `72.5` — a three-digit box would clip a real value, and
    //   rounding it away is not available (fix-411: this cell COMMITS).
    width: 30,
    tooltip: 'How wide this unit type is, in feet.',
  },
  {
    key: 'depth_ft',
    header: 'D',
    width: 30,
    tooltip: 'How deep this unit type is, in feet.',
  },
  {
    key: 'qty',
    header: 'Qty',
    // ★ "One number", sized for two — prod has projects with 10+ of a type.
    width: 22,
    tooltip: 'How many units on this project match these dimensions.',
  },
  {
    key: 'stories',
    header: 'Sty',
    width: 22,
    tooltip: 'How many stories tall this unit type is.',
  },
  {
    key: 'parking_kind',
    header: 'P',
    // ★ One letter plus a chevron. The CELL shows G/S/B/—; the OPEN MENU shows
    //   the words — see ParkingKindSelect for how both are true at once.
    width: 26,
    // ★★ SCOPE 6's COPY, WITH ONE CLAUSE ADDED. The brief mapped `none` AND
    //    "not recorded" both to `—`; fix-402's rule is that those are different
    //    answers and prod has 4 NULLs against 1 recorded `none`. So `none` is
    //    `N`, `—` means nobody has said, and the legend says both. See
    //    lib/unitParking for the full argument.
    tooltip:
      'What kind of parking is proposed. G garage · S surface · B both · ' +
      'N none · — not recorded',
  },
  {
    key: 'parking_stalls',
    header: '#',
    width: 20,
    tooltip: 'How many parking stalls this unit type gets.',
  },
  {
    key: 'roof_deck',
    header: 'RD',
    // ★★★ THIS RE-ABBREVIATES WHAT fix-412 C5 DELIBERATELY SPELLED OUT, and it
    //     is the same reasoning running the other way. fix-411 wrote "RD"
    //     because the cell was 52px; fix-412 restored "Roof Deck" because it
    //     had bought the row 42px and the constraint had expired. Bobby has now
    //     asked for the abbreviation back — *"Roof deck could be RD"* — and the
    //     tooltip carries what the letters cost. Not a regression: the header is
    //     short AND the meaning is one hover or one Tab away, which is more than
    //     either previous version offered.
    width: 26,
    tooltip: 'Whether this unit type has a roof deck.',
  },
  {
    key: 'remove',
    header: '',
    width: 16,
    tooltip: '',
  },
];

/**
 * ★★★ THE GAP BETWEEN TWO COLUMNS — AND WHY IT IS A FUNCTION.
 *
 * Bobby: *"I don't think we need the X between width and depth — and that would
 * give a little bit more space if we needed potentially another box."*
 *
 * ★★ REMOVING THE `×` COSTS THE PAIR ITS GRAMMAR. `20 × 30` reads as one
 * dimension; `20  30` reads as two numbers that happen to be adjacent. The
 * separator did work that the eye now has to do, so W and D are set TIGHTER to
 * each other (2px) than to anything else (4px) and the pair still groups.
 *
 * ★★★ AND THE SAVING IS BANKED, NOT SPENT. He asked for the freed width to stay
 * available for a future column, so it is not absorbed into padding: the whole
 * matrix is 274px, and the `×` column plus its two gaps would have been ~22 of
 * them. A ninth data column costs nothing but a row in the table above.
 */
export const UNIT_ROW_GAP = 4;

/** The tighter gap that keeps W and D reading as one dimension. */
export const UNIT_WD_GAP = 2;

/** Which gap follows the column at `index`. */
export function unitGapAfter(index: number): number {
  return UNIT_ROW_COLUMNS[index]?.key === 'width_ft' ? UNIT_WD_GAP : UNIT_ROW_GAP;
}

/**
 * ★★★ THE ONE TEMPLATE THE HEADER ROW AND EVERY UNIT ROW RENDER FROM.
 *
 * fix-412's ruling, unchanged and now the reason this file exists: a header
 * cannot sit over the wrong control when the header cell and the control are
 * literally the same grid column. Two hand-kept lists drift; one template
 * cannot.
 *
 * ★ `column-gap` is per-gap here (the W/D pair is tighter), which a single
 *   `gap` cannot express — so the gaps are baked into the template as explicit
 *   tracks rather than set as a property. That keeps ONE source for the whole
 *   geometry instead of a template plus a gap somebody has to keep in step.
 */
export const UNIT_MATRIX_GRID: string = UNIT_ROW_COLUMNS.map((c, i) =>
  i === UNIT_ROW_COLUMNS.length - 1
    ? `${c.width}px`
    : `${c.width}px ${unitGapAfter(i)}px`,
).join(' ');

/**
 * ★★★ WHAT THE MATRIX ACTUALLY COSTS, IN PIXELS — the number
 * `overviewCardLayout` derives the PROJECT card's floor from.
 *
 * ★★ THIS EXPORT IS THE WHOLE SAFETY MECHANISM. `OverviewCard` is
 * `overflow-hidden`, so a card narrower than its contents does not scroll — it
 * CLIPS, silently. fix-417 solved that with an `overflow-x` container; fix-418
 * removed the container; this solves it by making the card's floor a function
 * of the matrix instead of a number somebody typed. Widen a column above and
 * the card's floor widens with it, in the same build.
 */
export const UNIT_MATRIX_WIDTH: number =
  UNIT_ROW_COLUMNS.reduce((a, c) => a + c.width, 0) +
  UNIT_ROW_COLUMNS.slice(0, -1).reduce((a, _c, i) => a + unitGapAfter(i), 0);

/**
 * ★★★ SCOPE 7 — `work_scope` IS OFF THE GRID, SO IT NEEDS ITS OWN LABEL HERE.
 *
 * It is still a unit field and it is still declared once; it simply is not a
 * COLUMN, because its third state ("not yet answered") cannot be a letter — any
 * glyph in a one-glyph cell reads as an answer, and `—` is already spoken for by
 * "not recorded". So it renders as a chip under the row that owns it, with its
 * words intact, and the two strings live beside the columns rather than in the
 * component.
 */
export const WORK_SCOPE_LABEL = 'Work';

export const WORK_SCOPE_TOOLTIP =
  'Whether work was performed on this Remodel unit. No work · Yes · not yet answered.';

// ---------------------------------------------------------------------------
// ★★★ THE HEIGHT MODEL — because HEIGHT is what this ticket is actually about
// ---------------------------------------------------------------------------
//
// Bobby: *"When you have more than two different unit dimensions, the page gets
// way too vertically long, and it stretches out milestones, team, design plan
// of record, builder/owner."*
//
// ★★★ THAT SENTENCE IS THE ACCEPTANCE CRITERION, so it is arithmetic here
// rather than something a reviewer squints at. The five cards are
// `alignItems: stretch` (fix-309 #55), so every pixel the units band spends is
// charged to four cards that did not ask for it — which is why the per-type
// cost, not the total, is the number that matters.

/** The height of one matrix cell, px. ★ The row's `h-[16px]` must match; the
 *  fix-422 suite asserts the class against this constant so they cannot drift
 *  the way fix-412's two width lists did. */
export const UNIT_MATRIX_ROW_HEIGHT = 16;

/** Tailwind `gap-1` between the header row and each unit row. */
export const UNIT_MATRIX_ROW_GAP = 4;

/** The header strip's own line box at `text-[8px]`. */
export const UNIT_MATRIX_HEADER_HEIGHT = 10;

/** What N unit types cost, vertically, in the matrix. */
export function unitBandHeight(typeCount: number): number {
  return (
    UNIT_MATRIX_HEADER_HEIGHT +
    typeCount * (UNIT_MATRIX_ROW_HEIGHT + UNIT_MATRIX_ROW_GAP)
  );
}

/**
 * ★ What the same N types cost under fix-418's VERTICAL block, kept for the
 *   comparison that justifies this ticket.
 *
 * Measured off fix-418's shipped markup: each unit was a bordered block holding
 * a label row plus one `UnitField` per data column, each field a `text-[11px]
 * py-0.5` control on its own line (~18px), 2px apart, inside 8px of padding and
 * a 1px border, with 6px between blocks.
 */
export function fix418BandHeight(typeCount: number): number {
  const dataFields = UNIT_ROW_COLUMNS.filter((c) => c.key !== 'remove').length;
  const block = 16 + dataFields * (18 + 2) + 8 + 2;
  return typeCount * block + Math.max(0, typeCount - 1) * 6;
}

/** The header text for a field, so nothing renders a label of its own. */
export function unitFieldLabel(key: string): string {
  const col = UNIT_ROW_COLUMNS.find((c) => c.key === key);
  if (!col) throw new Error(`unitFieldLabel: no unit field named "${key}"`);
  return col.header;
}

/** The plain-language summary for a field. */
export function unitFieldTooltip(key: string): string {
  const col = UNIT_ROW_COLUMNS.find((c) => c.key === key);
  if (!col) throw new Error(`unitFieldTooltip: no unit field named "${key}"`);
  return col.tooltip;
}

/** ★ The columns fix-412 B5 suppresses on a confirmed No-work unit — everything
 *  that describes drawn detail. `label` and `remove` stay live: you must be able
 *  to see what the unit is and delete the row. `work_scope` is not listed
 *  because it is not a column any more; the chip that owns it is never
 *  suppressed, or you could not change your mind. */
export const UNIT_ROW_SUPPRESSED_ON_NO_WORK: readonly string[] = [
  'width_ft',
  'depth_ft',
  'qty',
  'stories',
  'parking_kind',
  'parking_stalls',
  'roof_deck',
];

/**
 * ★ fix-412's row, kept as a NUMBER rather than a layout.
 *
 * 584px across ten columns plus nine 4px gaps = 620px, which made the PROJECT
 * card's min-content ~642px and let it resize its four neighbours. That is the
 * evidence for fix-417, which is still load-bearing, so the arithmetic survives
 * its layout — but nothing renders from it.
 */
export const FIX_412_ROW_WIDTH = 620;
