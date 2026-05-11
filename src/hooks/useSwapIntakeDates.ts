import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q6.3.c: atomic swap of intake_date between two intake_records rows.
// Wraps Q7.3.0's bp_swap_intake_dates which also syncs linked permits'
// intake_date (matches v1 swap behavior — rescheduling an intake should
// reschedule the linked permit's intake_date too).
//
// Server returns a single row with {swapped, conflict, current_a,
// current_b}. We don't surface current_a/b to callers — the conflict
// branch triggers a re-fetch via invalidateQueries.

interface Row {
  swapped: boolean;
  conflict: boolean;
  current_a: string | null;
  current_b: string | null;
}

export interface SwapIntakeInput {
  idA: number;
  idB: number;
  expectedA: string;
  expectedB: string;
}

export function useSwapIntakeDates() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<boolean, Error, SwapIntakeInput>({
    mutationFn: async ({ idA, idB, expectedA, expectedB }) => {
      const { data, error } = await supabase.rpc('bp_swap_intake_dates', {
        p_id_a: idA,
        p_id_b: idB,
        p_expected_a: expectedA,
        p_expected_b: expectedB,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Swap returned no row');
      if (row.conflict) {
        throw new Error(
          'Swap conflict — one of the rows changed since you opened the page.',
        );
      }
      return row.swapped;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intakeRecords(tenantId),
      });
      // Linked permits' intake_date may have moved too.
      queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
      pushToast('Swapped intake dates', 'success');
    },
    onError: (error) => {
      pushToast(`Swap failed — ${error.message}`, 'error');
      queryClient.invalidateQueries({
        queryKey: queryKeys.intakeRecords(tenantId),
      });
    },
  });
}
