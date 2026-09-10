// ===========================================================================
// ★★★ fix-519 §C (P-228) — JURISDICTION BEFORE ZONE, IN BOTH PLACES
// ===========================================================================
//
// The SITE filter box asked `Zone · Jurisdiction`; the SITE table read
// `… Juris · Zone`. Two screens ordering the same two fields two ways.
//
// ★★★ THE TABLE WAS RIGHT AND THE FILTER WAS NOT, which is the opposite of
//     what fix-514 §H's own rule would suggest. P-196 ruled *"the table reads
//     in the order the filter reads"*, and §H applied it everywhere EXCEPT
//     here, where it recorded the exception in a comment instead:
//
//       *"ONE DEVIATION, NAMED: Bobby's list reads jurisdiction before zone;
//         the filter box asks Zone first. His list wins."*
//
//     A named deviation is still a deviation, and a comment is not a rule.
//
// ★★★ RULED (fix-519 §C): JURISDICTION FIRST IN BOTH — it is the coarser fact,
//     and the data says so. **0 of 219 active projects are missing a
//     jurisdiction; 3 are missing a zone.** You narrow from the field everybody
//     has to the field some do. **So the FILTER moves, not the table.**
//
// ★★ AND THE ORDER IS DECLARED HERE SO IT CANNOT DRIFT AGAIN. The filter box
//    renders its three controls from this list and the table renders its three
//    headers from it. One list, two readers — the same shape fix-519 §A gave
//    the unit columns, for the same reason.
//
// ★ ONLY THE SHARED RUN LIVES HERE. `Address`, `Lot W/D/SF`, `Corner`, `Type`,
//   `Units` and `Stage` are not in it: some have no filter at all and the ones
//   that do are not adjacent to these three on both surfaces. A list that
//   claimed to order the whole table would be a list the filter box could not
//   honour, which is how the last one stopped being true.
// ===========================================================================

import type { SortableColumn } from './libraryHelpers';

export interface LibrarySharedField {
  /** The sort key the table's header carries, and this list's identity. */
  key: Extract<SortableColumn, 'juris' | 'zone' | 'alley'>;
  /** The filter box's label — the long form, because a filter is read as a
   *  question and `Juris?` is not one. */
  filterLabel: string;
  /** The table's heading — the short form, because a column is read against
   *  ten others and every character is width. */
  columnLabel: string;
  align: 'left' | 'center';
}

/**
 * The three SITE fields whose order the filter box and the table share, in the
 * order they are read in BOTH.
 *
 * ★ `alley` was already third in both; it is in the list so the run is
 *   contiguous on both surfaces rather than "the two we argued about plus
 *   whatever happens to follow".
 */
export const LIBRARY_SITE_SHARED_FIELDS: readonly LibrarySharedField[] = [
  {
    key: 'juris',
    filterLabel: 'Jurisdiction',
    columnLabel: 'Juris',
    align: 'left',
  },
  {
    key: 'zone',
    filterLabel: 'Zone',
    columnLabel: 'Zone',
    align: 'center',
  },
  {
    key: 'alley',
    filterLabel: 'Alley',
    columnLabel: 'Alley',
    align: 'center',
  },
] as const;
