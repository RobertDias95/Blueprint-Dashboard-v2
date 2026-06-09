import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** fix-96-b: one da_team_routing row, in the shape the wizard's DA
 *  filter consumes. We only need the (da, jurisdiction) pair to decide
 *  selectability — ent_lead resolution still flows through the server's
 *  bp_ent_lead_for_da RPC (the SECURITY DEFINER ORDER BY is the source
 *  of truth for which row wins when both a juris-specific AND a
 *  NULL-juris row exist for the same DA). */
export interface DaTeamRoutingRow {
  da: string;
  jurisdiction: string | null;
}

/** All da_team_routing rows for the active tenant. The wizard reads
 *  these to gate which DAs are selectable for the project's juris —
 *  see daHasRoutingFor + Step3Permits / Step1ProjectInfo. */
export function useDaTeamRouting() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<DaTeamRoutingRow[]>({
    queryKey: queryKeys.daTeamRouting(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_team_routing')
        .select('da, jurisdiction');
      if (error) throw error;
      return (data ?? []) as DaTeamRoutingRow[];
    },
  });
}

/** fix-96-b: pure helper that mirrors bp_ent_lead_for_da's WHERE clause:
 *  a DA is routed for a juris when at least one row matches the juris
 *  specifically OR has jurisdiction=NULL (the "default" fallback). DAs
 *  with no routing rows at all are NOT routed for any juris — that's
 *  the legitimate "not set up yet" state the brief calls out. */
export function daHasRoutingFor(
  da: string,
  juris: string | null,
  rows: DaTeamRoutingRow[],
): boolean {
  for (const r of rows) {
    if (r.da !== da) continue;
    if (r.jurisdiction === null || r.jurisdiction === juris) return true;
  }
  return false;
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
