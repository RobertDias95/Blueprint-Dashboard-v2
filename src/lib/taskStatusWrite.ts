import type { TaskWriteStatus } from './taskStatus';

// ===========================================================================
// ★★★ fix-434 §A2 — ONE payload, so two controls cannot drift
// ===========================================================================
//
// P-063 asks for the status chip on a My Tasks row to become a control. The row
// already HAS a status control — the click-to-advance checkbox — and the danger
// the brief names is real: *two controls on one row writing different fields is
// the bug this ticket must not create.*
//
// ★★★ SO THE PAYLOAD IS A PURE FUNCTION AND BOTH CONTROLS CALL IT. Not "both
// controls were written to match"; there is one expression of the payload and
// two callers. A test asserts the chip and the checkbox produce byte-identical
// input for the same transition, and a third assertion pins it against what the
// detail-pane dropdown sends (components/TaskDetailEditor `patch`), which was
// already identical and must stay so.
//
// ★★ WHY EVERY FIELD IS RE-SENT. `bp_upsert_permit_task` OVERWRITES
// start_date/target_date rather than leaving them alone (fix-224 found this the
// hard way — a cross-view date erase Jade and Erick both reported). So a
// status-only write still has to carry the row's current dates, text,
// discipline, bucket and parent. Send less and you silently null a column.
//
// ★★★ THE AUDIT COMES FOR FREE AND THAT IS WHY THIS GOES THROUGH THE RPC.
// `permit_task_audit_trg` is an AFTER INSERT OR DELETE OR UPDATE trigger on
// `permit_tasks` itself (verified on prod 2026-08-29; 2,781 rows since
// 2026-08-04). It fires for every writer — RPC, scraper, migration — so a
// second control cannot skip the audit as long as it writes through the table.
// What a NEW write path could do is bypass the RPC's other guarantees, which is
// exactly why there is no new write path here.

/** The fields a status write reads off the row. Structurally typed so both the
 *  My Tasks `MyTaskNode` and the permit-tree `TaskNode` satisfy it without
 *  either importing the other. */
export interface TaskStatusTarget {
  id: string;
  permit_id: number;
  parent_task_id: string | null;
  discipline: 'arch' | 'ent';
  bucket?: 'de' | 'pm' | null;
  text: string;
  start_date: string | null;
  target_date: string | null;
}

/** The exact `useUpsertTask` input for a status change. */
export interface TaskStatusUpsertInput {
  id: string;
  permitId: number;
  parentTaskId: string | null;
  discipline: 'arch' | 'ent';
  bucket?: 'de' | 'pm' | null;
  text: string;
  status: TaskWriteStatus;
  startDate: string | null;
  targetDate: string | null;
  /** ★★ fix-434 §B: marks this as a STATUS-ONLY write so the mutation can
   *  reconcile with one coalesced refetch instead of one per click. Nothing
   *  about WHAT is written changes — see hooks/useTaskTree. */
  statusOnly: true;
}

export function taskStatusUpsertInput(
  task: TaskStatusTarget,
  status: TaskWriteStatus,
): TaskStatusUpsertInput {
  return {
    id: task.id,
    permitId: task.permit_id,
    parentTaskId: task.parent_task_id,
    discipline: task.discipline,
    bucket: task.bucket,
    text: task.text,
    status,
    startDate: task.start_date,
    targetDate: task.target_date,
    statusOnly: true,
  };
}
