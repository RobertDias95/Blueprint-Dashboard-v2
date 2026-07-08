import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
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
    return {
      all,
      activeDas: allDas.filter((m) => !m.former),
      formerDas: allDas.filter((m) => m.former),
      dms: ofRole('dm'),
      ents: ofRole('ent'),
      acqs: ofRole('acq'),
      schematics: ofRole('schematic'),
    };
  }, [q.data]);

  return { ...q, ...result };
}
