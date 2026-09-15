import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UNIT_CONFIG_FIELDS } from '../lib/unitConfigFields';
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
    resolve(process.cwd(), 'src/components/ProjectDetail/ProjectDataEditors.tsx'),
    'utf8',
  );

// ★★★ fix-572 §C — THE HORIZONTAL MATRIX THIS SECTION MEASURED IS RETIRED.
//     The Units tab is one labelled block per type now (Bobby: *"unit
//     configuration… cleanly and quickly"*). Its numbers survive as declared
//     literals in `lib/unitConfigFields`, exactly as fix-422 kept fix-412's
//     620 — *"deleting them would delete the evidence for a fix that is still
//     load-bearing."*
  it('★★ the off-list mark still costs the form no field of its own', () => {
    // ★★★ fix-449 §C3's ruling survives the restack: the `⚠` rides BESIDE the
    //     type control inside its own field, not as a ninth field. What is gone
    //     is the fixed-width grid the original argument was about — a mark in a
    //     wrapping block costs no track because there are no tracks.
    expect(UNIT_CONFIG_FIELDS.map((c) => c.key)).not.toContain('offlist');
    expect(UNIT_CONFIG_FIELDS).toHaveLength(8);
  });

  it('★★ the mark rides BESIDE the type control, not in a field of its own', () => {
    // ★★★ fix-572 §C — THE SPACER IS GONE BECAUSE THE GRID IS. fix-449 put
    //     the mark inside an existing `<span aria-hidden="true" />` so the
    //     matrix reserved no new track for it, and dropped `aria-hidden` only
    //     when there was something to announce. There are no tracks now: the
    //     Type control and its mark are one flex pair inside the `label`
    //     field, so the mark costs nothing by construction rather than by
    //     arithmetic.
    //
    // ★ THE ANNOUNCEMENT SURVIVES THE SPACER, which is the half that mattered
    //   — each mark carries its own `title`, so what it means is readable on
    //   hover instead of hidden behind an aria-hidden flip.
    expect(header).toContain('pd-unit-label-offlist');
    expect(header).toContain('pd-unit-label-needs-type');
    expect(header).toContain(
      'title="Not in the product-type list — kept exactly as stored"',
    );
    expect(header).toContain("title=\"Needs a type — this is the wizard's placeholder");
  });

  it('★★★ fix-486: the two marks are EXCLUSIVE — a type never draws both', () => {
    // ★★★ THE RULING IS UNCHANGED, ONLY ITS REASON IS. §C3 made the branches
    //     exclusive because the slot was one glyph wide and a second mark
    //     would have grown the Type column, moving fix-422's measured
    //     geometry. That geometry is retired — but two marks saying different
    //     things about the same value at once is a CONTRADICTION, not just a
    //     width, and that reason outlives the matrix.
    const slot = header.slice(
      header.indexOf('{needsType ? ('),
      header.indexOf('pd-unit-label-readonly'),
    );
    expect(slot).toContain('{needsType ? (');
    expect(slot).toContain('offListLabel && (');
    expect(slot.indexOf('pd-unit-label-needs-type')).toBeLessThan(
      slot.indexOf('pd-unit-label-offlist'),
    );
  });
});
