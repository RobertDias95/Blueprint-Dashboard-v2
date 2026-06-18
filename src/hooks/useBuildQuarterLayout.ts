import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-182b: the two "build a quarter from scratch" paths for the layout editor.
//   - useCloneQuarterLayout         -> bp_clone_quarter_layout (quarter -> quarter)
//   - useSeedQuarterLayoutFromCurrent -> bp_seed_quarter_layout_from_current
// Both refuse a non-empty target unless force; both return the row count so the
// caller can toast "copied N columns" (0 = the source had no saved layout).

export function useCloneQuarterLayout() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<
    number,
    Error,
    { from: string; to: string; force?: boolean }
  >({
    mutationFn: async ({ from, to, force = false }) => {
      const { data, error } = await supabase.rpc('bp_clone_quarter_layout', {
        p_from: from,
        p_to: to,
        p_force: force,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (count, { from, to }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, to),
      });
      pushToast(
        count > 0
          ? `Copied ${count} column${count === 1 ? '' : 's'} from ${from}`
          : `${from} has no saved layout to copy`,
        count > 0 ? 'success' : 'warn',
      );
    },
    onError: (error) => {
      pushToast(`Could not duplicate quarter — ${error.message}`, 'error');
    },
  });
}

export function useSeedQuarterLayoutFromCurrent() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, { quarter: string; force?: boolean }>({
    mutationFn: async ({ quarter, force = false }) => {
      const { data, error } = await supabase.rpc(
        'bp_seed_quarter_layout_from_current',
        { p_quarter: quarter, p_force: force },
      );
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (count, { quarter }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, quarter),
      });
      pushToast(
        count > 0
          ? `Started ${quarter} from the current team (${count} columns)`
          : 'No team structure to seed from',
        count > 0 ? 'success' : 'warn',
      );
    },
    onError: (error) => {
      pushToast(`Could not seed quarter — ${error.message}`, 'error');
    },
  });
}
