import { useQuery } from '@tanstack/react-query';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { fetchAllRows } from '../lib/fetchAllRows';
import { useAuthStore } from '../stores/authStore';
import type { CorrectionMissingWorklistRow } from '../lib/database.types';

// fix-279: the missing-letter worklist — for every permit the tool says the
// city issued corrections on, the rounds we have found no letter for.
//
// READ-ONLY. public.correction_missing_worklist is a view over permits,
// permit_cycles and correction_items, created WITH (security_invoker = true) so
// the caller's own RLS decides which rows come back. There is nothing to write
// here and no RPC — the answer is derived, never stored.
//
// ★ "No letter found" is NOT "not filed". The view cannot tell a letter that
// was never saved to the share from one saved under a filename the indexer's
// parser does not recognise. Every row carries `status_note` saying so and the
// UI repeats it.
//
// Paged like every other load-all hook: 98 rows today, but it is driven by
// permits.corr_rounds and grows with the pipeline, and PostgREST truncates an
// un-ranged select at 1,000 with no error at all.

const SELECT_COLUMNS =
  'tenant_id,project_id,permit_id,permit_num,permit_type,address,juris,cycle,' +
  'disciplines_expected,corr_issued,days_since_corr_issued,project_parked,' +
  'status_note';

type WorklistPage = PromiseLike<{
  data: CorrectionMissingWorklistRow[] | null;
  error: PostgrestError | null;
}>;

export function useCorrectionMissingWorklist() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<CorrectionMissingWorklistRow[]>({
    queryKey: queryKeys.correctionMissingWorklist(tenantId ?? ''),
    enabled: !!tenantId,
    // Recomputed server-side on every read; the inputs change at scraper
    // cadence, so a few minutes of staleness is free and a refetch per remount
    // is not.
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      fetchAllRows<CorrectionMissingWorklistRow>((from, to) =>
        supabase
          .from('correction_missing_worklist')
          .select(SELECT_COLUMNS)
          // Longest-outstanding first, as the brief asks. `permit_id` and
          // `cycle` complete a TOTAL order — without a unique tiebreak, rows
          // sharing a day count could shift between pages and be duplicated or
          // skipped.
          .order('days_since_corr_issued', { ascending: false, nullsFirst: false })
          .order('permit_id', { ascending: true })
          .order('cycle', { ascending: true })
          .range(from, to) as unknown as WorklistPage,
      ),
  });
}
