import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { fetchAllRows } from '../lib/fetchAllRows';
import type { PermitTask } from '../lib/database.types';

// Q7.1.a: cross-permit fetch of every permit_task for the active tenant.
// Different from usePermitTasks(permitId), which narrows to one permit.
// My Tasks aggregates across permits and joins client-side against
// usePermits + useProjects for address/permit-label display.
//
// Realtime invalidation reuses the existing permit_tasks bare-prefix key
// (queryKeys.permitTasksAll), so cycle/task edits on Project Detail flow
// through to My Tasks automatically.

export function useAllPermitTasks() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitTask[]>({
    queryKey: queryKeys.permitTasks(tenantId ?? ''),
    enabled: !!tenantId,
    // fix-189: paginate so the cross-permit task list never silently truncates
    // at the 1000-row cap as task volume grows. `id` is the unique tiebreaker
    // that keeps the page boundaries stable.
    queryFn: () =>
      fetchAllRows<PermitTask>((from, to) =>
        supabase
          .from('permit_tasks')
          .select('*')
          .order('bucket', { ascending: true })
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
  });
}
