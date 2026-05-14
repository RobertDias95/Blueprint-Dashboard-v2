import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { DmDaGroupRow } from '../lib/database.types';

// Q6.1: dm_da_groups read hook. Originally returned only (dm_name, da_name)
// pairs for the Draw Schedule grouping.
// Q7.3.b: extended select to include id + updated_at so TeamStructureEditor
// can pass them into the delete/upsert OCC RPCs. Output now exposes:
//   - .rows  — raw flat array with id/updated_at (Q7.3.b)
//   - .groups — grouped {dm, das[]} view (Q6.1; unchanged for DrawScheduleGrid)
// Q9.5.f-fix-20: sort by (dm_order, da_order) so DM column order matches V1
// (Lindsay → Derry → Brittani → Jade) and DAs render inside each DM per
// Bobby's explicit V1 layout. Falls back to (dm_name, da_name) for any rows
// missing order values (default 999 keeps them at the end).

export interface DmDaGroupView {
  dm: string;
  das: string[];
}

export function useDmDaGroups() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<DmDaGroupRow[]>({
    queryKey: queryKeys.dmDaGroups(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dm_da_groups')
        .select('id, dm_name, da_name, dm_order, da_order, updated_at')
        .order('dm_order', { ascending: true })
        .order('da_order', { ascending: true })
        .order('dm_name', { ascending: true })
        .order('da_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DmDaGroupRow[];
    },
  });

  const groups = useMemo<DmDaGroupView[]>(() => {
    // Preserve the server's sort order. A plain Map insertion-order walk
    // gives us DMs in (dm_order ASC) and DAs within each DM in (da_order
    // ASC), because the query already returned rows in that order.
    const byDm = new Map<string, string[]>();
    for (const row of q.data ?? []) {
      const list = byDm.get(row.dm_name) ?? [];
      list.push(row.da_name);
      byDm.set(row.dm_name, list);
    }
    return Array.from(byDm.entries()).map(([dm, das]) => ({ dm, das }));
  }, [q.data]);

  return { ...q, groups, rows: q.data ?? [] };
}
