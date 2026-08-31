import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// ★★★ fix-460 §B5 (P-046) — WRITING A TASK THAT HAS NO PERMIT
// ===========================================================================
//
// ★★ THERE IS NO READ HOOK HERE, DELIBERATELY. Team tasks arrive through
// `bp_list_tasks` alongside permit tasks — the union lives in the RPC, so every
// board, filter, count, band and badge already has them and no second read
// exists to disagree with the first. This file is only the write side.
//
// ★ Shape copied from useUpsertDaTeamRouting (fix-457) / useUpsertDmDaGroup:
// an OCC-guarded RPC that returns `conflict` as a VALUE, which the hook turns
// into an OCCConflictError.

interface UpsertRow {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

/** The editable fields of a team task. Everything is optional except `text` —
 *  a task with no description is not a task. */
export interface TeamTaskPatch {
  text: string;
  notes?: string | null;
  assigned_to?: string | null;
  /** ★ THE BLEND POINT: which of the two existing board lanes this lands in. */
  discipline?: 'arch' | 'ent';
  start_date?: string | null;
  due_date?: string | null;
  target_date?: string | null;
  completion_status?: string;
  priority?: boolean;
  sort_order?: number;
  source_message_id?: string | null;
  /** ★★ A LINK BACK, NOT AN OWNER — stored, never surfaced as project_id. */
  ref_project_id?: string | null;
  ref_permit_id?: number | null;
}

export type UpsertTeamTaskInput =
  | { op: 'insert'; patch: TeamTaskPatch }
  | { op: 'update'; id: string; updated_at: string; patch: TeamTaskPatch };

export function useUpsertTeamTask() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<{ id: string; updated_at: string }, Error, UpsertTeamTaskInput>({
    mutationFn: async (input) => {
      const isInsert = input.op === 'insert';
      const { data, error } = await supabase.rpc('bp_upsert_team_task', {
        p_id: isInsert ? null : input.id,
        p_data: input.patch,
        p_expected_updated_at: isInsert ? null : input.updated_at,
      });
      if (error) throw error;
      const row = (data as UpsertRow[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Team task');
      return { id: row.out_id, updated_at: row.updated_at };
    },
    onSuccess: () => {
      // ★★ THE SAME KEY THE BOARD READS. Team tasks come back through
      //    bp_list_tasks, so invalidating that one query is what makes a new
      //    team task appear everywhere at once — the property the union buys.
      queryClient.invalidateQueries({ queryKey: queryKeys.allTasks(tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.allTasks(tenantId) });
      } else {
        pushToast(`Could not save the task — ${error.message}`, 'error');
      }
    },
  });
}

/**
 * ★★★ fix-460 — the status flip for a team task.
 *
 * A focused single-field RPC rather than a reuse of `bp_upsert_team_task`, and
 * the reason is the same one fix-434 gives for the whole status path: the
 * checkbox and the chip fire in bursts, and an OCC token that must be read,
 * sent and re-read between clicks is exactly what makes a burst lose writes.
 * A status flip is one column and last-write-wins is the correct semantics for
 * it — the optimistic overlay in `useSetTaskStatus` already collapses a burst
 * into one call before this is reached.
 */
export function useSetTeamTaskStatus() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: string; status: string }>({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.rpc('bp_set_team_task_status', {
        p_id: id,
        p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allTasks(tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      pushToast(`Could not update the task — ${error.message}`, 'error');
    },
  });
}
