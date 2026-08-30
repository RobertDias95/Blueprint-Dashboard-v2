import type { LibraryRow } from './libraryHelpers';
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
export const UNIT_SORTABLE_COLUMNS = [
  'address',
  'juris',
  'productTypes',
  'unitLabel',
  'width',
  'depth',
  'qty',
  'stories',
  'parking',
  'stalls',
  'roofDeck',
  'work',
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
    case 'productTypes':
      return byText((r) => r.project.productTypes.join(', '));
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
    case 'work':
      return out.sort((a, b) => {
        const av = a.unit.work_scope ?? null;
        const bv = b.unit.work_scope ?? null;
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
