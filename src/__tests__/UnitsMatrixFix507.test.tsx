import { describe, it, expect } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { UnitsMatrix } from '../components/ProjectDetail/ProjectOverviewBoxes';
import {
  UNIT_MATRIX_CORNER_PCT,
  UNIT_MATRIX_TYPE_STEPS,
} from '../lib/projectCardLayout';
import type { UnitType } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-507 §E (P-175) — THE UNITS MATRIX FILLS ITS BOX AND NAMES ITS COLUMNS
// ===========================================================================
//
// Two defects, one table, and the second is the one that made the screen
// unreadable:
//
//   1. fix-506 shipped the transpose as a CSS grid of FIXED 45px type columns,
//      so a two-unit project drew a 152px strip inside a 400px card and left
//      the rest of the box empty. Bobby: *"if you had two, it would fill out
//      the space. If you had six, it would kind of shrink and condense to the
//      space."*
//
//   2. It headed each column with the type NAME. **59 prod projects have units
//      that are all `Detached`**, so the header row read `Detach…Detach…` — the
//      same word, n times, ellipsised. A header that identifies nothing is
//      worse than no header, and it is the exact bug in Bobby's screenshot.
//
// ★★★ `Type` IS AN ATTRIBUTE ROW NOW, WHICH IS THE ENTIRE POINT OF THE
//     TRANSPOSE: the columns are the units (`Unit 1 … Unit n`, an ordinal a
//     reader can point at) and every fact about a unit is a row, type included.
//
// ★ THE COMPONENT IS RENDERED DIRECTLY. It takes `unitTypes` and nothing else —
//   no hooks, no supabase — so this suite mounts the real thing rather than the
//   whole header, and a failure here names the matrix and not a fixture.

function unit(over: Partial<UnitType> = {}): UnitType {
  return {
    label: 'Detached',
    width_ft: 20,
    depth_ft: 27,
    size_sf: 1620,
    qty: 1,
    stories: 3,
    parking_kind: 'garage',
    parking_stalls: 1,
    roof_deck: false,
    ...over,
  } as UnitType;
}

/** `403 W Dravus St` — six types, every one of them `Detached`. */
const SIX = Array.from({ length: 6 }, () => unit());
/** `233 31st Ave E` — two types, both `Detached`. */
const TWO = [unit({ width_ft: 30, depth_ft: 31.5 }), unit({ width_ft: 34, depth_ft: 30 })];

function renderMatrix(types: readonly UnitType[]) {
  return render(<UnitsMatrix unitTypes={types} />);
}

describe('fix-507 §E: the columns are ordinals and Type is a row', () => {
  it('★★★ the headers read `Unit 1 … Unit n`, never the type name', () => {
    renderMatrix(SIX);
    const table = screen.getByTestId('pd-units-matrix-grid');
    const headers = Array.from(within(table).getAllByRole('columnheader'))
      .filter((h) => h.getAttribute('data-testid')?.startsWith('pd-units-col-'))
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Unit 1', 'Unit 2', 'Unit 3', 'Unit 4', 'Unit 5', 'Unit 6',
    ]);
    // ★★★ THE ASSERTION THAT WOULD HAVE FAILED BEFORE, and it is stated as an
    //     absence on purpose: the defect was the type NAME in the header, so
    //     "the headers are ordinals" is only half of it — the other half is
    //     that the name is not up there at all.
    for (const h of headers) expect(h).not.toContain('Detached');
  });

  it('★★★ …and `Type` is the FIRST attribute row, like every other attribute', () => {
    renderMatrix(SIX);
    const table = screen.getByTestId('pd-units-matrix-grid');
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    // ★ The order is Bobby's: Type · Width · Depth · Size (sf) · Qty · Stories ·
    //   Parking · Stalls · Roof deck.
    expect(
      rows.map((r) => r.querySelector('th')?.textContent),
    ).toEqual([
      'Type', 'Width', 'Depth', 'Size (sf)', 'Qty', 'Stories', 'Parking',
      'Stalls', 'Roof deck',
    ]);
    // ★★ PARENTAGE, NOT PRESENCE (fix-422's rule): the type has to be a CELL of
    //    the first body row, not merely somewhere in the table.
    const first = rows[0];
    expect(
      within(first as HTMLElement).getByTestId('pd-units-cell-type-0'),
    ).toHaveTextContent('Detached');
    expect(first.children).toHaveLength(SIX.length + 1);
  });

  it('★★★ the table FILLS its box — `width:100%`, fixed layout, 19% corner', () => {
    renderMatrix(TWO);
    const table = screen.getByTestId('pd-units-matrix-grid');
    // ★ `table-layout: fixed` is what makes n columns divide the width they are
    //   GIVEN instead of the width they ask for. Without it a two-unit table is
    //   as narrow as its content and the box stays empty — which is P-175.
    expect(table.style.width).toBe('100%');
    expect(table.style.tableLayout).toBe('fixed');
    expect(
      screen.getByTestId('pd-units-corner').style.width,
    ).toBe(`${UNIT_MATRIX_CORNER_PCT}%`);
  });
});

describe('fix-507 §E: `big` at four units and fewer', () => {
  it('★★★ two units render at the larger step, six at the smaller', () => {
    renderMatrix(TWO);
    expect(
      screen.getByTestId('pd-units-matrix-grid').dataset.big,
    ).toBe('true');
    const bigCell = screen.getByTestId('pd-units-cell-width-0');
    expect(bigCell.style.fontSize).toBe(`${UNIT_MATRIX_TYPE_STEPS.big.cell}px`);
    cleanup();

    renderMatrix(SIX);
    expect(
      screen.getByTestId('pd-units-matrix-grid').dataset.big,
    ).toBe('false');
    const smallCell = screen.getByTestId('pd-units-cell-width-0');
    expect(smallCell.style.fontSize).toBe(
      `${UNIT_MATRIX_TYPE_STEPS.normal.cell}px`,
    );
    // ★ The two steps are genuinely different, so a future edit that collapses
    //   them cannot pass this by making both the same.
    expect(UNIT_MATRIX_TYPE_STEPS.big.cell).toBeGreaterThan(
      UNIT_MATRIX_TYPE_STEPS.normal.cell,
    );
    expect(UNIT_MATRIX_TYPE_STEPS.big.padY).toBeGreaterThan(
      UNIT_MATRIX_TYPE_STEPS.normal.padY,
    );
  });

  it('★★ the boundary is 4/5, asserted on the rendered table', () => {
    renderMatrix(Array.from({ length: 4 }, () => unit()));
    expect(screen.getByTestId('pd-units-matrix-grid').dataset.big).toBe('true');
    cleanup();
    renderMatrix(Array.from({ length: 5 }, () => unit()));
    expect(screen.getByTestId('pd-units-matrix-grid').dataset.big).toBe('false');
  });

  it('★ an empty project still renders its own state, not an empty table', () => {
    renderMatrix([]);
    expect(screen.getByTestId('pd-units-matrix-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pd-units-matrix-grid')).toBeNull();
  });
});
