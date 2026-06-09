import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';

// fix-145: edit a reuse-redesign's draw_schedule lane (DA / dates / status)
// from the Project Overview inline editor. Wraps bp_update_redesign_dd_phase,
// which snaps dd_start to Monday + writes the Monday week-keys, OCC-checks via
// expected_updated_at, and INSERTs the lane if the redesign somehow has none.

export interface UpdateRedesignDdPhaseInput {
  projectId: string;
  da: string;
  /** ISO YYYY-MM-DD — dd_start (forward-snapped to Monday server-side). */
  dd_start: string;
  /** ISO YYYY-MM-DD — dd_end (the UI snaps to the end-week Friday). */
  dd_end: string;
  status: string;
  /** draw_schedule.updated_at captured before edit; null when no lane yet. */
  expectedUpdatedAt: string | null;
}

interface RpcRow {
  project_id: string;
  updated_at: string;
  conflict: boolean;
}

export function useUpdateRedesignDdPhase() {
  const qc = useQueryClient();

  return useMutation<RpcRow, Error, UpdateRedesignDdPhaseInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_update_redesign_dd_phase', {
        p_project_id: input.projectId,
        p_da: input.da,
        p_dd_start: input.dd_start,
        p_dd_end: input.dd_end,
        p_status: input.status,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) throw error;
      const row = (data as RpcRow[] | null)?.[0];
      if (!row) throw new Error('redesign DD-phase RPC returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'redesign DD phase');
      return row;
    },
    onSuccess: () => {
      // Bare prefix → Draw Schedule + Project Overview both refresh.
      qc.invalidateQueries({ queryKey: queryKeys.drawScheduleAll });
      pushToast('Redesign DD phase updated', 'success');
    },
    onError: (err) => {
      if (isOCCConflict(err)) {
        pushToast('Lane was edited elsewhere — refresh and retry', 'warn');
        qc.invalidateQueries({ queryKey: queryKeys.drawScheduleAll });
        return;
      }
      pushToast(`Failed to update redesign DD phase — ${err.message}`, 'error');
    },
  });
}
