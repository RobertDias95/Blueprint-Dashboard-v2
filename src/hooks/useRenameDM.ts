import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';

// Q7.3.b: bp_rename_dm atomic cascade. Narrower than useRenameDA — DMs
// don't appear on permits.architect or permit_tasks.assigned_to, so the
// rename only touches team_members + dm_da_groups.dm_name + permits.dm.

export interface RenameDMResult {
  noop?: boolean;
  team_members?: number;
  dm_da_groups?: number;
  permits_dm?: number;
}

export function useRenameDM() {
  const queryClient = useQueryClient();
  return useMutation<RenameDMResult, Error, { oldName: string; newName: string }>({
    mutationFn: async ({ oldName, newName }) => {
      const { data, error } = await supabase.rpc('bp_rename_dm', {
        p_old: oldName,
        p_new: newName,
      });
      if (error) throw error;
      return (data as RenameDMResult) ?? {};
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembersAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.dmDaGroupsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
      if (result.noop) {
        pushToast('No-op (same name)', 'info');
        return;
      }
      const total =
        (result.team_members ?? 0) +
        (result.dm_da_groups ?? 0) +
        (result.permits_dm ?? 0);
      pushToast(
        `Renamed ${vars.oldName} → ${vars.newName} (${total} rows across 3 tables)`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Rename failed — ${error.message}`, 'error');
    },
  });
}
