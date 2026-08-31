import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { useTeamMembers } from './useTeamMembers';
import { useSelfScope } from './useSelfScope';

// ===========================================================================
// ★★★ fix-462 §B (P-045) — AGENDA MEMBERSHIP
// ===========================================================================
//
// Bobby, 2026-08-30: membership is a **per-person checkbox, not a department**.
// Department was offered and rejected — gating by department means adding one
// person to the meeting moves their whole department, or you make an exception
// anyway and the gate stops meaning anything.
//
// ★★★ IT IS NOT A PERMISSION. It decides who sees ONE ribbon entry. Nothing
// else in the app reads it, the Agenda route is not guarded, and admin/editor
// gating stays exactly where it is (`profiles.role`). [[P-026]] stays parked.

/**
 * ★★ Is the signed-in person on the agenda?
 *
 * ★★★ RESOLVED THROUGH THE ROSTER, NOT THROUGH `profiles`. The roster is where
 * a person's identity lives (`team_members.name` is the join key and there is
 * no people table), and `useSelfScope` already does the email→roster resolution
 * every other self-scoped surface uses. Inventing a second resolution here is
 * how two screens start disagreeing about who you are.
 *
 * ★ ORed across the person's rows, like fix-298's `is_oversight`. The database
 * trigger keeps them in agreement, so the OR is belt-and-braces rather than a
 * tiebreak — and it means a stale cache mid-write reads "member" rather than
 * flickering the entry away.
 */
export function useIsAgendaMember(): boolean {
  const { identity } = useSelfScope();
  const team = useTeamMembers();
  return useMemo(() => {
    const me = (identity.name ?? '').trim().toLowerCase();
    if (me === '') return false;
    return team.all.some(
      (m) => (m.name ?? '').trim().toLowerCase() === me && m.agenda_member === true,
    );
  }, [identity.name, team.all]);
}

/** Every person on the agenda, by name — for the Settings panel's summary and
 *  for anything that needs to say who is in the meeting. */
export function useAgendaMemberNames(): string[] {
  const team = useTeamMembers();
  return useMemo(() => {
    const names = new Set<string>();
    for (const m of team.all) {
      if (m.agenda_member === true && (m.name ?? '').trim() !== '') {
        names.add(m.name.trim());
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [team.all]);
}

/**
 * ★★ Set membership for a PERSON.
 *
 * ★★★ BY NAME, NEVER BY ROW ID — the unit of membership is the person, and an
 * id would invite a caller to think in role rows, which is the mistake the
 * database trigger exists to make impossible. fix-461's `useSetTeamDepartment`
 * shape exactly, for the same reasons: invoker rights, because
 * `team_members_tenant_admin_write` already gates every verb on
 * `is_tenant_admin(tenant_id)`, so the DATABASE refuses a non-admin and
 * `readOnly` only hides the buttons.
 */
export function useSetAgendaMember() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, { name: string; member: boolean }>({
    mutationFn: async ({ name, member }) => {
      const { data, error } = await supabase.rpc('bp_set_team_agenda_member', {
        p_name: name,
        p_member: member,
      });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: (rows, { name, member }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(tenantId) });
      // ★ Saying how many rows moved is how somebody sees that ticking Dave
      //   moved BOTH his roster rows — the mechanism doing its job in public.
      pushToast(
        `${member ? 'Added' : 'Removed'} ${name}${rows > 1 ? ` (${rows} roster rows)` : ''}`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not change agenda membership — ${error.message}`, 'error');
    },
  });
}
