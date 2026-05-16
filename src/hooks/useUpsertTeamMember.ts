import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { TeamMember } from '../lib/database.types';

// Q7.3.b: row-level OCC upsert via bp_upsert_team_member_row. Same shape
// as useUpsertPermitTask — INSERT when p_id is NULL, otherwise UPDATE
// with the expected_updated_at OCC token.
//
// Used for: × on DA pills (patch {former: true} for the soft-delete-to-
// former-list path), × on Former DA "restore" (patch {former: false}),
// and ENT/ACQ rename (patch {name}). DA/DM renames use the dedicated
// useRenameDA / useRenameDM hooks instead (they cascade across schema).

type EditableField = 'name' | 'role' | 'active' | 'former' | 'email' | 'notes';
export type TeamMemberPatch = Partial<Pick<TeamMember, EditableField>>;

export type UpsertTeamMemberInput =
  | { op: 'insert'; patch: TeamMemberPatch & { name: string; role: TeamMember['role'] } }
  | { op: 'update'; member: TeamMember; patch: TeamMemberPatch };

interface Row {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

function buildPayload(
  base: Partial<TeamMember>,
  patch: TeamMemberPatch,
): Record<string, string | boolean | null> {
  const merged = { ...base, ...patch };
  return {
    name: merged.name ?? '',
    role: merged.role ?? 'da',
    active: merged.active ?? true,
    former: merged.former ?? false,
    email: merged.email ?? null,
    notes: merged.notes ?? null,
  };
}

export function useUpsertTeamMember() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<TeamMember, Error, UpsertTeamMemberInput>({
    mutationFn: async (input) => {
      if (input.op === 'insert') {
        const payload = buildPayload({}, input.patch);
        const { data, error } = await supabase.rpc('bp_upsert_team_member_row', {
          p_id: null,
          p_data: payload,
          p_expected_updated_at: null,
        });
        if (error) throw error;
        const row = (data as Row[])[0];
        if (!row) throw new Error('Insert returned no row');
        return {
          id: row.out_id,
          name: payload.name as string,
          role: payload.role as TeamMember['role'],
          active: payload.active as boolean,
          former: payload.former as boolean,
          email: payload.email as string | null,
          notes: payload.notes as string | null,
          updated_at: row.updated_at,
          // fix-25-feat-b: inserts default to open-ended (always active).
          active_start_quarter: null,
          active_end_quarter: null,
        };
      }
      const payload = buildPayload(input.member, input.patch);
      const { data, error } = await supabase.rpc('bp_upsert_team_member_row', {
        p_id: input.member.id,
        p_data: payload,
        p_expected_updated_at: input.member.updated_at,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Update returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Team member');
      return { ...input.member, ...input.patch, updated_at: row.updated_at };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(tenantId) });
      pushToast('Saved team member', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(tenantId) });
      } else {
        pushToast(`Could not save team member — ${error.message}`, 'error');
      }
    },
  });
}
