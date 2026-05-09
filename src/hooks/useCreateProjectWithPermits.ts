import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';

// Q5: Atomic create-with-children via bp_create_project_with_permits.
// One RPC creates project + permits + 2 default cycles per permit + base
// tasks copied from task_templates, all in a single transaction.
//
// Address collision is NOT an error from the RPC's perspective — it
// returns conflict=true with the existing project_id. The wizard surfaces
// that as an inline "view existing?" prompt rather than a hard failure.
// Other errors (network/SQL) come through as Error and bubble to the
// mutation's onError handler.

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

  return useMutation<CreateProjectResult, Error, CreateProjectInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_create_project_with_permits',
        {
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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.permits });
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
