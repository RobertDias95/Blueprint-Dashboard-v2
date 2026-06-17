import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveRosterIdentity,
  projectMatchesSelf,
  permitMatchesSelf,
  taskMatchesSelf,
  loadScopeMode,
  saveScopeMode,
  initialScopeMode,
} from '../lib/selfScope';
import type { TeamRole } from '../lib/database.types';

// fix-176: the login -> roster -> discipline resolution + role-aware scope. The
// crux is that permit/project fields store NAMES while users log in by email;
// team_members.email bridges the two. These pin the bridge + Bobby's scope rule.

function m(name: string, role: TeamRole, email: string | null) {
  return { name, role, email };
}

// Mirrors the prod fill (fix_176_team_member_emails): a person can hold several
// rows; every row carries the same email.
const ROSTER = [
  m('Miles', 'ent', 'miles@blueprintcap.com'),
  m('Miles', 'ent_lead', 'miles@blueprintcap.com'),
  m('Briana', 'ent', 'briana@blueprintcap.com'),
  m('Briana', 'ent_lead', 'briana@blueprintcap.com'),
  m('Brittani', 'dm', 'brittani@blueprintcap.com'),
  m('Cam', 'da', 'cameron@blueprintcap.com'),
  m('Shire', 'da', 'smahdi@blueprintcap.com'),
  m('Bobby', 'ent', 'robertd@blueprintcap.com'),
  m('Bobby', 'ent_lead', 'robertd@blueprintcap.com'),
  // A roster name with NO email (most DAs in prod) — must never match a login.
  m('Trevor', 'da', null),
];

describe('resolveRosterIdentity — login -> roster name + role-aware scope', () => {
  it('ent_lead holder -> PROJECT scope', () => {
    const id = resolveRosterIdentity('miles@blueprintcap.com', ROSTER);
    expect(id.name).toBe('Miles');
    expect(id.scope).toBe('project');
    expect(id.roles.sort()).toEqual(['ent', 'ent_lead']);
  });

  it('design manager (dm) -> PROJECT scope', () => {
    const id = resolveRosterIdentity('brittani@blueprintcap.com', ROSTER);
    expect(id.name).toBe('Brittani');
    expect(id.scope).toBe('project');
    expect(id.roles).toEqual(['dm']);
  });

  it('design associate (da only) -> PERMIT scope', () => {
    const id = resolveRosterIdentity('cameron@blueprintcap.com', ROSTER);
    expect(id.name).toBe('Cam');
    expect(id.scope).toBe('permit');
    expect(id.roles).toEqual(['da']);
  });

  it('email match is case/space-insensitive', () => {
    const id = resolveRosterIdentity('  MILES@BlueprintCap.com ', ROSTER);
    expect(id.name).toBe('Miles');
    expect(id.scope).toBe('project');
  });

  it('a login with no roster row -> name=null, scope=all (safe fallback)', () => {
    const id = resolveRosterIdentity('lucas@blueprintcap.com', ROSTER);
    expect(id.name).toBeNull();
    expect(id.roles).toEqual([]);
    expect(id.scope).toBe('all');
  });

  it('empty/null email -> all', () => {
    expect(resolveRosterIdentity(null, ROSTER).scope).toBe('all');
    expect(resolveRosterIdentity('', ROSTER).scope).toBe('all');
  });

  it('never matches a roster row whose email is null', () => {
    // No login email is empty, but guard the inverse: a null-email roster row
    // must not be hit by an empty needle.
    const id = resolveRosterIdentity('', ROSTER);
    expect(id.name).toBeNull();
  });

  it('project scope wins the union when a person is both ent_lead AND da', () => {
    const roster = [
      m('Hybrid', 'da', 'hybrid@x.com'),
      m('Hybrid', 'ent_lead', 'hybrid@x.com'),
    ];
    const id = resolveRosterIdentity('hybrid@x.com', roster);
    expect(id.scope).toBe('project');
    expect(id.roles.sort()).toEqual(['da', 'ent_lead']);
  });
});

describe('scope match predicates', () => {
  it('projectMatchesSelf matches entitlement_lead OR design_manager (case-insensitive)', () => {
    expect(projectMatchesSelf({ entitlement_lead: 'Miles', design_manager: null }, 'miles')).toBe(true);
    expect(projectMatchesSelf({ entitlement_lead: null, design_manager: 'Brittani' }, 'Brittani')).toBe(true);
    expect(projectMatchesSelf({ entitlement_lead: 'Briana', design_manager: null }, 'Miles')).toBe(false);
    expect(projectMatchesSelf({ entitlement_lead: 'Miles', design_manager: null }, null)).toBe(false);
  });

  it('permitMatchesSelf matches da OR dual_da', () => {
    expect(permitMatchesSelf({ da: 'Cam', dual_da: null }, 'Cam')).toBe(true);
    expect(permitMatchesSelf({ da: 'Trevor', dual_da: 'Cam' }, 'cam')).toBe(true);
    expect(permitMatchesSelf({ da: 'Trevor', dual_da: null }, 'Cam')).toBe(false);
    expect(permitMatchesSelf({ da: null, dual_da: null }, 'Cam')).toBe(false);
  });

  it('taskMatchesSelf matches primary or co-assignee', () => {
    expect(taskMatchesSelf({ primary_assignee: 'Cam', co_assignees: [] }, 'Cam')).toBe(true);
    expect(taskMatchesSelf({ primary_assignee: 'X', co_assignees: ['Y', 'Cam'] }, 'cam')).toBe(true);
    expect(taskMatchesSelf({ primary_assignee: 'X', co_assignees: ['Y'] }, 'Cam')).toBe(false);
    expect(taskMatchesSelf({ primary_assignee: null, co_assignees: [] }, 'Cam')).toBe(false);
  });
});

describe('initialScopeMode — self-default vs remembered choice', () => {
  it('uses the role-aware default when nothing is remembered', () => {
    expect(initialScopeMode(null, 'project')).toBe('mine');
    expect(initialScopeMode(null, 'permit')).toBe('mine');
    expect(initialScopeMode(null, 'all')).toBe('all');
  });

  it('a remembered choice always wins over the default', () => {
    expect(initialScopeMode('all', 'project')).toBe('all');
    expect(initialScopeMode('mine', 'all')).toBe('mine');
  });
});

describe('per-user scope persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips a choice keyed per user + view', () => {
    saveScopeMode('user-1', 'projects', 'all');
    expect(loadScopeMode('user-1', 'projects')).toBe('all');
    // Different view for the same user is independent.
    expect(loadScopeMode('user-1', 'dashboard')).toBeNull();
  });

  it("one user's choice never leaks to another login", () => {
    saveScopeMode('user-1', 'dashboard', 'all');
    expect(loadScopeMode('user-2', 'dashboard')).toBeNull();
  });

  it('returns null (no remembered choice) for a fresh user/view', () => {
    expect(loadScopeMode('nobody', 'mytasks')).toBeNull();
  });

  it('no-ops without a user id', () => {
    saveScopeMode(null, 'projects', 'mine');
    expect(loadScopeMode(null, 'projects')).toBeNull();
  });
});
