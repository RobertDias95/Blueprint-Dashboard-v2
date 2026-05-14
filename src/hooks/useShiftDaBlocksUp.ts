import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q9.5.f-fix-20: bp_shift_da_blocks_up. Slide every downstream block on a
// DA up by (gap_end - gap_start + 1 week), capped at the current week
// (Monday) AND at the previous shifted block's end + 1 week. Each block
// preserves its duration. Returns the count actually shifted and a flag
// for whether the cap kicked in (so the UI can mention "some blocks
// couldn't shift fully").

export interface ShiftDaBlocksUpInput {
  daName: string;
  /** Vacated block's original start_week — anchors the gap. */
  gapStartWeek: string;
  /** Vacated block's original end_week. */
  gapEndWeek: string;
}

interface RpcRow {
  out_shifted_count: number;
  out_blocked_at_current_week: boolean;
}

export interface ShiftDaBlocksUpResult {
  shiftedCount: number;
  blockedAtCurrentWeek: boolean;
}

export function useShiftDaBlocksUp() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<ShiftDaBlocksUpResult, Error, ShiftDaBlocksUpInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_shift_da_blocks_up', {
        p_da: input.daName,
        p_gap_start_week: input.gapStartWeek,
        p_gap_end_week: input.gapEndWeek,
      });
      if (error) throw error;
      const row = (data as RpcRow[])[0];
      if (!row) throw new Error('Shift returned no row');
      return {
        shiftedCount: row.out_shifted_count,
        blockedAtCurrentWeek: row.out_blocked_at_current_week,
      };
    },

    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawSchedule(tenantId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permits(tenantId),
      });

      if (result.shiftedCount === 0) {
        pushToast('No blocks shifted', 'info');
        return;
      }
      const tail = result.blockedAtCurrentWeek
        ? ' (some capped at current week)'
        : '';
      pushToast(
        `Shifted ${result.shiftedCount} block${result.shiftedCount === 1 ? '' : 's'} up${tail}`,
        'success',
      );
    },

    onError: (error) => {
      pushToast(`Could not shift blocks — ${error.message}`, 'error');
    },
  });
}
