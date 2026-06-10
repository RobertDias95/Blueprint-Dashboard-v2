import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-153: drag-handle reordering for the task-template editor. Takes the
// full ordered list of template ids for one scope and writes each id's new
// 0-based position as sort_order in a single round-trip via
// bp_reorder_task_templates. Replaces the old per-swap up/down arrow calls.

/** Pure reorder of a scope's id list — moves activeId into overId's slot.
 *  Mirrors @dnd-kit's drop semantics; kept here (not in the component) so the
 *  component file only exports components for react-refresh. */
export function reorderTemplateIds(
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

export function useReorderTaskTemplates() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { ids: string[] }>({
    mutationFn: async ({ ids }) => {
      const { error } = await supabase.rpc('bp_reorder_task_templates', {
        p_ids: ids,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTemplates(tenantId),
      });
    },
    onError: (error) => {
      pushToast(`Could not reorder templates — ${error.message}`, 'error');
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTemplates(tenantId),
      });
    },
  });
}
