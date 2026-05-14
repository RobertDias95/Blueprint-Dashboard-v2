import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-23a: bp_set_bp_dd_dates. Atomic update of the BP's dd_start/dd_end
// that cascades target_submit (end + 14d) across every permit on the
// project AND mirrors the dates onto draw_schedule.start_week/end_week.
// Closes the propagation gap where editing DD on Project Overview wrote
// only permits.dd_start/dd_end and left the draw_schedule + sibling
// permit target_submit values stale.
//
// Clear mode: pass ddStart=null + ddEnd=null. The RPC null-checks and
// wipes both columns + drops the draw_schedule row weeks. Caller must
// ensure both values are null together — partial-null is a mid-state
// the wizard should not submit (see DDPhaseEditor for the gate).

export interface SetBpDdDatesInput {
  projectId: string;
  /** ISO date string YYYY-MM-DD, or null to clear. */
  ddStart: string | null;
  /** ISO date string YYYY-MM-DD, or null to clear. Must match ddStart's
   *  null-ness (both null = clear; both set = update). */
  ddEnd: string | null;
  /** BP permit's current updated_at, captured from the row before edit. */
  expectedUpdatedAt: string;
}

interface RpcRow {
  out_project_id: string;
  out_bp_updated_at: string | null;
  out_draw_schedule_updated_at: string | null;
  out_conflict: boolean;
  out_permits_updated: number;
}

export interface SetBpDdDatesResult {
  projectId: string;
  bpUpdatedAt: string | null;
  drawScheduleUpdatedAt: string | null;
  permitsUpdated: number;
}

export function useSetBpDdDates() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<SetBpDdDatesResult, Error, SetBpDdDatesInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_set_bp_dd_dates', {
        p_project_id: input.projectId,
        p_dd_start: input.ddStart,
        p_dd_end: input.ddEnd,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw error;
      const row = (data as RpcRow[])[0];
      if (!row) throw new Error('DD-dates RPC returned no row');
      if (row.out_conflict) {
        throw new OCCConflictError(0, 'DD dates');
      }
      return {
        projectId: row.out_project_id,
        bpUpdatedAt: row.out_bp_updated_at,
        drawScheduleUpdatedAt: row.out_draw_schedule_updated_at,
        permitsUpdated: row.out_permits_updated,
      };
    },

    onSuccess: (result) => {
      // Bare-prefix invalidation touches every tenant variant; the
      // explicit by-project key covers the Project Detail page's own
      // permits query. Draw schedule needs a refresh because the BP's
      // dd_start/dd_end mirror onto draw_schedule.start_week/end_week.
      queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.drawScheduleAll });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitsByProject(tenantId, result.projectId),
      });

      const tail =
        result.permitsUpdated > 0
          ? ` (cascaded to ${result.permitsUpdated} permit${
              result.permitsUpdated === 1 ? '' : 's'
            })`
          : '';
      pushToast(`DD dates saved${tail}`, 'success');
    },

    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(
          'DD dates were modified by someone else — refresh and retry',
          'warn',
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.drawScheduleAll });
      } else {
        pushToast(`Could not save DD dates — ${error.message}`, 'error');
      }
    },
  });
}
