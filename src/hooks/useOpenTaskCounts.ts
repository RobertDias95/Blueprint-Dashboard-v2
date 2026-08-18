import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';

// ★★ fix-346 §2 — how many OPEN tasks each of a handful of named people holds.
//
// Bobby chose to skip the DAs who have no design manager in `dm_da_groups`
// (Cam, Shire, George), on one condition: "★★★ BUT IT MUST NOT BE SILENT."
// Settings → Team names them, and a name alone understates it — Cam has the
// largest task load on the team, which is what makes the skip worth acting on
// rather than shrugging at. This is where that number comes from.
//
// ★ COUNT QUERIES, NOT A FETCH. One `head: true` count per name (three today),
// rather than pulling every task row into a settings page to length() an array.
// It is also the reason this does not reuse `useAllPermitTasks`: that hook
// paginates ~1,200 rows to build My Tasks, and a warning line does not need
// them. (fix-333's lesson in the other direction — never reuse a list hook for
// a lookup — applies here too: the right query for a count is a count.)
//
// ★ Keyed under the `permit_tasks` bare prefix so a task edit anywhere
// refreshes the number through the existing realtime invalidation.

export function useOpenTaskCounts(names: string[]) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  // Sorted + deduped so the cache key is stable whatever order the caller's
  // list arrives in.
  const keyNames = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).sort();

  return useQuery<Record<string, number>>({
    queryKey: queryKeys.openTaskCounts(tenantId ?? '', keyNames),
    enabled: !!tenantId && keyNames.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        keyNames.map(async (name) => {
          const { count, error } = await supabase
            .from('permit_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_to', name)
            .neq('completion_status', 'Resolved');
          if (error) throw error;
          return [name, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });
}
