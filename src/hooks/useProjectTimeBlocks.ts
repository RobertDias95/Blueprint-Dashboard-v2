import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { DaTimeBlock } from '../lib/database.types';

// ★★★ fix-384 — the blocks that point AT this project.
//
// This is what the project link buys, and without it the column would be one
// nobody fills: a link that changes nothing anybody can see is not worth
// typing. Somebody standing on a project asking "when did we design this?" is
// exactly who needs to see a second design window that draw_schedule cannot
// store, so the answer lives on the project's own page.
//
// ★★ A LINKED BLOCK IS STILL SOMEBODY'S TIME, NOT A DESIGN WINDOW OF RECORD.
// This hook reads da_time_blocks directly and is used by ONE card. It is
// deliberately not wired into any report, forecast or volume calculation —
// see migrations/fix_384_np_block_project_link.sql for why that matters.

/** The reverse lookup is cheap and rarely changes; the grid's own fetch is the
 *  hot path. Matching the daTimeBlocks list's freshness would re-ask a
 *  question whose answer moves about once a month. */
const FIVE_MINUTES = 5 * 60 * 1000;

export function useProjectTimeBlocks(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<DaTimeBlock[]>({
    queryKey: queryKeys.projectTimeBlocks(tenantId ?? '', projectId ?? ''),
    enabled: Boolean(projectId) && !!tenantId,
    staleTime: FIVE_MINUTES,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_time_blocks')
        .select(
          'id, da_name, type, label, start_week, end_week, created_at, updated_at, project_id',
        )
        .eq('project_id', projectId!)
        .order('start_week', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DaTimeBlock[];
    },
  });
}
