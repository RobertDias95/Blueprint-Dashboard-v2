import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q7.3.a: bp_delete_permit_type. Returns boolean — true when a row was
// removed. Same non-cascading behavior as useDeleteJurisdiction (parity
// with v1's removePermitType — catalog removal only).

export function useDeletePermitType() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<boolean, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      const { data, error } = await supabase.rpc('bp_delete_permit_type', {
        p_name: name,
      });
      if (error) throw error;
      return Boolean(data);
    },
    onSuccess: (removed) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTypes(tenantId) });
      if (removed) pushToast('Removed permit type', 'success');
    },
    onError: (error) => {
      pushToast(`Could not remove permit type — ${error.message}`, 'error');
    },
  });
}
