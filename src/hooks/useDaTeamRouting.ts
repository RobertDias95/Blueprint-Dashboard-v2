import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-72: DA -> DM (ent_lead) routing.
//
//   lookupEntLeadForDa(da, juris)  — the routed DM for a DA + jurisdiction, or
//                                    null when the DA isn't in the routing
//                                    table. Used before a draw-schedule move to
//                                    decide whether to prompt for a DM change.
//   useCascadeEntLead()            — applies the routed ent_lead to every permit
//                                    on a project (bp_cascade_ent_lead_for_project).
//                                    Called only when the user confirms the move
//                                    should also update the DM.
//
// The cascade is a follow-up to bp_move_draw_schedule_da (which is unchanged).
// ENT task primary is derived from permits.ent_lead at read time (fix-70), so
// the cascade alone reassigns ENT tasks — no permit_task_assignees edits.

/** The routed DM (ent_lead) for a DA + jurisdiction, or null when the DA has
 *  no routing row. Standalone async (not a hook) so it's callable inline from a
 *  drag-drop handler. */
export async function lookupEntLeadForDa(
  da: string,
  juris: string | null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('bp_ent_lead_for_da', {
    p_da: da,
    p_juris: juris,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export function useCascadeEntLead() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, { projectId: string }>({
    mutationFn: async ({ projectId }) => {
      const { data, error } = await supabase.rpc(
        'bp_cascade_ent_lead_for_project',
        { p_project_id: projectId },
      );
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: (count, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitsByProject(tenantId, projectId),
      });
      // ENT task primary derives from permits.ent_lead — refresh the task tree.
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
      if (count > 0) {
        pushToast(
          `Updated DM on ${count} permit${count === 1 ? '' : 's'}`,
          'success',
        );
      }
    },
    onError: (error) => {
      pushToast(`Could not update DM — ${error.message}`, 'error');
    },
  });
}
