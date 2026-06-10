import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-154: delete a per-jurisdiction target_submit override. The server RPC
// refuses to delete a Base row (jurisdiction null) and returns the rows-deleted
// count; we surface a warn toast if nothing was removed.

export function useDeleteTargetSubmitFormula() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, { type: string; jurisdiction: string }>({
    mutationFn: async ({ type, jurisdiction }) => {
      const { data, error } = await supabase.rpc(
        'bp_delete_target_submit_formula',
        { p_type: type, p_jurisdiction: jurisdiction },
      );
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (deleted) => {
      if (deleted === 0) {
        pushToast('Nothing to remove — Base rows cannot be deleted.', 'warn');
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.targetSubmitFormulas(tenantId),
      });
    },
    onError: (error) => {
      pushToast(`Could not remove override — ${error.message}`, 'error');
      queryClient.invalidateQueries({
        queryKey: queryKeys.targetSubmitFormulas(tenantId),
      });
    },
  });
}
