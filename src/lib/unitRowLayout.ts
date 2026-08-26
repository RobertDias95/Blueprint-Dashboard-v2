// ===========================================================================
// ★★★ fix-412 SCOPE C — ONE COLUMN LIST, SHARED BY THE HEADER AND THE ROW
// ===========================================================================
//
// Bobby, 2026-08-26: *"the dead space between the Units label on the far left
// and the first field box is doing nothing. Use it. Put a 'Unit dimensions'
// heading above, and below it run the row shifted west … reclaiming that gutter
// so nothing is cramped and each header sits over its own control."*
//
// ---------------------------------------------------------------------------
// ★★★ WHY THE TWO REPORTED DEFECTS HAPPENED, AND WHY WIDENING WOULD NOT FIX IT
// ---------------------------------------------------------------------------
//
// The header strip and the unit row were TWO INDEPENDENT LISTS OF WIDTHS in two
// components, and they had already drifted apart in four places:
//
//   · Qty  — header declared 18px, the input rendered `w-7` (28px).
//   · Sty  — header declared 30px, the input rendered `w-7` (28px).
//   · Parking / Roof Deck — the header declared 62px and 52px; the SELECTS had
//     **no width at all** and auto-sized to their widest option. "Surface +
//     Garage" is far wider than 62px and "— / Yes / No" is far narrower than
//     52px, so Parking pushed everything right and Roof Deck sat under the
//     wrong header. That is precisely the pair Bobby reported: *"RD did not sit
//     over its own box, and Stalls drifted toward Parking."*
//   · The row also carried a trailing × remove button with no header column at
//     all, so every cumulative error landed on the last real column.
//
// ★★ Widening the columns would have moved the misalignment, not removed it.
// Two hand-maintained lists drift again the next time somebody adds a field —
// which is exactly what this ticket is doing.
//
// ★★★ SO THE FIX IS STRUCTURAL: this file declares the columns ONCE, and the
// header and every row render as CSS-grid children of the same
// `grid-template-columns`. A header then cannot sit over the wrong control,
// because the header cell and the control are literally in the same grid
// column. The alignment stops being a number somebody has to keep in step and
// becomes a property of the layout.
//
// ★ It lives in lib/ rather than beside the components for two reasons: the
// react-refresh rule forbids a component module exporting a non-component, and
// a test can assert the rendered geometry against the same source the component
// renders from.

export interface UnitRowColumn {
  /** Matches the unit_types key it edits, where there is one. */
  key: string;
  /** The header text. Empty for the trailing control column. */
  header: string;
  /** Fixed px width. */
  width: number;
}

/**
 * ★★★ THE COLUMN ORDER IS BOBBY'S, WITH ONE INSERTION.
 *
 * He asked for: *"Label · W · D · Qty · Sty · Parking · Stalls · Roof Deck"*.
 * All eight are here, in that exact relative order. `work` is inserted after
 * `label`, and the reason is Scope B5:
 *
 *   · IT QUALIFIES THE LABEL. "Remodel" is the answer to *what is this unit*;
 *     "was work performed" is the immediate follow-up, and the two read as one
 *     thought when they are adjacent.
 *   · IT GATES EVERYTHING TO ITS RIGHT. On a confirmed No-work unit the
 *     dimension, parking and roof-deck inputs are suppressed. The control that
 *     causes that must sit to the LEFT of what it greys out, or the row reads
 *     right-to-left: you would see five dead boxes and have to travel to the
 *     far end to find out why.
 *
 * ★ Putting it last was the alternative and it fails the second point.
 */
export const UNIT_ROW_COLUMNS: readonly UnitRowColumn[] = [
  { key: 'label', header: 'Label', width: 84 },
  { key: 'work_scope', header: 'Work', width: 74 },
  { key: 'width_ft', header: 'W', width: 46 },
  { key: 'depth_ft', header: 'D', width: 46 },
  { key: 'qty', header: 'Qty', width: 38 },
  { key: 'stories', header: 'Sty', width: 38 },
  { key: 'parking_kind', header: 'Parking', width: 104 },
  { key: 'parking_stalls', header: 'Stalls', width: 58 },
  // ★★★ fix-412 C5 — "Roof Deck" IN FULL, WHICH REVERSES fix-411 §3 ON PURPOSE.
  //
  // fix-411 abbreviated this header to "RD" and said why, in as many words:
  // *"'RD' rather than the full words because this header is a 52px fixed-width
  // cell"*. That constraint is gone — reclaiming the gutter (Scope C2) bought
  // the row ~42px, and this column is 78px now, which fits "Roof Deck" at 8px
  // with room to spare. The abbreviation existed only to survive a width that
  // no longer applies.
  //
  // ★ This is a deliberate reversal, not a regression: fix-411's REASONING was
  // right and its constraint expired. Every other roof-deck surface already
  // spelled it in full and is untouched, so the app now says "Roof Deck"
  // everywhere — which is what fix-411 §3 was trying to achieve when it removed
  // the ambiguous bare "Deck".
  { key: 'roof_deck', header: 'Roof Deck', width: 78 },
  // ★ The remove button gets its OWN column. It had none before, so its width
  //   came out of whatever sat last — one of the two reported defects.
  { key: 'remove', header: '', width: 18 },
];

/** The `grid-template-columns` both the header and every row render with. */
export const UNIT_ROW_GRID: string = UNIT_ROW_COLUMNS.map(
  (c) => `${c.width}px`,
).join(' ');

/** The gap between columns, in px. Declared here so the header and the row
 *  cannot disagree about it either. */
export const UNIT_ROW_GAP = 4;

/** ★ The columns Scope B5 suppresses on a confirmed No-work unit — everything
 *  that describes drawn detail. `label`, `work_scope` and `remove` stay live:
 *  you must be able to see what the unit is, change your mind about the answer,
 *  and delete the row. */
export const UNIT_ROW_SUPPRESSED_ON_NO_WORK: readonly string[] = [
  'width_ft',
  'depth_ft',
  'qty',
  'stories',
  'parking_kind',
  'parking_stalls',
  'roof_deck',
];
