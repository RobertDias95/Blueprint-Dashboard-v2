import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-154: OCC upsert for a target_submit offset row. p_jurisdiction null →
// the Base row for the type; a non-null jurisdiction → a per-juris override.
// expected_updated_at is the row's last-seen timestamp (null when creating a
// brand-new override). A stale timestamp returns conflict=true → toast + refetch.

export interface UpsertTargetSubmitFormulaInput {
  type: string;
  jurisdiction: string | null;
  offset_days: number;
  /** null when the row doesn't exist yet (insert path). */
  expected_updated_at: string | null;
}

interface Row {
  out_updated_at: string;
  conflict: boolean;
}

export function useUpsertTargetSubmitFormula() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<string, Error, UpsertTargetSubmitFormulaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_upsert_target_submit_formula',
        {
          p_type: input.type,
          p_jurisdiction: input.jurisdiction,
          p_offset_days: input.offset_days,
          p_expected_updated_at: input.expected_updated_at,
        },
      );
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Target submit formula');
      return row.out_updated_at;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.targetSubmitFormulas(tenantId),
      });
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
      } else {
        pushToast(`Could not save formula — ${error.message}`, 'error');
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.targetSubmitFormulas(tenantId),
      });
    },
  });
}
