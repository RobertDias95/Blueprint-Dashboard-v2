import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleRow, PermitWithCycles } from '../lib/database.types';

// Q5.5.D: Atomic write via bp_update_draw_schedule_with_dd_sync. The RPC
// updates draw_schedule.start_week/end_week/dd_start/dd_end with OCC, then
// cascades dd_start/dd_end to every permit on the project — all in one
// transaction. RLS enforces tenant scope (RPC is SECURITY INVOKER).
//
// Q6 will use this as the only write path for project schedule dates.
// ProjectDetail's dd_start/dd_end editors are read-only displays.

export interface UpdateDrawScheduleInput {
  projectId: string;
  /** Current draw_schedule.updated_at — used for OCC. */
  expectedUpdatedAt: string;
  daAssigned: string | null;
  startWeek: string | null;
  endWeek: string | null;
  scheduleStatus: string | null;
}

interface RpcResult {
  out_project_id: string;
  out_updated_at: string | null;
  out_conflict: boolean;
}

interface MutationContext {
  drawSnapshot: DrawScheduleRow[] | undefined;
  permitsSnapshot: PermitWithCycles[] | undefined;
  byProjectSnapshot: PermitWithCycles[] | undefined;
}

export function useUpdateDrawSchedule() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<RpcResult, Error, UpdateDrawScheduleInput, MutationContext>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_update_draw_schedule_with_dd_sync',
        {
          p_project_id: input.projectId,
          p_da_assigned: input.daAssigned,
          p_start_week: input.startWeek,
          p_end_week: input.endWeek,
          p_schedule_status: input.scheduleStatus,
          p_expected_updated_at: input.expectedUpdatedAt,
        },
      );
      if (error) throw error;
      const row = (data as RpcResult[])[0];
      if (!row) throw new Error('Update returned no row');
      if (row.out_conflict) {
        throw new OCCConflictError(0, 'Draw schedule');
      }
      return row;
    },

    onMutate: async (input) => {
      const drawKey = queryKeys.drawSchedule(tenantId);
      const permitsKey = queryKeys.permits(tenantId);
      const byProjectKey = queryKeys.permitsByProject(tenantId, input.projectId);

      await queryClient.cancelQueries({ queryKey: drawKey });
      await queryClient.cancelQueries({ queryKey: permitsKey });
      await queryClient.cancelQueries({ queryKey: byProjectKey });

      const drawSnapshot = queryClient.getQueryData<DrawScheduleRow[]>(drawKey);
      const permitsSnapshot = queryClient.getQueryData<PermitWithCycles[]>(permitsKey);
      const byProjectSnapshot = queryClient.getQueryData<PermitWithCycles[]>(byProjectKey);

      // Compute the cascaded permit dd dates the way the server will: dd_start
      // is the start_week's date, dd_end is end_week + 4 days (Friday).
      const newDdStart = input.startWeek;
      const newDdEnd = input.endWeek
        ? new Date(new Date(input.endWeek).getTime() + 4 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
        : null;

      queryClient.setQueryData<DrawScheduleRow[]>(drawKey, (rows) =>
        rows?.map((r) =>
          r.project_id === input.projectId
            ? {
                ...r,
                da_assigned: input.daAssigned,
                start_week: input.startWeek,
                end_week: input.endWeek,
                status: input.scheduleStatus,
                dd_start: newDdStart,
                dd_end: newDdEnd,
              }
            : r,
        ),
      );

      const cascadePermits = (rows: PermitWithCycles[] | undefined) =>
        rows?.map((p) =>
          p.project_id === input.projectId
            ? { ...p, dd_start: newDdStart, dd_end: newDdEnd }
            : p,
        );

      queryClient.setQueryData(permitsKey, cascadePermits(permitsSnapshot));
      queryClient.setQueryData(byProjectKey, cascadePermits(byProjectSnapshot));

      return { drawSnapshot, permitsSnapshot, byProjectSnapshot };
    },

    onError: (error, input, context) => {
      const drawKey = queryKeys.drawSchedule(tenantId);
      const permitsKey = queryKeys.permits(tenantId);
      const byProjectKey = queryKeys.permitsByProject(tenantId, input.projectId);

      if (context?.drawSnapshot !== undefined) {
        queryClient.setQueryData(drawKey, context.drawSnapshot);
      }
      if (context?.permitsSnapshot !== undefined) {
        queryClient.setQueryData(permitsKey, context.permitsSnapshot);
      }
      if (context?.byProjectSnapshot !== undefined) {
        queryClient.setQueryData(byProjectKey, context.byProjectSnapshot);
      }

      if (isOCCConflict(error)) {
        pushToast(
          'Draw schedule was modified by someone else — reverted',
          'warn',
        );
        queryClient.invalidateQueries({ queryKey: drawKey });
        queryClient.invalidateQueries({ queryKey: permitsKey });
        queryClient.invalidateQueries({ queryKey: byProjectKey });
      } else {
        pushToast(`Could not save draw schedule — ${error.message}`, 'error');
      }
    },

    onSuccess: (_, input) => {
      // Refetch to pick up the server's authoritative updated_at on draw_schedule
      // and the cascaded permit rows. Realtime will arrive too but doing this
      // here keeps the OCC token fresh for any immediate follow-up edit.
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawSchedule(tenantId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permits(tenantId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitsByProject(tenantId, input.projectId),
      });
      pushToast('Saved draw schedule', 'success');
    },
  });
}
