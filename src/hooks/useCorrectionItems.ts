import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { CorrectionItem } from '../lib/database.types';

// fix-276: one project's indexed correction-letter comments.
//
// READ ONLY. public.correction_items grants `authenticated` SELECT and nothing
// else (anon gets nothing); the rows are written by the file_indexer on Bobby's
// PC under service_role. There is deliberately no write hook here — if one is
// ever wanted it belongs behind an RPC, not a table grant.
//
// RLS already scopes to the caller's tenant, so the query filters on project_id
// alone; tenantId only participates in the cache key (the Q5.5.D convention) so
// a tenant switch can't serve another tenant's cached rows.
//
// No fetchAllRows paging: this is ONE project's rows, and the largest project
// in production has 96 (2,194 across 93 projects). That is an order of
// magnitude below PostgREST's 1000-row cap, and the ordering below is total, so
// a future overflow would page cleanly if it ever needs to.
//
// `enabled` guards the query until the route param and the active tenant have
// both resolved, matching usePermitsByProject.

/** Columns the Corrections panel reads. Explicit rather than `*` so a widening
 *  of the table (the indexer owns its own schema) can't quietly start shipping
 *  extracted letter text this UI has no use for. */
const SELECT_COLUMNS =
  'id,project_id,permit_id,building,discipline,cycle,letter_date,reviewer,' +
  'item_no,subject,body,codes,category,theme,source_file';

export function useCorrectionItems(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<CorrectionItem[]>({
    queryKey: queryKeys.correctionItems(tenantId ?? '', projectId ?? ''),
    enabled: Boolean(projectId) && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('correction_items')
        .select(SELECT_COLUMNS)
        // A total ordering: (source_file, item_no) is unique within a project
        // once source_folder is folded in, and item_no breaks any remaining
        // tie. Grouping re-sorts anyway — this just keeps the wire order
        // deterministic so a refetch can't reshuffle equal rows.
        .eq('project_id', projectId!)
        .order('cycle', { ascending: true, nullsFirst: false })
        .order('source_file', { ascending: true })
        .order('item_no', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CorrectionItem[];
    },
  });
}
