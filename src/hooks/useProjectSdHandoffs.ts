import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// ★ fix-344 §1 — reassigning the schematic designer, and moving their work.
//
// ★★ THE SAME SHAPE AS fix-225's DA HANDOFF: an admin-only move in ONE
// transaction, recorded in a ledger. The entry point differs (a Settings field
// rather than a danger-zone button) because moving a schematic designer is
// routine — no board block moves, no redesign is implied — but the guarantees
// are the ones fix-225 established, and the RPC is the only write path.
//
// ★ TOLERANT of a pre-migration prod, exactly like useProjectDaHandoffs: the
// table and RPC only exist after fix_344 lands, so the read swallows
// "relation does not exist" and the history simply stays empty.

const MISSING_TABLE = '42P01';

export interface ProjectSdHandoff {
  id: string;
  project_id: string;
  from_sd: string | null;
  to_sd: string | null;
  note: string | null;
  created_at: string;
}

/** Handoff history for one project, most recent first. */
export function useProjectSdHandoffs(projectId: string | null) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectSdHandoff[]>({
    queryKey: queryKeys.projectSdHandoffs(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_sd_handoffs')
        .select('id, project_id, from_sd, to_sd, note, created_at')
        .eq('project_id', projectId as string)
        .order('created_at', { ascending: false });
      if (error) {
        if (error.code === MISSING_TABLE) return [];
        throw error;
      }
      return (data ?? []) as ProjectSdHandoff[];
    },
  });
}

export interface ReassignSdInput {
  projectId: string;
  /** null / '' = the project loses its SD without gaining one. */
  toSd: string | null;
  note?: string | null;
}

export function useReassignProjectSd() {
  const queryClient = useQueryClient();
  return useMutation<{ tasks_moved: number } | null, Error, ReassignSdInput>({
    mutationFn: async ({ projectId, toSd, note }) => {
      const { data, error } = await supabase.rpc('bp_reassign_project_sd', {
        p_project_id: projectId,
        p_to_sd: toSd,
        p_note: note ?? null,
      });
      if (error) throw error;
      const row = (data as { tasks_moved: number }[] | null)?.[0] ?? null;
      return row;
    },
    onSuccess: (row, input) => {
      // The project's field, its tasks and the ledger all moved server-side.
      queryClient.invalidateQueries({ queryKey: queryKeys.projectsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.projectSdHandoffsAll });
      // ★ The count is the point of the feature — say what moved, or the user
      // has to go and check whether anything did.
      const moved = row?.tasks_moved ?? 0;
      const who = input.toSd ? `to ${input.toSd}` : 'to nobody';
      pushToast(
        moved > 0
          ? `Schematic designer reassigned ${who} — ${moved} open task${moved === 1 ? '' : 's'} moved`
          : `Schematic designer reassigned ${who}`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not reassign the schematic designer — ${error.message}`, 'error');
    },
  });
}
