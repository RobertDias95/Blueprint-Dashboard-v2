import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { ResubmitRound } from '../lib/resubmitBy';

// ★★ fix-646 (P-066): every open correction round with its smart Resubmit-by
// date, from THE rule (`bp_resubmit_rounds` → bp_resubmit_rounds_for). One
// narrow read (~40 rows) shared by every screen that shows the date, keyed by
// permit so a screen asks "does this permit have an open round?" in O(1).
export function useResubmitRounds() {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  const q = useQuery<ResubmitRound[]>({
    queryKey: queryKeys.resubmitRounds(tenantId),
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_resubmit_rounds');
      if (error) throw error;
      return (data ?? []) as ResubmitRound[];
    },
  });
  const byPermit = useMemo(() => {
    const m = new Map<number, ResubmitRound>();
    for (const r of q.data ?? []) m.set(r.permit_id, r);
    return m;
  }, [q.data]);
  return { ...q, byPermit };
}
