import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q9.5.f-fix-20: bp_place_new_project_on_da. After creating a project, this
// hook auto-places it at the next-available slot on the chosen DA's draw
// schedule. Server computes next-available so concurrent placements stay
// race-free. Idempotent — calling on a project that's already scheduled
// returns the existing row with out_placed=false.

export interface PlaceNewProjectInput {
  projectId: string;
  da: string;
  /** Default 4 weeks if omitted. */
  durationWeeks?: number;
}

interface RpcRow {
  out_project_id: string;
  out_da: string | null;
  out_start_week: string | null;
  out_end_week: string | null;
  out_placed: boolean;
}

export interface PlaceNewProjectResult {
  projectId: string;
  da: string | null;
  startWeek: string | null;
  endWeek: string | null;
  /** True for a fresh insert, false when the project was already scheduled. */
  placed: boolean;
}

export function usePlaceNewProjectOnDa() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<PlaceNewProjectResult, Error, PlaceNewProjectInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_place_new_project_on_da',
        {
          p_project_id: input.projectId,
          p_da: input.da,
          p_duration_weeks: input.durationWeeks ?? 4,
        },
      );
      if (error) throw error;
      const row = (data as RpcRow[])[0];
      if (!row) throw new Error('Placement returned no row');
      return {
        projectId: row.out_project_id,
        da: row.out_da,
        startWeek: row.out_start_week,
        endWeek: row.out_end_week,
        placed: row.out_placed,
      };
    },

    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawSchedule(tenantId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permits(tenantId),
      });
      // Quiet on no-op (project was already scheduled). Loud on a fresh
      // placement so the user knows where it landed.
      if (result.placed && result.da && result.startWeek) {
        pushToast(
          `Placed on ${result.da}, week of ${result.startWeek}`,
          'success',
        );
      }
    },

    onError: (error) => {
      pushToast(`Could not place project — ${error.message}`, 'error');
    },
  });
}
