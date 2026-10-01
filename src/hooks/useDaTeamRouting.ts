import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
// ★★★ fix-617 (census gap 41): the ROW SHAPE and the ROUTING RULE both live in
//     lib/daRouting.ts now. Six test files replace this module wholesale, which
//     makes any non-hook export of it `undefined` inside a render (fix-415's
//     trap) — a pure rule has no business here. The type is re-exported below
//     so this module's eight existing readers are unaffected.
import type { DaTeamRoutingRow } from '../lib/daRouting';

// fix-72: DA -> DM (ent_lead) routing.
//
//   lookupEntLeadForDa(da, juris)  — the routed DM for a DA + jurisdiction, or
//                                    null when the DA isn't in the routing
//                                    table. Used before a draw-schedule move to
//                                    decide whether to prompt for a DM change.
//   useCascadeEntLead()            — auto-fills the routed ent_lead on a
//                                    project's permits (bp_cascade_ent_lead_for_project).
//                                    Called only when the user confirms the move
//                                    should also update the DM. fix-147: the
//                                    cascade only fills permits whose ent_lead is
//                                    NULL — it never overwrites an explicit pick.
//                                    Clear ent_lead first to re-trigger the fill.
//
// The cascade is a follow-up to bp_move_draw_schedule_da (which is unchanged).
// ENT task primary is derived from permits.ent_lead at read time (fix-70), so
// the cascade alone reassigns ENT tasks — no permit_task_assignees edits.

export type { DaTeamRoutingRow };

/** All da_team_routing rows for the active tenant. The wizard reads
 *  these to gate which DAs are selectable for the project's juris —
 *  see `daHasRoutingFor` (lib/daRouting) + Step3Permits / Step1ProjectInfo. */
export function useDaTeamRouting() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<DaTeamRoutingRow[]>({
    queryKey: queryKeys.daTeamRouting(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      // ★ fix-457 added `id, updated_at` so Settings can address and OCC-guard
      //   a single rule. Additive: every existing reader destructures by name
      //   and is unaffected by two more fields arriving.
      const { data, error } = await supabase
        .from('da_team_routing')
        .select('id, da, jurisdiction, ent_lead, updated_at');
      if (error) throw error;
      return (data ?? []) as DaTeamRoutingRow[];
    },
  });
}

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
    meta: { write: 'bp_cascade_ent_lead_for_project' },
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
