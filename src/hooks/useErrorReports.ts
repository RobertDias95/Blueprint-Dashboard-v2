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
  count: number;
  user_count: number;
  backlog_ref: string | null;
}

/** Fetch the aggregate groups for one or more statuses. Empty string array
 *  → no filter (server defaults to [new, queued, in_progress]). */
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
      const { data, error } = await supabase.rpc('bp_new_error_count');
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
