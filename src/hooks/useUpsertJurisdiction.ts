import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q7.3.a: bp_upsert_jurisdiction RPC wrapper. No OCC (the catalog has no
// updated_at column — PK=name with single-admin write pressure). Calls
// ON CONFLICT UPDATE on the server, so the hook works for both INSERT and
// non-rename UPDATE paths. Renames are not supported in-place because the
// PK is the name; clients should delete + add for a rename.

export interface UpsertJurisdictionInput {
  name: string;
  learn_window_days: number | null;
  notes: string | null;
}

interface Row {
  out_name: string;
  out_learn_window_days: number | null;
  out_notes: string | null;
}

export function useUpsertJurisdiction() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<Row, Error, UpsertJurisdictionInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_upsert_jurisdiction', {
        p_name: input.name,
        p_learn_window_days: input.learn_window_days,
        p_notes: input.notes,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Upsert returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jurisdictions(tenantId) });
      pushToast('Saved jurisdiction', 'success');
    },
    onError: (error) => {
      pushToast(`Could not save jurisdiction — ${error.message}`, 'error');
    },
  });
}
