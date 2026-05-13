import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles } from '../lib/database.types';

// Q9.5.f-fix-17 C: row-level OCC delete for a permit. Server-side FK cascade
// handles permit_cycles / permit_tasks / permit_schedule_overrides + SET NULL
// on intake_records, so the RPC is a single OCC-gated DELETE.

export interface DeletePermitInput {
  permitId: number;
  projectId: string;
  expectedUpdatedAt: string;
}

interface DeleteResult {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

export function useDeletePermit() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<void, Error, DeletePermitInput>({
    mutationFn: async ({ permitId, expectedUpdatedAt }) => {
      const { data, error } = await supabase.rpc('bp_delete_permit_row', {
        p_id: permitId,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw error;
      const row = (data as DeleteResult[] | null)?.[0];
      if (!row || row.conflict) {
        throw new OCCConflictError(permitId, 'Permit');
      }
    },

    onSuccess: (_data, { permitId, projectId }) => {
      const dropOne = (rows: PermitWithCycles[] | undefined) =>
        rows?.filter((p) => p.id !== permitId);
      queryClient.setQueryData<PermitWithCycles[] | undefined>(
        queryKeys.permits(tenantId),
        dropOne,
      );
      queryClient.setQueryData<PermitWithCycles[] | undefined>(
        queryKeys.permitsByProject(tenantId, projectId),
        dropOne,
      );
    },

    onError: (error) => {
      pushToast(`Could not delete permit — ${error.message}`, 'error');
    },
  });
}
