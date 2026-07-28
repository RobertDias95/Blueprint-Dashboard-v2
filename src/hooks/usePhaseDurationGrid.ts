import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import {
  PHASE_RECENT_WINDOW_DAYS,
  type PhaseDurationRow,
  type PhaseSide,
} from '../lib/phaseDurations';

// fix-253: read the learned phase-duration grid — every (type, jurisdiction,
// cycle_index, side) cohort with n >= 3, in one round-trip.
//
// READ-ONLY. bp_phase_duration_grid is STABLE and contains no write statement;
// nothing about rendering this report can move a date.

interface GridRow {
  type: string;
  juris: string;
  cycle_index: number;
  side: string;
  median_days: number | null;
  n: number | null;
  min_days: number | null;
  max_days: number | null;
  recent_median_days: number | null;
  recent_n: number | null;
}

function toRow(r: GridRow): PhaseDurationRow {
  return {
    type: r.type,
    juris: r.juris,
    cycleIndex: r.cycle_index,
    side: (r.side === 'ours' ? 'ours' : 'city') as PhaseSide,
    medianDays: r.median_days,
    n: r.n ?? 0,
    minDays: r.min_days,
    maxDays: r.max_days,
    recentMedianDays: r.recent_median_days,
    recentN: r.recent_n ?? 0,
  };
}

export function usePhaseDurationGrid(
  recentDays: number = PHASE_RECENT_WINDOW_DAYS,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useQuery<PhaseDurationRow[]>({
    queryKey: queryKeys.phaseDurationGrid(tenantId, recentDays),
    enabled: !!tenantId,
    // History moves slowly; this is an analysis surface, not a live figure.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_phase_duration_grid', {
        p_recent_days: recentDays,
      });
      if (error) throw error;
      return ((data ?? []) as GridRow[]).map(toRow);
    },
  });
}
