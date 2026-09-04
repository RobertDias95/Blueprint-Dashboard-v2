import { useCallback, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTeamMembers } from './useTeamMembers';
import { useProjects } from './useProjects';
import { usePermits } from './usePermits';
import {
  initialScopeMode,
  loadScopeMode,
  resolveRosterIdentity,
  saveScopeMode,
  widenScopeWhenUnassigned,
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
 *  no flash of an under-scoped list.
 *
 * ---------------------------------------------------------------------------
 * ★★★ fix-428 — WHY THE PERMITS QUERY IS HERE AND NOT IN `useSelfScope`
 * ---------------------------------------------------------------------------
 *
 * The widening needs to know whether this person is on any PERMIT. The obvious
 * place to ask is `useSelfScope`, next to the projects query it already drives.
 * That would be a serious mistake:
 *
 *   `useSelfScope` is called by **Chrome.tsx**, which renders on EVERY screen,
 *   and by useBoardLens, useBoardNotifications, MyBoard and PersonalBoard —
 *   five callers, none of which load permits. Putting `usePermits()` there
 *   makes every page in the app fetch every permit with its nested cycles, to
 *   decide a toggle those pages do not have. `useShowHeldWork.ts` already
 *   carries a comment warning about exactly this trap.
 *
 * `useScopeMode` is used ONLY by the surfaces that render the toggle —
 * Dashboard, ProjectList, MyTasks' MineTasks body, and WaitingOnView — and the
 * first three already call `usePermits()` themselves. React Query dedupes onto
 * the same cached query, so on those three this costs ZERO new fetches: the
 * same argument the `useProjects()` note above makes.
 *
 * ★★ THE ONE HONEST EXCEPTION, and the brief's STEP 0 #8 was slightly off
 * about it: `MyTasks()` the page does NOT call `usePermits()` — its two calls
 * live in the `MineTasks` body. So Waiting On gains one subscription to the
 * shared permits query. One surface, to a query the rest of the app keeps warm
 * — against making every page in the product fetch it. Recorded rather than
 * glossed over.
 *
 * ★★★ fix-499 §D UPDATED THIS NOTE RATHER THAN DELETING IT, and the update is
 * the point: WaitingOnView is no longer the SIBLING of `MineTasks` in a
 * ternary. It is its own report at `/reports/waiting-on`, so it does not share
 * a mount with anything that already holds the permits query — the exception
 * got slightly more expensive, not less, and it is still worth it. It keeps the
 * SAME `'mytasks'` persistence key on purpose: a person's Mine/All choice must
 * not fork just because the screen moved address.
 *
 * ★ `identity.scope` itself is NOT widened. RosterIdentity keeps fix-179's
 *   meaning for every existing reader (the fix-343 name plate, the board lens,
 *   PersonalBoard); only the toggle's DEFAULT is computed from the wider
 *   question. */
export function useScopeMode(view: SelfScopeView): UseScopeModeResult {
  const { identity, userId, isLoading } = useSelfScope();
  const permitsQ = usePermits();
  // The explicit choice made this mount; null until the user toggles.
  const [override, setOverride] = useState<ScopeMode | null>(null);

  // Remembered choice from a previous visit (null = never chosen). Re-read when
  // the user or view changes so a different login never inherits the choice.
  const stored = useMemo(
    () => loadScopeMode(userId, view),
    [userId, view],
  );

  // ★ fix-428: the tier `deriveSelfScope` reached from projects alone, asked
  //   again against permits. Memoised on the query's own data reference so a
  //   render that changes nothing re-scans nothing.
  const effectiveScope = useMemo(
    () => widenScopeWhenUnassigned(identity.scope, identity.name, permitsQ.data ?? []),
    [identity.scope, identity.name, permitsQ.data],
  );

  // ★★ THE PERMITS QUERY IS FOLDED INTO THE SAME GUARD, not checked after it.
  //    A permit-scoped person shown Everyone for one frame and then snapped to
  //    My Work is the flinch fix-324 and fix-403's lazy-initialiser discipline
  //    exists to prevent — and it would be a NEW flinch introduced by this
  //    ticket, on the people the ticket is not even about.
  const resolving = isLoading || permitsQ.isLoading;

  const mode: ScopeMode =
    override ?? (resolving ? 'all' : initialScopeMode(stored, effectiveScope));

  const setMode = useCallback(
    (next: ScopeMode) => {
      setOverride(next);
      saveScopeMode(userId, view, next);
    },
    [userId, view],
  );

  return { mode, setMode, identity, ready: !resolving };
}
