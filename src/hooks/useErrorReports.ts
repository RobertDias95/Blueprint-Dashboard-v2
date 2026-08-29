import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';

// fix-87: hooks for the Settings → Errors page + the nav warning-triangle
// badge. Three RPCs:
//   bp_list_error_groups(status[])   — page list
//   bp_update_error_group_status(...) — page actions
//   bp_new_error_count()              — nav badge
//
// Both read RPCs are STABLE on the server; this hook layer caches them
// alongside the rest of the app's data. Realtime invalidation already
// covers error_reports via the bare-prefix queryKeys.errorReportsAll
// (REALTIME_TABLES wiring lives in queryKeys.ts).

export type ErrorGroupStatus =
  | 'new'
  | 'queued'
  | 'in_progress'
  | 'resolved'
  | 'dismissed';

export type ErrorGroupSource =
  | 'frontend_toast'
  | 'frontend_exception'
  | 'backend_rpc'
  | 'scraper';

export interface ErrorGroup {
  fingerprint: string;
  source: ErrorGroupSource;
  level: 'error' | 'warning';
  sample_message: string;
  sample_context: Record<string, unknown> | null;
  status: ErrorGroupStatus;
  first_seen: string;
  last_seen: string;
  /** ★ fix-338: EVERY occurrence of this fingerprint. It used to be "occurrences
   *  that survived the status filter", which the page rendered as
   *  "occurrences" — so a group with one resolved and one new row read as
   *  "New · 1 occurrence" and hid the fact it had been triaged already. */
  count: number;
  user_count: number;
  /** ★★★ fix-438 C2: how many DISTINCT permits this group touches.
   *
   *  The number that was missing, and the one that changes the reading
   *  entirely. Measured on prod 2026-08-29: the largest group is 89
   *  occurrences and **89 distinct permits** — once each — while the
   *  resubmittal group is 25 occurrences over **3**. "89 occurrences" and "89
   *  permits" are the same size and opposite meanings: one is a permit in
   *  trouble, the other is a bad afternoon across the whole book.
   *
   *  0 when nothing in the group's context names a permit, which is how a
   *  Bridge error stays silent about permits. */
  permit_count: number;
  /** ★ fix-338: how many occurrences were already resolved or dismissed. */
  resolved_count: number;
  /** When it was last marked resolved, if ever. */
  last_resolved_at: string | null;
  /** ★★ fix-338: closed at least once, and open again. The difference between
   *  "new problem" and "the fix did not hold" — the fact Bobby was reaching for
   *  when he said "I just felt like they were already marked as resolved". */
  recurred: boolean;
  backlog_ref: string | null;
}

/** Fetch the aggregate groups for one or more statuses. Empty string array
 *  → no filter (server defaults to [new, queued, in_progress]). */
/**
 * ★★★ fix-438 C1 — SCRAPER ROWS ARE NOT LISTED, AND NOT DELETED.
 *
 * Bobby's ruling: Error Triage keeps BRIDGE errors. Measured 2026-08-29, the
 * panel was 173 open scraper warnings beside 6 open Bridge errors — 96% of it
 * was not what it is for. The 229 historical scraper rows stay in the table,
 * un-listed; `p_include_scraper` makes them reachable rather than erased, and
 * nothing UPDATEs them (marking them resolved would be a claim nobody made).
 *
 * The scraper stops writing them in fix-439; conditions go to
 * `permit_conditions` and reach their ENT lead as a notification instead.
 */
export function useErrorGroups(statuses: ErrorGroupStatus[]) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  // Sort the status list so the queryKey is order-independent — caller
  // passes ['queued','new'] vs ['new','queued'] and we still hit the same
  // cache entry.
  const sorted = [...statuses].sort();
  return useQuery<ErrorGroup[]>({
    queryKey: queryKeys.errorGroups(tenantId ?? '', sorted),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_error_groups', {
        p_status: sorted,
        // ★ Explicit, though it is the server default too. The one place a
        //   reader looks to answer "does this panel show scraper rows" should
        //   not be a DEFAULT in a migration.
        p_include_scraper: false,
      });
      if (error) throw error;
      return (data ?? []) as ErrorGroup[];
    },
  });
}

/** Cheap count for the nav badge. Polled every 30s in addition to the
 *  realtime invalidation on the error_reports prefix. */
export function useNewErrorCount() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<number>({
    queryKey: queryKeys.newErrorCount(tenantId ?? ''),
    enabled: !!tenantId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      // ★ C3: the badge counts what the page lists. Two functions, one flag,
      //   one default — a badge counting a different set from the page it
      //   opens is the disagreement fix-432 spent a ticket removing.
      const { data, error } = await supabase.rpc('bp_new_error_count', {
        p_include_scraper: false,
      });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });
}

export interface UpdateErrorGroupStatusInput {
  fingerprint: string;
  newStatus: ErrorGroupStatus;
  backlogRef?: string | null;
}

/** Bulk status update across every row with a given fingerprint. Triggers
 *  invalidation of every error_reports cache so the page + badge refresh
 *  together. */
export function useUpdateErrorGroupStatus() {
  const queryClient = useQueryClient();
  return useMutation<number, Error, UpdateErrorGroupStatusInput>({
    mutationKey: ['bp_update_error_group_status'],
    mutationFn: async ({ fingerprint, newStatus, backlogRef }) => {
      const { data, error } = await supabase.rpc(
        'bp_update_error_group_status',
        {
          p_fingerprint: fingerprint,
          p_new_status: newStatus,
          p_backlog_ref: backlogRef ?? null,
        },
      );
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.errorReportsAll });
    },
  });
}
