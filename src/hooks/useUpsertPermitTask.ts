import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { PermitTask } from '../lib/database.types';

// Q4: Row-level OCC upsert for permit_tasks via bp_upsert_permit_task_row.
// Same shape as useUpsertPermitCycle, but the cache target is the
// per-permit task list (queryKeys.permitTasksFor(permitId)) — tasks are
// queried separately from permits/cycles, so the cache walk is simpler.

type EditableTaskField =
  | 'bucket'
  | 'legacy_id'
  | 'text'
  | 'cat'
  | 'assigned_to'
  | 'stage'
  | 'completion_status'
  | 'start_date'
  | 'due_date'
  | 'target_date'
  | 'is_jurisdiction_specific'
  | 'done'
  | 'is_auto_generated'
  | 'city_acceptance_check'
  | 'cycle_idx'
  | 'sort_order';

export type TaskPatch = Partial<Pick<PermitTask, EditableTaskField>>;

export type UpsertTaskInput = {
  permitId: number;
  patch: TaskPatch;
} & (
  | { op: 'insert' }
  | { op: 'update'; task: PermitTask }
);

interface MutationContext {
  snapshot: PermitTask[] | undefined;
}

/** Merge current task values + patch + sensible defaults into the full p_data
 *  payload the RPC expects. NULL/undefined translate to '' so NULLIF works. */
function buildFullPayload(
  permitId: number,
  base: Partial<PermitTask>,
  patch: TaskPatch,
): Record<string, string | number | boolean> {
  const merged = { ...base, ...patch };
  return {
    permit_id: permitId,
    bucket: merged.bucket ?? 'de',
    legacy_id: merged.legacy_id ?? '',
    text: merged.text ?? '',
    cat: merged.cat ?? '',
    is_jurisdiction_specific: merged.is_jurisdiction_specific ?? false,
    start_date: merged.start_date ?? '',
    due_date: merged.due_date ?? '',
    target_date: merged.target_date ?? '',
    completion_status: merged.completion_status ?? 'Open',
    done: merged.done ?? false,
    assigned_to: merged.assigned_to ?? '',
    stage: merged.stage ?? 'de',
    is_auto_generated: merged.is_auto_generated ?? false,
    city_acceptance_check: merged.city_acceptance_check ?? false,
    cycle_idx: merged.cycle_idx ?? '',
    sort_order: merged.sort_order ?? 0,
  } as Record<string, string | number | boolean>;
}

export function useUpsertPermitTask() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<PermitTask, Error, UpsertTaskInput, MutationContext>({
    mutationFn: async (input) => {
      if (input.op === 'insert') {
        const payload = buildFullPayload(input.permitId, {}, input.patch);
        const { data, error } = await supabase.rpc('bp_upsert_permit_task_row', {
          p_id: null,
          p_data: payload,
          p_expected_updated_at: null,
        });
        if (error) throw error;
        const row = (data as { out_id: string; updated_at: string; conflict: boolean }[])[0];
        if (!row) throw new Error('Insert returned no row');
        return {
          id: row.out_id,
          permit_id: input.permitId,
          bucket: (payload.bucket as string) || 'de',
          legacy_id: null,
          text: (payload.text as string) || '',
          cat: (payload.cat as string) || null,
          is_jurisdiction_specific: payload.is_jurisdiction_specific as boolean,
          start_date: (payload.start_date as string) || null,
          due_date: (payload.due_date as string) || null,
          target_date: (payload.target_date as string) || null,
          completion_status: (payload.completion_status as string) || 'Open',
          done: payload.done as boolean,
          assigned_to: (payload.assigned_to as string) || null,
          stage: (payload.stage as string) || 'de',
          is_auto_generated: payload.is_auto_generated as boolean,
          city_acceptance_check: payload.city_acceptance_check as boolean,
          cycle_idx:
            typeof payload.cycle_idx === 'number' ? payload.cycle_idx : null,
          sort_order: payload.sort_order as number,
          created_at: row.updated_at,
          updated_at: row.updated_at,
        };
      }

      const payload = buildFullPayload(input.permitId, input.task, input.patch);
      const { data, error } = await supabase.rpc('bp_upsert_permit_task_row', {
        p_id: input.task.id,
        p_data: payload,
        p_expected_updated_at: input.task.updated_at,
      });
      if (error) throw error;
      const row = (data as { out_id: string; updated_at: string; conflict: boolean }[])[0];
      if (!row) throw new Error('Update returned no row');
      if (row.conflict) {
        throw new OCCConflictError(input.permitId, 'Task');
      }
      return {
        ...input.task,
        ...input.patch,
        updated_at: row.updated_at,
      };
    },

    onMutate: async (input) => {
      const key = queryKeys.permitTasksFor(tenantId, input.permitId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<PermitTask[]>(key);

      if (input.op === 'insert') {
        const tempTask: PermitTask = {
          id: `temp-${Math.random()}`,
          permit_id: input.permitId,
          bucket: input.patch.bucket ?? 'de',
          legacy_id: null,
          text: input.patch.text ?? 'New task',
          cat: input.patch.cat ?? null,
          is_jurisdiction_specific: input.patch.is_jurisdiction_specific ?? false,
          start_date: input.patch.start_date ?? null,
          due_date: input.patch.due_date ?? null,
          target_date: input.patch.target_date ?? null,
          completion_status: input.patch.completion_status ?? 'Open',
          done: input.patch.done ?? false,
          assigned_to: input.patch.assigned_to ?? null,
          stage: input.patch.stage ?? 'de',
          is_auto_generated: false,
          city_acceptance_check: input.patch.city_acceptance_check ?? false,
          cycle_idx: input.patch.cycle_idx ?? null,
          sort_order: input.patch.sort_order ?? 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        queryClient.setQueryData<PermitTask[]>(key, [
          ...(snapshot ?? []),
          tempTask,
        ]);
      } else {
        queryClient.setQueryData<PermitTask[]>(
          key,
          (snapshot ?? []).map((t) =>
            t.id === input.task.id ? { ...t, ...input.patch } : t,
          ),
        );
      }
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
        pushToast(`Could not save task — ${error.message}`, 'error');
      }
    },

    onSuccess: (_, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitTasksFor(tenantId, input.permitId),
      });
      pushToast('Saved task', 'success');
    },
  });
}
