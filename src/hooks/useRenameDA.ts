import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';

// Q7.3.b: bp_rename_da atomic cascade. Updates the DA name across
// team_members + dm_da_groups + permits.da + permits.architect +
// permit_tasks.assigned_to + da_time_blocks.da_name in one transaction
// (server-verified end-to-end before this hook landed). Returns the
// per-table row counts as JSONB so the toast can confirm reach.

export interface RenameDAResult {
  noop?: boolean;
  team_members?: number;
  dm_da_groups?: number;
  permits_da?: number;
  permits_arch?: number;
  permit_tasks?: number;
  da_time_blocks?: number;
}

export function useRenameDA() {
  const queryClient = useQueryClient();
  return useMutation<RenameDAResult, Error, { oldName: string; newName: string }>({
    mutationFn: async ({ oldName, newName }) => {
      const { data, error } = await supabase.rpc('bp_rename_da', {
        p_old: oldName,
        p_new: newName,
      });
      if (error) throw error;
      return (data as RenameDAResult) ?? {};
    },
    onSuccess: (result, vars) => {
      // Every cascaded table can have stale caches; invalidate the lot.
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembersAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.dmDaGroupsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.daTimeBlocksAll });
      if (result.noop) {
        pushToast('No-op (same name)', 'info');
        return;
      }
      const total =
        (result.team_members ?? 0) +
        (result.dm_da_groups ?? 0) +
        (result.permits_da ?? 0) +
        (result.permits_arch ?? 0) +
        (result.permit_tasks ?? 0) +
        (result.da_time_blocks ?? 0);
      pushToast(
        `Renamed ${vars.oldName} → ${vars.newName} (${total} rows across 6 tables)`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Rename failed — ${error.message}`, 'error');
    },
  });
}
