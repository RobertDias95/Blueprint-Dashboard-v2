import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q9.5.f-fix-20: bp_move_draw_schedule_da. Atomic DA reassignment that
// rewrites assignment on EVERY artifact tied to the old DA in one tx:
//   - draw_schedule (da_assigned + weeks + dd_start/dd_end)
//   - permits.da, permits.dm (only where permits.da currently equals OLD DA —
//     preserves manual overrides like Bobby on PAR / Cam on SDOT Tree)
//   - permit_tasks.assigned_to (same selective rewrite)
//   - dd_start/dd_end cascade to all project permits
// Returns a gap_exists flag the client uses to decide whether to surface
// the gap-fill prompt.
//
// Use this hook only when the DA actually changed. Same-DA moves
// (re-anchor within the same DA's column) should stay on
// useUpdateDrawSchedule — that path's contract is unchanged.

export interface MoveDrawScheduleDaInput {
  projectId: string;
  newDa: string;
  newDm: string | null;
  startWeek: string;
  endWeek: string;
  scheduleStatus: string | null;
  expectedUpdatedAt: string;
}

interface RpcRow {
  out_project_id: string;
  out_updated_at: string | null;
  out_conflict: boolean;
  out_old_da: string | null;
  out_permits_updated: number;
  out_tasks_updated: number;
  out_gap_exists: boolean;
  out_gap_downstream_count: number;
  out_gap_after_week: string | null;
}

export interface MoveDrawScheduleDaResult {
  projectId: string;
  updatedAt: string | null;
  oldDa: string | null;
  permitsUpdated: number;
  tasksUpdated: number;
  gapExists: boolean;
  gapDownstreamCount: number;
  /** Original start_week — used by bp_shift_da_blocks_up as the gap anchor. */
  gapAfterWeek: string | null;
}

export function useMoveDrawScheduleDa() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<MoveDrawScheduleDaResult, Error, MoveDrawScheduleDaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_move_draw_schedule_da', {
        p_project_id: input.projectId,
        p_new_da: input.newDa,
        p_new_dm: input.newDm,
        p_start_week: input.startWeek,
        p_end_week: input.endWeek,
        p_status: input.scheduleStatus,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw error;
      const row = (data as RpcRow[])[0];
      if (!row) throw new Error('Move returned no row');
      if (row.out_conflict) {
        throw new OCCConflictError(0, 'Draw schedule');
      }
      return {
        projectId: row.out_project_id,
        updatedAt: row.out_updated_at,
        oldDa: row.out_old_da,
        permitsUpdated: row.out_permits_updated,
        tasksUpdated: row.out_tasks_updated,
        gapExists: row.out_gap_exists,
        gapDownstreamCount: row.out_gap_downstream_count,
        gapAfterWeek: row.out_gap_after_week,
      };
    },

    onSuccess: (result) => {
      // Touch every cache that could surface the propagated change:
      // draw_schedule (assignment + dates), permits (da/dm + dd dates),
      // permit_tasks (assigned_to). Realtime invalidation handles other
      // tabs/users automatically.
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawSchedule(tenantId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permits(tenantId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitsByProject(tenantId, result.projectId),
      });
      // Tasks cache key is loose-keyed; broad invalidation is fine here
      // since DA moves are infrequent and the impact is global.
      queryClient.invalidateQueries({
        queryKey: ['permit_tasks'],
      });

      // Toast summarizes propagation so the user sees what got rewritten.
      // The gap-fill prompt opens separately based on result.gapExists.
      const summary: string[] = [];
      if (result.permitsUpdated > 0) {
        summary.push(
          `${result.permitsUpdated} permit${result.permitsUpdated === 1 ? '' : 's'}`,
        );
      }
      if (result.tasksUpdated > 0) {
        summary.push(
          `${result.tasksUpdated} task${result.tasksUpdated === 1 ? '' : 's'}`,
        );
      }
      const tail =
        summary.length > 0 ? ` (reassigned ${summary.join(' + ')})` : '';
      pushToast(`Moved project${tail}`, 'success');
    },

    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(
          'Draw schedule was modified by someone else — refresh and retry',
          'warn',
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.drawSchedule(tenantId),
        });
      } else {
        pushToast(`Could not move project — ${error.message}`, 'error');
      }
    },
  });
}
