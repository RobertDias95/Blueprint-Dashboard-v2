import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q5: Atomic create-with-children via bp_create_project_with_permits.
// One RPC creates project + permits + 2 default cycles per permit + base
// tasks copied from task_templates, all in a single transaction.
//
// Address collision is NOT an error from the RPC's perspective — it
// returns conflict=true with the existing project_id. The wizard surfaces
// that as an inline "view existing?" prompt rather than a hard failure.
// Other errors (network/SQL) come through as Error and bubble to the
// mutation's onError handler.
//
// Q5.5.D: p_tenant_id is required by the RPC (no internal default).
// Read activeTenantId from authStore at mutation-call time. RLS WITH CHECK
// on each INSERT confirms the caller is a member of that tenant.

export interface PermitInput {
  type: string;
  num?: string;
  da?: string;
  dm?: string;
  ent_lead?: string;
  target_submit?: string;
  dd_start?: string;
  dd_end?: string;
  kickoff_date?: string;
}

export interface CreateProjectInput {
  address: string;
  juris: string;
  notes?: string;
  permits: PermitInput[];
}

export interface CreateProjectResult {
  project_id: string;
  permit_ids: number[];
  conflict: boolean;
}

export function useCreateProjectWithPermits() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId);

  return useMutation<CreateProjectResult, Error, CreateProjectInput>({
    mutationFn: async (input) => {
      if (!tenantId) {
        throw new Error('No active tenant — cannot create project');
      }
      const { data, error } = await supabase.rpc(
        'bp_create_project_with_permits',
        {
          p_tenant_id: tenantId,
          p_address: input.address,
          p_juris: input.juris,
          p_notes: input.notes ?? null,
          p_permits: input.permits,
        },
      );
      if (error) throw error;
      const row = (data as CreateProjectResult[])[0];
      if (!row) throw new Error('RPC returned no row');
      return row;
    },

    onSuccess: (result) => {
      // Bare-prefix invalidation matches every tenant variant (Phase 2 safety).
      queryClient.invalidateQueries({ queryKey: queryKeys.projectsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitsAll });
      // Conflict path: no toast here — the wizard surfaces an inline UI for
      // the "view existing?" handoff. Toast would compete with that.
      if (!result.conflict) {
        pushToast('Project created', 'success');
      }
    },

    onError: (error) => {
      pushToast(`Could not create project — ${error.message}`, 'error');
    },
  });
}
