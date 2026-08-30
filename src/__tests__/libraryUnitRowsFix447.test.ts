import { describe, it, expect } from 'vitest';
import {
  DEFAULT_UNIT_SORT,
  UNIT_SORTABLE_COLUMNS,
  flattenUnitRows,
  isUnitSortable,
  sortUnitRows,
  unitRowProjectCount,
  type UnitSortableColumn,
} from '../lib/libraryUnitRows';
import type { LibraryRow } from '../lib/libraryHelpers';
import type { UnitType } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-447 §B3 — ONE ROW PER UNIT
// ===========================================================================

function unit(over: Partial<UnitType> = {}): UnitType {
  return {
    label: 'Cottage',
    width_ft: 25,
    depth_ft: 40,
    qty: 1,
    stories: 2,
    parking_kind: null,
    parking_stalls: null,
    roof_deck: null,
    work_scope: null,
    ...over,
  } as UnitType;
}

function row(over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    projectId: 'p1',
    address: '100 Apple Way',
    juris: 'Seattle',
    productTypes: ['SFR'],
    units: 3,
    zone: 'NR',
    lotWidth: 40,
    lotDepth: 100,
    alley: 'Yes',
    tags: [],
    stage: 'de',
    unitTypes: [unit()],
    numLots: null,
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as LibraryRow;
}

describe('fix-447: flattenUnitRows', () => {
  it('★★★ a project with three units appears three times', () => {
    const rows = [
      row({
        projectId: 'a',
        unitTypes: [unit({ label: 'A' }), unit({ label: 'B' }), unit({ label: 'C' })],
      }),
    ];
    const flat = flattenUnitRows(rows);
    expect(flat).toHaveLength(3);
    expect(flat.map((f) => f.unit.label)).toEqual(['A', 'B', 'C']);
    // ★ The address repeats — see the module header for why not a rowspan.
    expect(new Set(flat.map((f) => f.project.address)).size).toBe(1);
  });

  it('★★★ a project with NO units contributes nothing', () => {
    // Measured on prod: 96 of 202 projects hold no unit_types at all, so this
    // is the dominant case, not an edge one.
    const flat = flattenUnitRows([row({ projectId: 'x', unitTypes: [] })]);
    expect(flat).toEqual([]);
  });

  it('★★ the key is stable per (project, index), so duplicate labels survive', () => {
    const flat = flattenUnitRows([
      row({ projectId: 'a', unitTypes: [unit({ label: 'Same' }), unit({ label: 'Same' })] }),
    ]);
    expect(flat.map((f) => f.key)).toEqual(['a:0', 'a:1']);
  });

  it('★★ unitRowProjectCount counts PROJECTS, not rows', () => {
    const flat = flattenUnitRows([
      row({ projectId: 'a', unitTypes: [unit(), unit(), unit()] }),
      row({ projectId: 'b', unitTypes: [unit()] }),
      row({ projectId: 'c', unitTypes: [] }),
    ]);
    expect(flat).toHaveLength(4);
    expect(unitRowProjectCount(flat)).toBe(2);
  });
});

describe('fix-447: sortUnitRows', () => {
  const rows = [
    row({
      projectId: 'a',
      address: '200 Birch',
      unitTypes: [
        unit({ label: 'Wide', width_ft: 40 }),
        unit({ label: 'Narrow', width_ft: 20 }),
      ],
    }),
    row({
      projectId: 'b',
      address: '100 Apple',
      unitTypes: [unit({ label: 'Mid', width_ft: 30 })],
    }),
  ];

  it('★★★ sorting by a UNIT column orders UNITS, not projects', () => {
    // ★★★ THE POINT OF THE WHOLE MODULE. Project a's two units land either
    //     side of project b's — which is exactly why the address cannot be a
    //     rowspan.
    const flat = flattenUnitRows(rows);
    const sorted = sortUnitRows(flat, { col: 'width', asc: true });
    expect(sorted.map((r) => r.unit.label)).toEqual(['Narrow', 'Mid', 'Wide']);
    expect(sorted.map((r) => r.project.projectId)).toEqual(['a', 'b', 'a']);
  });

  it('★★ address sorts by the project, and units keep their entered order', () => {
    const sorted = sortUnitRows(flattenUnitRows(rows), { col: 'address', asc: true });
    expect(sorted.map((r) => r.project.address)).toEqual([
      '100 Apple',
      '200 Birch',
      '200 Birch',
    ]);
    // ★ The tie-break is the unit's own index, so a project's units never
    //   shuffle among themselves for a key they all share.
    expect(sorted.slice(1).map((r) => r.index)).toEqual([0, 1]);
  });

  it('★★★ nulls sort LAST in BOTH directions', () => {
    const flat = flattenUnitRows([
      row({
        projectId: 'a',
        unitTypes: [
          unit({ label: 'has', stories: 3 }),
          unit({ label: 'none', stories: null }),
          unit({ label: 'low', stories: 1 }),
        ],
      }),
    ]);
    // "Not recorded" is not a small number, and flipping the direction must
    // not parade the blanks to the top.
    expect(
      sortUnitRows(flat, { col: 'stories', asc: true }).map((r) => r.unit.label),
    ).toEqual(['low', 'has', 'none']);
    expect(
      sortUnitRows(flat, { col: 'stories', asc: false }).map((r) => r.unit.label),
    ).toEqual(['has', 'low', 'none']);
  });

  it('★★★ EVERY sortable column has an arm — fix-410’s rule', () => {
    // A name listed without an arm falls through to a comparison the value
    // cannot support, which is a render-time throw (fix-406).
    const flat = flattenUnitRows(rows);
    for (const col of UNIT_SORTABLE_COLUMNS) {
      expect(() => sortUnitRows(flat, { col, asc: true }), col).not.toThrow();
      expect(sortUnitRows(flat, { col, asc: true }), col).toHaveLength(
        flat.length,
      );
    }
  });

  it('★★ an unrecognised stored column falls back rather than throwing', () => {
    const flat = flattenUnitRows(rows);
    const sorted = sortUnitRows(flat, {
      col: 'numLots' as unknown as UnitSortableColumn,
      asc: true,
    });
    expect(sorted).toHaveLength(flat.length);
    // Falls back to the default (address).
    expect(sorted[0]!.project.address).toBe('100 Apple');
  });

  it('★ isUnitSortable guards the boundary against SITE column names', () => {
    expect(isUnitSortable('width')).toBe(true);
    // `lotWidth` is a SITE column; handing it to this sorter is the mix-up the
    // separate unions exist to prevent.
    expect(isUnitSortable('lotWidth')).toBe(false);
    expect(isUnitSortable(null)).toBe(false);
    expect(DEFAULT_UNIT_SORT.col).toBe('address');
  });
});
