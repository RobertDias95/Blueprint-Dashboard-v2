import { describe, it, expect } from 'vitest';
import {
  TEAM_OPTIONS,
  migrateArchitectureTeam,
  roleToken,
  parseCoAssignee,
  isRoleToken,
  coAssigneeLabel,
  DYNAMIC_ROLE_LABELS,
  PRIMARY_TEAM_OPTIONS,
  normalizePrimaryTeamKey,
  isPrimaryPerson,
  resolvePrimaryAssignee,
  primarySelectValue,
  defaultPrimaryTeamKey,
  buildAssigneeOptions,
  type AssigneeRoleOption,
  type PrimaryResolutionContext,
} from '../lib/taskTeam';

// fix-222: task-template team taxonomy + co-assignee token helpers.

describe('fix-222 TEAM taxonomy', () => {
  it('offers exactly Entitlements / Design Associate / Schematic Team (Architecture retired)', () => {
    expect(TEAM_OPTIONS).toEqual([
      'Entitlements',
      'Design Associate',
      'Schematic Team',
    ]);
    expect(TEAM_OPTIONS as readonly string[]).not.toContain('Architecture');
  });
});

describe('fix-222 migrateArchitectureTeam', () => {
  it("'Architecture' → 'Design Associate' for a normal template", () => {
    expect(migrateArchitectureTeam('Architecture', 'Create Site Plan')).toBe(
      'Design Associate',
    );
  });

  it("'Architecture' → 'Schematic Team' for a schematic-prep template", () => {
    expect(migrateArchitectureTeam('Architecture', 'Schematic Design')).toBe(
      'Schematic Team',
    );
    // case-insensitive substring match
    expect(
      migrateArchitectureTeam('Architecture', 'Prep SCHEMATIC package'),
    ).toBe('Schematic Team');
  });

  it('leaves non-Architecture teams untouched', () => {
    expect(migrateArchitectureTeam('Entitlements', 'x')).toBe('Entitlements');
    expect(migrateArchitectureTeam(null, 'Schematic Design')).toBeNull();
  });
});

describe('fix-222 co-assignee tokens', () => {
  it('round-trips a role token and labels it', () => {
    const t = roleToken('design_manager');
    expect(t).toBe('role:design_manager');
    expect(isRoleToken(t)).toBe(true);
    expect(parseCoAssignee(t)).toEqual({ kind: 'role', role: 'design_manager' });
    expect(coAssigneeLabel(t)).toBe('Design Manager');
  });

  it('treats a plain name as a person', () => {
    expect(isRoleToken('Jordan')).toBe(false);
    expect(parseCoAssignee('Jordan')).toEqual({ kind: 'person', name: 'Jordan' });
    expect(coAssigneeLabel('Jordan')).toBe('Jordan');
  });

  it('an unknown role: string is treated as a person name, not a token', () => {
    expect(isRoleToken('role:nope')).toBe(false);
    expect(coAssigneeLabel('role:nope')).toBe('role:nope');
  });

  it('exposes the three dynamic-role labels', () => {
    expect(DYNAMIC_ROLE_LABELS).toEqual({
      design_associate: 'Design Associate',
      design_manager: 'Design Manager',
      schematic_designer: 'Schematic Designer',
    });
  });
});

// fix-228: PRIMARY owner (assigned_to) taxonomy + resolver for live tasks.
describe('fix-228 primary owner', () => {
  const ctxA: PrimaryResolutionContext = {
    da: 'Jade',
    entLead: 'Miles',
    dm: 'Derry',
    schematicDesigners: ['Shire'],
  };

  it('offers the fix-222 taxonomy + Design Manager, Design Associate first (default)', () => {
    expect(PRIMARY_TEAM_OPTIONS).toEqual([
      'Design Associate',
      'Entitlements',
      'Schematic Team',
      'Design Manager',
    ]);
  });

  it('default (empty/null) resolves to the DA', () => {
    expect(resolvePrimaryAssignee(null, ctxA)).toBe('Jade');
    expect(resolvePrimaryAssignee('', ctxA)).toBe('Jade');
    expect(resolvePrimaryAssignee('   ', ctxA)).toBe('Jade');
  });

  it('resolves each team/role key to its person', () => {
    expect(resolvePrimaryAssignee('Design Associate', ctxA)).toBe('Jade');
    expect(resolvePrimaryAssignee('Entitlements', ctxA)).toBe('Miles');
    expect(resolvePrimaryAssignee('Schematic Team', ctxA)).toBe('Shire');
    expect(resolvePrimaryAssignee('Design Manager', ctxA)).toBe('Derry');
  });

  it('Design Manager resolves to DIFFERENT DMs for different DAs (dm_da_groups)', () => {
    const jadeCtx: PrimaryResolutionContext = { da: 'Jade', entLead: null, dm: 'Derry', schematicDesigners: [] };
    const trevorCtx: PrimaryResolutionContext = { da: 'Trevor', entLead: null, dm: 'Lindsay', schematicDesigners: [] };
    expect(resolvePrimaryAssignee('Design Manager', jadeCtx)).toBe('Derry');
    expect(resolvePrimaryAssignee('Design Manager', trevorCtx)).toBe('Lindsay');
  });

  it('legacy "Architecture" reads as Design Associate → the DA (task point 4)', () => {
    expect(normalizePrimaryTeamKey('Architecture')).toBe('Design Associate');
    expect(resolvePrimaryAssignee('Architecture', ctxA)).toBe('Jade');
    expect(primarySelectValue('Architecture')).toBe('Design Associate');
  });

  it('a specific person resolves to itself and is not a team key', () => {
    expect(resolvePrimaryAssignee('Erick', ctxA)).toBe('Erick');
    expect(normalizePrimaryTeamKey('Erick')).toBeNull();
    expect(isPrimaryPerson('Erick')).toBe(true);
    expect(isPrimaryPerson('Entitlements')).toBe(false);
    expect(isPrimaryPerson(null)).toBe(false);
  });

  it('a team key with no one in the role falls back to the friendly label (never blank)', () => {
    const empty: PrimaryResolutionContext = { da: null, entLead: null, dm: null, schematicDesigners: [] };
    expect(resolvePrimaryAssignee('Entitlements', empty)).toBe('Entitlements');
    expect(resolvePrimaryAssignee('Design Manager', empty)).toBe('Design Manager');
  });

  it('primarySelectValue defaults an unset primary to "Design Associate"', () => {
    expect(primarySelectValue(null)).toBe('Design Associate');
    expect(primarySelectValue('Entitlements')).toBe('Entitlements');
    expect(primarySelectValue('Erick')).toBe('Erick');
  });
});

// fix-230: the UNSET default primary follows the task's COLUMN/discipline
// (regression fix — fix-228 always defaulted to the DA regardless of column).
describe('fix-230 discipline-aware default primary', () => {
  // 5107 S Hudson St / 7120510-CN shape: DA=Ainsley, ent_lead=Miles.
  const ctx: PrimaryResolutionContext = {
    da: 'Ainsley',
    entLead: 'Miles',
    dm: 'Derry',
    schematicDesigners: ['Shire'],
  };

  it('defaultPrimaryTeamKey: ent → Entitlements, arch/other/unknown → Design Associate', () => {
    expect(defaultPrimaryTeamKey('ent')).toBe('Entitlements');
    expect(defaultPrimaryTeamKey('arch')).toBe('Design Associate');
    expect(defaultPrimaryTeamKey(null)).toBe('Design Associate');
    expect(defaultPrimaryTeamKey(undefined)).toBe('Design Associate');
  });

  it('an UNSET ENT-discipline task defaults its primary to the ent_lead (Miles), not the DA', () => {
    expect(resolvePrimaryAssignee(null, ctx, 'ent')).toBe('Miles');
    expect(resolvePrimaryAssignee('', ctx, 'ent')).toBe('Miles');
    expect(primarySelectValue(null, 'ent')).toBe('Entitlements');
  });

  it('an UNSET ARCH-discipline task defaults its primary to the DA (Ainsley)', () => {
    expect(resolvePrimaryAssignee(null, ctx, 'arch')).toBe('Ainsley');
    expect(primarySelectValue(null, 'arch')).toBe('Design Associate');
  });

  it('omitting discipline keeps the DA default (back-compat with pre-fix-230 callers)', () => {
    expect(resolvePrimaryAssignee(null, ctx)).toBe('Ainsley');
    expect(primarySelectValue(null)).toBe('Design Associate');
  });

  it('an EXPLICITLY-set assigned_to is untouched by discipline', () => {
    // A person, a team key, and a role all resolve the same regardless of column.
    expect(resolvePrimaryAssignee('Erick', ctx, 'ent')).toBe('Erick');
    expect(resolvePrimaryAssignee('Erick', ctx, 'arch')).toBe('Erick');
    expect(resolvePrimaryAssignee('Design Associate', ctx, 'ent')).toBe('Ainsley');
    expect(resolvePrimaryAssignee('Entitlements', ctx, 'arch')).toBe('Miles');
    expect(primarySelectValue('Erick', 'ent')).toBe('Erick');
    expect(primarySelectValue('Entitlements', 'arch')).toBe('Entitlements');
  });
});

// fix-231: shared dedupe for the assignee <select> option list. A role-labeled
// option that resolves to a person also in the static roster must not list that
// person twice — keep the role-labeled one, drop the bare static.
describe('fix-231 buildAssigneeOptions dedupe', () => {
  const roleOpts: AssigneeRoleOption[] = [
    { value: 'Entitlements', label: 'Entitlements · Miles', resolvedPerson: 'Miles' },
    { value: 'Design Associate', label: 'Design Associate · Jade', resolvedPerson: 'Jade' },
  ];

  it('drops a bare roster person a role option already resolves to; keeps the role option', () => {
    const { roleOptions, personOptions } = buildAssigneeOptions({
      roleOptions: roleOpts,
      personNames: ['Miles', 'Jade', 'Erick'],
    });
    // Miles + Jade are covered by role options → not repeated as bare persons.
    expect(personOptions).toEqual(['Erick']);
    // The informative role-labeled options survive untouched.
    expect(roleOptions.map((o) => o.label)).toEqual([
      'Entitlements · Miles',
      'Design Associate · Jade',
    ]);
    // Miles appears exactly once across the whole option set, and it's the role one.
    const all = [...roleOptions.map((o) => o.label), ...personOptions];
    expect(all.filter((l) => l.includes('Miles'))).toEqual(['Entitlements · Miles']);
  });

  it('never drops a role option in favor of a bare name', () => {
    const { roleOptions } = buildAssigneeOptions({
      roleOptions: roleOpts,
      personNames: ['Miles'],
    });
    expect(roleOptions).toHaveLength(2); // both role options intact
  });

  it('two colliding static entries → keep the first, drop the later duplicate', () => {
    const { personOptions } = buildAssigneeOptions({
      roleOptions: [],
      personNames: ['Erick', 'Jade', 'Erick', ' Jade '],
    });
    expect(personOptions).toEqual(['Erick', 'Jade']);
  });

  it('keepValue: a bare person that IS the current selection is kept even if a role resolves to them', () => {
    // The user explicitly stored the person "Miles"; the select must still offer
    // that bare option so it can reflect the stored value.
    const { personOptions } = buildAssigneeOptions({
      roleOptions: roleOpts,
      personNames: ['Miles', 'Erick'],
      keepValue: 'Miles',
    });
    expect(personOptions).toEqual(['Miles', 'Erick']);
  });

  it('a role option with no resolved person claims nobody (no false dedupe)', () => {
    const { personOptions } = buildAssigneeOptions({
      roleOptions: [{ value: 'Schematic Team', label: 'Schematic Team', resolvedPerson: null }],
      personNames: ['Miles', 'Jade'],
    });
    expect(personOptions).toEqual(['Miles', 'Jade']);
  });

  it('empty role options → the roster passes through unchanged (co-assignee path)', () => {
    const { personOptions } = buildAssigneeOptions({
      roleOptions: [],
      personNames: ['Miles', 'Jade', 'Erick'],
    });
    expect(personOptions).toEqual(['Miles', 'Jade', 'Erick']);
  });
});
