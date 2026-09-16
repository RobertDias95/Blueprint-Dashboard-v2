import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict, occToken } from '../lib/occ';
import { occRowKey, occSerialize } from '../lib/occQueue';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { applyDeletedBlock, currentBlockToken } from '../lib/daTimeBlockCache';

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
    // ★ fix-511 §C — see useUpsertDaTimeBlock.
    meta: { write: 'bp_delete_da_time_block_row' },
    mutationFn: async ({ id, updated_at }) =>
      // ★★ fix-581: the cache read is the SEED — the popup's Remove button
      //    posts `npPopup.block.updated_at`, held for as long as the popup has
      //    been open. ★★★ fix-584 §B: and the serializer is what makes it right
      //    even while another write on this block is still in flight, which the
      //    cache cannot be.
      occSerialize(
        occRowKey('da_time_blocks', id),
        occToken(currentBlockToken(queryClient, tenantId, id, updated_at)),
        async (expected) => {
        const value = await (async () => {
      const { data, error } = await supabase.rpc(
        'bp_delete_da_time_block_row',
        { p_id: id, p_expected_updated_at: expected },
      );
      if (error) throw error;
      const row = (data as Row[])[0];
      if (row?.conflict) throw new OCCConflictError(0, 'Time block');
        })();
        return { value, token: undefined };
      }),
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
