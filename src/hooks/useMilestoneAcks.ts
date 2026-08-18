import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
import type { PermitMilestoneAck } from '../lib/myBoard';

// fix-298 Phase 2: read + write for permit_milestone_acks.
//
// An ack records that a person performed a milestone that has NO TASK behind
// it — "pay issuance fees", "ping the reviewer" — so the board stops re-raising
// it tomorrow morning. It also carries the design-complete confirmation.
//
// ★ Deliberately NOT a retrospective resolved task. permit_tasks counts feed
// the design-leg rule ("at least one design task existed and all are
// resolved"), so writing a synthetic task to record an ENTITLEMENT action
// would change whether the permit reads as ready to hand off. See the
// migration for the full reasoning.
//
// Append-only by grant as well as by policy: `authenticated` holds SELECT and
// INSERT and nothing else.

// ★ fix-336: the bare prefix moved to lib/queryKeys so REALTIME_TABLES can
// name it — a handoff acknowledged by the design side now reaches the
// entitlement lead's bell without a reload.
const ACKS_KEY = queryKeys.milestoneAcksAll;

export function useMilestoneAcks() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitMilestoneAck[]>({
    queryKey: [...ACKS_KEY, tenantId ?? ''],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_milestone_acks')
        .select('id, permit_id, milestone, anchor, acked_by_name, acked_at')
        .order('acked_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PermitMilestoneAck[];
    },
  });
}

export interface AckMilestoneInput {
  permitId: number;
  /** MilestoneKind, or 'design_complete' for the handoff confirmation. */
  milestone: string;
  /** The milestone's driving value at ack time — see milestoneAnchor(). */
  anchor: string | null;
  /** Roster name, denormalised so the board can say who without a join. */
  ackedByName: string | null;
  note?: string | null;
}

export function useAckMilestone() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useMutation<void, Error, AckMilestoneInput>({
    mutationFn: async (input) => {
      const { error } = await supabase.from('permit_milestone_acks').insert({
        permit_id: input.permitId,
        milestone: input.milestone,
        anchor: input.anchor,
        acked_by: userId,
        acked_by_name: input.ackedByName,
        note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACKS_KEY });
    },
    onError: (error) => {
      pushToast(`Could not record that — ${error.message}`, 'error');
    },
  });
}
