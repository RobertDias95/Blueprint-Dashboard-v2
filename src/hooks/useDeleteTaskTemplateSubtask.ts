import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q7.3.c: bp_delete_task_template_subtask_row.

interface Row {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

export function useDeleteTaskTemplateSubtask() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: string; updated_at: string }>({
    mutationFn: async ({ id, updated_at }) => {
      const { data, error } = await supabase.rpc(
        'bp_delete_task_template_subtask_row',
        { p_id: id, p_expected_updated_at: updated_at },
      );
      if (error) throw error;
      const row = (data as Row[])[0];
      if (row?.conflict) throw new OCCConflictError(0, 'Subtask');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTemplateSubtasks(tenantId),
      });
      pushToast('Removed subtask', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.taskTemplateSubtasks(tenantId),
        });
      } else {
        pushToast(`Could not remove — ${error.message}`, 'error');
      }
    },
  });
}
