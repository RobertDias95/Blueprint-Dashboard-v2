import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { TaskTemplateSubtask } from '../lib/database.types';

// Q7.3.c: bp_upsert_task_template_subtask_row. INSERT (parent template_id
// required) or UPDATE (text/sort_order with OCC).

type EditableField = 'template_id' | 'text' | 'sort_order';
export type SubtaskPatch = Partial<Pick<TaskTemplateSubtask, EditableField>>;

export type UpsertSubtaskInput =
  | { op: 'insert'; patch: SubtaskPatch & { template_id: string; text: string } }
  | { op: 'update'; subtask: TaskTemplateSubtask; patch: SubtaskPatch };

interface Row {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

function buildPayload(
  base: Partial<TaskTemplateSubtask>,
  patch: SubtaskPatch,
): Record<string, string | number | null> {
  const merged = { ...base, ...patch };
  return {
    template_id: merged.template_id ?? '',
    text: merged.text ?? '',
    sort_order: merged.sort_order ?? 0,
  };
}

export function useUpsertTaskTemplateSubtask() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<TaskTemplateSubtask, Error, UpsertSubtaskInput>({
    mutationFn: async (input) => {
      if (input.op === 'insert') {
        const payload = buildPayload({}, input.patch);
        const { data, error } = await supabase.rpc(
          'bp_upsert_task_template_subtask_row',
          { p_id: null, p_data: payload, p_expected_updated_at: null },
        );
        if (error) throw error;
        const row = (data as Row[])[0];
        if (!row) throw new Error('Insert returned no row');
        return {
          id: row.out_id,
          template_id: payload.template_id as string,
          text: payload.text as string,
          sort_order: payload.sort_order as number,
          updated_at: row.updated_at,
        };
      }
      const payload = buildPayload(input.subtask, input.patch);
      const { data, error } = await supabase.rpc(
        'bp_upsert_task_template_subtask_row',
        {
          p_id: input.subtask.id,
          p_data: payload,
          p_expected_updated_at: input.subtask.updated_at,
        },
      );
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Update returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Subtask');
      return { ...input.subtask, ...input.patch, updated_at: row.updated_at };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTemplateSubtasks(tenantId),
      });
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.taskTemplateSubtasks(tenantId),
        });
      } else {
        pushToast(`Could not save subtask — ${error.message}`, 'error');
      }
    },
  });
}
