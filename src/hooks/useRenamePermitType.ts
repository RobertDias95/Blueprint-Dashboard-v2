import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-288: bp_rename_permit_type.
//
// ★ WHY A DEDICATED RPC RATHER THAN upsert-new + delete-old. The catalogue is
// joined to permits BY STRING — permits.type holds 'Building Permit', not a
// foreign key. Renaming client-side would leave every permit carrying the OLD
// string and pointing at a catalogue row that no longer exists. 143 permits say
// 'Building Permit'. The RPC moves the catalogue row and every referencing
// permit in ONE transaction, and returns how many permits it repointed so the
// UI can say what actually happened.
//
// Renaming onto a name that already exists is refused server-side rather than
// silently merging two types (and all their permits) into one.

interface Row {
  out_name: string;
  out_permits_repointed: number;
}

export function useRenamePermitType() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<Row, Error, { from: string; to: string }>({
    mutationFn: async ({ from, to }) => {
      const { data, error } = await supabase.rpc('bp_rename_permit_type', {
        p_old: from,
        p_new: to,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Rename returned no row');
      return row;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTypes(tenantId) });
      // The permits themselves moved, so anything reading permits.type is stale.
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
      const n = row.out_permits_repointed;
      pushToast(
        n === 0
          ? `Renamed to ${row.out_name}`
          : `Renamed to ${row.out_name} — ${n} permit${n === 1 ? '' : 's'} updated`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not rename permit type — ${error.message}`, 'error');
    },
  });
}
