import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { PermitType } from '../lib/database.types';

// Q7.3.a: read permit_types catalog. Sorted by builtin (true first), then name.
//
// ★ fix-680: `*` so ts_anchor (the Target Submit anchor) comes along. Not a
//   named column list: the client deploys before the migration is applied,
//   and naming a column that doesn't exist yet would fail EVERY type picker
//   in that window. A row without it parses as 'none'.

export function usePermitTypes() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitType[]>({
    queryKey: queryKeys.permitTypes(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_types')
        .select('*')
        .order('is_builtin', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitType[];
    },
  });
}
