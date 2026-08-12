import { useQuery } from '@tanstack/react-query';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { fetchAllRows } from '../lib/fetchAllRows';
import { useAuthStore } from '../stores/authStore';
import type { CorrectionItem } from '../lib/database.types';

// fix-277: EVERY indexed correction item for the tenant, for the Corrections
// report. The per-project reader is useCorrectionItems; this is the cross-project
// one, and it is a different hook rather than a parameter because the two have
// genuinely different failure modes — see the paging note below.
//
// READ ONLY. `authenticated` holds SELECT on public.correction_items and nothing
// else; RLS scopes to the caller's tenant.
//
// ── PAGING IS NOT OPTIONAL HERE ─────────────────────────────────────────────
// PostgREST caps an un-ranged select at db-max-rows (1000) and returns the first
// page SILENTLY — no error, no signal. correction_items holds 2,194 rows today,
// so a bare .select() would drop more than half the corpus and every count and
// repeat rate on the page would be wrong in a way nothing on screen would
// betray. That is exactly the fix-189 bug. fetchAllRows pages until short.
//
// The order below is TOTAL — (project_id, source_file, item_no) is unique, and
// `id` is there as the final tiebreak — which fetchAllRows requires: without it
// rows can shift across a page boundary and be duplicated or skipped.

/** Columns the report reads. Explicit rather than `*`: this pulls the WHOLE
 *  corpus, so the letter text it does not use (source_folder, content_hash) and
 *  the plumbing columns (tenant_id, timestamps) would be dead weight on every
 *  page of every load. */
//
// ★ fix-283a: is_correction / exclusion_reason are SELECTED BUT NOT FILTERED
// ON. The report has to show how many rows the filter dropped and why, so the
// excluded rows must arrive; the split happens in the page, against
// partitionCorrections. Filtering here would make "141 excluded" unknowable
// without a second round trip, and a filter nobody can see is exactly what the
// brief says not to build.
const SELECT_COLUMNS =
  'id,project_id,permit_id,building,discipline,cycle,letter_date,reviewer,' +
  'item_no,subject,body,codes,category,theme,source_file,' +
  'is_correction,exclusion_reason';

/** The shape fetchAllRows needs back from one page.
 *
 *  `select(<string>)` on an untyped Database generic infers GenericStringError[]
 *  rather than the row type — the client cannot know what a runtime column list
 *  returns. `select('*')` (what useAllPermitCycleReviewers does) sidesteps this
 *  but gives up the narrowing above. Asserting the shape at this one boundary is
 *  the cheaper trade; CorrectionItem is hand-typed against the real table and
 *  SELECT_COLUMNS is its column list. */
type CorrectionPage = PromiseLike<{
  data: CorrectionItem[] | null;
  error: PostgrestError | null;
}>;

export function useAllCorrectionItems() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<CorrectionItem[]>({
    queryKey: queryKeys.allCorrectionItems(tenantId ?? ''),
    enabled: !!tenantId,
    // The indexer runs by hand on Bobby's PC, so this data changes a few times
    // a week at most. No need to refetch it on every remount of the report.
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      fetchAllRows<CorrectionItem>((from, to) =>
        supabase
          .from('correction_items')
          .select(SELECT_COLUMNS)
          .order('project_id', { ascending: true })
          .order('source_file', { ascending: true })
          .order('item_no', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as unknown as CorrectionPage,
      ),
  });
}
