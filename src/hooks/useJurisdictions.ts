import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { Jurisdiction } from '../lib/database.types';

// Q7.3.a: read jurisdictions catalog. Sorted alphabetically by name.

export function useJurisdictions() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Jurisdiction[]>({
    queryKey: queryKeys.jurisdictions(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jurisdictions')
        .select('name, learn_window_days, notes')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Jurisdiction[];
    },
  });
}
