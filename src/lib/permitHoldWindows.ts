import type { PermitHold, ProjectHold } from './database.types';

// ===========================================================================
// ★★★ fix-390 — THE UNION, AND THE ONE-WAY RULE IT ENCODES
// ===========================================================================
//
// Every hold-aware calculation in the app already takes an ARRAY OF WINDOWS:
// `accountableDays`, `activeHoldElapsedDays` and `intervalOverlapsHold` are all
// typed `Pick<ProjectHold,'hold_start'|'hold_end'>[] | HoldWindow[]` — they are
// structural, and never look at `project_id`. That is what makes permit holds
// cheap: a permit's own windows drop straight in beside its project's, and the
// held-days arithmetic, the projection shift and the learner exclusion all keep
// working with no change to any of them.
//
// ★★★ THE DIRECTION IS THE WHOLE TICKET. Reading DOWNWARD is right and is what
// this does: a permit is paused if its PROJECT is paused, or if IT is paused.
// Reading UPWARD would be the bug the ticket exists to prevent — one stuck ULS
// painting a project its BP is moving through — so there is deliberately no
// function here that takes permit holds and returns project state. If you find
// yourself wanting one, that is the moment to re-read this comment.

/** The minimal shape every hold-aware calculation actually consumes. */
export type HoldWindowLike = Pick<ProjectHold, 'hold_start' | 'hold_end'>;

/**
 * Every hold window that pauses THIS permit — its project's holds plus its own.
 *
 * ★ Order does not matter (`holdOverlap` merges and clamps), and duplicates are
 * harmless for the same reason, so a permit under a project hold AND its own
 * hold is counted once. That is why the redundant-but-legal case needs no
 * special handling: two overlapping windows are one paused stretch.
 */
export function holdWindowsForPermit(
  projectHolds: ReadonlyArray<HoldWindowLike> | null | undefined,
  permitHolds: ReadonlyArray<HoldWindowLike> | null | undefined,
): HoldWindowLike[] {
  const out: HoldWindowLike[] = [];
  for (const h of projectHolds ?? []) out.push(h);
  for (const h of permitHolds ?? []) out.push(h);
  return out;
}

/**
 * Is this permit paused right now — by its project, or by itself?
 *
 * ★★ The two arguments are the two SETS the caller already has in hand: the
 * project ids on hold (`activeHoldProjectIds`) and the permit ids on hold
 * (`activeHoldPermitIds`). Passing sets rather than rows keeps this O(1) per
 * permit on surfaces that ask it for hundreds of rows.
 */
export function isPermitHeld(
  permit: { id: number; project_id: string },
  heldProjectIds: ReadonlySet<string> | null | undefined,
  heldPermitIds: ReadonlySet<number> | null | undefined,
): boolean {
  return (
    !!heldProjectIds?.has(permit.project_id) || !!heldPermitIds?.has(permit.id)
  );
}

/**
 * ★ The permit's OWN open hold, for the badge — never its project's.
 *
 * The project badge is already rendered by the project's own surfaces; a permit
 * chip showing its project's hold would say the same thing twice in two places
 * and make a project hold look like a permit one.
 */
export function ownHoldForPermit(
  permitId: number,
  byPermitId: ReadonlyMap<number, PermitHold> | null | undefined,
): PermitHold | null {
  return byPermitId?.get(permitId) ?? null;
}
