import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { PermitTypeDefault } from '../lib/database.types';

// fix-25-feat-Z: upsert one row in permit_type_defaults via the
// bp_upsert_permit_type_default RPC. Tenant resolved server-side
// from auth context. Optimistic update on the tenant's cache so
// the editor reflects the new value instantly; rollback on error.

export interface UpsertPermitTypeDefaultInput {
  type: string;
  intake_to_approval_days: number;
  c1_resub_offset_days: number | null;
}

interface RpcRow {
  out_type: string;
  out_updated_at: string;
}

interface MutationContext {
  snapshot: PermitTypeDefault[] | undefined;
}

export function useUpsertPermitTypeDefault() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<PermitTypeDefault, Error, UpsertPermitTypeDefaultInput, MutationContext>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_upsert_permit_type_default',
        {
          p_type: input.type,
          p_intake_to_approval_days: input.intake_to_approval_days,
          p_c1_resub_offset_days: input.c1_resub_offset_days,
        },
      );
      if (error) throw error;
      const row = (data as RpcRow[])[0];
      if (!row) throw new Error('Upsert returned no row');
      return {
        type: row.out_type,
        intake_to_approval_days: input.intake_to_approval_days,
        c1_resub_offset_days: input.c1_resub_offset_days,
        updated_at: row.out_updated_at,
      };
    },

    onMutate: async (input) => {
      const key = queryKeys.permitTypeDefaults(tenantId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<PermitTypeDefault[]>(key);
      queryClient.setQueryData<PermitTypeDefault[]>(key, (rows) => {
        const existing = rows ?? [];
        const idx = existing.findIndex((r) => r.type === input.type);
        const next: PermitTypeDefault = {
          type: input.type,
          intake_to_approval_days: input.intake_to_approval_days,
          c1_resub_offset_days: input.c1_resub_offset_days,
          updated_at: new Date().toISOString(),
        };
        if (idx >= 0) {
          const copy = [...existing];
          copy[idx] = next;
          return copy;
        }
        return [...existing, next];
      });
      return { snapshot };
    },

    onError: (error, _input, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.permitTypeDefaults(tenantId),
          context.snapshot,
        );
      }
      pushToast(
        `Could not save default — ${error.message}`,
        'error',
      );
    },

    onSuccess: (result) => {
      // Replace the optimistic row with the server's confirmed updated_at.
      queryClient.setQueryData<PermitTypeDefault[]>(
        queryKeys.permitTypeDefaults(tenantId),
        (rows) =>
          rows?.map((r) => (r.type === result.type ? result : r)),
      );
      pushToast(`Saved ${result.type} default`, 'success');
    },
  });
}
