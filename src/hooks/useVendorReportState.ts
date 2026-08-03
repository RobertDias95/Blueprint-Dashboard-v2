import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { VendorLedgerRow, VendorSentRow } from '../lib/vendorReport';

// fix-265: the vendor send ledger — what an external vendor was LAST told about
// each project. Read side drives the New / Changed bucketing on the forecast;
// write side is the explicit "Mark as sent" action.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: composing an email must never write the
// ledger. Only useMarkVendorReportSent writes, and it is wired to its own button
// — Bobby previews drafts he does not send, and a compose that silently marked
// things sent would make those projects vanish from next week's email. If you
// are ever tempted to "helpfully" call the mutation from the compose handler,
// that is the bug the whole feature was built to avoid.

/** Every ledger row for one vendor in the active tenant. */
export function useVendorReportState(vendorKey: string) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<VendorLedgerRow[]>({
    queryKey: queryKeys.vendorReportState(tenantId ?? '', vendorKey),
    enabled: !!tenantId && !!vendorKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_report_state')
        .select('project_id, sent_start_week, sent_dd_end, sent_status, sent_at')
        .eq('vendor_key', vendorKey);
      if (error) throw error;
      return (data ?? []) as unknown as VendorLedgerRow[];
    },
  });
}

export interface MarkVendorReportSentInput {
  vendorKey: string;
  rows: VendorSentRow[];
}

/** Record a send: upsert the ledger for EXACTLY the rows that were included.
 *
 *  Idempotent by construction (the RPC upserts on the PK), which is what makes
 *  "mark sent twice in a row leaves nothing new or changed" true. Invalidating
 *  the bare prefix re-buckets the report immediately. */
export function useMarkVendorReportSent() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, MarkVendorReportSentInput>({
    mutationFn: async (input) => {
      const { error } = await supabase.rpc('bp_mark_vendor_report_sent', {
        p_tenant_id: tenantId,
        p_vendor_key: input.vendorKey,
        p_rows: input.rows,
      });
      if (error) throw error;
      return input.rows.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vendorReportStateAll });
      pushToast(
        `Marked ${count} project${count === 1 ? '' : 's'} as sent`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not mark as sent — ${error.message}`, 'error');
    },
  });
}
