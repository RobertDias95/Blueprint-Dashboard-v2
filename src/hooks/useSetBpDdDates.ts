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
//
// fix-25h: the RPC now overlap-checks the proposed start_week/end_week
// against other projects + NP blocks on the same DA. When a conflict is
// found, the RPC RETURNS conflict info (overlapKind + conflicts list +
// proposed weeks + draw_schedule.updated_at) instead of writing. The
// caller surfaces the appropriate prompt:
//   - overlapKind='project' → OverlapPrompt → Push Down via
//     bp_resolve_da_overlap with the proposed weeks
//   - overlapKind='np' → NpWarningPrompt → retry useSetBpDdDates with
//     forceNp=true (RPC skips the NP check on the retry)

export type ProjectOverlapConflict = {
  project_id: string;
  address: string;
  start_week: string;
  end_week: string;
};

export type NpOverlapConflict = {
  id: string;
  type: string;
  label: string | null;
  start_week: string;
  end_week: string;
};

export interface SetBpDdDatesInput {
  projectId: string;
  /** ISO date string YYYY-MM-DD, or null to clear. */
  ddStart: string | null;
  /** ISO date string YYYY-MM-DD, or null to clear. Must match ddStart's
   *  null-ness (both null = clear; both set = update). */
  ddEnd: string | null;
  /** BP permit's current updated_at, captured from the row before edit. */
  expectedUpdatedAt: string;
  /** When true, the RPC skips the NP overlap check. Set after the user
   *  confirms "Save anyway" on NpWarningPrompt. */
  forceNp?: boolean;
}

interface RpcRow {
  out_project_id: string;
  out_bp_updated_at: string | null;
  out_draw_schedule_updated_at: string | null;
  out_conflict: boolean;
  out_permits_updated: number;
  out_overlap_kind: 'project' | 'np' | null;
  out_overlap_conflicts:
    | ProjectOverlapConflict[]
    | NpOverlapConflict[]
    | null;
  out_proposed_start_week: string | null;
  out_proposed_end_week: string | null;
}

export interface SetBpDdDatesResult {
  projectId: string;
  bpUpdatedAt: string | null;
  drawScheduleUpdatedAt: string | null;
  permitsUpdated: number;
  /** When set, the RPC did NOT write — caller must surface a prompt and
   *  decide whether to push-down or save-anyway. */
  overlapKind: 'project' | 'np' | null;
  overlapConflicts:
    | ProjectOverlapConflict[]
    | NpOverlapConflict[]
    | null;
  proposedStartWeek: string | null;
  proposedEndWeek: string | null;
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
        p_force_np: input.forceNp ?? false,
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
        overlapKind: row.out_overlap_kind,
        overlapConflicts: row.out_overlap_conflicts,
        proposedStartWeek: row.out_proposed_start_week,
        proposedEndWeek: row.out_proposed_end_week,
      };
    },

    onSuccess: (result) => {
      // Overlap responses are NOT writes — caller handles them via prompts.
      // Skip cache invalidation and the success toast in that case.
      if (result.overlapKind) return;

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
