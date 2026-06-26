import { describe, it, expect } from 'vitest';
import {
  nextUnitTypeLabel,
  parseUnitTypes,
  resolveUnitLabel,
  resolveUnitTypesForSave,
} from '../lib/unitTypeNaming';

// fix-205 → fix-209: resolveUnitLabel. One product type → that type is the
// auto-label (custom freeform preserved). 2+ product types → product-type-ONLY:
// the value must be a product type, else it resolves to '' (unpicked).
describe('resolveUnitLabel', () => {
  it('fix-212: one product type is AUTHORITATIVE — blank AND a legacy custom both resolve to the type', () => {
    expect(resolveUnitLabel('Type A', ['SFR'])).toBe('SFR'); // custom overridden
    expect(resolveUnitLabel('', ['SFR'])).toBe('SFR');
    expect(resolveUnitLabel('Cottage 1', ['Attached Units'])).toBe('Attached Units');
  });

  it('fix-209: 2+ product types — keeps the label only if it IS a product type', () => {
    expect(resolveUnitLabel('SFR', ['SFR', 'Duplex'])).toBe('SFR');
    expect(resolveUnitLabel('Duplex', ['SFR', 'Duplex'])).toBe('Duplex');
  });

  it('fix-209: 2+ product types — a legacy/custom label is unpicked → ""', () => {
    expect(resolveUnitLabel('Cottage 1', ['SFR', 'Duplex'])).toBe('');
    expect(resolveUnitLabel('Type A', ['SFR', 'Accessory Unit'])).toBe('');
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
      { label: 'A', width_ft: 20, depth_ft: 30, qty: 1, stories: null },
    ]);
  });

  it('keeps canonical rows, carries stories, defaults a bad qty to 1', () => {
    expect(
      parseUnitTypes([
        { label: 'B', width_ft: 17.5, depth_ft: 33.75, qty: 0, stories: 3 },
      ]),
    ).toEqual([
      { label: 'B', width_ft: 17.5, depth_ft: 33.75, qty: 1, stories: 3 },
    ]);
  });
});

describe('resolveUnitTypesForSave', () => {
  it('fix-212: single product type is authoritative — EVERY row (blank or legacy custom) → the type', () => {
    const out = resolveUnitTypesForSave(
      [
        { label: '', width_ft: 96, depth_ft: 147.5, qty: 1, stories: 2 },
        { label: 'Type B', width_ft: 20, depth_ft: 30, qty: 2, stories: null },
      ],
      ['SFR'],
    );
    expect(out[0].label).toBe('SFR');
    expect(out[1].label).toBe('SFR'); // "Type B" overridden by the single type
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
