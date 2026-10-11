import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';

// ===========================================================================
// ★★★ fix-638 §A (P-333) — THE DUE DATES THE REVIEWER VIEW DOES NOT CARRY
// ===========================================================================
//
// The popover's rows come from `permit_cycle_reviewers_current` (fix-454), and
// that VIEW does not expose `target_date` — measured on prod 2026-10-11: the
// table has it, the view's column list stops at `updated_at`. `select('*')`
// on the view therefore returned no due date at all, silently.
//
// ★★ Widening the view is a migration, and fix-638 is a no-migration ticket.
//    So the open popover asks the TABLE for exactly its own rows' dates — a
//    handful of ids, fetched only while the popover is open — instead of
//    putting every historical reviewer row back on the wire (fix-454's fix).
//
// ★ Keyed under the `permit_cycle_reviewers` prefix, so the realtime
//   invalidation that already refreshes the chip refreshes these too.

export function useReviewerTargetDates(ids: readonly string[]) {
  const sorted = [...ids].sort();
  return useQuery<Map<string, string | null>>({
    queryKey: [...queryKeys.permitCycleReviewersAll, 'target_dates', sorted],
    enabled: sorted.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_cycle_reviewers')
        .select('id, target_date')
        .in('id', sorted);
      if (error) throw error;
      const out = new Map<string, string | null>();
      for (const r of (data ?? []) as { id: string; target_date: string | null }[]) {
        out.set(r.id, r.target_date);
      }
      return out;
    },
  });
}
