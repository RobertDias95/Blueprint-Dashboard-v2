import { describe, it, expect } from 'vitest';
import { coAssigneeDisplayName } from '../lib/taskTeam';
import { findDmForDa } from '../components/wizard/dmRouting';
import type { DmDaGroupRow } from '../lib/database.types';

// fix-224: display resolution (shared by both task views) + the migration's
// assigned_to → co_assignees backfill resolution.

describe('fix-224 coAssigneeDisplayName', () => {
  const dmRows: DmDaGroupRow[] = [
    { id: '1', dm_name: 'Lindsay', da_name: 'Trevor', updated_at: 'x' },
    { id: '2', dm_name: 'Derry', da_name: 'Nicky', updated_at: 'x' },
  ] as DmDaGroupRow[];

  it("a design_manager token resolves to the correct DM for two different DAs", () => {
    const ctxA = { da: 'Trevor', dm: findDmForDa('Trevor', dmRows), schematicDesigners: [] };
    expect(coAssigneeDisplayName('role:design_manager', ctxA)).toBe('Lindsay');
    const ctxB = { da: 'Nicky', dm: findDmForDa('Nicky', dmRows), schematicDesigners: [] };
    expect(coAssigneeDisplayName('role:design_manager', ctxB)).toBe('Derry');
  });

  it('a design_associate token resolves to the DA; a plain name passes through', () => {
    const ctx = { da: 'Trevor', dm: 'Lindsay', schematicDesigners: [] };
    expect(coAssigneeDisplayName('role:design_associate', ctx)).toBe('Trevor');
    expect(coAssigneeDisplayName('Miles', ctx)).toBe('Miles');
  });

  it('an unresolvable role token falls back to its friendly label', () => {
    const ctx = { da: null, dm: null, schematicDesigners: [] };
    expect(coAssigneeDisplayName('role:design_manager', ctx)).toBe('Design Manager');
  });
});

// Mirror of the migration's backfill CASE (fix_224_unify_task_assignment.sql):
//   assigned_to 'Entitlements' -> permit.ent_lead
//   assigned_to 'Architecture' -> permit.da
//   else the literal assigned_to name.
function resolveAssignedToBackfill(
  assignedTo: string,
  permit: { ent_lead: string | null; da: string | null },
): string | null {
  const raw =
    assignedTo === 'Entitlements'
      ? permit.ent_lead
      : assignedTo === 'Architecture'
        ? permit.da
        : assignedTo;
  const v = (raw ?? '').trim();
  return v === '' ? null : v;
}

describe('fix-224 backfill: assigned_to team keys resolve to people', () => {
  const permit = { ent_lead: 'Miles', da: 'Trevor' };

  it("'Entitlements' → the permit's ent_lead", () => {
    expect(resolveAssignedToBackfill('Entitlements', permit)).toBe('Miles');
  });
  it("'Architecture' → the permit's da", () => {
    expect(resolveAssignedToBackfill('Architecture', permit)).toBe('Trevor');
  });
  it('a literal name passes through', () => {
    expect(resolveAssignedToBackfill('Briana', permit)).toBe('Briana');
  });
  it('a team key with no matching role resolves to null (skipped)', () => {
    expect(
      resolveAssignedToBackfill('Entitlements', { ent_lead: null, da: 'Trevor' }),
    ).toBeNull();
  });
});
