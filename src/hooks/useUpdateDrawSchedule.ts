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
      // Q9.5.f-fix-20 caveat: target_submit cascades to BPs as end_week + 7
      // (Monday after DD ends). Optimistic update applies it locally so
      // computeProjectedApproval picks up the new anchor immediately and the
      // Est. Approval line + Schedule Estimator update on the next render
      // — no flash of stale data between mutation and server-side refetch.
      const newDdStart = input.startWeek;
      const newDdEnd = input.endWeek
        ? new Date(new Date(input.endWeek).getTime() + 4 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
        : null;
      // Bobby's spec: target_submit = end_week + 14 days. Two-week buffer
      // covers final prep + corrections. Matches v1 behavior.
      const newTargetSubmit = input.endWeek
        ? new Date(new Date(input.endWeek).getTime() + 14 * 24 * 60 * 60 * 1000)
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
        rows?.map((p) => {
          if (p.project_id !== input.projectId) return p;
          // BPs also get the target_submit refresh; non-BP permits keep
          // their per-permit target_submit (matches the server-side
          // type='Building Permit' filter on the cascade).
          if (p.type === 'Building Permit') {
            return {
              ...p,
              dd_start: newDdStart,
              dd_end: newDdEnd,
              target_submit: newTargetSubmit,
            };
          }
          return { ...p, dd_start: newDdStart, dd_end: newDdEnd };
        });

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

    onSuccess: (data, input) => {
      // Bug B fix: write the server's fresh out_updated_at SYNCHRONOUSLY into
      // the draw_schedule cache row. The previous code only invalidateQueries'd
      // (async refetch) — between server-confirm and refetch-lands, the next
      // drag would capture the row's stale updated_at and the follow-up RPC
      // would hit OCC instead of overlap detection. setQueryData is sync,
      // so the OCC token is fresh by the time the next dragstart reads it.
      if (data.out_updated_at) {
        queryClient.setQueryData<DrawScheduleRow[]>(
          queryKeys.drawSchedule(tenantId),
          (rows) =>
            rows?.map((r) =>
              r.project_id === input.projectId
                ? {
                    ...r,
                    updated_at: data.out_updated_at as string,
                    da_assigned: input.daAssigned,
                    start_week: input.startWeek,
                    end_week: input.endWeek,
                    status: input.scheduleStatus,
                  }
                : r,
            ),
        );
      }
      // Permits' updated_at advances via the bp_set_updated_at trigger; refetch
      // to pick up the cascaded dd_start/dd_end + new tokens.
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
