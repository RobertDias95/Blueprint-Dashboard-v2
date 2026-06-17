import { useCallback, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTeamMembers } from './useTeamMembers';
import { useProjects } from './useProjects';
import {
  initialScopeMode,
  loadScopeMode,
  resolveRosterIdentity,
  saveScopeMode,
  type RosterIdentity,
  type ScopeMode,
  type SelfScopeView,
} from '../lib/selfScope';

// fix-176: resolve the logged-in user's roster identity (name + roles + scope)
// from team_members, and manage the per-view Mine/All toggle that defaults to
// the user's own work and remembers their manual switch per-user.

export interface UseSelfScopeResult {
  identity: RosterIdentity;
  userId: string | null;
  isLoading: boolean;
}

/** Current user's roster identity (assignment-driven scope), resolved by matching
 *  the auth email against team_members and then deciding scope from the loaded
 *  projects (fix-179). Unmapped users resolve to name=null / scope='all'.
 *
 *  useProjects() here subscribes to the SAME cached projects query the Dashboard /
 *  Project List already drive — React Query dedupes, so this adds no extra fetch
 *  where the data is already available. */
export function useSelfScope(): UseSelfScopeResult {
  const email = useAuthStore((s) => s.user?.email ?? null);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const team = useTeamMembers();
  const projectsQ = useProjects();

  const identity = useMemo(
    () => resolveRosterIdentity(email, team.all, projectsQ.data ?? []),
    [email, team.all, projectsQ.data],
  );

  // Wait for BOTH roster + projects before the scope is trustworthy: a
  // project-lead resolves to 'permit' until projects land, so gating here
  // prevents defaulting them to permit-scope for a frame.
  return {
    identity,
    userId,
    isLoading: team.isLoading || projectsQ.isLoading,
  };
}

export interface UseScopeModeResult {
  /** Effective mode to filter by. 'all' until the default resolves. */
  mode: ScopeMode;
  setMode: (mode: ScopeMode) => void;
  identity: RosterIdentity;
  /** True once the self-default / remembered choice has been applied. */
  ready: boolean;
}

/** Per-view Mine/All toggle. On first load (no remembered choice) it applies
 *  the role-aware self-default; once the user switches, the choice is persisted
 *  per-user and survives navigation. Unmapped users default to 'all'.
 *
 *  Derived (no effect): the effective mode is the user's in-session override if
 *  they've toggled, else their remembered choice from storage, else the
 *  role-aware default. Until the roster query settles we show 'all' so there's
 *  no flash of an under-scoped list. */
export function useScopeMode(view: SelfScopeView): UseScopeModeResult {
  const { identity, userId, isLoading } = useSelfScope();
  // The explicit choice made this mount; null until the user toggles.
  const [override, setOverride] = useState<ScopeMode | null>(null);

  // Remembered choice from a previous visit (null = never chosen). Re-read when
  // the user or view changes so a different login never inherits the choice.
  const stored = useMemo(
    () => loadScopeMode(userId, view),
    [userId, view],
  );

  const mode: ScopeMode =
    override ?? (isLoading ? 'all' : initialScopeMode(stored, identity.scope));

  const setMode = useCallback(
    (next: ScopeMode) => {
      setOverride(next);
      saveScopeMode(userId, view, next);
    },
    [userId, view],
  );

  return { mode, setMode, identity, ready: !isLoading };
}
