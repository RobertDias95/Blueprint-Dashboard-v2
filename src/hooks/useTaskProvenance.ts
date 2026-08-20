import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { TaskProvenanceRow } from '../lib/taskProvenance';

// ★★ fix-363 — one task's provenance, fetched only when somebody asks for it.
//
// Bobby: "maybe a pop-up of the information." ★ `enabled` is the whole design:
// the panel is reference information a person wants occasionally, so nothing is
// fetched until it is opened. Four more lines on every task row would bury the
// work itself, and 1,361 extra queries to render a board would be worse still.
//
// ★ The RPC returns FACTS. `lib/taskProvenance` decides the three states —
// a person, the machine, not recorded — because that is the rule this ticket
// turns on and it belongs where a test can reach it.

export function useTaskProvenance(taskId: string | null | undefined, enabled = true) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<TaskProvenanceRow[]>({
    queryKey: queryKeys.taskProvenance(tenantId ?? '', taskId ?? ''),
    enabled: !!tenantId && !!taskId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_task_provenance', {
        p_task_id: taskId,
      });
      if (error) throw error;
      return (data ?? []) as TaskProvenanceRow[];
    },
    // History does not change unless somebody edits the task, and any such edit
    // invalidates the task queries anyway.
    staleTime: 5 * 60 * 1000,
  });
}

/** ★★ Who assigned each recently-assigned task, for the notification that names
 *  them. One narrow bulk read rather than a column on `bp_list_tasks` — that
 *  RPC feeds every task surface, and the field is NULL on all 1,361 existing
 *  tasks. fix-354's and fix-360's pattern. */
export function useTaskAssigners() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<{ task_id: string; actor_name: string | null }[]>({
    queryKey: [...queryKeys.taskAssignersAll, tenantId ?? ''],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_task_assigners', {});
      if (error) throw error;
      return (data ?? []) as { task_id: string; actor_name: string | null }[];
    },
    staleTime: 60 * 1000,
  });
}
