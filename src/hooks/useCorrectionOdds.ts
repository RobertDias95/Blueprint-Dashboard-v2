import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import {
  correctionSignalFor,
  type CorrectionOddsPayload,
  type CorrectionSignal,
} from '../lib/correctionOdds';

// ★ fix-614 (P-300): the correction-count signal for the estimate.
//
// ONE call for the whole tenant (`bp_correction_odds()` returns aggregates and
// one row per open permit — a few KB, no 1,000-row cap), shared by every
// surface that projects an approval date so they all project the SAME date:
// the Schedule Estimator, the permits table, the Overview and the draw grid.
//
// ★★ FAIL-SAFE BY CONSTRUCTION. Until the migration is applied the function
//    does not exist; any error (or no data yet) means `signalFor` returns
//    null, and `computeProjectedApproval` with no signal is byte-for-byte the
//    projection it was before this ticket.

export function useCorrectionOdds(): {
  signalFor: (
    permit: { id: number; type: string | null },
    juris: string | null | undefined,
  ) => CorrectionSignal | null;
} {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<CorrectionOddsPayload | null>({
    queryKey: queryKeys.correctionOdds(tenantId ?? ''),
    enabled: !!tenantId,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_correction_odds');
      if (error) return null; // not applied yet / not allowed → no signal
      return (data ?? null) as CorrectionOddsPayload | null;
    },
  });
  const payload = q.data ?? null;
  const signalFor = useCallback(
    (permit: { id: number; type: string | null }, juris: string | null | undefined) =>
      correctionSignalFor(payload, permit, juris),
    [payload],
  );
  return { signalFor };
}
