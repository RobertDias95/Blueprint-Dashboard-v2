import { describe, it, expect } from 'vitest';
import {
  formulaScopeKey,
  resolveTargetSubmitOffset,
} from '../hooks/useTargetSubmitFormulas';
import type { TargetSubmitFormula } from '../lib/database.types';

// fix-154: per-type × per-jurisdiction target_submit offset overrides.
//
// Resolution (per-juris → Base → null) is tested as a pure unit against
// resolveTargetSubmitOffset, the exact mirror of the SQL bp_target_submit_offset
// resolver (live-verified: Seattle BP override=45 wins, Kirkland falls to
// Base=21, unknown type → NULL). The Settings wiring (edit Base, add override,
// remove override) is tested against PerTypeScheduleTable (fix-615).
//
// Server-side Base-delete refusal verified live: bp_delete_target_submit_formula
// ('Building Permit', NULL) returns 0 (the IF jurisdiction IS NULL guard fires
// before any delete) — and the table never renders a remove button on a Base
// value, so the UI can't request it.

const NOW = '2026-06-10T12:00:00Z';

function fixtureMap(rows: TargetSubmitFormula[]): Map<string, TargetSubmitFormula> {
  const m = new Map<string, TargetSubmitFormula>();
  for (const r of rows) m.set(formulaScopeKey(r.type, r.jurisdiction), r);
  return m;
}

describe('resolveTargetSubmitOffset (fix-154 resolver)', () => {
  const rows: TargetSubmitFormula[] = [
    { type: 'Building Permit', jurisdiction: null, offset_days: 21, updated_at: NOW },
    { type: 'Building Permit', jurisdiction: 'Seattle', offset_days: 45, updated_at: NOW },
    { type: 'Demolition', jurisdiction: null, offset_days: 37, updated_at: NOW },
  ];
  const map = fixtureMap(rows);

  it('returns Base when no per-juris override exists', () => {
    expect(resolveTargetSubmitOffset(map, 'Building Permit', 'Kirkland')).toBe(21);
    expect(resolveTargetSubmitOffset(map, 'Demolition', 'Seattle')).toBe(37);
    // Base view itself.
    expect(resolveTargetSubmitOffset(map, 'Building Permit', null)).toBe(21);
  });

  it('returns the per-juris offset when an override exists', () => {
    expect(resolveTargetSubmitOffset(map, 'Building Permit', 'Seattle')).toBe(45);
  });

  it('returns null when neither override nor Base exists (unknown type)', () => {
    expect(resolveTargetSubmitOffset(map, 'NoSuchType', 'Seattle')).toBeNull();
    expect(resolveTargetSubmitOffset(map, 'NoSuchType', null)).toBeNull();
  });
});

// ---- Settings editor wiring ----
//
// ★ fix-615: TargetSubmitFormulasEditor is retired — the per-type schedule is
//   one table now (PerTypeScheduleTable). Its edit / add-override /
//   remove-override / read-only behaviour is tested there, in
//   PerTypeScheduleFix615.test.tsx.
