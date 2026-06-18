import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-182b: bp_reorder_quarter_layout. Takes the FULL ordered id list for a
// quarter and writes each id's new 0-based position in one round-trip.
// Mirrors useReorderTaskTemplates (incl. the pure dnd-kit reorder helper).

/** Pure reorder of a quarter's id list — moves activeId into overId's slot.
 *  Mirrors @dnd-kit's drop semantics; kept here (not in the component) so the
 *  component file only exports components for react-refresh. */
export function reorderLayoutIds(
  ids: string[],
  activeId: string,
  overId: string,
): string[] {
  if (activeId === overId) return ids;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

export function useReorderQuarterLayout() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { quarter: string; ids: string[] }>({
    mutationFn: async ({ quarter, ids }) => {
      const { error } = await supabase.rpc('bp_reorder_quarter_layout', {
        p_quarter: quarter,
        p_ids: ids,
      });
      if (error) throw error;
    },
    onSuccess: (_void, { quarter }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, quarter),
      });
    },
    onError: (error, { quarter }) => {
      pushToast(`Could not reorder columns — ${error.message}`, 'error');
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, quarter),
      });
    },
  });
}
