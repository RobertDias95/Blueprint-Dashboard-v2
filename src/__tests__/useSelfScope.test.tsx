import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthStore } from '../stores/authStore';
import type { User } from '@supabase/supabase-js';
import type { TeamRole } from '../lib/database.types';

// fix-176: useScopeMode defaults each view to the logged-in user's own work,
// persists the manual switch per-user, and remembers it on remount.
// fix-179: scope is decided by REAL project-level assignments (mocked projects),
// not the roster role column — drive it via a mocked roster + projects + authStore.

const teamState = vi.hoisted(() => ({
  all: [] as { name: string; role: TeamRole; email: string | null }[],
  isLoading: false,
}));

const projectsState = vi.hoisted(() => ({
  data: [] as { entitlement_lead: string | null; design_manager: string | null }[],
  isLoading: false,
}));

const permitsState = vi.hoisted(() => ({
  data: [] as {
    ent_lead: string | null;
    dm: string | null;
    da: string | null;
    dual_da: string | null;
  }[],
  isLoading: false,
}));

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => teamState,
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => projectsState,
}));
// ★★ fix-428: useScopeMode asks whether the person is on any PERMIT before
// defaulting them to "My Work" — see widenScopeWhenUnassigned. Cam and Bobby
// are permit-scope in these fixtures precisely BECAUSE they lead no project,
// and fix-179's point was that their "My Work" is not empty. The permits below
// are what makes that true; without them fix-428 correctly widens both to
// Everyone. A person with NO permit is covered by its own test.
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => permitsState,
}));

import { useScopeMode } from '../hooks/useSelfScope';

const ROSTER = [
  { name: 'Miles', role: 'ent_lead' as TeamRole, email: 'miles@blueprintcap.com' },
  { name: 'Brittani', role: 'dm' as TeamRole, email: 'brittani@blueprintcap.com' },
  { name: 'Cam', role: 'da' as TeamRole, email: 'cameron@blueprintcap.com' },
  // Bobby holds the ent_lead ROLE but leads no project below → permit scope.
  { name: 'Bobby', role: 'ent_lead' as TeamRole, email: 'robertd@blueprintcap.com' },
];

// Miles leads a project (entitlement_lead); Brittani is a design_manager.
// Cam + Bobby lead NO project → permit scope.
const PROJECTS = [
  { entitlement_lead: 'Miles', design_manager: null },
  { entitlement_lead: null, design_manager: 'Brittani' },
];

// Cam works a permit as DA; Bobby is its ENT lead. Neither leads a project, so
// both are permit-scope — and fix-428 leaves permit-scope alone when there IS a
// permit.
const PERMITS = [
  { ent_lead: 'Bobby', dm: null, da: 'Cam', dual_da: null },
];

function loginAs(id: string, email: string | null) {
  useAuthStore.setState({ user: { id, email } as unknown as User });
}

beforeEach(() => {
  window.localStorage.clear();
  teamState.all = ROSTER;
  teamState.isLoading = false;
  projectsState.data = PROJECTS;
  projectsState.isLoading = false;
  permitsState.data = PERMITS;
  permitsState.isLoading = false;
  useAuthStore.setState({ user: null });
});

describe('useScopeMode — assignment-driven self-default', () => {
  it('a project lead defaults to MINE with project scope', () => {
    loginAs('u-miles', 'miles@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('projects'));
    expect(result.current.mode).toBe('mine');
    expect(result.current.identity.name).toBe('Miles');
    expect(result.current.identity.scope).toBe('project');
    expect(result.current.ready).toBe(true);
  });

  it('a design_manager lead defaults to MINE with project scope', () => {
    loginAs('u-britt', 'brittani@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('dashboard'));
    expect(result.current.mode).toBe('mine');
    expect(result.current.identity.scope).toBe('project');
  });

  it('a permit-only assignee defaults to MINE with permit scope', () => {
    loginAs('u-cam', 'cameron@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('mytasks'));
    expect(result.current.mode).toBe('mine');
    expect(result.current.identity.name).toBe('Cam');
    expect(result.current.identity.scope).toBe('permit');
  });

  // fix-179: the motivating bug — Bobby has the ent_lead ROLE but leads no
  // project, so he is PERMIT scope and his "My Work" is no longer empty.
  it('Bobby (ent_lead role, leads 0 projects) defaults to MINE with permit scope', () => {
    loginAs('u-bobby', 'robertd@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('dashboard'));
    expect(result.current.mode).toBe('mine');
    expect(result.current.identity.name).toBe('Bobby');
    expect(result.current.identity.scope).toBe('permit');
  });

  it('an unmapped login defaults to ALL with no roster name', () => {
    loginAs('u-lucas', 'lucas@blueprintcap.com');
    const { result } = renderHook(() => useScopeMode('projects'));
    expect(result.current.mode).toBe('all');
    expect(result.current.identity.name).toBeNull();
    expect(result.current.identity.scope).toBe('all');
  });

  it('switching to ALL persists and is remembered on remount', () => {
    loginAs('u-miles', 'miles@blueprintcap.com');
    const first = renderHook(() => useScopeMode('projects'));
    expect(first.result.current.mode).toBe('mine');
    act(() => first.result.current.setMode('all'));
    expect(first.result.current.mode).toBe('all');
    first.unmount();

    // Remount (e.g. navigating away + back) — the remembered "all" wins over
    // the role-aware default.
    const second = renderHook(() => useScopeMode('projects'));
    expect(second.result.current.mode).toBe('all');
  });

  it("a remembered choice is keyed per-user and does not leak to another login", () => {
    loginAs('u-miles', 'miles@blueprintcap.com');
    const a = renderHook(() => useScopeMode('projects'));
    act(() => a.result.current.setMode('all'));
    a.unmount();

    // A different login on the same browser still gets their own default.
    loginAs('u-cam', 'cameron@blueprintcap.com');
    const b = renderHook(() => useScopeMode('projects'));
    expect(b.result.current.mode).toBe('mine');
    expect(b.result.current.identity.scope).toBe('permit');
  });

  it('the switch is independent per view for the same user', () => {
    loginAs('u-miles', 'miles@blueprintcap.com');
    const proj = renderHook(() => useScopeMode('projects'));
    act(() => proj.result.current.setMode('all'));
    proj.unmount();

    // Dashboard hasn't been touched -> still defaults to mine.
    const dash = renderHook(() => useScopeMode('dashboard'));
    expect(dash.result.current.mode).toBe('mine');
  });
});
