import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleRow } from '../lib/database.types';

// Q2: All draw_schedule rows. Q6 will add interactivity; Q2 just needs the
// status field to drive the DE early/late split on the dashboard matrix.

export function useDrawSchedule() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<DrawScheduleRow[]>({
    queryKey: queryKeys.drawSchedule(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('draw_schedule')
        .select('*');
      if (error) throw error;
      return (data ?? []) as DrawScheduleRow[];
    },
  });
}
