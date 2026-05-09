import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';

// Q6.1: dm_da_groups is a flat (dm_name, da_name) table; the draw schedule
// grid wants it grouped {dm: 'Lindsay', das: ['Francesca', ...]}.

export interface DmDaGroup {
  dm: string;
  das: string[];
}

interface FlatRow {
  dm_name: string;
  da_name: string;
}

export function useDmDaGroups() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const flat = useQuery<FlatRow[]>({
    queryKey: queryKeys.dmDaGroups(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dm_da_groups')
        .select('dm_name, da_name')
        .order('dm_name', { ascending: true })
        .order('da_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as FlatRow[];
    },
  });

  const groups = useMemo<DmDaGroup[]>(() => {
    const byDm = new Map<string, string[]>();
    for (const row of flat.data ?? []) {
      const list = byDm.get(row.dm_name) ?? [];
      list.push(row.da_name);
      byDm.set(row.dm_name, list);
    }
    return Array.from(byDm.entries()).map(([dm, das]) => ({ dm, das }));
  }, [flat.data]);

  return { ...flat, groups };
}
