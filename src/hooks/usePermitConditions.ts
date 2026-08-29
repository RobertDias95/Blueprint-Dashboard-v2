import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
import type { PermitConditionRow } from '../lib/permitConditions';

// ===========================================================================
// ★★★ fix-438 — reading the standing conditions, and saying "I know"
// ===========================================================================
//
// ★★ ONE READ, TENANT-WIDE, ROUTED IN THE BUILDER. The RPC returns every open
// condition and `buildNewItems` keeps the ones whose `ent_lead` is the viewer.
// That is the same shape as flips and permits and for the same reason: the
// board and the bell share one builder, and a server-side per-viewer query
// would give them two answers to "is this mine" — which is the drift fix-336
// spent a ticket collapsing.
//
// ★ It is a small read. Three permits carry open conditions today, and the
//   ceiling is "permits with something wrong", not "permits".

export function usePermitConditions() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitConditionRow[]>({
    queryKey: queryKeys.permitConditions(tenantId ?? ''),
    enabled: !!tenantId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_permit_conditions', {
        p_open_only: true,
      });
      if (error) throw error;
      return (data ?? []) as PermitConditionRow[];
    },
  });
}

/**
 * ★★★ ACKNOWLEDGE, AND THERE IS NO RESOLVE.
 *
 * Bobby's ruling in as many words: a condition holds until the condition
 * changes. Acknowledging stamps the CURRENT material detail hash server-side;
 * the item disappears while the hash matches and comes back when it does not.
 * Nothing here marks a read row — that is deliberate. A read row would make the
 * re-surfaced item arrive already-read and never reach the badge, which would
 * quietly undo the one thing acknowledging is supposed to leave working.
 *
 * ★ Same precedent as fix-339's shared "Got it": the action is the domain
 *   write, and the item leaves the list because the fact behind it changed.
 */
export function useAcknowledgeCondition() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.rpc('bp_acknowledge_permit_condition', {
        p_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.permitConditionsAll,
      });
    },
    onError: (error) => {
      // ★ The server refuses anyone who is not the permit's ENT lead or an
      //   admin. That refusal is a sentence a person can act on, so it is shown
      //   rather than swallowed.
      pushToast(`Could not acknowledge — ${error.message}`, 'error');
    },
  });
}
