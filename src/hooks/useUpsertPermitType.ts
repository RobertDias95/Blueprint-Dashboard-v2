import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q7.3.a: bp_upsert_permit_type RPC. Same shape as bp_upsert_jurisdiction —
// PK=name, no OCC, ON CONFLICT updates non-PK fields (is_builtin, notes).
// Built-in types ship with the v1 catalog and shouldn't normally be edited
// post-cutover; the UI surfaces this with a visual indicator + delete guard.

export interface UpsertPermitTypeInput {
  name: string;
  is_builtin: boolean | null;
  notes: string | null;
}

interface Row {
  out_name: string;
  out_is_builtin: boolean | null;
  out_notes: string | null;
}

export function useUpsertPermitType() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<Row, Error, UpsertPermitTypeInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_upsert_permit_type', {
        p_name: input.name,
        p_is_builtin: input.is_builtin,
        p_notes: input.notes,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Upsert returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTypes(tenantId) });
      pushToast('Saved permit type', 'success');
    },
    onError: (error) => {
      pushToast(`Could not save permit type — ${error.message}`, 'error');
    },
  });
}
