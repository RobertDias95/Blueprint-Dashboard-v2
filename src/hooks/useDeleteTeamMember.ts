import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q7.3.b: bp_delete_team_member_row. Hard delete with OCC. Used for:
//   - × on DM/ENT/ACQ pills (no former-list parity for these roles)
//   - × on Former DA pills (permanent removal from the alumni section)
// DAs in the active list use useUpsertTeamMember({former: true}) instead.

interface Row {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

export function useDeleteTeamMember() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: string; updated_at: string }>({
    mutationFn: async ({ id, updated_at }) => {
      const { data, error } = await supabase.rpc('bp_delete_team_member_row', {
        p_id: id,
        p_expected_updated_at: updated_at,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (row?.conflict) throw new OCCConflictError(0, 'Team member');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(tenantId) });
      pushToast('Removed team member', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(tenantId) });
      } else {
        pushToast(`Could not remove team member — ${error.message}`, 'error');
      }
    },
  });
}
