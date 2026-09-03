import { describe, it, expect } from 'vitest';
import {
  isOffListUnitLabel,
  nextUnitTypeLabel,
  parseUnitTypes,
  productTypeRegistry,
  resolveUnitLabel,
  resolveUnitTypesForSave,
  unitLabelOptions,
} from '../lib/unitTypeNaming';

// fix-205 → fix-209: resolveUnitLabel. One product type → that type is the
// auto-label (custom freeform preserved). 2+ product types → product-type-ONLY:
// the value must be a product type, else it resolves to '' (unpicked).
describe('resolveUnitLabel', () => {
  // =========================================================================
  // ★★★ fix-449 §C (P-077) INVERTS fix-209 AND HALF OF fix-212 — BY RULING.
  // =========================================================================
  //
  // Both were about the same thing: a stored label the app did not recognise.
  // fix-209 blanked it on a multi-type project; fix-212 overwrote it with the
  // lone type on a single-type one. Neither ever showed the person what was
  // actually in the row.
  //
  // Measured on prod 2026-08-29, 22 of 235 unit rows carry such a label —
  // "Type A" ×5, "Type B" ×5, "SFR + Attached Units" ×4, "SFR w/ Accessory
  // Units" ×4, "Type C" ×2, "Accessory Unit" ×1, "Type D" ×1. Bobby's ruling
  // (P-077, and fix-415's rule inherited): an off-list value is SHOWN AS
  // off-list, never silently vanished or rewritten — and "Type A–D" read like
  // per-project unit NAMES rather than product types, which is his call to
  // make, not a mapping for this function to guess.
  //
  // ★★ THE HALF OF fix-212 THAT SURVIVES is the one about ABSENCE: a BLANK
  //    label on a single-type project still resolves to that type. Nothing is
  //    displaced there, and it is asserted three tests down, unchanged.
  it('fix-209/212 → fix-449: a STORED label is preserved verbatim, whatever the types', () => {
    // Single type: no longer overwritten.
    expect(resolveUnitLabel('Type A', ['SFR'])).toBe('Type A');
    expect(resolveUnitLabel('Cottage 1', ['Attached Units'])).toBe('Cottage 1');
    // Two or more: no longer blanked.
    expect(resolveUnitLabel('Cottage 1', ['SFR', 'Duplex'])).toBe('Cottage 1');
    expect(resolveUnitLabel('Type A', ['SFR', 'Accessory Unit'])).toBe('Type A');
  });

  it('fix-209: a label that IS a product type still reads as itself', () => {
    expect(resolveUnitLabel('SFR', ['SFR', 'Duplex'])).toBe('SFR');
    expect(resolveUnitLabel('Duplex', ['SFR', 'Duplex'])).toBe('Duplex');
  });

  it('★★★ every one of the 22 prod off-list labels survives unchanged', () => {
    // One case per distinct value measured on prod. The counts are in the
    // ticket; what matters here is that none of them is rewritten.
    const OFF_LIST = [
      'Type A',
      'Type B',
      'Type C',
      'Type D',
      'SFR + Attached Units',
      'SFR w/ Accessory Units',
      'Accessory Unit',
    ];
    for (const label of OFF_LIST) {
      expect(resolveUnitLabel(label, ['SFR']), label).toBe(label);
      expect(resolveUnitLabel(label, ['SFR', 'Duplex']), label).toBe(label);
      expect(resolveUnitLabel(label, []), label).toBe(label);
    }
  });

  it('blank label + a single product type → that type', () => {
    expect(resolveUnitLabel('', ['SFR'])).toBe('SFR');
    expect(resolveUnitLabel('   ', ['Attached Units'])).toBe('Attached Units');
  });

  it('blank label + multiple product types → stays blank (can\'t auto-pick)', () => {
    expect(resolveUnitLabel('', ['SFR', 'Duplex'])).toBe('');
  });

  it('blank label + no product types → stays blank', () => {
    expect(resolveUnitLabel('', [])).toBe('');
    expect(resolveUnitLabel(null, null)).toBe('');
    expect(resolveUnitLabel(undefined, undefined)).toBe('');
  });

  it('ignores empty/whitespace product-type entries when counting', () => {
    // One real type after filtering blanks → resolves to it.
    expect(resolveUnitLabel('', ['SFR', '', '  '])).toBe('SFR');
  });
});

// fix-206: parseUnitTypes + resolveUnitTypesForSave are now shared by the
// Project Overview editor and the Library matrix (one store).
describe('parseUnitTypes', () => {
  it('returns [] for non-array input', () => {
    expect(parseUnitTypes(null)).toEqual([]);
    expect(parseUnitTypes(undefined)).toEqual([]);
    expect(parseUnitTypes('x')).toEqual([]);
  });

  it('coalesces v1 {w,d} into {width_ft,depth_ft} and defaults qty/stories', () => {
    expect(parseUnitTypes([{ label: 'A', w: 20, d: 30 }])).toEqual([
      {
        label: 'A',
        width_ft: 20,
        depth_ft: 30,
        qty: 1,
        stories: null,
        // ★ fix-402: three more fields, all null on a row that never
        //   carried them — NOT RECORDED, never a default.
        parking_kind: null,
        parking_stalls: null,
        roof_deck: null,
        // ★★★ fix-486 §D: `work_scope` IS NO LONGER EMITTED, and this exact-shape
        //   assertion is what proves it. The whitelist mechanism fix-412 noted
        //   here is unchanged and now cuts the other way: a key `parseUnitTypes`
        //   does not name is DELETED from the row on the next save, which is
        //   precisely how the retired field stays retired.
      },
    ]);
  });

  it('keeps canonical rows, carries stories, defaults a bad qty to 1', () => {
    expect(
      parseUnitTypes([
        { label: 'B', width_ft: 17.5, depth_ft: 33.75, qty: 0, stories: 3 },
      ]),
    ).toEqual([
      {
        label: 'B',
        width_ft: 17.5,
        depth_ft: 33.75,
        qty: 1,
        stories: 3,
        // ★ fix-402: three more fields, all null on a row that never
        //   carried them — NOT RECORDED, never a default.
        parking_kind: null,
        parking_stalls: null,
        roof_deck: null,
      },
    ]);
  });
});

describe('resolveUnitTypesForSave', () => {
  // ★★★ fix-449 INVERTS THIS ONE, AND IT IS THE MOST CONSEQUENTIAL OF THE SET.
  //
  // `resolveUnitTypesForSave` runs on the SAVE path — every unit row goes
  // through it before it is persisted. So under fix-212 an off-list label on a
  // single-product-type project was not merely displayed as the type: editing
  // ANY field on that project — a width, a stories count — REWROTE the stored
  // label to the type, on disk, silently. Five of prod's "Type A" rows and five
  // "Type B" sat one keystroke away from being lost that way.
  //
  // Bobby's ruling is explicit that the 22 stay exactly as stored while he
  // decides what "Type A–D" should become. A save path that quietly resolved
  // them would have made that decision for him.
  it('fix-212 → fix-449: a save FILLS a blank but never overwrites a stored label', () => {
    const out = resolveUnitTypesForSave(
      [
        { label: '', width_ft: 96, depth_ft: 147.5, qty: 1, stories: 2 },
        { label: 'Type B', width_ft: 20, depth_ft: 30, qty: 2, stories: null },
      ],
      ['SFR'],
    );
    // ★ The absence case still fills — fix-212's useful half.
    expect(out[0].label).toBe('SFR');
    // ★★★ The stored value survives its own project being saved.
    expect(out[1].label).toBe('Type B');
    // Non-label fields untouched.
    expect(out[0].depth_ft).toBe(147.5);
  });

  it('leaves blanks blank when multiple product types (no auto-pick)', () => {
    const out = resolveUnitTypesForSave(
      [{ label: '', width_ft: null, depth_ft: null, qty: 1, stories: null }],
      ['SFR', 'Duplex'],
    );
    expect(out[0].label).toBe('');
  });
});

// Guard the existing seed-letter helper still behaves (shared module).
describe('nextUnitTypeLabel (regression)', () => {
  it('seeds the next vacant Type letter', () => {
    expect(nextUnitTypeLabel(['Type A', 'Type C'])).toBe('Type B');
    expect(nextUnitTypeLabel([])).toBe('Type A');
  });
});

// ===========================================================================
// ★★★ fix-449 §C — THE MARK AND THE OPTION LIST
// ===========================================================================
describe('fix-449: isOffListUnitLabel', () => {
  const REGISTRY = ['SFR', 'Cottages', 'Duplex', 'Condo', 'ADU', 'DADU', 'SFR+ADU', 'Remodel'];

  it('★★★ the 22 prod values are off-list; the registry ones are not', () => {
    for (const l of ['Type A', 'Type B', 'Type C', 'Type D', 'SFR + Attached Units', 'SFR w/ Accessory Units', 'Accessory Unit']) {
      expect(isOffListUnitLabel(l, REGISTRY), l).toBe(true);
    }
    for (const l of REGISTRY) {
      expect(isOffListUnitLabel(l, REGISTRY), l).toBe(false);
    }
  });

  it('★★ a BLANK is not off-list — "nothing recorded" is not a wrong answer', () => {
    expect(isOffListUnitLabel('', REGISTRY)).toBe(false);
    expect(isOffListUnitLabel('   ', REGISTRY)).toBe(false);
    expect(isOffListUnitLabel(null, REGISTRY)).toBe(false);
  });

  it('★★ with NO registry loaded nothing is judged off-list', () => {
    // An empty options array means "not known yet", not "everything is wrong"
    // — otherwise every row wears a mark for the frame before app_config lands.
    expect(isOffListUnitLabel('Type A', [])).toBe(false);
    expect(isOffListUnitLabel('Type A', null)).toBe(false);
  });
});

describe('fix-449: unitLabelOptions', () => {
  it('★★★ appends the STORED value when it is off-list (fix-415 rule)', () => {
    // The control has to be able to DISPLAY what it holds.
    expect(unitLabelOptions(['SFR', 'Duplex'], 'Type A')).toEqual([
      'SFR',
      'Duplex',
      'Type A',
    ]);
  });

  it('★ …and does not duplicate one that is already there', () => {
    expect(unitLabelOptions(['SFR', 'Duplex'], 'SFR')).toEqual(['SFR', 'Duplex']);
    expect(unitLabelOptions(['SFR'], '')).toEqual(['SFR']);
    expect(unitLabelOptions(['SFR'], null)).toEqual(['SFR']);
  });
});

describe('fix-449: productTypeRegistry', () => {
  it('★★ reads the app_config key, ignoring blanks and non-strings', () => {
    const m = new Map<string, unknown>([
      ['productTypeOptions', ['SFR', '', '  ', 7, 'Duplex']],
    ]);
    expect(productTypeRegistry(m)).toEqual(['SFR', 'Duplex']);
  });

  it('★ an absent key or map reads as EMPTY, which marks nothing', () => {
    expect(productTypeRegistry(new Map())).toEqual([]);
    expect(productTypeRegistry(null)).toEqual([]);
  });
});
