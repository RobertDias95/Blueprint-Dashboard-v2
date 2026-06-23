import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { useProjects } from './useProjects';
import { asExternalTeamBlob, resolveExternalFirm } from '../lib/externalTeam';
import type {
  WaitingOnDiscipline,
  WaitingOnTaskRow,
} from '../lib/database.types';

// fix-140 / fix-190d: My Tasks "Waiting On" reporting view. bp_list_waiting_on_tasks
// still enumerates every task with waiting_on set (+ its project/permit/sort), but
// the firm is now resolved from projects.external_team — the SAME store the
// external-team editor writes — via resolveExternalFirm, NOT from the empty
// normalized project_external_teams/consultant_firms tables the RPC's join uses.
// (One term, one store, one resolver — the firm columns the RPC returns are
// superseded here.) firm_id carries the firm NAME (the blob has no firm registry
// yet) so the discipline -> firm grouping keys on it; firm_active stays true.

export function useWaitingOnTasks(opts: { includeCompleted: boolean }) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const projectsQ = useProjects();
  const tasksQ = useQuery<WaitingOnTaskRow[]>({
    // Key carries the flag so the active-only + include-completed views coexist
    // in cache (toggling doesn't refetch the other from scratch).
    queryKey: queryKeys.waitingOnTasks(tenantId ?? '', opts.includeCompleted),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_waiting_on_tasks', {
        p_include_completed: opts.includeCompleted,
      });
      if (error) throw error;
      return (data ?? []) as WaitingOnTaskRow[];
    },
  });

  // Overlay the firm from each task's project external_team blob (single source).
  const data = useMemo<WaitingOnTaskRow[]>(() => {
    const blobByProject = new Map<string, ReturnType<typeof asExternalTeamBlob>>();
    for (const p of projectsQ.data ?? []) {
      blobByProject.set(p.id, asExternalTeamBlob(p.external_team));
    }
    return (tasksQ.data ?? []).map((row) => {
      const firm = resolveExternalFirm(blobByProject.get(row.project_id), row.waiting_on);
      return { ...row, firm_id: firm, firm_name: firm, firm_active: true };
    });
  }, [tasksQ.data, projectsQ.data]);

  return {
    data,
    isLoading: tasksQ.isLoading || projectsQ.isLoading,
    error: tasksQ.error ?? projectsQ.error,
    refetch: () => {
      void tasksQ.refetch();
      void projectsQ.refetch();
    },
  };
}

// ============================================================
// Grouping: discipline -> firm
// ============================================================

export interface WaitingOnFirmGroup {
  /** null = no firm assigned to this project for this discipline. */
  firmId: string | null;
  firmName: string | null;
  /** false when the assigned firm is archived; the null-firm group is true. */
  firmActive: boolean;
  tasks: WaitingOnTaskRow[];
}

export interface WaitingOnDisciplineGroup {
  discipline: WaitingOnDiscipline;
  /** sorted by firm_name asc; the "(no firm)" group is always last. */
  firms: WaitingOnFirmGroup[];
  totalTasks: number;
}

const NO_FIRM = '__none__';

/** Group waiting-on rows by discipline (alphabetical), then by firm within
 *  each discipline (firm_name asc, the null-firm group last). Row order within
 *  a firm group is preserved from the input (the RPC already sorts by due_date
 *  NULLS LAST). A firm and the no-firm group never merge; two distinct firm_ids
 *  stay separate even when sharing a name; an archived firm keeps its own
 *  group (firmActive=false). */
export function groupByDisciplineThenFirm(
  rows: WaitingOnTaskRow[],
): WaitingOnDisciplineGroup[] {
  const byDiscipline = new Map<string, WaitingOnTaskRow[]>();
  for (const row of rows) {
    const arr = byDiscipline.get(row.waiting_on) ?? [];
    arr.push(row);
    byDiscipline.set(row.waiting_on, arr);
  }

  return [...byDiscipline.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((discipline) => {
      const drows = byDiscipline.get(discipline)!;
      const byFirm = new Map<string, WaitingOnTaskRow[]>();
      for (const row of drows) {
        const key = row.firm_id ?? NO_FIRM;
        const arr = byFirm.get(key) ?? [];
        arr.push(row);
        byFirm.set(key, arr);
      }
      const firms: WaitingOnFirmGroup[] = [...byFirm.entries()].map(
        ([key, tasks]) => {
          const firmId = key === NO_FIRM ? null : key;
          return {
            firmId,
            firmName: firmId === null ? null : tasks[0].firm_name,
            // null firm treats as active; an explicit false = archived.
            firmActive: firmId === null ? true : tasks[0].firm_active !== false,
            tasks,
          };
        },
      );
      firms.sort((a, b) => {
        if (a.firmId === null) return 1; // no-firm group last
        if (b.firmId === null) return -1;
        return (a.firmName ?? '').localeCompare(b.firmName ?? '');
      });
      return {
        discipline: discipline as WaitingOnDiscipline,
        firms,
        totalTasks: drows.length,
      };
    });
}
