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

/**
 * ★★★ fix-508 §E — THE PIPELINE'S OWN WORDS, PROMOTED OUT OF A COMPONENT.
 *
 * The permits rail groups its cards by phase now, and §E says to head those
 * groups with *"the Pipeline's own words"*. Those words existed — as a private
 * `STAGE_FULL_LABEL` inside `Dashboard/AddrGroup.tsx`, written by fix-364 under
 * the heading *"one concept, one term"*.
 *
 * ★ So it moves here rather than being copied, which is the exact reason this
 *   file exists: fix-104 created it because the stage map was about to be
 *   duplicated into the sidebar for the third time.
 *
 * ★★ `STAGE_LABEL` above is the SHORT form and both are real — `D&E` is what a
 *    breadcrumb inside a 190px rail card can hold, `Design & Engineering` is
 *    what a group header spanning the rail can. Two forms of one vocabulary,
 *    one file.
 */
export const STAGE_FULL_LABEL: Record<Stage, string> = {
  de: 'Design & Engineering',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

/**
 * The five buckets in the order the Pipeline reads them, and the order the
 * permits rail stacks them in.
 *
 * ★ fix-421's ruling survives inside this order: *"issued should be at the
 *   bottom, redesign should be above that, and then all the other active and
 *   ongoing permits should be above that."* `is` is last, and the rail renders
 *   the redesigns band between `ap` and `is`.
 */
export const STAGE_ORDER: readonly Stage[] = ['de', 'pm', 'co', 'ap', 'is'];

/** Tiny helper for callers that want the function-call form rather
 *  than indexing the map directly. Returns the stage code itself when
 *  the input is somehow an unmapped string (defensive — Stage is a
 *  union, but TypeScript-erased runtime data has slipped through
 *  before). */
export function stageLabel(stage: Stage): string {
  return STAGE_LABEL[stage] ?? stage;
}
