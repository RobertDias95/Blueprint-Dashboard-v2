import { useQueries, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { anchorFor } from '../lib/targetSubmitLearner';
import type { TargetSubmitBenchmark } from '../lib/targetSubmitPolicy';

// fix-249: read the DISPLAY-ONLY history benchmark for a (type, jurisdiction)
// cohort. This never influences a date — bp_recompute_target_submits drives
// target_submit purely from the configured policy offset now. The benchmark
// exists so the standard can be set next to the evidence, and so a permit
// shows how its configured target compares with what the team actually did.
//
// bp_target_submit_benchmark returns exactly one row: median_days / n /
// min_days / max_days over the first recency window with n >= 3, or all-NULLs
// with window_label='insufficient' when no window reached the gate.

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
  windowLabel: 'insufficient',
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
      'insufficient') as TargetSubmitBenchmark['windowLabel'],
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

/** One cohort's benchmark. Anchor is derived from the type (anchors are fixed
 *  per type in code — fix-249 explicitly does NOT change them). Mirror types
 *  (G&C / LSM) have no learner cohort, so the query stays disabled. */
export function useTargetSubmitBenchmark(
  type: string | null | undefined,
  juris: string | null | undefined,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  const anchor = type ? anchorFor(type) : 'mirror_bp';
  const enabled = !!tenantId && !!type && !!juris && anchor !== 'mirror_bp';

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
    // The client ships ahead of the migration (the backfill is gated on
    // Bobby's review of the Phase 0 report). Until bp_target_submit_benchmark
    // exists the RPC 404s — degrade to "no note" quietly instead of a retry
    // storm. The date itself never depended on this call.
    retry: false,
    queryFn: () => fetchBenchmark(type as string, juris as string, anchor),
  });
}

/** Benchmarks for many types at one jurisdiction — the Settings editor shows
 *  the evidence beside every configured offset. Types whose anchor is
 *  mirror_bp resolve to the empty benchmark without a round-trip. */
export function useTargetSubmitBenchmarks(
  types: string[],
  juris: string | null | undefined,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  const results = useQueries({
    queries: types.map((type) => {
      const anchor = anchorFor(type);
      const enabled =
        !!tenantId && !!juris && anchor !== 'mirror_bp';
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
