import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { SnapshotRow } from '../lib/weeklySnapshot';

// ★★★ fix-463 §A (P-108) — the five buckets, as ONE NARROW READ.
//
// ⚠️ DELIBERATELY NOT PART OF `bp_list_tasks`. That RPC already ships ~1.2 MB
// per refetch and sits behind every board, filter, count and badge in the app;
// bolting five permit aggregates onto it would make every screen pay for a
// report six people read once a week.
//
// MEASURED: 208 rows / 44 kB, against bp_list_tasks' 1,643 rows / ~1.2 MB — so
// this adds ~3.7%, and only on the Agenda screen.
//
// ★ `staleTime` is generous because the answer is a WEEKLY summary: refetching
//   it on every window focus would be spending bytes to change nothing. The
//   modal's own check (useWeeklyEdition) is what notices the clock.
export interface WeeklySnapshot {
  today: string;
  rows: SnapshotRow[];
}

export function useWeeklySnapshot(enabled = true) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<WeeklySnapshot>({
    queryKey: ['weekly_snapshot', tenantId ?? ''],
    enabled: !!tenantId && enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_weekly_snapshot');
      if (error) throw error;
      const d = (data ?? {}) as Partial<WeeklySnapshot>;
      return { today: d.today ?? '', rows: d.rows ?? [] };
    },
  });
}
