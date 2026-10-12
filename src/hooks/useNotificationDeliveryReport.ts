import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { mapDeliveryReport, type DeliveryReport } from '../lib/notificationDelivery';

// ★ fix-650 §D — the admin report. One RPC; it refuses non-admins (42501), and
//   the route is admin-gated as well.
export function useNotificationDeliveryReport(days = 30) {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useQuery<DeliveryReport>({
    queryKey: ['notification_delivery_report', tenantId, days],
    enabled: !!tenantId,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_notification_delivery_report', {
        p_days: days,
      });
      if (error) throw error;
      return mapDeliveryReport(data);
    },
  });
}
