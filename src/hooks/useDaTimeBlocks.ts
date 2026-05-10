import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { DaTimeBlock } from '../lib/database.types';

// Q6.2.c: read-only fetch for da_time_blocks (DA vacation/training/etc.
// overlay). Tenant scope enforced by RLS. Render-only in v2; admin
// editing is Q7+.

export function useDaTimeBlocks() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<DaTimeBlock[]>({
    queryKey: queryKeys.daTimeBlocks(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_time_blocks')
        .select('id, da_name, type, label, start_week, end_week, created_at')
        .order('da_name', { ascending: true })
        .order('start_week', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DaTimeBlock[];
    },
  });
}
