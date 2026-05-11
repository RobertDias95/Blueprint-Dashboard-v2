import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { TaskTemplate } from '../lib/database.types';

// Q7.3.c: bp_upsert_task_template_row OCC wrapper. INSERT when p_id is
// null; UPDATE with expected_updated_at otherwise. Used for adding new
// templates, editing fields inline, and updating sort_order for the
// up/down reorder buttons.
//
// Tests cover INSERT (no id) + UPDATE (matching updated_at) + OCC
// conflict (stale updated_at) paths.

type EditableField =
  | 'permit_type'
  | 'jurisdiction'
  | 'bucket'
  | 'text'
  | 'default_assignee'
  | 'default_target_offset'
  | 'cat'
  | 'sort_order';

export type TaskTemplatePatch = Partial<Pick<TaskTemplate, EditableField>>;

export type UpsertTaskTemplateInput =
  | {
      op: 'insert';
      patch: TaskTemplatePatch & {
        permit_type: string;
        bucket: TaskTemplate['bucket'];
        text: string;
      };
    }
  | { op: 'update'; template: TaskTemplate; patch: TaskTemplatePatch };

interface Row {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

function buildPayload(
  base: Partial<TaskTemplate>,
  patch: TaskTemplatePatch,
): Record<string, string | number | null> {
  const merged = { ...base, ...patch };
  return {
    permit_type: merged.permit_type ?? '',
    jurisdiction: merged.jurisdiction ?? '',
    bucket: merged.bucket ?? 'de',
    text: merged.text ?? '',
    default_assignee: merged.default_assignee ?? null,
    default_target_offset: merged.default_target_offset ?? null,
    cat: merged.cat ?? null,
    sort_order: merged.sort_order ?? 0,
  };
}

export function useUpsertTaskTemplate() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<TaskTemplate, Error, UpsertTaskTemplateInput>({
    mutationFn: async (input) => {
      if (input.op === 'insert') {
        const payload = buildPayload({}, input.patch);
        const { data, error } = await supabase.rpc(
          'bp_upsert_task_template_row',
          { p_id: null, p_data: payload, p_expected_updated_at: null },
        );
        if (error) throw error;
        const row = (data as Row[])[0];
        if (!row) throw new Error('Insert returned no row');
        return {
          id: row.out_id,
          permit_type: payload.permit_type as string,
          jurisdiction: (payload.jurisdiction as string) || null,
          bucket: payload.bucket as TaskTemplate['bucket'],
          text: payload.text as string,
          default_assignee: payload.default_assignee as string | null,
          default_target_offset: payload.default_target_offset as number | null,
          cat: payload.cat as string | null,
          sort_order: payload.sort_order as number,
          updated_at: row.updated_at,
        };
      }
      const payload = buildPayload(input.template, input.patch);
      const { data, error } = await supabase.rpc('bp_upsert_task_template_row', {
        p_id: input.template.id,
        p_data: payload,
        p_expected_updated_at: input.template.updated_at,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Update returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Task template');
      return { ...input.template, ...input.patch, updated_at: row.updated_at };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates(tenantId) });
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates(tenantId) });
      } else {
        pushToast(`Could not save template — ${error.message}`, 'error');
      }
    },
  });
}
