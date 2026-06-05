import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles } from '../lib/database.types';

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

    onSuccess: (result, input) => {
      // Overlap responses are NOT writes — caller handles them via prompts.
      // Skip cache invalidation and the success toast in that case.
      if (result.overlapKind) return;

      // fix-73: write the BP's fresh out_bp_updated_at SYNCHRONOUSLY into the
      // permits caches. The RPC bulk-updates every permit on the project
      // (target_submit cascade) so EVERY sibling's updated_at also bumped —
      // but only the BP's new token is returned. Patching the BP closes the
      // most common race (Bobby's repro: set DD dates, then edit BP's
      // approval_date → first save OCC-conflicted, blanked the typed value,
      // succeeded on second click). Siblings still rely on the refetch below.
      //
      // fix-121: the patch also nulls out target_submit on the BP AND every
      // sibling permit in the project. Without this, the synchronous patch
      // surfaces the new dd_start/dd_end immediately while target_submit
      // sits at its pre-edit value until the invalidate-driven refetch
      // lands — Bobby's "DD moved but target_submit stayed in July 2026"
      // repro on 6516 37th Ave SW. Prod cascade IS working (verified: 0
      // drifted BPs across the whole dataset, all dd_end + learned_offset
      // engine-aligned), so the gap is purely UI staleness during the
      // round-trip. Nulling target_submit makes the UI honest: it renders
      // "—" briefly until the refetch returns the engine-computed value
      // (cascade fired before bp_set_bp_dd_dates returned, so the refetch
      // sees the new target_submit). Non-BP siblings get the same treatment
      // because bp_set_bp_dd_dates' UPDATE bulk-sets dd_start/dd_end across
      // the whole project, and the cascade updates their target_submits too
      // (G&C/LSM mirrors + Demolition c0_intake_anchored types).
      if (result.bpUpdatedAt) {
        const bpUpdatedAt = result.bpUpdatedAt;
        const patchProjectPermits = (
          rows: PermitWithCycles[] | undefined,
        ) =>
          rows?.map((p) => {
            if (p.project_id !== result.projectId) return p;
            const base = {
              ...p,
              dd_start: input.ddStart,
              dd_end: input.ddEnd,
              // fix-121: target_submit cascaded server-side; null out the
              // cache so the UI shows the placeholder until refetch lands
              // (typically <100ms) instead of the stale pre-edit value.
              target_submit: null,
            };
            // Only the BP carries the OCC token round-trip — siblings'
            // updated_at refreshes via invalidate-driven refetch below.
            if (p.type === 'Building Permit') {
              return { ...base, updated_at: bpUpdatedAt };
            }
            return base;
          });
        queryClient.setQueryData<PermitWithCycles[]>(
          queryKeys.permits(tenantId),
          (rows) => patchProjectPermits(rows),
        );
        queryClient.setQueryData<PermitWithCycles[]>(
          queryKeys.permitsByProject(tenantId, result.projectId),
          (rows) => patchProjectPermits(rows),
        );
      }

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
