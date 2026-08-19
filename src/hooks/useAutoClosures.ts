import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { AutoClosureItemInput } from '../lib/boardReads';

// fix-354 — the closures the machine made, for the board to report.
//
// ★★ ONE ROW PER (permit, closure, recipient), already grouped and already
// routed by the database — see bp_auto_close_recipient. The client's only job
// is to ask "is that me", which buildNewItems does.
//
// ★ BOUNDED BY TIME, not by count. These accumulate forever and a notification
// about work closed in March is not news; 60 days is comfortably longer than
// anything that could still be unread, and it keeps the query flat as the
// ledger grows. The board's other sources are naturally bounded (open tasks,
// live permits) — this one is not, so it says so here.
const WINDOW_DAYS = 60;

export function useAutoClosures() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<AutoClosureItemInput[]>({
    queryKey: [...queryKeys.autoClosuresAll, tenantId ?? ''],
    enabled: !!tenantId,
    queryFn: async () => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('permit_task_auto_closures')
        .select(
          'id, permit_id, reason, recipient, task_count, closed_at, ' +
            'permits!inner(project_id, num, type, projects!inner(address))',
        )
        .gte('closed_at', since)
        .order('closed_at', { ascending: false });
      if (error) throw error;
      type Row = {
        id: string;
        permit_id: number;
        reason: string;
        recipient: string;
        task_count: number;
        closed_at: string;
        permits: {
          project_id: string | null;
          num: string | null;
          type: string | null;
          projects: { address: string | null } | null;
        } | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        permit_id: r.permit_id,
        project_id: r.permits?.project_id ?? null,
        address: r.permits?.projects?.address ?? null,
        // ★ The same label shape the rest of the board uses: number and type
        // when there is a number, type alone when there is not. Never blank.
        permit_label: (r.permits?.num ?? '').trim()
          ? `${r.permits!.num} · ${r.permits?.type ?? 'Permit'}`
          : (r.permits?.type ?? 'Permit'),
        reason: r.reason,
        recipient: r.recipient,
        task_count: r.task_count,
        closed_at: r.closed_at,
      }));
    },
  });
}
