import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  UNIT_MATRIX_GRID,
  UNIT_ROW_COLUMNS,
} from '../lib/unitRowLayout';
import { isOffListUnitLabel } from '../lib/unitTypeNaming';
import {
  isWizardPlaceholderLabel,
  mapProjectProductType,
  mapUnitLabel,
} from '../lib/unitTypeVocabulary';

// ===========================================================================
// ★★★ fix-449 §C2/§C3 — THE 22, AND THE MARK THAT COSTS NO WIDTH
// ===========================================================================

// ===========================================================================
// ★★★ fix-486 (P-143) — BOBBY RULED ON "Type A–D", AND ON THE OTHER THREE
// ===========================================================================
//
// fix-449 measured 22 off-list labels and deliberately mapped NONE of them,
// recording that *"Bobby rules on Type A–D separately"*. He has now ruled, and
// the answer splits the 22 three ways rather than two:
//
//   · `SFR + Attached Units` (4) and `SFR w/ Accessory Units` (4) WERE product
//     types after all, spelled long. The fix-486 migration mapped them to
//     Attached and Detached. They no longer exist on prod.
//   · `Accessory Unit` (1) had already been edited away by a person before the
//     remap ran — measured 2026-09-03, it is on no row. The migration's verify
//     step would have ABORTED on it, which is how that is known rather than
//     assumed.
//   · `Type A`–`Type D` (11 rows on 4 projects, all redesigns) STAY EXACTLY AS
//     STORED. fix-449 guessed right about them: they are not a vocabulary, they
//     are the wizard's seed letters, and a mapping that swallowed them would
//     have declared eleven unanswered rows answered.
//
// ★★★ SO fix-449's §C2 RULING IS SUPERSEDED, NOT MISTAKEN. Its rule was "we do
// not know, so do not guess"; the answer arrived and three of the seven turned
// out to be spellings. The eleven it protected are still protected, and the
// protection is now STRONGER: they get their own mark saying they need a type,
// instead of sharing "not in the list" with a word somebody chose on purpose.

/** ★ The off-list set as fix-449 measured it on prod 2026-08-29, kept as the
 *  BEFORE half of the fix-486 remap. Nothing reads it as current. */
const PROD_OFF_LIST_2026_08_29: ReadonlyArray<readonly [string, number]> = [
  ['Type A', 5],
  ['Type B', 5],
  ['SFR + Attached Units', 4],
  ['SFR w/ Accessory Units', 4],
  ['Type C', 2],
  ['Accessory Unit', 1],
  ['Type D', 1],
];

/** ★ What is still off-list after the remap, measured 2026-09-03. */
const PROD_OFF_LIST_AFTER: ReadonlyArray<readonly [string, number]> = [
  ['Type A', 4],
  ['Type B', 4],
  ['Type C', 2],
  ['Type D', 1],
];

/** ★ fix-486's five. The registry is DATA (`app_config.productTypeOptions`);
 *  this is a fixture of it, exactly as the eight-value list before it was. */
const REGISTRY = ['Detached', 'Attached', 'ADU', 'DADU', 'Remodel'];

describe('fix-449 §C2 (superseded by fix-486): the 22, and what became of them', () => {
  it('★★★ fix-449 measured 22 across 235 rows; fix-486 left 11 across 245', () => {
    expect(PROD_OFF_LIST_2026_08_29.reduce((n, [, c]) => n + c, 0)).toBe(22);
    expect(PROD_OFF_LIST_AFTER.reduce((n, [, c]) => n + c, 0)).toBe(11);
  });

  it('★★★ every survivor is a wizard placeholder — nothing else is off-list', () => {
    // ★★★ THE WHOLE CLAIM OF THE REMAP IN ONE ASSERTION. If a mapping rule had
    //     been missed, a real product-type spelling would still be sitting in
    //     this list; there is none, and the migration's own verify step
    //     enforces the same thing against the live rows.
    for (const [label] of PROD_OFF_LIST_AFTER) {
      expect(isWizardPlaceholderLabel(label), label).toBe(true);
    }
    for (const [label] of PROD_OFF_LIST_2026_08_29) {
      if (isWizardPlaceholderLabel(label)) continue;
      // The three that were spellings, and where each landed.
      expect(mapUnitLabel(label) ?? 'GONE', label).toBe(
        { 'SFR + Attached Units': 'Attached',
          'SFR w/ Accessory Units': 'Detached',
          'Accessory Unit': 'GONE' }[label],
      );
    }
  });

  it('★★★ every survivor is STILL judged off-list by the predicate', () => {
    // ★★ The predicate did NOT change — only which mark the row draws. A
    //    placeholder is genuinely not in the registry, and code that asks
    //    "is this in the list" must keep getting the true answer.
    for (const [label] of PROD_OFF_LIST_AFTER) {
      expect(isOffListUnitLabel(label, REGISTRY), label).toBe(true);
    }
  });

  it('★★ and the five registry values are not', () => {
    for (const t of REGISTRY) {
      expect(isOffListUnitLabel(t, REGISTRY), t).toBe(false);
    }
  });

  it('★★★ "SFR+ADU" and "SFR + Attached Units" were NEVER the same value', () => {
    // ★ fix-449 refused the tempting normalisation and left it to Bobby. He
    //   split them: `SFR+ADU` is Detached AND ADU on a project, Detached alone
    //   on a unit row; `SFR + Attached Units` is Attached. Different answers —
    //   so the refusal was right, and this records what the answer turned out
    //   to be rather than deleting the question.
    expect(mapProjectProductType('SFR+ADU')).toEqual(['Detached', 'ADU']);
    expect(mapUnitLabel('SFR+ADU')).toBe('Detached');
    expect(mapUnitLabel('SFR + Attached Units')).toBe('Attached');
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
    //
    // ★ fix-486 added a SECOND mark in the same slot ("needs a type"), which is
    //   why the condition is a disjunction. Still one span, still no new track.
    expect(header).toContain('pd-unit-label-offlist');
    expect(header).toContain('pd-unit-label-needs-type');
    expect(header).toMatch(
      /aria-hidden=\{offListLabel \|\| needsType \? undefined : 'true'\}/,
    );
  });

  it('★★★ fix-486: the two marks are EXCLUSIVE — a row never draws both', () => {
    // ★★★ Same slot, and the slot is one glyph wide. If both branches could
    //     render, the Type column would grow and fix-422's measured geometry
    //     would move — the exact cost §C3 exists to prevent. The ternary is
    //     what makes it structural rather than incidental.
    const slot = header.slice(
      header.indexOf('aria-hidden={offListLabel || needsType'),
      header.indexOf('pd-unit-label-offlist'),
    );
    expect(slot).toContain('{needsType ? (');
    expect(slot).toContain(') : (');
  });
});
