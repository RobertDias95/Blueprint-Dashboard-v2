import { useCallback, useState } from 'react';
import { useAckMilestone } from './useMilestoneAcks';
import { useUpsertTask } from './useTaskTree';
import { pushToast } from '../stores/toastStore';

// fix-298 Phase 2 — the handoff.
//
// "All design tasks are done. Hand this to Miles to resubmit?" On confirm:
//   1. the design leg is marked complete (a design_complete ack, anchored on
//      the current cycle so a fresh round of corrections asks again), and
//   2. the submittal task is created, ASSIGNED TO THE ENTITLEMENT LEAD.
//
// The lead does not have to notice — it arrives on their board and in their
// My Tasks, because step 2 goes through the SAME useUpsertTask hook the My
// Tasks checkbox uses. There is deliberately no second task-creation path.
//
// Order matters: the task is created FIRST. If the ack landed first and the
// task insert then failed, the permit would read "handed off" with nothing
// waiting for the lead — the silent-failure shape this whole feature exists to
// remove. This way the worst case is a task with no ack, which simply means
// the prompt is still showing and can be confirmed again.

export const SUBMITTAL_TASK_TEXT = 'Resubmit to the city';

export interface ConfirmHandoffInput {
  permitId: number;
  /** Current cycle index, the ack's anchor. */
  cycleIndex: number | null;
  /** Who the submittal task is assigned to. */
  entLead: string | null;
  /** Roster name of the person confirming. */
  byName: string | null;
  /** True when the permit had NO design tasks and a person is vouching. */
  manual?: boolean;
}

export function useConfirmHandoff() {
  const ack = useAckMilestone();
  const upsertTask = useUpsertTask();
  const [pendingId, setPendingId] = useState<number | null>(null);

  const confirm = useCallback(
    async (input: ConfirmHandoffInput) => {
      setPendingId(input.permitId);
      try {
        // 1. The submittal task, assigned to the entitlement lead.
        await upsertTask.mutateAsync({
          permitId: input.permitId,
          discipline: 'ent',
          text: SUBMITTAL_TASK_TEXT,
          status: 'Open',
          assignedTo: input.entLead ?? undefined,
        });
        // 2. Only then, the design-leg confirmation.
        await ack.mutateAsync({
          permitId: input.permitId,
          milestone: 'design_complete',
          anchor: input.cycleIndex === null ? null : String(input.cycleIndex),
          ackedByName: input.byName,
          note: input.manual ? 'Marked complete manually (no design tasks)' : null,
        });
        pushToast(
          input.entLead
            ? `Handed to ${input.entLead} to resubmit`
            : 'Design marked complete',
          'success',
        );
      } finally {
        setPendingId(null);
      }
    },
    [ack, upsertTask],
  );

  return { confirm, pendingId, isPending: ack.isPending || upsertTask.isPending };
}
