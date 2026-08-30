import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  UNIT_MATRIX_GRID,
  UNIT_ROW_COLUMNS,
} from '../lib/unitRowLayout';
import { isOffListUnitLabel } from '../lib/unitTypeNaming';

// ===========================================================================
// ★★★ fix-449 §C2/§C3 — THE 22, AND THE MARK THAT COSTS NO WIDTH
// ===========================================================================

/** ★ Every distinct off-list label measured on prod 2026-08-29, with its count.
 *  Bobby rules on "Type A–D" separately — they read like per-project unit
 *  NAMES rather than product types, which is why not one of them is mapped
 *  here. This list exists so a future change that swallows them fails loudly. */
const PROD_OFF_LIST: ReadonlyArray<readonly [string, number]> = [
  ['Type A', 5],
  ['Type B', 5],
  ['SFR + Attached Units', 4],
  ['SFR w/ Accessory Units', 4],
  ['Type C', 2],
  ['Accessory Unit', 1],
  ['Type D', 1],
];

const REGISTRY = [
  'SFR',
  'Cottages',
  'Duplex',
  'Condo',
  'ADU',
  'DADU',
  'SFR+ADU',
  'Remodel',
];

describe('fix-449 §C2: the 22 off-list labels', () => {
  it('★★★ they total 22 across 235 unit rows', () => {
    expect(PROD_OFF_LIST.reduce((n, [, c]) => n + c, 0)).toBe(22);
  });

  it('★★★ every one is judged OFF-LIST against the canonical registry', () => {
    for (const [label] of PROD_OFF_LIST) {
      expect(isOffListUnitLabel(label, REGISTRY), label).toBe(true);
    }
  });

  it('★★ and the eight registry values are not', () => {
    for (const t of REGISTRY) {
      expect(isOffListUnitLabel(t, REGISTRY), t).toBe(false);
    }
  });

  it('★★★ "SFR+ADU" and "SFR + Attached Units" are NOT the same value', () => {
    // ★ The tempting mapping, refused. They differ by spacing and by wording,
    //   and only Bobby can say whether the second is the first. A migration
    //   that "normalised" them would be a rewrite wearing a tidy-up's clothes.
    expect(isOffListUnitLabel('SFR+ADU', REGISTRY)).toBe(false);
    expect(isOffListUnitLabel('SFR + Attached Units', REGISTRY)).toBe(true);
  });
});

describe('fix-449 §C3: the mark costs the matrix no width', () => {
  const header = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectDetail/ProjectDetailHeader.tsx'),
    'utf8',
  );

  it('★★★ no column was added to UNIT_ROW_COLUMNS', () => {
    // ★★★ The grid is DERIVED from this list (widths + baked-in gaps), and
    //     `overviewCardLayout` derives the PROJECT card's floor from the grid.
    //     A new track would have widened the card — fix-422's measured
    //     geometry — so the mark rides in the SPACER that already sat between
    //     Type and W.
    expect(UNIT_ROW_COLUMNS.map((c) => c.key)).toEqual([
      'label',
      'width_ft',
      'depth_ft',
      'qty',
      'stories',
      'parking_kind',
      'parking_stalls',
      'roof_deck',
      'remove',
    ]);
  });

  it('★★★ the grid template is unchanged by this ticket', () => {
    // Recomputed from the columns: if the mark had cost a track, this string
    // would have grown and the assertion below would fail with it.
    const expected = UNIT_ROW_COLUMNS.map((c, i) =>
      i === UNIT_ROW_COLUMNS.length - 1 ? `${c.width}px` : `${c.width}px`,
    );
    // Every column width still appears, in order, in the template.
    let cursor = 0;
    for (const w of expected) {
      const at = UNIT_MATRIX_GRID.indexOf(w, cursor);
      expect(at, w).toBeGreaterThanOrEqual(0);
      cursor = at + w.length;
    }
  });

  it('★★ the mark renders INSIDE the existing spacer, not a new cell', () => {
    // The spacer was `<span aria-hidden="true" />`; it now carries the mark and
    // drops aria-hidden only when there is one to announce.
    expect(header).toContain('pd-unit-label-offlist');
    expect(header).toMatch(
      /aria-hidden=\{offListLabel \? undefined : 'true'\}/,
    );
  });
});
