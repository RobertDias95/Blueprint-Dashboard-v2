import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import type { ReviewerEstimate } from '../lib/reviewerDueEstimate';

// ===========================================================================
// ★★★ fix-640 (P-335) — THE ESTIMATES FOR THE OPEN POPOVER'S REVIEWERS
// ===========================================================================
//
// fix-638 fetched `target_date` from the TABLE here, because the view did not
// carry it. fix-640 put `target_date` on the view, so that fetch is gone and
// the city date now arrives with the row. What this asks instead is the ESTIMATE
// — `bp_reviewer_due_estimates` — for exactly the open reviewers that have no
// usable city date, only while the popover is open.
//
// ★ Keyed under the `permit_cycle_reviewers` prefix, so the realtime
//   invalidation that already refreshes the chip refreshes these too.

export function useReviewerDueEstimates(ids: readonly string[]) {
  const sorted = [...ids].sort();
  return useQuery<Map<string, ReviewerEstimate>>({
    queryKey: [...queryKeys.permitCycleReviewersAll, 'due_estimates', sorted],
    enabled: sorted.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_reviewer_due_estimates', { p_ids: sorted });
      if (error) throw error;
      const out = new Map<string, ReviewerEstimate>();
      for (const r of (data ?? []) as ReviewerEstimate[]) out.set(r.reviewer_id, r);
      return out;
    },
  });
}
