import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-182b: bp_delete_quarter_layout_row. Remove a single column with OCC.
// Mirrors useDeleteDmDaGroup. The caller passes the quarter so the right
// cache key is invalidated.

interface Row {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

export function useDeleteQuarterLayoutRow() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<
    void,
    Error,
    { id: string; updated_at: string; quarter: string }
  >({
    mutationFn: async ({ id, updated_at }) => {
      const { data, error } = await supabase.rpc('bp_delete_quarter_layout_row', {
        p_id: id,
        p_expected_updated_at: updated_at,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (row?.conflict) throw new OCCConflictError(0, 'Quarter layout');
    },
    onSuccess: (_void, { quarter }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, quarter),
      });
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(
          'Layout was modified by someone else — refresh and retry',
          'warn',
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.drawScheduleQuarterLayoutAll,
        });
      } else {
        pushToast(`Could not remove column — ${error.message}`, 'error');
      }
    },
  });
}
