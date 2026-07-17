import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type {
  WeeklyDaReportFilters,
  WeeklyDaReportPayload,
} from '../lib/database.types';

// fix-67: Weekly DA Update report (Reports hub Phase 1). Reads via the
// bp_get_weekly_da_report RPC, which joins permits + projects + the latest
// cycle + each permit's newest ACTIVE unified note (public.notes — fix-notes-4,
// replacing the old report_notes table) and returns a DA-grouped payload. RLS /
// the RPC's explicit tenant filter scope rows to the caller's tenant.
//
// The data is cheap, so we lean toward auto-refresh: the query key folds in
// week_start + window + filters, so the report re-runs whenever any of those
// change. No manual "Generate" gating needed (the component still offers a
// refresh affordance via refetch).

export const WEEKLY_DA_REPORT_WINDOW_DEFAULT = 14;

/** Strip empty-string filter values so the query key + RPC payload stay
 *  stable (an empty dropdown selection means "no filter", not ""). */
function compactFilters(
  filters: WeeklyDaReportFilters,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v;
  }
  return out;
}

export function useWeeklyDaReport(
  weekStart: string,
  windowDays: number = WEEKLY_DA_REPORT_WINDOW_DEFAULT,
  filters: WeeklyDaReportFilters = {},
) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const compact = compactFilters(filters);

  return useQuery<WeeklyDaReportPayload>({
    queryKey: queryKeys.weeklyDaReport(
      tenantId ?? '',
      weekStart,
      windowDays,
      compact,
    ),
    // Need both a tenant and a week anchor before the RPC can run.
    enabled: !!tenantId && !!weekStart,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_get_weekly_da_report', {
        p_week_start: weekStart,
        p_window_days: windowDays,
        p_filters: compact,
      });
      if (error) throw error;
      // The RPC returns a single jsonb value (not a row set).
      return (data ?? {
        das: [],
        generated_at: new Date().toISOString(),
        week_start: weekStart,
        window_days: windowDays,
      }) as WeeklyDaReportPayload;
    },
    staleTime: 30 * 1000,
  });
}
