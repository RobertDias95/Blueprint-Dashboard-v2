// ===========================================================================
// ★★★ fix-519 §A (P-230) — THE UNIT TABLE'S COLUMNS, DECLARED ONCE
// ===========================================================================
//
// Bobby, 2026-09-10: *"when we click unit, the columns are not reflecting the
// right data? Roofdeck is reflecting parking? Etc?"*
//
// ★★★ WHAT WAS WRONG. `LibraryMatrix`'s `<thead>` listed the unit columns in
//     one order and `LibraryUnitRow`, 500 lines below it, printed its `<td>`s
//     in ANOTHER — two hand-written lists that had drifted apart. fix-514 §H
//     (P-196) reordered the HEADER to match the filter box
//     (*width · depth · size · parking · stalls · roof deck · stories · qty*)
//     and left the row on fix-402's older order
//     (*width · depth · size · qty · stories · parking · stalls · roof deck*).
//     Nothing lined the two up, so from that ticket onward every value after
//     `Size (sf)` printed under somebody else's heading:
//
//       heading      printed          `10150 NE 64th St`, unit 1
//       ---------    -------------    -------------------------
//       PARKING      qty              1        (should be `garage`)
//       STALLS       stories          3        (should be `2`)
//       ROOF DECK    parking_kind     G        (should be `N`)
//       STORIES      parking_stalls   2        (should be `3`)
//       QTY          roof_deck        N        (should be `1`)
//
//     ★★★ `roof_deck` is `false` on all three of that project's units and the
//         column printed `G`. A boolean column cannot print a parking code by
//         accident; that is what makes it conclusive rather than suggestive.
//
// ★★★ AND THE TABLE WAS DISAGREEING WITH ITSELF. `sortUnitRows` has always
//     been bound BY NAME — sorting on `roofDeck` sorts `roof_deck` — so
//     clicking `Roof Deck` reordered the rows by a value that column was not
//     showing. One name-bound reader and one position-bound reader over the
//     same data is the whole defect in a sentence.
//
// ⚠️ THE BLAST RADIUS WAS THE BACKFILL. P-225 has Cam and others using this
//    table to decide which unit fields are missing. A parking code sitting
//    under ROOF DECK is not a cosmetic error — it is a wrong answer that gets
//    typed into the database as a correction.
//
// ★★★ THE FIX IS THIS FILE, NOT A REORDERING. Reordering the row's cells would
//     have fixed the instance and left the cause: two lists that can drift
//     again the next time a column is inserted. **The header and the cells now
//     render from THIS list**, so a column and its value cannot be separated —
//     inserting one changes both, or neither.
//
// ★ Every column NAMES the `unit_types` key it reads (`sourceKey`), and the
//   test asserts the printed value against that key rather than against a
//   position. A positional assertion would have passed happily through the
//   whole of the broken period.
//
// ★ IN `lib`, NOT IN THE COMPONENT FILE. `react-refresh/only-export-components`
//   is an ERROR in this repo — a component file may export components and
//   types and nothing else. Same rule that moved `projectDataTabs`.
// ===========================================================================

import type { UnitType } from './database.types';
import { NOT_RECORDED, parkingKindCode } from './unitParking';
import type { UnitSortableColumn } from './libraryUnitRows';

/** What a cell prints. `text` wins over `value`; `value` gets fix-386's
 *  null-is-not-recorded / zero-is-zero treatment in `UnitCell`. */
export interface UnitCellContent {
  value?: number | null;
  text?: string;
}

export interface LibraryUnitColumn {
  /** The sort key the header carries. Also the React key and the testid stem,
   *  so a column cannot be renamed in one place and not the other. */
  col: UnitSortableColumn;
  /** The heading. */
  label: string;
  align: 'left' | 'center';
  /**
   * ★★★ THE KEY THIS COLUMN READS, DECLARED. This is the field the whole
   *     ticket turns on: it lets a test say *"the ROOF DECK column reads
   *     `roof_deck`"* instead of *"the ninth cell holds whatever the ninth cell
   *     holds"*. `null` on `unitLabel`, whose text is RESOLVED against the
   *     project's product types (fix-209/212) rather than read straight off the
   *     unit.
   */
  sourceKey: keyof UnitType | null;
  /** The testid suffix, e.g. `library-unit-<pid>-<i>-roofdeck`. Kept as its own
   *  field because three of them predate the sort names (`roofdeck`, not
   *  `roofDeck`) and fix-205's testids are load-bearing in four suites. */
  testId: string;
  /** What the cell prints. `null` on `unitLabel` — that cell carries the
   *  off-list `⚠` mark and is rendered by the component. */
  read: ((u: UnitType) => UnitCellContent) | null;
}

/**
 * ★★★ THE ORDER IS fix-514 §H's (P-196), UNCHANGED — *"the table reads in the
 *     order the filter reads"*, and the UNIT filter box asks Width, Depth,
 *     Size, Parking, Stalls, Roof Deck, Stories in that order.
 *
 * ★ `Unit type` and `Qty` have no filter, so they sit either side of the
 *   filtered run: the type IDENTIFIES the row (like Address above it) and Qty
 *   is a count of it. That was fix-514 §H's reasoning and it survives.
 *
 * ★★ So this list is not a new ruling. It is the ruling that already shipped
 *    in the header, finally being the only place the order is written down.
 */
export const LIBRARY_UNIT_COLUMNS: readonly LibraryUnitColumn[] = [
  {
    col: 'unitLabel',
    label: 'Type',
    align: 'left',
    sourceKey: null,
    testId: 'label',
    read: null,
  },
  {
    col: 'width',
    label: 'Width',
    align: 'center',
    sourceKey: 'width_ft',
    testId: 'width',
    read: (u) => ({ value: u.width_ft ?? null }),
  },
  {
    col: 'depth',
    label: 'Depth',
    align: 'center',
    sourceKey: 'depth_ft',
    testId: 'depth',
    read: (u) => ({ value: u.depth_ft ?? null }),
  },
  {
    // ★ fix-488 §B — the column the size filter returns you to. A filter you
    //   cannot read the result of is half a feature. fix-514 §E made the value
    //   TYPEABLE in Project Details, so this stops being a filter over a field
    //   nobody could fill.
    col: 'size',
    label: 'Size (sf)',
    align: 'center',
    sourceKey: 'size_sf',
    testId: 'size',
    read: (u) => ({ value: u.size_sf ?? null }),
  },
  {
    col: 'parking',
    label: 'Parking',
    align: 'center',
    sourceKey: 'parking_kind',
    testId: 'parking',
    // ★ A CODE, not the raw word: `parkingKindCode` is what the Overview's
    //   matrix prints too, so the two surfaces say the same letter.
    read: (u) => ({ text: parkingKindCode(u.parking_kind ?? null) }),
  },
  {
    col: 'stalls',
    label: 'Stalls',
    align: 'center',
    sourceKey: 'parking_stalls',
    testId: 'stalls',
    read: (u) => ({ value: u.parking_stalls ?? null }),
  },
  {
    col: 'roofDeck',
    label: 'Roof Deck',
    align: 'center',
    sourceKey: 'roof_deck',
    testId: 'roofdeck',
    // ★ Three states, not two: `null` is NOT RECORDED and is a different fact
    //   from `false`. This is the cell that was printing `G`.
    read: (u) => ({
      text: u.roof_deck == null ? NOT_RECORDED : u.roof_deck ? 'Y' : 'N',
    }),
  },
  {
    col: 'stories',
    label: 'Stories',
    align: 'center',
    sourceKey: 'stories',
    testId: 'stories',
    read: (u) => ({ value: u.stories ?? null }),
  },
  {
    col: 'qty',
    label: 'Qty',
    align: 'center',
    sourceKey: 'qty',
    testId: 'qty',
    read: (u) => ({ value: u.qty ?? null }),
  },
] as const;

/** The headings, in order — for the empty state's `colSpan` and for any test
 *  that wants to state the order in one line. */
export const LIBRARY_UNIT_COLUMN_LABELS: readonly string[] =
  LIBRARY_UNIT_COLUMNS.map((c) => c.label);
