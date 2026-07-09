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
