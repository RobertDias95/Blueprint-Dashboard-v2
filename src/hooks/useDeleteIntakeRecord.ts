import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { IntakeRecord } from '../lib/database.types';

// Q6.3.c: bp_delete_intake_records_row (Q5.5.C). OCC delete + idempotent
// on missing rows (server returns deleted=true, conflict=false).

interface Row {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

export function useDeleteIntakeRecord() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: number; updated_at: string }>({
    // ★ fix-579 §B: fix-511 §C's line, which these two never got. Report 729
    //   arrived with no RPC name at all, so a reader had to infer the write
    //   from the message — exactly the cost fix-511 §C measured at four
    //   database queries per row.
    meta: { write: 'bp_delete_intake_records_row' },
    mutationFn: async ({ id, updated_at }) => {
      const { data, error } = await supabase.rpc(
        'bp_delete_intake_records_row',
        { p_id: id, p_expected_updated_at: updated_at },
      );
      if (error) throw error;
      const row = (data as Row[])[0];
      if (row?.conflict) {
        // ★ fix-579 §B: this RPC names the server's side explicitly
        //   (`current_updated_at`) and the field was declared in `Row` but read
        //   by nobody. A delete refused for a stale token is the same
        //   comparison as an update refused for one, and now says so.
        throw new OCCConflictError(0, 'Intake', {
          rowId: id,
          expected: updated_at,
          actual: row.current_updated_at ?? null,
        });
      }
    },
    onSuccess: (_void, variables) => {
      // fix-258: drop the row from the cache immediately rather than waiting
      // for the invalidate-driven refetch. Without this the deleted row stays
      // on screen for the round-trip and can be edited again, sending an OCC
      // token for a row that no longer exists.
      queryClient.setQueryData<IntakeRecord[]>(
        queryKeys.intakeRecords(tenantId),
        (rows) => rows?.filter((r) => r.id !== variables.id),
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.intakeRecords(tenantId),
      });
      pushToast('Removed intake', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.intakeRecords(tenantId),
        });
      } else {
        pushToast(`Could not remove — ${error.message}`, 'error');
      }
    },
  });
}
