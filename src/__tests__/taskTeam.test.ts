import { describe, it, expect } from 'vitest';
import {
  TEAM_OPTIONS,
  migrateArchitectureTeam,
  roleToken,
  parseCoAssignee,
  isRoleToken,
  coAssigneeLabel,
  DYNAMIC_ROLE_LABELS,
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
