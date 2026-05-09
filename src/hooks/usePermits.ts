import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles } from '../lib/database.types';

// Q2: All permits with their cycles attached via Supabase nested select.
// The dashboard matrix consumes this for stage classification. Cycles are
// required for effectiveStage(); fetching them inline is one round trip
// instead of N+1.
//
// Q5.5.D: tenant-scoped via RLS; cache key includes activeTenantId.

export function usePermits() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitWithCycles[]>({
    queryKey: queryKeys.permits(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permits')
        .select('*, permit_cycles(*)')
        .order('id', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitWithCycles[];
    },
  });
}
