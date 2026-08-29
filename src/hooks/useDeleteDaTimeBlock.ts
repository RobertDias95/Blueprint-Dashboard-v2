import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { applyDeletedBlock } from '../lib/daTimeBlockCache';

// Q6.2.f: bp_delete_da_time_block_row. PK is text. Idempotent on
// missing rows (server returns deleted=true, conflict=false).

interface Row {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

export function useDeleteDaTimeBlock() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: string; updated_at: string }>({
    mutationFn: async ({ id, updated_at }) => {
      const { data, error } = await supabase.rpc(
        'bp_delete_da_time_block_row',
        { p_id: id, p_expected_updated_at: updated_at },
      );
      if (error) throw error;
      const row = (data as Row[])[0];
      if (row?.conflict) throw new OCCConflictError(0, 'Time block');
    },
    onSuccess: (_void, { id }) => {
      // ★★★ fix-442 (P-067): drop it from the grid now, on the SUCCESS path
      // only. A refused delete must leave the block where it is — showing it
      // gone while the database still holds it would be a worse lie than the
      // stale token this ticket is fixing.
      applyDeletedBlock(queryClient, tenantId, id);
      queryClient.invalidateQueries({ queryKey: queryKeys.daTimeBlocks(tenantId) });
      pushToast('Removed time block', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.daTimeBlocks(tenantId),
        });
      } else {
        pushToast(`Could not remove — ${error.message}`, 'error');
      }
    },
  });
}
