import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveRosterIdentity,
  deriveSelfScope,
  projectMatchesSelf,
  permitMatchesSelf,
  taskMatchesSelf,
  loadScopeMode,
  saveScopeMode,
  initialScopeMode,
} from '../lib/selfScope';
import type { TeamRole } from '../lib/database.types';

// fix-176: login -> roster name bridge (team_members.email). fix-179: the SCOPE
// tier is decided by REAL project-level assignments, not the roster role column —
// a per-permit lead (e.g. Bobby: 'ent_lead' role but leads 0 projects) is
// permit-scoped, not project-scoped.

function m(name: string, role: TeamRole, email: string | null) {
  return { name, role, email };
}

function proj(entitlement_lead: string | null, design_manager: string | null = null) {
  return { entitlement_lead, design_manager };
}

// Mirrors the prod fill (fix_176_team_member_emails): a person can hold several
// rows; every row carries the same email. NOTE the role column here deliberately
// does NOT match the scope outcome (Bobby is 'ent_lead' yet permit-scoped) —
// that's the whole point of fix-179.
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

// Prod-shaped: Miles / Briana lead projects (entitlement_lead); Brittani is a
// design_manager on a project. Bobby / Cam / Shire lead NO project (they're
// per-permit only) → permit scope.
const PROJECTS = [
  proj('Miles', null),
  proj('Briana', null),
  proj(null, 'Brittani'),
  proj('Miles', 'Brittani'),
];

describe('resolveRosterIdentity — assignment-driven scope (fix-179)', () => {
  it('a project-level entitlement_lead -> PROJECT scope', () => {
    const id = resolveRosterIdentity('miles@blueprintcap.com', ROSTER, PROJECTS);
    expect(id.name).toBe('Miles');
    expect(id.scope).toBe('project');
    expect(id.roles.sort()).toEqual(['ent', 'ent_lead']);
  });

  it('a project-level design_manager -> PROJECT scope', () => {
    const id = resolveRosterIdentity('brittani@blueprintcap.com', ROSTER, PROJECTS);
    expect(id.name).toBe('Brittani');
    expect(id.scope).toBe('project');
  });

  it('mapped name with only permit assignments (leads no project) -> PERMIT scope', () => {
    const id = resolveRosterIdentity('cameron@blueprintcap.com', ROSTER, PROJECTS);
    expect(id.name).toBe('Cam');
    expect(id.scope).toBe('permit');
  });

  // The motivating bug: Bobby holds the 'ent_lead' ROLE but leads ZERO projects
  // at the project level → must be PERMIT scope, not project (which matched
  // nothing and left his "My Work" empty under fix-176).
  it('Bobby-shaped: ent_lead role but 0 project-level lead rows -> PERMIT scope', () => {
    const id = resolveRosterIdentity('robertd@blueprintcap.com', ROSTER, PROJECTS);
    expect(id.name).toBe('Bobby');
    expect(id.roles).toContain('ent_lead');
    expect(id.scope).toBe('permit');
  });

  it('email match is case/space-insensitive', () => {
    const id = resolveRosterIdentity('  MILES@BlueprintCap.com ', ROSTER, PROJECTS);
    expect(id.name).toBe('Miles');
    expect(id.scope).toBe('project');
  });

  it('a login with no roster row -> name=null, scope=all (safe fallback)', () => {
    const id = resolveRosterIdentity('lucas@blueprintcap.com', ROSTER, PROJECTS);
    expect(id.name).toBeNull();
    expect(id.roles).toEqual([]);
    expect(id.scope).toBe('all');
  });

  it('empty/null email -> all', () => {
    expect(resolveRosterIdentity(null, ROSTER, PROJECTS).scope).toBe('all');
    expect(resolveRosterIdentity('', ROSTER, PROJECTS).scope).toBe('all');
  });

  it('never matches a roster row whose email is null', () => {
    const id = resolveRosterIdentity('', ROSTER, PROJECTS);
    expect(id.name).toBeNull();
  });

  it('a project-lead with no projects loaded yet resolves to permit (until projects land)', () => {
    // Transient: before the projects query resolves, even Miles reads permit —
    // the view re-derives once projects load. Pinned so the behavior is intended.
    const id = resolveRosterIdentity('miles@blueprintcap.com', ROSTER, []);
    expect(id.name).toBe('Miles');
    expect(id.scope).toBe('permit');
  });
});

describe('deriveSelfScope (fix-179)', () => {
  it('project when the name leads ≥1 project', () => {
    expect(deriveSelfScope('Miles', PROJECTS)).toBe('project');
    expect(deriveSelfScope('Brittani', PROJECTS)).toBe('project');
  });
  it('permit when mapped but leads no project', () => {
    expect(deriveSelfScope('Bobby', PROJECTS)).toBe('permit');
    expect(deriveSelfScope('Cam', PROJECTS)).toBe('permit');
  });
  it('all when name is null/empty (unmapped)', () => {
    expect(deriveSelfScope(null, PROJECTS)).toBe('all');
    expect(deriveSelfScope('', PROJECTS)).toBe('all');
  });
});

describe('scope match predicates', () => {
  it('projectMatchesSelf matches entitlement_lead OR design_manager (case-insensitive)', () => {
    expect(projectMatchesSelf({ entitlement_lead: 'Miles', design_manager: null }, 'miles')).toBe(true);
    expect(projectMatchesSelf({ entitlement_lead: null, design_manager: 'Brittani' }, 'Brittani')).toBe(true);
    expect(projectMatchesSelf({ entitlement_lead: 'Briana', design_manager: null }, 'Miles')).toBe(false);
    expect(projectMatchesSelf({ entitlement_lead: 'Miles', design_manager: null }, null)).toBe(false);
  });

  // fix-180: a permit is "mine" if my name is in ANY of its role fields —
  // ent_lead / dm / da / dual_da. Bobby is a permit-level ent_lead (da on 0).
  it('permitMatchesSelf matches ent_lead / dm / da / dual_da (case-insensitive)', () => {
    const none = { ent_lead: null, dm: null, da: null, dual_da: null };
    // ent_lead — the Bobby case that was previously missed.
    expect(permitMatchesSelf({ ...none, ent_lead: 'Bobby' }, 'Bobby')).toBe(true);
    expect(permitMatchesSelf({ ...none, ent_lead: 'Bobby' }, 'bobby')).toBe(true);
    // dm
    expect(permitMatchesSelf({ ...none, dm: 'Brittani' }, 'brittani')).toBe(true);
    // da + dual_da (DAs unchanged)
    expect(permitMatchesSelf({ ...none, da: 'Cam' }, 'Cam')).toBe(true);
    expect(permitMatchesSelf({ ...none, da: 'Trevor', dual_da: 'Cam' }, 'cam')).toBe(true);
    // name in none of the four roles → false
    expect(permitMatchesSelf({ ...none, da: 'Trevor', ent_lead: 'Miles' }, 'Cam')).toBe(false);
    expect(permitMatchesSelf(none, 'Cam')).toBe(false);
    // null/empty name never matches
    expect(permitMatchesSelf({ ...none, ent_lead: 'Bobby' }, null)).toBe(false);
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
