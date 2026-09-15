// ===========================================================================
// ★★★ fix-572 §C (P-277) — UNIT CONFIGURATION, ONE LABELLED BLOCK PER TYPE
// ===========================================================================
//
// Bobby, 2026-09-15: *"types should be at the top and then unit configuration
// is the category that then nicely and cleanly organizes this info… so in one
// swoop, you can cleanly and quickly organize the unit configuration."*
//
// ---------------------------------------------------------------------------
// ★★★ THIS REPLACES `lib/unitRowLayout`, AND THE §0 PREMISE IT RESTED ON WAS
//     ALREADY FALSE
// ---------------------------------------------------------------------------
//
// The brief called the shared layout *"the whole risk of the ticket"*:
// `unitRowLayout` was said to serve the modal AND the Project Overview PROJECT
// card, so restacking one would restack the other.
//
// ★★★ MEASURED: IT DID NOT. `UNIT_ROW_COLUMNS` / `UNIT_MATRIX_GRID` had exactly
//     ONE consumer — `ProjectDataEditors.tsx`, the modal. The Overview card has
//     rendered from its OWN transposed declaration since fix-507/508
//     (`ProjectOverviewBoxes.UNIT_ATTRIBUTES` + `projectCardLayout`), and
//     `PROJECT_CARD_MIN_WIDTH` derives from `UNIT_MATRIX_TRANSPOSED_WIDTH` in
//     `projectCardLayout` — **not** from `unitRowLayout.UNIT_MATRIX_WIDTH`,
//     which had no consumer outside its own file and its tests.
//
// ★★ SO THE SPLIT THE BRIEF ASKS FOR ALREADY HAPPENED, two tickets ago, and
//    this file is the modal's half being renamed to what it actually is. There
//    is ONE declaration for ONE surface — fix-412's rule — and the Overview is
//    untouched because it never read this.
//
// ---------------------------------------------------------------------------
// ★★★ AND fix-412's HEADER-OVER-ITS-OWN-CONTROL RULE IS SATISFIED MORE
//     STRONGLY, NOT ABANDONED
// ---------------------------------------------------------------------------
//
// fix-412 pinned `UNIT_MATRIX_GRID` as ONE string rendered by both a header
// strip and each row, because two hand-kept width lists had drifted four ways
// and put `Roof Deck` over a parking cell (P-230's sibling). **The new form has
// no header strip**: every field carries its own label, inside its own block,
// in the same JSX. A label cannot sit over the wrong control when it is not
// over a control at all — it is beside it, in one element.
//
// ★ So the grid test is retired rather than weakened, and the ruling it
//   enforced is now structural. Recorded here because fix-412 cost a ticket to
//   learn and deleting its assertion quietly would read as forgetting it.

/** One field in a unit's configuration block. */
export interface UnitConfigField {
  /** The `unit_types` key it reads and writes. `label` is the type name. */
  key:
    | 'label'
    | 'qty'
    | 'width_ft'
    | 'depth_ft'
    | 'size_sf'
    | 'stories'
    | 'parking_kind'
    | 'roof_deck';
  /**
   * ★★★ THE WHOLE WORD. §C: *"Nothing in this block is abbreviated: labels read
   *     Type, Quantity, Width, Depth, Unit Size, Stories, Parking, Roof Deck,
   *     not W · D · QTY · STY · P · RD."*
   *
   * fix-422 abbreviated them because the matrix cell was 22–30px wide. That
   * constraint was the Overview row's, and it does not exist in a 760px modal
   * — the same scoped exception §C makes for Unit Size below.
   */
  label: string;
  /** Plain language, for the control's accessible name. ★ fix-422 put these on
   *  a focusable header because the columns were letters; they stay because an
   *  accessible name is worth having even when the visible label is a word. */
  hint: string;
}

/**
 * ★★★ THE ORDER IS BOBBY'S, VERBATIM: *"Type · Quantity · Width · Depth · Unit
 *     Size · Stories · Parking · Roof Deck"*, then the remove control.
 *
 * ★★ `size_sf` IS IN THE LIST, and that is a scoped exception rather than a
 *    reversal. fix-488 §B built it as a ninth matrix column, measured it
 *    (matrix 274 → 312px, PROJECT floor 296 → 334, overview row minimum
 *    1,172 → 1,248, wrap point 1,742 → 1,818) and REVERTED it — because at
 *    1280 the wider wrapped line then needed 736px against 710 available,
 *    which is fix-423 §D's guarantee broken. **Every number in that argument is
 *    about the OVERVIEW ROW.** This form is inside a 760px modal that owes the
 *    overview row nothing, so the constraint does not apply here.
 *    ⚠️ The Overview matrix still does NOT show Unit Size. fix-488's ruling is
 *    unchanged where it was made.
 */
export const UNIT_CONFIG_FIELDS: readonly UnitConfigField[] = [
  {
    key: 'label',
    label: 'Type',
    hint: 'The type these numbers describe. The list comes from Settings.',
  },
  {
    key: 'qty',
    label: 'Quantity',
    hint: 'How many units on this project match these dimensions.',
  },
  { key: 'width_ft', label: 'Width', hint: 'How wide this type is, in feet.' },
  { key: 'depth_ft', label: 'Depth', hint: 'How deep this type is, in feet.' },
  {
    key: 'size_sf',
    label: 'Unit Size',
    hint: 'Floor area for this type, in square feet. Typed, never computed from width × depth.',
  },
  {
    key: 'stories',
    label: 'Stories',
    hint: 'How many stories tall this type is. B is a basement — 3+B is three stories over a basement.',
  },
  {
    key: 'parking_kind',
    label: 'Parking',
    hint: 'What kind of parking is proposed — 1-car garage through 4-car garage, or Surface / None.',
  },
  {
    key: 'roof_deck',
    label: 'Roof Deck',
    hint: 'Whether this type has a roof deck, and whether it has a penthouse.',
  },
];

/** The visible label for a field. ★ Throws on an unknown key, like
 *  `unitFieldTooltip` did: a control asking for a label that does not exist is
 *  a typo, and a silent `undefined` renders as an unlabelled box — which is the
 *  exact defect this ticket is fixing. */
export function unitFieldLabel(key: UnitConfigField['key']): string {
  const f = UNIT_CONFIG_FIELDS.find((c) => c.key === key);
  if (!f) throw new Error(`unitFieldLabel: no unit field named "${key}"`);
  return f.label;
}

export function unitFieldHint(key: UnitConfigField['key']): string {
  const f = UNIT_CONFIG_FIELDS.find((c) => c.key === key);
  if (!f) throw new Error(`unitFieldHint: no unit field named "${key}"`);
  return f.hint;
}

// ===========================================================================
// ★★★ RETIRED LAYOUT EVIDENCE — numbers kept because the fixes are still
//     load-bearing, not because the layouts are
// ===========================================================================
//
// fix-422 kept fix-412's 620 for exactly this reason and said so: *"deleting
// them would delete the evidence for a fix that is still load-bearing."*
// fix-572 §C retires the horizontal matrix those numbers described, so they
// move here under names that say they are history.
//
// ★★★ AND THIS IS fix-562's OWN LESSON, APPLIED AHEAD OF TIME: a historical
//     measurement must be a LITERAL, never derived from a live list.
//     `fix418BandHeight` computed its field count from `UNIT_ROW_COLUMNS`, so
//     removing one column silently rewrote fix-418's shipped past. These are
//     literals and cannot move again.

/** fix-412's ten-column spelled-out row — the 620px that caused fix-417. */
export const FIX_412_ROW_WIDTH = 620;

/** fix-422's horizontal matrix at its final width, after fix-562 §A removed
 *  the `#` stalls column (274 → 266). ★ It bound nothing outside its own file
 *  by the end: the PROJECT card's floor has derived from
 *  `projectCardLayout.UNIT_MATRIX_TRANSPOSED_WIDTH` since fix-507/508. */
export const FIX_422_MATRIX_WIDTH = 266;

/** Its inter-column gap, and its column count after fix-562 §A. */
export const FIX_422_MATRIX_GAP = 4;
export const FIX_422_MATRIX_COLUMNS = 8;

/** The matrix cell's line box, and the `gap-1` between its rows. ★ fix-422
 *  asserted the row's `h-[16px]` class against this so the two could not drift;
 *  the class is gone with the row, and the numbers stay as the inputs to
 *  `fix422BandHeight` below. */
export const FIX_422_MATRIX_ROW_HEIGHT = 16;
export const FIX_422_MATRIX_ROW_GAP = 4;
/** The header strip's own line box at `text-[8px]`. */
export const FIX_422_MATRIX_HEADER_HEIGHT = 10;

/** What N unit types cost vertically in fix-422's matrix. ★ Kept because
 *  fix-422 §B's whole acceptance criterion is the COMPARISON below, and half a
 *  comparison proves nothing. */
export function fix422BandHeight(typeCount: number): number {
  return (
    FIX_422_MATRIX_HEADER_HEIGHT +
    typeCount * (FIX_422_MATRIX_ROW_HEIGHT + FIX_422_MATRIX_ROW_GAP)
  );
}

/**
 * ★ What the same N types cost under fix-418's VERTICAL block — the layout
 *   fix-422 replaced, and the one fix-572 §C's blocks superficially resemble.
 *
 * Measured off fix-418's shipped markup: each unit was a bordered block holding
 * a label row plus one `UnitField` per data column, each field a `text-[11px]
 * py-0.5` control on its own line (~18px), 2px apart, inside 8px of padding and
 * a 1px border, with 6px between blocks.
 *
 * ★★★ fix-562 §A's LESSON, AND THE REASON THE WHOLE BLOCK ABOVE IS LITERALS:
 *     this read `UNIT_ROW_COLUMNS.filter(...).length`, which made a MEASUREMENT
 *     OF A SHIPPED PAST LAYOUT a function of today's column list. Removing the
 *     `#` column silently rewrote fix-418's history from 186px per block to
 *     166, and two fix-422 assertions changed sign with nothing having happened
 *     to fix-418. fix-418 shipped EIGHT data fields — label, W, D, Qty, Sty, P,
 *     #, RD — and that number is written here, where it cannot drift.
 *
 * ⚠️ fix-572 §C DOES NOT REVIVE THIS COST, which is the thing a reader will
 *    assume from the shape. fix-418 stacked eight fields ONE PER LINE inside
 *    the OVERVIEW card, where every pixel is charged to four sibling cards that
 *    did not ask for it (`alignItems: stretch`, fix-309 #55). §C's blocks are
 *    four fields per line, inside a MODAL that shares its height with nothing,
 *    and the Overview card still renders fix-507/508's transposed matrix. The
 *    two layouts have neither a surface nor a geometry in common.
 */
export const FIX_418_DATA_FIELDS = 8;

export function fix418BandHeight(typeCount: number): number {
  const block = 16 + FIX_418_DATA_FIELDS * (18 + 2) + 8 + 2;
  return typeCount * block + Math.max(0, typeCount - 1) * 6;
}
