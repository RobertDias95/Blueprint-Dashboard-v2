import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleRow } from '../lib/database.types';

// Q6.2.b: Push Down cascade. Calls bp_resolve_da_overlap, which atomically
// moves the anchor to (target_da, target_start, target_end) and pushes
// every overlapping block on the target DA past the new anchor end
// (preserves each block's duration). Server enforces tenant scope via
// SECURITY INVOKER + RLS; OCC is on the anchor only.
//
// fix-24a (prod migration 2026-05-14): each pushed block now skips past
// any overlapping da_time_blocks entry on the target DA — same NP-jump
// loop bp_shift_da_blocks_up uses. Push-down used to land pushed blocks
// at `frontier + 7` unconditionally and silently overlap vacation /
// training / redesign / other NP blocks. The new RPC iteratively jumps
// the candidate position past each overlapping NP until no overlap
// remains, then writes. Symmetric with the shift-up gap close.
//
// Optimistic update strategy: too risky to mirror the cascade math
// client-side — instead we just patch the anchor's row optimistically
// (mirrors useUpdateDrawSchedule) and let invalidation pick up the pushed
// rows. The server returns the anchor's fresh updated_at; we setQueryData
// it synchronously to close the same stale-OCC race we fixed in Q6.2.a-fix.

export interface ResolveDaOverlapInput {
  anchorProjectId: string;
  expectedUpdatedAt: string;
  daAssigned: string;
  startWeek: string;
  endWeek: string;
  scheduleStatus: string | null;
}

interface RpcResult {
  out_anchor_project_id: string;
  out_anchor_updated_at: string | null;
  out_pushed_project_ids: string[];
  out_conflict: boolean;
}

interface MutationContext {
  drawSnapshot: DrawScheduleRow[] | undefined;
}

export function useResolveDaOverlap() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<RpcResult, Error, ResolveDaOverlapInput, MutationContext>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_resolve_da_overlap', {
        p_anchor_project_id: input.anchorProjectId,
        p_target_da: input.daAssigned,
        p_target_start_week: input.startWeek,
        p_target_end_week: input.endWeek,
        p_anchor_status: input.scheduleStatus,
        p_anchor_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw error;
      const row = (data as RpcResult[])[0];
      if (!row) throw new Error('Resolve overlap returned no row');
      if (row.out_conflict) {
        throw new OCCConflictError(0, 'Draw schedule');
      }
      return row;
    },

    onMutate: async (input) => {
      const drawKey = queryKeys.drawSchedule(tenantId);
      await queryClient.cancelQueries({ queryKey: drawKey });
      const drawSnapshot = queryClient.getQueryData<DrawScheduleRow[]>(drawKey);

      // Optimistic anchor patch only. Pushed-row positions come from refetch
      // on success — keeping the optimistic surface narrow avoids drift if
      // the cascade math here ever diverges from the server's.
      queryClient.setQueryData<DrawScheduleRow[]>(drawKey, (rows) =>
        rows?.map((r) =>
          r.project_id === input.anchorProjectId
            ? {
                ...r,
                da_assigned: input.daAssigned,
                start_week: input.startWeek,
                end_week: input.endWeek,
                status: input.scheduleStatus,
              }
            : r,
        ),
      );

      return { drawSnapshot };
    },

    onError: (error, _input, context) => {
      const drawKey = queryKeys.drawSchedule(tenantId);
      if (context?.drawSnapshot !== undefined) {
        queryClient.setQueryData(drawKey, context.drawSnapshot);
      }
      if (isOCCConflict(error)) {
        pushToast(
          'Draw schedule was modified by someone else — push-down reverted',
          'warn',
        );
        queryClient.invalidateQueries({ queryKey: drawKey });
        queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
      } else {
        pushToast(`Push-down failed — ${error.message}`, 'error');
      }
    },

    onSuccess: (data, input) => {
      // Patch anchor's cache row with the server's fresh updated_at + new
      // fields, synchronously. Same Bug-B-fix pattern as useUpdateDrawSchedule.
      if (data.out_anchor_updated_at) {
        queryClient.setQueryData<DrawScheduleRow[]>(
          queryKeys.drawSchedule(tenantId),
          (rows) =>
            rows?.map((r) =>
              r.project_id === input.anchorProjectId
                ? {
                    ...r,
                    updated_at: data.out_anchor_updated_at as string,
                    da_assigned: input.daAssigned,
                    start_week: input.startWeek,
                    end_week: input.endWeek,
                    status: input.scheduleStatus,
                  }
                : r,
            ),
        );
      }
      // Pushed rows' new ranges + permit dd dates land via refetch.
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawSchedule(tenantId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });

      const pushedCount = data.out_pushed_project_ids.length;
      if (pushedCount === 0) {
        pushToast('Saved draw schedule', 'success');
      } else {
        pushToast(
          `Pushed ${pushedCount} project${pushedCount === 1 ? '' : 's'} down`,
          'success',
        );
      }
    },
  });
}
