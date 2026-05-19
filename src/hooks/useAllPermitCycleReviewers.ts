import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
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

export function useAllPermitCycleReviewers() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitCycleReviewer[]>({
    queryKey: queryKeys.permitCycleReviewers(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_cycle_reviewers')
        .select('*')
        .order('cycle_index', { ascending: false })
        .order('reviewer_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitCycleReviewer[];
    },
  });
}
