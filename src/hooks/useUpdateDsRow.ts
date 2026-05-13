import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleRow } from '../lib/database.types';

// Q9.5.g: generic field-patch mutation for draw_schedule. Backs the three
// popup actions (set status, set duration, resync from permits) via the
// existing bp_upsert_draw_schedule_row RPC — it accepts arbitrary jsonb so
// any subset of fields can be written in one call. OCC is row-level via
// expectedUpdatedAt; conflict surfaces via toast + cache invalidate.
//
// Note: this hook ignores dd_start / dd_end cascade to permits — that's
// only done by bp_update_draw_schedule_with_dd_sync (the drag-place path).
// Status / duration / resync don't touch dd dates on permits.

export interface UpdateDsRowInput {
  /** The current row in full — used to build the merged jsonb payload (RPC
   *  overwrites every field on each call, so we must echo back everything
   *  we don't intend to change). */
  current: DrawScheduleRow;
  /** Field patch. project_id and updated_at can't be patched here. */
  patch: Partial<
    Omit<DrawScheduleRow, 'project_id' | 'updated_at' | 'tenant_id'>
  >;
  /** Used for the toast label on success / conflict. */
  fieldLabel?: string;
}

interface RpcResult {
  out_project_id: string;
  updated_at: string | null;
  conflict: boolean;
}

interface MutationContext {
  drawSnapshot: DrawScheduleRow[] | undefined;
}

export function useUpdateDsRow() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<RpcResult, Error, UpdateDsRowInput, MutationContext>({
    mutationFn: async ({ current, patch }) => {
      // Merge current + patch, then strip non-payload columns and stringify
      // jsonb-style values the way the RPC expects (p_data->>'field' returns
      // text, so dates/booleans must serialize cleanly).
      const merged: Record<string, unknown> = { ...current, ...patch };
      const payload: Record<string, string> = {};
      for (const key of [
        'da_assigned',
        'start_week',
        'end_week',
        'status',
        'manually_placed',
        'manual_status',
        'dd_start',
        'dd_end',
        'notes',
        'color_override',
        'status_override',
      ] as const) {
        const v = merged[key];
        if (v === null || v === undefined) {
          payload[key] = '';
        } else if (typeof v === 'boolean') {
          payload[key] = v ? 'true' : 'false';
        } else {
          payload[key] = String(v);
        }
      }
      const { data, error } = await supabase.rpc('bp_upsert_draw_schedule_row', {
        p_project_id: current.project_id,
        p_data: payload,
        p_expected_updated_at: current.updated_at,
      });
      if (error) throw error;
      const row = (data as RpcResult[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Draw schedule');
      return row;
    },

    onMutate: async ({ current, patch }) => {
      const drawKey = queryKeys.drawSchedule(tenantId);
      await queryClient.cancelQueries({ queryKey: drawKey });
      const drawSnapshot = queryClient.getQueryData<DrawScheduleRow[]>(drawKey);
      queryClient.setQueryData<DrawScheduleRow[]>(drawKey, (rows) =>
        rows?.map((r) =>
          r.project_id === current.project_id ? { ...r, ...patch } : r,
        ),
      );
      return { drawSnapshot };
    },

    onError: (error, _input, context) => {
      if (context?.drawSnapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.drawSchedule(tenantId),
          context.drawSnapshot,
        );
      }
      if (isOCCConflict(error)) {
        pushToast(
          'Draw schedule was modified by someone else — reverted',
          'warn',
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.drawSchedule(tenantId),
        });
      } else {
        pushToast(`Could not save draw schedule — ${error.message}`, 'error');
      }
    },

    onSuccess: (data, input) => {
      // Sync write of fresh updated_at into cache (matches the Bug B fix in
      // useUpdateDrawSchedule — otherwise the next mutation would race OCC).
      if (data.updated_at) {
        queryClient.setQueryData<DrawScheduleRow[]>(
          queryKeys.drawSchedule(tenantId),
          (rows) =>
            rows?.map((r) =>
              r.project_id === input.current.project_id
                ? {
                    ...r,
                    ...input.patch,
                    updated_at: data.updated_at as string,
                  }
                : r,
            ),
        );
      }
      pushToast(input.fieldLabel ? `Saved ${input.fieldLabel}` : 'Saved', 'success');
    },
  });
}
