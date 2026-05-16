import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-25-feat-b: bp_update_team_member_quarters. Dedicated OCC-aware
// update for the (active_start_quarter, active_end_quarter) range on a
// team_members row. Kept separate from bp_upsert_team_member_row so the
// roster edit path (name / role / former / etc.) stays unchanged.

export interface UpdateTeamMemberQuartersInput {
  memberId: string;
  /** 'YYYY-Qn' string, or null to clear (open-ended). */
  activeStart: string | null;
  activeEnd: string | null;
  expectedUpdatedAt: string;
}

interface RpcRow {
  out_id: string;
  out_updated_at: string | null;
  out_conflict: boolean;
}

export interface UpdateTeamMemberQuartersResult {
  memberId: string;
  updatedAt: string | null;
}

export function useUpdateTeamMemberQuarters() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<
    UpdateTeamMemberQuartersResult,
    Error,
    UpdateTeamMemberQuartersInput
  >({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_update_team_member_quarters',
        {
          p_id: input.memberId,
          p_active_start: input.activeStart,
          p_active_end: input.activeEnd,
          p_expected_updated_at: input.expectedUpdatedAt,
        },
      );
      if (error) throw error;
      const row = (data as RpcRow[])[0];
      if (!row) throw new Error('Update RPC returned no row');
      if (row.out_conflict) {
        throw new OCCConflictError(0, 'Team member');
      }
      return { memberId: row.out_id, updatedAt: row.out_updated_at };
    },

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.teamMembers(tenantId),
      });
      pushToast('Saved active quarters', 'success');
    },

    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(
          'Team member was modified by someone else — refresh and retry',
          'warn',
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.teamMembers(tenantId),
        });
      } else {
        pushToast(`Could not save quarters — ${error.message}`, 'error');
      }
    },
  });
}
