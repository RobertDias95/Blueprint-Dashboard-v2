import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAllRows';
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
      // ★★ fix-627 §B (P-322): 305 rows today — one per project, so it grows
      //    without bound. `project_id` is the PK, so ordering by it is total.
      //    A truncated draw schedule would silently lose lanes off the board.
      const data = await fetchAllRows<DrawScheduleRow>((from, to) =>
        supabase
          .from('draw_schedule')
          .select('*')
          .order('project_id', { ascending: true })
          .range(from, to),
      );
      return data;
    },
  });
}
