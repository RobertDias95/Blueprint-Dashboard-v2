import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles } from '../lib/database.types';

// Q2: Single project's permits + cycles. Used by the project detail page.
// `enabled` guards against firing the query before the route param resolves
// or before the active tenant is known.

export function usePermitsByProject(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitWithCycles[]>({
    queryKey: queryKeys.permitsByProject(tenantId ?? '', projectId ?? ''),
    enabled: Boolean(projectId) && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permits')
        .select('*, permit_cycles(*)')
        .eq('project_id', projectId!)
        .order('id', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitWithCycles[];
    },
  });
}
