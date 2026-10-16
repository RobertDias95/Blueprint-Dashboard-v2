import { useQueries, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { isLearnableAnchor } from '../lib/targetSubmitLearner';
import { useTargetSubmitAnchors } from './useTargetSubmitAnchors';
import type { TargetSubmitBenchmark } from '../lib/targetSubmitPolicy';

// fix-249 → ★ fix-680: read what a (type, jurisdiction) cohort's Target
// Submit number IS and where it came from. bp_target_submit_benchmark reads
// the same observation list as bp_learn_target_submit_days, so this is the
// number the engine uses, not a separate figure.
//
// It returns one row: window_label 'learned' (median_days = median of the n
// <= 5 most recent submittals), 'starting' (no history: median_days = the
// Settings starting number, n = 0) or 'none'.

interface BenchmarkRow {
  median_days: number | null;
  n: number | null;
  min_days: number | null;
  max_days: number | null;
  window_label: string;
  total_samples: number | null;
}

const EMPTY: TargetSubmitBenchmark = {
  medianDays: null,
  n: null,
  minDays: null,
  maxDays: null,
  windowLabel: 'none',
  totalSamples: 0,
};

function toBenchmark(row: BenchmarkRow | undefined): TargetSubmitBenchmark {
  if (!row) return EMPTY;
  return {
    medianDays: row.median_days,
    n: row.n,
    minDays: row.min_days,
    maxDays: row.max_days,
    windowLabel: (row.window_label ??
      'none') as TargetSubmitBenchmark['windowLabel'],
    totalSamples: row.total_samples ?? 0,
  };
}

async function fetchBenchmark(
  type: string,
  juris: string,
  anchor: string,
): Promise<TargetSubmitBenchmark> {
  const { data, error } = await supabase.rpc('bp_target_submit_benchmark', {
    p_type: type,
    p_juris: juris,
    p_anchor: anchor,
  });
  if (error) throw error;
  return toBenchmark((data as BenchmarkRow[] | null)?.[0]);
}

/** One cohort's benchmark. ★ fix-680: the anchor is the type's
 *  `permit_types.ts_anchor`. Mirror / none types have no learner cohort, so
 *  the query stays disabled. */
export function useTargetSubmitBenchmark(
  type: string | null | undefined,
  juris: string | null | undefined,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  const { anchorOf } = useTargetSubmitAnchors();
  const anchor = anchorOf(type);
  const enabled = !!tenantId && !!type && !!juris && isLearnableAnchor(anchor);

  return useQuery<TargetSubmitBenchmark>({
    queryKey: queryKeys.targetSubmitBenchmark(
      tenantId,
      type ?? '',
      juris ?? '',
      anchor,
    ),
    enabled,
    // History moves slowly; this is a comparison aid, not a live figure.
    staleTime: 5 * 60 * 1000,
    // Degrade to "no note" quietly on an error instead of a retry storm.
    // The date itself never depends on this call.
    retry: false,
    queryFn: () => fetchBenchmark(type as string, juris as string, anchor),
  });
}

/** Benchmarks for many types at one jurisdiction — the Settings editor shows
 *  the learned number beside every starting number. Types whose anchor is
 *  mirror_bp / none resolve to the empty benchmark without a round-trip. */
export function useTargetSubmitBenchmarks(
  types: string[],
  juris: string | null | undefined,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  const { anchorOf } = useTargetSubmitAnchors();

  const results = useQueries({
    queries: types.map((type) => {
      const anchor = anchorOf(type);
      const enabled = !!tenantId && !!juris && isLearnableAnchor(anchor);
      return {
        queryKey: queryKeys.targetSubmitBenchmark(
          tenantId,
          type,
          juris ?? '',
          anchor,
        ),
        enabled,
        staleTime: 5 * 60 * 1000,
        queryFn: () => fetchBenchmark(type, juris as string, anchor),
      };
    }),
  });

  const byType = new Map<string, TargetSubmitBenchmark>();
  types.forEach((type, i) => {
    byType.set(type, results[i]?.data ?? EMPTY);
  });

  return {
    byType,
    isLoading: results.some((r) => r.isLoading),
  };
}
