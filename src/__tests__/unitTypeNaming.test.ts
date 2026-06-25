import { describe, it, expect } from 'vitest';
import { nextUnitTypeLabel, resolveUnitLabel } from '../lib/unitTypeNaming';

// fix-205: resolveUnitLabel — the "unnamed" fix. A blank label resolves to the
// project's single product type; with 0 or 2+ types it stays blank.
describe('resolveUnitLabel', () => {
  it('keeps a non-empty label verbatim (never clobbered)', () => {
    expect(resolveUnitLabel('Type A', ['SFR'])).toBe('Type A');
    expect(resolveUnitLabel('Cottage 1', ['SFR', 'Duplex'])).toBe('Cottage 1');
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

// Guard the existing seed-letter helper still behaves (shared module).
describe('nextUnitTypeLabel (regression)', () => {
  it('seeds the next vacant Type letter', () => {
    expect(nextUnitTypeLabel(['Type A', 'Type C'])).toBe('Type B');
    expect(nextUnitTypeLabel([])).toBe('Type A');
  });
});
