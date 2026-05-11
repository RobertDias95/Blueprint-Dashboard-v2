import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { DmDaGroupRow } from '../lib/database.types';

// Q7.3.b: bp_upsert_dm_da_group_row. INSERT a new (dm_name, da_name) pair,
// or UPDATE an existing one with OCC. Used by TeamStructureEditor to add
// a DA to a DM's group + by the "move to different DM" dropdown to flip
// dm_name on an existing row.

interface Row {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

export type UpsertDmDaGroupInput =
  | { op: 'insert'; dm_name: string; da_name: string }
  | { op: 'update'; row: DmDaGroupRow; patch: Partial<Pick<DmDaGroupRow, 'dm_name' | 'da_name'>> };

export function useUpsertDmDaGroup() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<{ id: string; updated_at: string }, Error, UpsertDmDaGroupInput>({
    mutationFn: async (input) => {
      const isInsert = input.op === 'insert';
      const payload = isInsert
        ? { dm_name: input.dm_name, da_name: input.da_name }
        : { dm_name: input.row.dm_name, da_name: input.row.da_name, ...input.patch };
      const { data, error } = await supabase.rpc('bp_upsert_dm_da_group_row', {
        p_id: isInsert ? null : input.row.id,
        p_data: payload,
        p_expected_updated_at: isInsert ? null : input.row.updated_at,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Team group');
      return { id: row.out_id, updated_at: row.updated_at };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dmDaGroups(tenantId) });
      pushToast('Saved team structure', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.dmDaGroups(tenantId) });
      } else {
        pushToast(`Could not save team structure — ${error.message}`, 'error');
      }
    },
  });
}
