import type { Stage } from './database.types';

// fix-104: shared stage → display label map. Pre-fix, this constant
// was duplicated across PermitCard, ScheduleHealthTable, and was about
// to be duplicated again in ProjectDetail's PermitsSidebar — drift
// risk. Centralizing here so the sidebar breadcrumb and the right-hand
// Schedule Health stage column read the same words for the same stage.
//
// The labels are v1's vocabulary (index.html stage chips) and don't
// vary by surface. Other display variants (DE-early vs DE-late split,
// drawschedule status overlay, etc.) belong in their owning files —
// only the stage-code → noun mapping lives here.
export const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

/** Tiny helper for callers that want the function-call form rather
 *  than indexing the map directly. Returns the stage code itself when
 *  the input is somehow an unmapped string (defensive — Stage is a
 *  union, but TypeScript-erased runtime data has slipped through
 *  before). */
export function stageLabel(stage: Stage): string {
  return STAGE_LABEL[stage] ?? stage;
}
