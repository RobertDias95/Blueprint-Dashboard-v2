import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { PermitType } from '../lib/database.types';

// Q7.3.a: read permit_types catalog. Sorted by builtin (true first), then name.

export function usePermitTypes() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitType[]>({
    queryKey: queryKeys.permitTypes(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_types')
        .select('name, is_builtin, notes')
        .order('is_builtin', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitType[];
    },
  });
}
