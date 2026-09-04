import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Permit, PermitWithCycles } from '../lib/database.types';

// Q9.5.f-fix-17 C: insert a new permit row. permits.id is an identity column
// (default-allocated) and permits_default_tenant trigger fills tenant_id
// from the caller's JWT, so a plain insert is enough — no RPC needed.

export interface CreatePermitInput {
  projectId: string;
  type: string;
  /** Optional initial values; the default handles status. */
  patch?: Partial<Permit>;
}

export function useCreatePermit() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<PermitWithCycles, Error, CreatePermitInput>({
    mutationFn: async ({ projectId, type, patch }) => {
      // ★★★ fix-498 (P-025): `stage: 'de'` used to be in this literal. The
      //     column is gone — this is a DIRECT table insert, not an RPC, so it
      //     would have 400'd on the next "Add permit" click the moment the
      //     migration landed. STEP 0's brief listed only the two project RPCs
      //     as writers; this one and bp_insert_permit were the ones it missed.
      //     A new permit's stage is derived, and with no cycles and no dates
      //     it derives to 'de' anyway — the seed was never doing any work.
      const insert = {
        project_id: projectId,
        type,
        status: 'Pre-Submittal — GO',
        ...(patch ?? {}),
      };
      const { data, error } = await supabase
        .from('permits')
        .insert(insert)
        .select('*, permit_cycles(*)')
        .single();
      if (error) throw error;
      return data as PermitWithCycles;
    },

    onSuccess: (permit) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitsByProject(tenantId, permit.project_id),
      });
    },

    onError: (error) => {
      pushToast(`Could not add permit — ${error.message}`, 'error');
    },
  });
}
