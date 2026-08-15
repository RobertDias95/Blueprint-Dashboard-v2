import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { isCurrentMember } from '../lib/roster';
import type { TeamMember, TeamRole } from '../lib/database.types';

// Q7.3.b: read team_members for the active tenant. Returns the full set
// + memoized role-bucketed views so AdminTeamTab can render its 4 pill
// lists (DAs, DMs, ENTs, ACQs) + Former DAs section without re-filtering.

export interface TeamMembersResult {
  all: TeamMember[];
  activeDas: TeamMember[];
  formerDas: TeamMember[];
  dms: TeamMember[];
  ents: TeamMember[];
  acqs: TeamMember[];
  /** fix-222: the Schematic Team roster — sources the New Project wizard's
   *  Schematic Designer picker + the Schematic Team admin section. */
  schematics: TeamMember[];
  /** fix-233: the distinct display names of CURRENT team members (active and not
   *  former), sorted A→Z — the single source for the task assignee people-pickers
   *  so departed staff never appear as selectable options. */
  activeMemberNames: string[];
}

/** fix-233: derive the distinct names of CURRENT team members, sorted A→Z,
 *  deduped (team_members has one row per role, so a person holding several roles
 *  would otherwise repeat). The ONE definition the task assignee dropdowns
 *  (primary + co-assignee) source their roster from.
 *
 *  ★ fix-321: the membership test moved to `isCurrentMember` in lib/roster and
 *  this calls it — same rule as before (`active !== false && former !== true`),
 *  now shared with every other picker instead of being this hook's private
 *  answer. Two pickers disagreeing about who is on the team is the drift #79
 *  exists to remove. */
export function activeMemberNamesOf(
  members: readonly TeamMember[] | null | undefined,
): string[] {
  return [
    ...new Set(
      (members ?? [])
        .filter(isCurrentMember)
        .map((m) => m.name)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export function useTeamMembers() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<TeamMember[]>({
    queryKey: queryKeys.teamMembers(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select(
          'id, name, role, active, former, email, notes, updated_at, active_start_quarter, active_end_quarter',
        )
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TeamMember[];
    },
  });

  const result = useMemo<TeamMembersResult>(() => {
    const all = q.data ?? [];
    function ofRole(role: TeamRole) {
      return all.filter((m) => m.role === role);
    }
    const allDas = ofRole('da');
    // ★ fix-321: both lists split on the SHARED rule. activeDas used to test
    // `!former` alone, so a DA flagged active=false but not former counted as
    // active here and as departed in the assignee dropdowns — the same person,
    // two answers. One predicate now decides for every picker in the app.
    return {
      all,
      activeDas: allDas.filter(isCurrentMember),
      formerDas: allDas.filter((m) => !isCurrentMember(m)),
      dms: ofRole('dm'),
      ents: ofRole('ent'),
      acqs: ofRole('acq'),
      schematics: ofRole('schematic'),
      activeMemberNames: activeMemberNamesOf(all),
    };
  }, [q.data]);

  return { ...q, ...result };
}
