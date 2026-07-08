import { describe, it, expect } from 'vitest';
import {
  resolveTeamAssignee,
  resolveCoAssignee,
  resolveCoAssignees,
  roleToken,
} from '../lib/taskTeam';
import { findDmForDa } from '../components/wizard/dmRouting';
import type { DmDaGroupRow } from '../lib/database.types';

// fix-153 + fix-222: contract spec for the team + co-assignee resolution that
// bp_create_project_with_permits applies when seeding permit_tasks from
// task_templates. The resolution is SQL (migrations/fix_222_task_template_overhaul.sql:
// the CASE on tt.default_team + the unnest/CASE token transform inside the
// INSERT-SELECT). No live DB in CI, so these pure helpers (src/lib/taskTeam.ts)
// are THE tested source of truth and the SQL mirrors them — keep in lockstep.

describe('fix-222 default_team → assigned_to routing', () => {
  const ctx = {
    entLead: 'Maria',
    da: 'Trevor',
    schematicDesigners: ['Ana'],
  };

  it("'Entitlements' → the permit's ent_lead", () => {
    expect(resolveTeamAssignee('Entitlements', ctx)).toBe('Maria');
  });

  it("'Design Associate' → the permit's da", () => {
    expect(resolveTeamAssignee('Design Associate', ctx)).toBe('Trevor');
    expect(
      resolveTeamAssignee('Design Associate', { ...ctx, da: 'Qisheng' }),
    ).toBe('Qisheng');
  });

  it("'Schematic Team' → the project's schematic designer", () => {
    expect(resolveTeamAssignee('Schematic Team', ctx)).toBe('Ana');
    expect(
      resolveTeamAssignee('Schematic Team', { ...ctx, schematicDesigners: [] }),
    ).toBeNull();
  });

  it("legacy 'Architecture' still routes to da (pre-migration safety)", () => {
    expect(resolveTeamAssignee('Architecture', ctx)).toBe('Trevor');
  });

  it('a literal (legacy) name passes through; null stays null', () => {
    expect(resolveTeamAssignee('Bob Literal', ctx)).toBe('Bob Literal');
    expect(resolveTeamAssignee(null, ctx)).toBeNull();
  });

  it("resolves to null when the team's field is unset", () => {
    expect(
      resolveTeamAssignee('Design Associate', { ...ctx, da: null }),
    ).toBeNull();
    expect(
      resolveTeamAssignee('Entitlements', { ...ctx, entLead: null }),
    ).toBeNull();
  });
});

describe('fix-222 dynamic co-assignee token resolution', () => {
  // A real dm_da_groups shape: DA → DM pairing (quarter-agnostic canonical map).
  const dmRows: DmDaGroupRow[] = [
    { id: '1', dm_name: 'Lindsay', da_name: 'Trevor', updated_at: 'x' },
    { id: '2', dm_name: 'Derry', da_name: 'Nicky', updated_at: 'x' },
  ] as DmDaGroupRow[];

  it("'Design Manager' token resolves to the correct DM for two different DAs via dm_da_groups", () => {
    // Permit A: DA Trevor → DM Lindsay.
    const ctxA = {
      da: 'Trevor',
      dm: findDmForDa('Trevor', dmRows),
      schematicDesigners: [],
    };
    expect(resolveCoAssignee(roleToken('design_manager'), ctxA)).toEqual([
      'Lindsay',
    ]);

    // Permit B: DA Nicky → DM Derry. Same template token, different DM —
    // never hardcoded to a named DM.
    const ctxB = {
      da: 'Nicky',
      dm: findDmForDa('Nicky', dmRows),
      schematicDesigners: [],
    };
    expect(resolveCoAssignee(roleToken('design_manager'), ctxB)).toEqual([
      'Derry',
    ]);
  });

  it("'Design Associate' → the project's DA; 'Schematic Designer' → the schematic designer(s)", () => {
    const ctx = { da: 'Trevor', dm: 'Lindsay', schematicDesigners: ['Ana', 'Bo'] };
    expect(resolveCoAssignee(roleToken('design_associate'), ctx)).toEqual([
      'Trevor',
    ]);
    expect(resolveCoAssignee(roleToken('schematic_designer'), ctx)).toEqual([
      'Ana',
      'Bo',
    ]);
  });

  it('a plain person name passes through; unresolvable role → nothing', () => {
    const ctx = { da: null, dm: null, schematicDesigners: [] };
    expect(resolveCoAssignee('Jordan', ctx)).toEqual(['Jordan']);
    expect(resolveCoAssignee(roleToken('design_manager'), ctx)).toEqual([]);
  });

  it('resolveCoAssignees flattens + dedupes a mixed list', () => {
    const ctx = { da: 'Trevor', dm: 'Lindsay', schematicDesigners: ['Ana'] };
    const out = resolveCoAssignees(
      [
        'Jordan',
        roleToken('design_associate'), // → Trevor
        roleToken('design_manager'), // → Lindsay
        'Jordan', // dup person
        roleToken('schematic_designer'), // → Ana
      ],
      ctx,
    );
    expect(out).toEqual(['Jordan', 'Trevor', 'Lindsay', 'Ana']);
  });
});
