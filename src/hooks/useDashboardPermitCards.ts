import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { PermitCardSummary } from '../lib/dashboardCardSummary';

// fix-notes-2: per-permit "waiting on" summaries for the dashboard expanded
// cards. One tenant-wide RPC (bp_dashboard_permit_cards) returns only permits
// that have an open Entitlement/Architecture task or an active note — the
// client keys the result by permit id; an absent permit means "Nothing
// pending". Shares its cache across every ExpandedRow that reads it, and is
// invalidated by both permit_tasks and notes realtime changes (see queryKeys).

interface RpcRow {
  permit_id: number;
  ent_task: string | null;
  arch_task: string | null;
  note: string | null;
}

export function useDashboardPermitCards() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Map<number, PermitCardSummary>>({
    queryKey: queryKeys.dashboardPermitCards(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_dashboard_permit_cards');
      if (error) throw error;
      const map = new Map<number, PermitCardSummary>();
      for (const row of (data ?? []) as RpcRow[]) {
        map.set(row.permit_id, {
          entTask: row.ent_task,
          archTask: row.arch_task,
          note: row.note,
        });
      }
      return map;
    },
  });
}
