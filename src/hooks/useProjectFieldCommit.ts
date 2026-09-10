import { useCallback } from 'react';
import { useUpdateProject } from './useUpdateProject';
import type { Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-520 §A (P-227) — ONE SAVE MODEL: A FIELD COMMITS WHEN YOU LEAVE IT
// ===========================================================================
//
// fix-519 §B measured the split and guarded the one path that had already lost
// somebody's work. **The shape that produced it was still in eight other
// tabs**, and Cam is about to spend weeks in this modal (P-225: 102 projects
// with no unit rows). This hook is the collapse.
//
// ★★★ WHAT WAS THERE, AT FIELD LEVEL — worse than the tab-level count fix-519
//     took from the captions:
//
//       Save button   Address · Jurisdiction · GO date · Unit count ·
//                     Product types · ACQ/ENT/DM/CA · BP Design Associate ·
//                     Point of Contact · Contact Email · Archived · Backfill ·
//                     every Permits field
//       on blur       Zone · Lot W/D/SF · Corner · Alley · Reuse-of · Closing ·
//                     DD start/end · Target submit · Intake · Unit dimensions ·
//                     Unit size (sf) · every Consultant control
//       immediate     Schematic Designer (bp_reassign_project_sd)
//
// ★★★ AND THE UNITS TAB'S CAPTION WAS FALSE. It said *"Each field saves as you
//     leave it — there is no Save button"* while Unit count and Product types
//     both rode the button. fix-519 filed that tab as pure blur BECAUSE of the
//     caption. **A blanket promise that holds for one tab in nine is worse than
//     no promise** — it is precisely what teaches somebody their edit is safe.
//
// ★★★ THE RULE NOW: every field on this modal commits when you leave it, using
//     the SAME path the site, lot, date and unit editors have always used —
//     `useUpdateProject`, one field, one OCC token, fix-99's auto-recovery.
//     **The Permits tab is the one exception and it is labelled on screen**,
//     because a new permit row and its six fields have to land together.
//
// ★★ WHY BLUR RATHER THAN "SAVE EVERYWHERE": it is what the modal already
//    promised, what the majority of fields already did, and — the reason that
//    settles it — **a per-field commit cannot discard an edit somewhere else.**
//    There is no unsaved state for a sibling control's refresh to throw away,
//    which is the defect fix-519 §B had to guard against rather than remove.
//
// ★ NOT A NEW WRITE PATH. `SiteEditor.commit` has done exactly this since
//   fix-415; this is that function lifted out of one component so eleven more
//   fields can stop having their own model. One definition, so the next field
//   added cannot invent a third.
// ===========================================================================

export interface ProjectFieldCommit {
  /**
   * Write ONE column, if it actually changed.
   *
   * ★ The no-op guard is not an optimisation — it is what makes a blur model
   *   usable. Tabbing through a form touches every field; without it, every
   *   pass would bump `updated_at` and invalidate the cache for nothing, and
   *   fix-341's "modified by someone else" false alarms would come back.
   */
  commit: <K extends keyof Project>(
    field: K,
    next: Project[K],
    original: Project[K] | null | undefined,
    label: string,
  ) => Promise<void>;
  /** True when the project carries no OCC token — every control disables. */
  occMissing: boolean;
  saving: boolean;
}

export function useProjectFieldCommit(project: Project): ProjectFieldCommit {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;
  const projectId = project.id;
  const updatedAt = project.updated_at;

  const commit = useCallback(
    async <K extends keyof Project>(
      field: K,
      next: Project[K],
      original: Project[K] | null | undefined,
      label: string,
    ) => {
      if (!updatedAt) return;
      // ★ `?? null` on the original: an ABSENT column and a null are the same
      //   fact, and only one of them survives a round-trip.
      if (next === (original ?? null)) return;
      await updateMutation.mutateAsync({
        projectId,
        expectedUpdatedAt: updatedAt,
        patch: { [field]: next } as Partial<Project>,
        // ★ The label is what the OCC toast says when this collides, so it is
        //   the field's NAME as the person reading it knows it — "GO date",
        //   not "go_date".
        fieldLabel: label,
      });
    },
    [projectId, updatedAt, updateMutation],
  );

  return { commit, occMissing, saving: updateMutation.isPending };
}
