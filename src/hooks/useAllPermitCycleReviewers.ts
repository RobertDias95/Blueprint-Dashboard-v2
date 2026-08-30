import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { fetchAllRows } from '../lib/fetchAllRows';
import type { PermitCycleReviewer } from '../lib/database.types';

// fix-31: cross-permit fetch of every permit_cycle_reviewers row for the
// active tenant. Project Overview's Schedule Health table indexes the
// result by permit_id client-side. Tenant scoping is handled by RLS;
// no extra filter needed.
//
// Realtime invalidation: useRealtimeInvalidation hooks into
// REALTIME_TABLES['permit_cycle_reviewers'] = [permitCycleReviewersAll],
// so when the scraper upserts a reviewer row the cache invalidates
// automatically.

/** ★★★ fix-454 §A (P-104): the source is the VIEW, not the table.
 *
 *  Half of what this hook fetched was cycle history that every one of its EIGHT
 *  consumers immediately discarded. Measured on prod 2026-08-30: 2,597 rows /
 *  919 kB, of which 1,359 (52.3%) sat below their permit's current cycle. fix-189
 *  paginated this query when it crossed 1,000 rows; it had since grown 2.6x to
 *  three round trips — and because REALTIME_TABLES invalidates the prefix key,
 *  ONE scraper write re-pulled all of it for every open client.
 *
 *  ★★★ NOT A PRUNE. `permit_cycle_reviewers` still holds every historical row and
 *  this ticket writes none of them; see migrations/fix_454_current_cycle_reviewers.
 *  fix-185 was already scoping every consumer to the current cycle CORRECTLY —
 *  the defect was only ever that the rest was put on the wire.
 *
 *  ★★★ AND THE VIEW IS "LATEST CYCLE **THAT HAS ROWS**", NOT "THE CURRENT CYCLE",
 *  which is the one thing here that is easy to get wrong. fix-186 renders a third
 *  state — "Cycle N — not yet assigned" — when the current cycle has no reviewer
 *  rows but an earlier one does, and both sites detect it from the bare EXISTENCE
 *  of history (`rows.length > 0`, at ReviewerRollupChip:136 and
 *  projectViewHelpers:180). A strict current-cycle filter returns nothing at all
 *  for exactly those permits — 15 of them on prod — so the flag would have
 *  flipped to false and the explanation would have silently become a dash.
 *  Keeping each permit's latest NON-EMPTY cycle makes every consumer's input
 *  byte-identical to the table's, so not one line of consumer logic moved.
 *
 *  Result: 2,597 rows / 919 kB -> 1,293 rows / 456 kB, and 3 round trips -> 2.
 *
 *  ★ The query key is deliberately UNCHANGED, so REALTIME_TABLES'
 *  `['permit_cycle_reviewers']` prefix still invalidates this query when the
 *  scraper writes the underlying table. The view is not itself published (and
 *  cannot be — a view carries no replica identity); the table it reads is. */
export const ALL_PERMIT_CYCLE_REVIEWERS_SOURCE =
  'permit_cycle_reviewers_current';

export function useAllPermitCycleReviewers() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitCycleReviewer[]>({
    queryKey: queryKeys.permitCycleReviewers(tenantId ?? ''),
    enabled: !!tenantId,
    // fix-189: paginate — permit_cycle_reviewers crossed 1000 rows, so a bare
    // un-ranged select silently truncated to the first 1000 and dropped the
    // tail (e.g. an in_review reviewer landing past row 1000 made its permit
    // read "Corrections" instead of "Permitting"). `id` is appended as a unique
    // tiebreaker so the page boundaries are stable.
    //
    // ★ fix-454 KEEPS THE PAGINATION. The narrowed set is 1,293 rows today —
    //   still over PostgREST's 1,000-row cap, so dropping fetchAllRows here
    //   would re-introduce fix-189's exact bug with a smaller margin. The
    //   postgrest-1000-row-cap rule is standing and this is not an exception.
    queryFn: () =>
      fetchAllRows<PermitCycleReviewer>((from, to) =>
        supabase
          .from(ALL_PERMIT_CYCLE_REVIEWERS_SOURCE)
          .select('*')
          .order('cycle_index', { ascending: false })
          // fix-251: reviewer_name is nullable (unassigned pending slots).
          // nullsFirst is pinned explicitly so page boundaries stay stable
          // regardless of PostgREST's default — this ordering feeds a
          // paginated fetch, and `id` below is the unique tiebreaker.
          .order('reviewer_name', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to),
      ),
  });
}
