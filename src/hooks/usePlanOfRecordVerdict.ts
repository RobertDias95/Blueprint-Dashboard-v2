import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { ProjectPlanOfRecordVerdictRow } from '../lib/database.types';

// fix-358: the REASONING behind the Design Plan of Record card.
//
// fix-356 (the scraper) walked the share, decided which set is the plan of
// record, and wrote down WHY — 138 rows, and until now no Bridge code read the
// table. This hook is that read.
//
// ★★ READ ONLY, and structurally so, exactly like usePlanOfRecord beside it.
// `authenticated` has SELECT and nothing else; the indexer writes under
// service_role. There is no mutation hook here and none belongs — the share is
// the source of truth and the indexer is its only writer.
//
// ★★★ THREE OUTCOMES, AND THEY ARE THREE DIFFERENT THINGS:
//
//   a row with a stage    the indexer chose a set, and `sentence` says what it
//                         passed over to get there
//   a row with stage NULL the indexer looked and NOTHING qualified. 33 projects
//                         today. `sentence` is the filing request.
//   NO ROW AT ALL         the indexer has not walked this project. 21 of 159
//                         today — 15 redesigns bound to a base project and 6
//                         folders it could not match, ten of the 21 carrying
//                         permits. ★ This is NOT "no design set", and saying so
//                         would accuse the team of not filing something they
//                         filed.
//
// `maybeSingle()` because the table is one row per project (project_id is the
// primary key), so "no row" is a legitimate state and two rows would be a bug
// upstream rather than something for the UI to arbitrate.
//
// RLS scopes rows to the caller's tenant, so the filter is project_id alone;
// tenantId only participates in the cache key (the Q5.5.D convention) so a
// tenant switch cannot serve another tenant's cached row.

const SELECT_COLUMNS =
  'project_id,stage,file_name,unc_path,sentence,verdict,computed_at';

/** The indexer runs when Bobby runs it — at most daily, and all 138 rows on
 *  prod share one `computed_at` to the microsecond. Re-asking every thirty
 *  seconds would be asking a question whose answer cannot have changed. */
const A_DAY_ISH = 60 * 60 * 1000;

export function usePlanOfRecordVerdict(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectPlanOfRecordVerdictRow | null>({
    queryKey: queryKeys.planOfRecordVerdict(tenantId ?? '', projectId ?? ''),
    enabled: Boolean(projectId) && !!tenantId,
    staleTime: A_DAY_ISH,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_plan_of_record_verdict')
        .select(SELECT_COLUMNS)
        .eq('project_id', projectId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ProjectPlanOfRecordVerdictRow | null;
    },
  });
}
