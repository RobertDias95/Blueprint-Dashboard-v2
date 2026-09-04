import type { PermitCycle } from './database.types';

// ===========================================================================
// ★★★ fix-494 (P-155) — "SUBMITTED" MEANS ONE THING
// ===========================================================================
//
// Bobby, 2026-09-04, on `5811 Greenwood Ave N` / `7128829-CN` (permit 316):
// *"why did the task get created in the design bucket if the project is under
// corrections for the architect?"*
//
// Miles made a task from a chat message on a permit submitted 2026-06-25,
// intake accepted 2026-06-26, corrections issued that morning. It landed in
// **D&E**.
//
// ---------------------------------------------------------------------------
// ★★★ BECAUSE THERE WERE TWO DEFINITIONS OF "SUBMITTED" AND THEY DISAGREED
// ---------------------------------------------------------------------------
//   the permit SCREEN   `c0.intake_accepted`   (PermitDetailV2, fix-123)
//   the DB TRIGGER      `c0.submitted`         (bp_trg_permit_task_default_bucket,
//                                               fix-79)
//
// On permit 316: `c0.submitted` is NULL, `c0.intake_accepted` is 2026-06-26,
// and `c1.submitted` is 2026-06-25. The screen said Permitting; the database
// said D&E; a chat task sends no bucket, so the database won.
//
// ★★★ MEASURED ON PROD 2026-09-04: **58 of 261 open permits** are in that
//     shape. Every chat-created task on any of them went to the wrong phase.
//
// ---------------------------------------------------------------------------
// ★★ THIS IS THE TYPESCRIPT TWIN OF `bp_permit_is_submitted`
// ---------------------------------------------------------------------------
// Same three signals, same order, deliberately. THREE readers now share one
// rule — the chat composer (which sends the bucket), the permit screen (which
// picks its opening tab) and the trigger (which fills in a bucket nobody sent).
// D-2026-09-02: consistency is a brand rule. A test asserts the two stay in
// step by reading the migration's own SQL.

/** The shape both callers can supply — the permit's cycles, nothing else. */
export interface PermitCyclesLike {
  permit_cycles?: PermitCycle[] | null;
}

/**
 * ★★★ IS THIS PERMIT WITH THE CITY?
 *
 * True when **any** of three things is true:
 *
 *   · cycle 0 has an `intake_accepted`  — the city accepted intake
 *   · cycle 0 has a `submitted`         — cycle 0 went in
 *   · any cycle ≥ 1 has a `submitted`   — a resubmittal
 *
 * ★★ NONE OF THE THREE IS MORE AUTHORITATIVE THAN THE OTHERS. Requiring
 *    `c0.submitted` alone is precisely what misfiled permit 316's task: that
 *    permit has the other two and not that one. Requiring
 *    `c0.intake_accepted` alone would misfile the mirror case — a permit
 *    submitted but not yet accepted at intake.
 *
 * ★ A permit with no cycles at all is NOT submitted, which is right: nothing
 *   has been sent anywhere. That is the `'de'` fallthrough both sides share.
 */
export function permitIsSubmitted(
  permit: PermitCyclesLike | null | undefined,
): boolean {
  const cycles = permit?.permit_cycles;
  if (!Array.isArray(cycles)) return false;
  return cycles.some((c) =>
    c.cycle_index === 0
      ? c.intake_accepted != null || c.submitted != null
      : c.cycle_index >= 1 && c.submitted != null,
  );
}

/** The phase a new task on this permit belongs in. */
export type TaskBucket = 'de' | 'pm';

/**
 * ★ The one place the boolean becomes a bucket, so no caller writes the
 *   ternary itself and gets it backwards.
 */
export function defaultTaskBucket(
  permit: PermitCyclesLike | null | undefined,
): TaskBucket {
  return permitIsSubmitted(permit) ? 'pm' : 'de';
}

/** ★ What the composer shows the poster before they press Send — the phase the
 *  task will land in, in the words the tabs use. */
export const TASK_BUCKET_LABEL: Record<TaskBucket, string> = {
  de: 'D&E',
  pm: 'Permitting',
};
