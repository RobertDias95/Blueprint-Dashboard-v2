import { matchingUnitIndices } from './libraryHelpers';
import type { LibraryFilters, LibraryRow } from './libraryHelpers';
import type { UnitType } from './database.types';

// ===========================================================================
// ★★★ fix-447 §B3 (P-055) — THE UNIT VIEW IS ONE ROW PER UNIT
// ===========================================================================
//
// Bobby, 2026-08-26: *"Click UNIT and the same table reformats to address +
// unit information. The metric you are searching by decides the columns you
// get back."*
//
// ---------------------------------------------------------------------------
// ★★★ FLAT, WITH THE ADDRESS REPEATED — NOT A ROWSPAN. MEASURED FIRST.
// ---------------------------------------------------------------------------
//
// Prod, 2026-08-29: of 202 projects, **106 hold a `unit_types` array and 96
// hold NULL**; those 106 carry **235 unit rows in total, at most 6 on any one
// project** (avg 2.28 where present). So the UNIT view is a ~235-row table,
// not a thousand-row one: no virtualisation, no grouping machinery, and the
// address costs nothing to repeat.
//
// ★★★ AND THE ROWSPAN WOULD HAVE BEEN WRONG ANYWAY. A rowspan'd address cell
// assumes every unit of a project is CONTIGUOUS — which is exactly what
// "sorting by a unit column sorts units, not projects" destroys. Sort by Width
// and one project's three units land in three different places; a rowspan
// there renders a cell spanning rows that belong to somebody else. Repeating
// the address is the shape that survives every sort.
//
// ★★ NINETY-SIX PROJECTS HAVE NO UNITS AND SIMPLY ARE NOT HERE. That is the
// honest answer to "one row per unit" — but it means the row count drops by
// roughly half when you switch view, which is why §B5's count line says
// "N units across M projects" rather than a bare number. A count that changed
// from 202 to 103 with nothing explaining it would read as a broken filter.

export interface LibraryUnitRow {
  /** Stable per (project, unit index) — the index matters because two unit
   *  types on one project may share a label. */
  key: string;
  /** The project this unit belongs to; carries the address/juris/type/stage
   *  columns the UNIT view still shows. */
  project: LibraryRow;
  unit: UnitType;
  /** Position within the project's own list, so a stable sort keeps a
   *  project's units in their entered order when the sort key ties. */
  index: number;
}

/** Every unit of every row, in project order then entry order. A project with
 *  no units contributes nothing. */
export function flattenUnitRows(
  rows: readonly LibraryRow[],
): LibraryUnitRow[] {
  const out: LibraryUnitRow[] = [];
  for (const project of rows) {
    project.unitTypes.forEach((unit, index) => {
      out.push({ key: `${project.projectId}:${index}`, project, unit, index });
    });
  }
  return out;
}

// ===========================================================================
// ★★★ fix-469 §1 (P-121) — THE UNIT VIEW RETURNS ONLY MATCHING UNITS
// ===========================================================================
//
// Bobby, 2026-09-01, with a marked-up screenshot — yellow on the rows that
// matched, a red X on every row that did not: *"when you search by unit, say
// 16x36 and there is a unit that matches from a project — the results show all
// of the units from that project — not helpful — it is showing a lot of noise
// that doesnt apply."*
//
// MEASURED ON PROD 2026-09-01 for his exact search (unit 16×36, ±1 each):
//
//     every unit row in the library   241
//     printed for this search today    35
//     that actually match              10   across 9 projects
//
// ★★ 71% of the answer did not match the question.
//
// ---------------------------------------------------------------------------
// ★★★ NOTHING WAS BROKEN — THIS UNDOES A DELIBERATE DESIGN, AND THE SCREEN SAID SO
// ---------------------------------------------------------------------------
// The UNIT card's caption read *"one unit must match all of these"*, and that
// was honest: the UNIT panel was a PROJECT QUALIFIER, not a row filter. A
// project qualified when any one of its units matched, and then all of its units
// printed. The matched-row highlight (fix-205) was doing its job correctly on
// top of that.
//
// ★★ Bobby was not asking for the matches to be marked. He was asking for the
// non-matches not to be printed. He was offered a middle option — matches only,
// plus a `1 of 4 units` expander per row — and REJECTED it. There is no
// expander: to see the rest of a project's units you open the project, and the
// Library's own SITE view already answers that question, which is why the
// expander would have been a second door onto a room that has one.
//
// ★ SITE VIEW IS UNTOUCHED. A lot search still returns projects and all their
//   units — that is the plan-reuse reading, and it keeps its home.
//
// ---------------------------------------------------------------------------
// ★★★ THE PREDICATE IS NOT NEW, AND THAT IS THE POINT
// ---------------------------------------------------------------------------
// `matchingUnitIndices` already answers exactly this question, and its own
// docstring has always said so: *"Drives row filtering AND the 'highlight
// matching unit row' visual treatment."* It carries fix-402's per-unit
// conjunction (a project with unit A garage-no-deck and unit B surface-with-deck
// must NOT match "garage AND roof deck") and fix-412's work-scope extension. A
// second predicate here would be a second answer to one question, and the two
// would drift the first time a filter dimension was added.
//
// ★★ SO THIS IS A COMPOSITION OF TWO EXISTING FUNCTIONS, and `flattenUnitRows`
// above is left exactly as it was. It is a truthful primitive — "every unit of
// every row" — with its own fix-447 suite, and it is still the right answer to
// its own question. This one asks a different question.
//
// ★ WITH NO UNIT FILTER ACTIVE, `matchingUnitIndices` returns every index, so
//   this returns every row. No criteria, no filtering: the UNIT view without a
//   unit search still lists the whole library, which is what it should do.
export function matchingUnitRows(
  rows: readonly LibraryRow[],
  filters: LibraryFilters,
): LibraryUnitRow[] {
  const keep = new Map<string, Set<number>>();
  for (const r of rows) {
    keep.set(r.projectId, new Set(matchingUnitIndices(r, filters)));
  }
  return flattenUnitRows(rows).filter((u) =>
    keep.get(u.project.projectId)?.has(u.index) ?? false,
  );
}

/** How many distinct projects are represented — the "across M projects" half
 *  of the count line. */
export function unitRowProjectCount(rows: readonly LibraryUnitRow[]): number {
  const seen = new Set<string>();
  for (const r of rows) seen.add(r.project.projectId);
  return seen.size;
}

/**
 * ★★★ THE UNIT VIEW'S OWN SORT COLUMNS.
 *
 * Deliberately a SEPARATE union from `SORTABLE_COLUMNS`. The two views sort
 * different things — a site sort orders projects, a unit sort orders units —
 * and fix-406's lesson is that a stored column name outliving its union throws
 * during render. Keeping them apart means a site column can never be handed to
 * the unit sorter, and `isUnitSortable` guards the boundary the same way
 * `isSortableColumn` does for the other table.
 */
// ★★ fix-483 §A5 / §A2: `productTypes` and `work` left this union with their
//    columns — a sort on a column nobody can see is not a feature (fix-406's
//    rule, applied for the third time).
//
// ★★★ AND THE STORED-STRING TRAP DOES NOT APPLY HERE, which is worth saying
//     because fix-406 was bitten by it: the unit sort is NOT persisted
//     (`useState(DEFAULT_UNIT_SORT)` in LibraryMatrix — `surfaceFilterPrefs`
//     has never stored a sort), so no blob can hand a retired name back.
//     `isUnitSortable` guards the boundary anyway.
export const UNIT_SORTABLE_COLUMNS = [
  'address',
  'juris',
  'unitLabel',
  'width',
  'depth',
  // ★ fix-488 §B. Unlike the SITE sorter, this union's `switch` is
  //   exhaustive-return, so a member added here without an arm below is a
  //   COMPILE error rather than a render-time throw.
  'size',
  'qty',
  'stories',
  'parking',
  'stalls',
  'roofDeck',
  'stage',
] as const;

export type UnitSortableColumn = (typeof UNIT_SORTABLE_COLUMNS)[number];

export function isUnitSortable(v: unknown): v is UnitSortableColumn {
  return (
    typeof v === 'string' &&
    (UNIT_SORTABLE_COLUMNS as readonly string[]).includes(v)
  );
}

export interface UnitSortState {
  col: UnitSortableColumn;
  asc: boolean;
}

export const DEFAULT_UNIT_SORT: UnitSortState = { col: 'address', asc: true };

/** ★ Nulls last in BOTH directions, like `sortLibraryRows`' tri-state arm: "not
 *  recorded" is not a small number, and flipping the direction should not
 *  parade the blanks to the top. */
function cmpNullable(a: number | null, b: number | null, dir: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

function cmpBool(a: boolean | null, b: boolean | null, dir: number): number {
  const n = (v: boolean | null) => (v === null ? null : v ? 1 : 0);
  return cmpNullable(n(a), n(b), dir);
}

/**
 * Sort units. ★★ Every member of `UNIT_SORTABLE_COLUMNS` has an arm here and
 * the test asserts it — fix-410's rule, because a name in the list without an
 * arm falls through to a comparison the value cannot support.
 *
 * ★ An unrecognised stored column falls back to the default rather than
 * throwing (fix-406's rule, same reasoning).
 */
export function sortUnitRows(
  rows: readonly LibraryUnitRow[],
  state: UnitSortState,
): LibraryUnitRow[] {
  const col = isUnitSortable(state.col) ? state.col : DEFAULT_UNIT_SORT.col;
  const dir = state.asc ? 1 : -1;
  const out = [...rows];
  const byText = (f: (r: LibraryUnitRow) => string) =>
    out.sort((a, b) => f(a).localeCompare(f(b)) * dir || a.index - b.index);

  switch (col) {
    case 'address':
      return byText((r) => r.project.address);
    case 'juris':
      return byText((r) => r.project.juris);
    case 'unitLabel':
      return byText((r) => r.unit.label);
    case 'stage':
      return byText((r) => r.project.stage);
    case 'parking':
      // ★ Text, but nulls still last: an unrecorded kind sorts after every
      //   recorded one rather than under the empty string.
      return out.sort((a, b) => {
        // ★ `?? null` because the DB type marks these optional: an ABSENT key
        //   and a null are the same fact ("not recorded"), and only one of
        //   them survives a JSON round-trip.
        const av = a.unit.parking_kind ?? null;
        const bv = b.unit.parking_kind ?? null;
        if (av === null && bv === null) return a.index - b.index;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av.localeCompare(bv) * dir || a.index - b.index;
      });
    case 'width':
      return out.sort(
        (a, b) =>
          cmpNullable(a.unit.width_ft ?? null, b.unit.width_ft ?? null, dir) || a.index - b.index,
      );
    case 'depth':
      return out.sort(
        (a, b) =>
          cmpNullable(a.unit.depth_ft ?? null, b.unit.depth_ft ?? null, dir) || a.index - b.index,
      );
    case 'size':
      return out.sort(
        (a, b) =>
          cmpNullable(a.unit.size_sf ?? null, b.unit.size_sf ?? null, dir) || a.index - b.index,
      );
    case 'qty':
      return out.sort(
        (a, b) => cmpNullable(a.unit.qty ?? null, b.unit.qty ?? null, dir) || a.index - b.index,
      );
    case 'stories':
      return out.sort(
        (a, b) =>
          cmpNullable(a.unit.stories ?? null, b.unit.stories ?? null, dir) || a.index - b.index,
      );
    case 'stalls':
      return out.sort(
        (a, b) =>
          cmpNullable(a.unit.parking_stalls ?? null, b.unit.parking_stalls ?? null, dir) ||
          a.index - b.index,
      );
    case 'roofDeck':
      return out.sort(
        (a, b) =>
          cmpBool(a.unit.roof_deck ?? null, b.unit.roof_deck ?? null, dir) || a.index - b.index,
      );
  }
}
