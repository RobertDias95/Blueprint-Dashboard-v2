import { useCallback } from 'react';
import { useUpsertTask } from './useTaskTree';
import { useTaskStatusOverlay } from '../lib/taskStatusOverlayContext';
import {
  taskStatusUpsertInput,
  type TaskStatusTarget,
} from '../lib/taskStatusWrite';
import {
  nextCheckboxStatus,
  writableStatus,
  type TaskStatus,
  type TaskWriteStatus,
} from '../lib/taskStatus';

// ===========================================================================
// ★★★ fix-434 — ONE write path, TWO entry points
// ===========================================================================
//
// P-063 (Bobby) wants the status chip on a row to be the control — *"being able
// to just mark something off as Resolved, Resolved, Resolved"* — and P-065
// (Miles) says the checkbox already on that row lags when clicked quickly. The
// two are one ticket because a control one click away is worth nothing if the
// list stalls the moment somebody uses it.
//
// ★★★ THIS IS NOT A SECOND IMPLEMENTATION. It calls `useUpsertTask` — the same
// mutation, the same `bp_upsert_permit_task` RPC, the same
// `permit_task_audit_trg` behind it — with a payload built by the one pure
// function in lib/taskStatusWrite. What it ADDS is the optimistic layer and the
// reconciliation policy, and it adds them for BOTH controls at once, which is
// the only way the two can be guaranteed not to drift.
//
// ★★ THE CHECKBOX AND THE CHIP DIFFER IN ONE THING ONLY: what status they are
// asking for. The checkbox computes it (forward-only, terminal at Resolved —
// fix-235); the chip is handed it. Everything after that point is shared.

/** Row shape both entry points hand over. */
export type StatusTargetTask = TaskStatusTarget & { status: TaskStatus };

export interface SetTaskStatusApi {
  /** Ask for an explicit status — the chip's trio. */
  setStatus: (task: StatusTargetTask, next: TaskWriteStatus) => void;
  /** ★ fix-235's forward-only advance, now reading the OPTIMISTIC current
   *  status rather than the render prop. That single change is what makes
   *  three fast clicks land on Resolved instead of three times on
   *  In Progress — see components/MyTasks/TaskStatusOverlay for the
   *  measurement. Returns false when the click was a no-op. */
  advance: (task: StatusTargetTask) => boolean;
}

export function useSetTaskStatus(): SetTaskStatusApi {
  const upsert = useUpsertTask();
  const overlay = useTaskStatusOverlay();
  const { set: setOverlay, readCurrent } = overlay;

  const setStatus = useCallback(
    (task: StatusTargetTask, next: TaskWriteStatus) => {
      // ★★★ ASKING FOR THE STATUS IT IS ALREADY ON IS A NO-OP, AND THE CHECK
      //    HAS TO BE MADE HERE. The chip cannot make it from its own props:
      //    ten clicks in one React batch produce no re-render, so all ten see
      //    the pre-burst status and all ten would look like real changes. This
      //    reads the ref, so click 2 already knows what click 1 asked for —
      //    which is what turns "ten clicks on Resolved" into ONE write.
      if (readCurrent(task.id, task.status) === next) return;
      // ★★★ SYNCHRONOUS, AND BEFORE THE MUTATION. The next click in the same
      //    batch reads this, so the two clicks cannot both decide from the
      //    same stale value.
      setOverlay(task.id, next);
      // ★★★ B3's ROLLBACK IS NOT HERE, AND THAT IS THE LESSON. It was, as
      //    `mutate(input, { onError })` — and it silently never ran, because
      //    an optimistic tick moves the row to a different sub-column, which
      //    unmounts the card, and React Query discards a mutation's PER-CALL
      //    callbacks when the caller unmounts. The toast fired, the correcting
      //    refetch landed, and the row still read "Resolved". The clear lives
      //    in the mutation's own onError now — see hooks/useTaskTree.
      upsert.mutate(taskStatusUpsertInput(task, next));
    },
    [readCurrent, setOverlay, upsert],
  );

  const advance = useCallback(
    (task: StatusTargetTask): boolean => {
      const current = readCurrent(task.id, task.status);
      const next = nextCheckboxStatus(current);
      if (!next) return false; // Resolved is terminal on the checkbox
      setStatus(task, writableStatus(next));
      return true;
    },
    [readCurrent, setStatus],
  );

  // ★ There is deliberately no `displayStatus` here. The row does NOT resolve
  //   its own status: `MineTasks` applies the overlay to the whole array before
  //   anything is grouped or counted, so the card, its column and every counter
  //   read one value. A per-card resolver would have let the chip say one thing
  //   while the OPEN counter beside it said another — fix-409's rule broken in
  //   a new place.
  return { setStatus, advance };
}
