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
  /** Optional initial values; defaults handle stage/status. */
  patch?: Partial<Permit>;
}

export function useCreatePermit() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<PermitWithCycles, Error, CreatePermitInput>({
    mutationFn: async ({ projectId, type, patch }) => {
      const insert = {
        project_id: projectId,
        type,
        stage: 'de',
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
