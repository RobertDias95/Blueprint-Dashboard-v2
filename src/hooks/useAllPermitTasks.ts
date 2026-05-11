import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_tasks')
        .select('*')
        .order('bucket', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitTask[];
    },
  });
}
