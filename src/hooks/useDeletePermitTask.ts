import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { PermitTask } from '../lib/database.types';

// Q4: Row-level OCC delete for permit_tasks via bp_delete_permit_task_row.

export interface DeleteTaskInput {
  task: PermitTask;
  permitId: number;
}

interface MutationContext {
  snapshot: PermitTask[] | undefined;
}

export function useDeletePermitTask() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<void, Error, DeleteTaskInput, MutationContext>({
    mutationFn: async ({ task, permitId }) => {
      const { data, error } = await supabase.rpc('bp_delete_permit_task_row', {
        p_id: task.id,
        p_expected_updated_at: task.updated_at,
      });
      if (error) throw error;
      const row = (
        data as {
          deleted: boolean;
          conflict: boolean;
          current_updated_at: string | null;
        }[]
      )[0];
      if (!row) throw new Error('Delete returned no row');
      if (row.conflict) {
        throw new OCCConflictError(permitId, 'Task');
      }
    },

    onMutate: async ({ task, permitId }) => {
      const key = queryKeys.permitTasksFor(tenantId, permitId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<PermitTask[]>(key);
      queryClient.setQueryData<PermitTask[]>(
        key,
        (snapshot ?? []).filter((t) => t.id !== task.id),
      );
      return { snapshot };
    },

    onError: (error, input, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.permitTasksFor(tenantId, input.permitId),
          context.snapshot,
        );
      }
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.permitTasksFor(tenantId, input.permitId),
        });
      } else {
        pushToast(`Could not delete task — ${error.message}`, 'error');
      }
    },

    onSuccess: () => {
      pushToast('Deleted task', 'success');
    },
  });
}
