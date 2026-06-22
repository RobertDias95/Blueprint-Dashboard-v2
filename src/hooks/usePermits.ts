import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { fetchAllRows } from '../lib/fetchAllRows';
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
    // fix-189: paginate the top-level permits select so neither permits nor the
    // nested permit_cycles (831 rows and climbing — the embed rides along per
    // permit row) is ever silently truncated at the 1000-row cap as the company
    // grows. `id` is already a unique total order, so page boundaries are stable.
    queryFn: () =>
      fetchAllRows<PermitWithCycles>((from, to) =>
        supabase
          .from('permits')
          .select('*, permit_cycles(*)')
          .order('id', { ascending: true })
          .range(from, to),
      ),
  });
}
