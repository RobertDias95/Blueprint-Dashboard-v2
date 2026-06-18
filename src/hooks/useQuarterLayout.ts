import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleQuarterLayoutRow } from '../lib/database.types';

// fix-182b: read one quarter's saved Draw Schedule column layout, ordered
// left-to-right by `position`. Used by the Settings editor only — the live
// grid does not read this yet (Phase C). Disabled until both a tenant and a
// quarter are known.

export function useQuarterLayout(quarter: string | null) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<DrawScheduleQuarterLayoutRow[]>({
    queryKey: queryKeys.drawScheduleQuarterLayout(tenantId ?? '', quarter ?? ''),
    enabled: !!tenantId && !!quarter,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('draw_schedule_quarter_layout')
        .select(
          'id, quarter, position, col_kind, da_name, group_label, label_override, updated_at',
        )
        .eq('quarter', quarter as string)
        .order('position', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DrawScheduleQuarterLayoutRow[];
    },
  });

  return { ...q, rows: q.data ?? [] };
}
