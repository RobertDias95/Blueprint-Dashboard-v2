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
import {
  parkingLabel,
  roofDeckLabel,
  storiesLabel,
} from './unitVocabulary';

// ★★★ fix-562 §A — `lib/unitParking` IS GONE, AND ITS JOB MOVED WHOLE.
//
// It held fix-402's four-kind vocabulary, the stall coercion, the letter codes
// and two project-level rollups. Bobby replaced the vocabulary
// (`1-car garage` … `Surface / None`), removed stalls from the product, and the
// two rollups (`parkingRollup` / `roofDeckRollup`) had had **no caller in
// `src/` since fix-447 §B removed the Library's rollup chips** — they were
// scenery with a test suite. `NOT_RECORDED` and the three vocabularies now live
// in `lib/unitVocabulary`, which is the one place a reader looks for any of it.
//
// ★ Named here rather than deleted silently: the next reader of a fix-402
//   comment needs somewhere to land (the fix-326 pattern).
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
 * ★★★ THE FILTERED RUN IS STILL fix-514 §H's (P-196) — *"the table reads in
 *     the order the filter reads"*, and the UNIT filter box asks Width, Depth,
 *     Size, Parking, Roof Deck, Stories in that order. (It asked `Stalls`
 *     between Parking and Roof Deck until fix-562 §A removed the field, and
 *     `Qty` sat after Stories until fix-562 §H removed the column.)
 *
 * ★★★ fix-571 §C MOVED `Type` FROM THE FRONT TO THE BACK. Bobby: *"type should
 *     be inbetween stories and jurisdiction."* It has no filter of its own, so
 *     §H's rule never placed it — fix-514 put it first on the reasoning that a
 *     type IDENTIFIES the row the way Address does, and Bobby has ruled the
 *     other way: the left of the row is address then DIMENSIONS (fix-553 §C),
 *     and a label is not a dimension.
 *
 * ★★ SUPERSEDED, NOT MISTAKEN (fix-400's rule) — fix-514's reasoning is quoted
 *    above rather than deleted, because the next person to wonder why a label
 *    sits among the parcel facts deserves to find the argument it replaced.
 *
 * ★★ And this list is still the ONLY place the order is written down: the
 *    `<thead>` and the row's `<td>`s both render from it, so a move like this
 *    one changes both or neither (fix-519 §A).
 */
export const LIBRARY_UNIT_COLUMNS: readonly LibraryUnitColumn[] = [
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
    // ★★★ fix-562 §A — THE COMPOSED LABEL, NOT A LETTER CODE. fix-422's `G` /
    //     `S` / `B` existed because the Project Overview matrix cell was 26px;
    //     this table's cell is not, and the whole point of the new vocabulary
    //     is that `2-car garage` says the thing a one-letter code could not.
    //     `parkingLabel` is what the Overview prints too, so the two surfaces
    //     still say the same words.
    read: (u) => ({ text: parkingLabel(u.parking_kind ?? null, u.parking_count ?? null) }),
  },
  // ★★★ fix-562 §A — `STALLS / UNIT` IS GONE FROM THIS LIST, AND FROM THE
  //     PRODUCT. Bobby folded the count into the parking answer, so the column,
  //     its filter, its sort arm, its editor input and `UnitType.parking_stalls`
  //     all left together. 123 rows of it are in `_fix562_unit_matrix_snapshot`.
  //     A column removed from here removes its `<th>` too — that is what this
  //     list is for (fix-519 §A).
  {
    col: 'roofDeck',
    label: 'Roof Deck',
    align: 'center',
    sourceKey: 'roof_deck',
    testId: 'roofdeck',
    // ★★★ fix-562 §A — `W/ PH` · `W/O PH` · `None`, replacing fix-402's Y/N.
    //     Still three states plus the dash: `null` is NOT RECORDED and is a
    //     different fact from a recorded `None`. This is the cell that was
    //     printing `G` (fix-519 §A).
    read: (u) => ({ text: roofDeckLabel(u.roof_deck ?? null, u.penthouse ?? null) }),
  },
  {
    col: 'stories',
    label: 'Stories',
    align: 'center',
    sourceKey: 'stories',
    testId: 'stories',
    // ★★★ fix-562 §A — `3` or `3+B`. The TEXT composes the basement modifier;
    //     the SORT (lib/libraryUnitRows) still reads the NUMBER, which is the
    //     whole reason the parts are stored separately rather than the label.
    read: (u) => ({ text: storiesLabel(u.stories ?? null, u.basement ?? null) }),
  },
  // ★★★ fix-571 §C (P-276) — `Type` IS LAST IN THE UNIT BLOCK NOW.
  //
  // Bobby, 2026-09-15: *"in the library, when on unit, type should be inbetween
  // stories and jurisdiction in the table card below."*
  //
  // ★★★ THIS IS fix-553 §C's PRINCIPLE ONE COLUMN FURTHER, not a new
  //     preference. That ticket moved `Juris` right because *the left of the
  //     row should read address, then the dimensional data*. `Type` is a LABEL,
  //     not a dimension — it names the thing the numbers describe — so it
  //     belongs with the parcel facts that follow them rather than in front of
  //     Width.
  //
  // ★★ AND IT MOVES BY ITSELF, WHICH IS THE WHOLE POINT OF THIS FILE. The
  //    `<thead>` and `LibraryUnitRow`'s `<td>`s both render from this list
  //    (fix-519 §A), so changing its position here changes both or neither.
  //    Under the two hand-written lists this replaced, a move like this one is
  //    exactly what produced P-230 — every value after the moved column
  //    printing under somebody else's heading.
  //
  // ★ IT STILL SORTS. `unitLabel` keeps its `col` key, so `UNIT_SORTABLE_COLUMNS`
  //   and `sortUnitRows`' name-bound arm are untouched — a sort that broke on a
  //   column MOVE would be the position-bound reader fix-519 §A removed.
  {
    col: 'unitLabel',
    label: 'Type',
    align: 'left',
    sourceKey: null,
    testId: 'label',
    read: null,
  },
  // ★★★ fix-562 §H (P-274) — `QTY` COMES OFF BOTH LIBRARY VIEWS. Bobby,
  //     2026-09-14: *"we'll take off quantity on the library for unit and site,
  //     and then he could just put the quantity in at the project overview
  //     screen in the project details."* This supersedes fix-553 §E, which said
  //     the unit view only.
  //
  // ★★★ THE FIELD IS NOT DELETED — this is the P-236 shape: drop the INPUT,
  //     keep the COLUMN. `unit_types[].qty` is live data (2–4 on 102 of 267
  //     units, measured 2026-09-15) and it is still read by the Project
  //     Overview matrix, the unit-count rollup and the Project Details editor.
  //
  // ★★★ AND THE DESTINATION WAS VERIFIED FIRST, which is fix-524 §0.3's lesson:
  //     `pd-unit-qty` in Project Details → Units already writes this field, and
  //     `psm-units` beside it writes `projects.units`. Removing the only place
  //     a field can be typed is how 102 units become uneditable.
] as const;

/** The headings, in order — for the empty state's `colSpan` and for any test
 *  that wants to state the order in one line. */
export const LIBRARY_UNIT_COLUMN_LABELS: readonly string[] =
  LIBRARY_UNIT_COLUMNS.map((c) => c.label);
