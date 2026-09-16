import { useCallback } from 'react';
import { useUpdateProject } from './useUpdateProject';
import { useMayWriteProject } from './useMayWriteProject';
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
  /** True when the project carries no OCC token, **or when the server says
   *  this person may not write this project** — every control disables.
   *
   *  ★★★ fix-567 §D (P-271) — THE SECOND REASON JOINED THE FIRST HERE, in the
   *      one hook all six sections of the modal already share, rather than at
   *      fourteen `disabled=` sites. fix-549 §B gave the Project Data editors
   *      the server's answer; the DATES and the address never got it, because
   *      they commit through this hook instead. One line here is the whole of
   *      that half, and the next field added to the modal is covered before it
   *      is written.
   *
   *  ★★ THE NAME STAYS `occMissing` DELIBERATELY. Every call site already
   *     reads it as *"this control cannot write"*, which is exactly what it
   *     still means; renaming it would have touched fourteen lines to say the
   *     same thing. The two reasons are distinguished by {@link mayWrite}
   *     for anyone who needs to tell them apart. */
  occMissing: boolean;
  /** ★ The server's answer alone, for a caller that must word a refusal
   *  differently from "this row has no version token". */
  mayWrite: boolean;
  saving: boolean;
}

// ===========================================================================
// ★★★ fix-575a — THE NO-OP GUARD HAD TO LEARN ABOUT ARRAYS
// ===========================================================================
//
// It was `next === (original ?? null)`, which is REFERENCE equality. That is
// correct and sufficient for every scalar column — and it can never short
// -circuit an array, because `['ECA'] === ['ECA']` is false.
//
// ★★★ THAT MATTERED THE MOMENT `project_tags` CAME THROUGH HERE. Its editor
//     builds a fresh array on every call (`chosen.filter(…)`, `[...chosen, v]`),
//     so a reference check would have declared every write a change. Today that
//     is harmless — the editor only calls on a click, and a click IS a change —
//     but *"harmless because of how the one current caller happens to behave"*
//     is exactly the kind of guard that stops being true when a second caller
//     arrives, and this hook exists because a second caller always does.
//
// ★★ SHALLOW, NOT DEEP, AND THAT IS THE RIGHT DEPTH. The only array columns on
//    `projects` are `product_types` and `project_tags`, both `string[]`. A deep
//    compare would also invite `unit_types` (an array of OBJECTS) through this
//    hook, and that column is written by `writeTypes` through a whitelist
//    rebuild — a different model, deliberately not unified here.
//
// ⚠️ ORDER-SENSITIVE ON PURPOSE. `['ECA','SIP']` and `['SIP','ECA']` are
//    different values: the stored order is what the chips render in, so a
//    reorder is a real edit and must not be swallowed as a no-op.
function projectValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function useProjectFieldCommit(project: Project): ProjectFieldCommit {
  const updateMutation = useUpdateProject();
  // ★★★ fix-567 §D — ASKED, NEVER RE-DERIVED. `useMayWriteProject` calls
  //     `bp_may_write_project`, the same function the `projects` RLS policy and
  //     `bp_update_project_fields` call — so the field and the gate cannot
  //     disagree, and Shire's new `may_edit_all_projects` grant reaches the
  //     dates without a second copy of the rule in TypeScript.
  // ★★ It fails closed: an error, no session, or a query still in flight all
  //    read **no**, which renders read-only rather than accepting typing the
  //    server will refuse.
  const mayWrite = useMayWriteProject(project.id);
  const occMissing = !project.updated_at || !mayWrite;
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
      if (projectValuesEqual(next, original ?? null)) return;
      try {
        await updateMutation.mutateAsync({
          projectId,
          expectedUpdatedAt: updatedAt,
          patch: { [field]: next } as Partial<Project>,
          // ★ The label is what the OCC toast says when this collides, so it is
          //   the field's NAME as the person reading it knows it — "GO date",
          //   not "go_date".
          fieldLabel: label,
        });
      } catch {
        // ═══════════════════════════════════════════════════════════════
        // ★★★ fix-575a — THE SWALLOW IS LOAD-BEARING, AND IT HIDES NOTHING
        // ═══════════════════════════════════════════════════════════════
        //
        // ★★★ THE USER HAS ALREADY BEEN TOLD, by the time this runs.
        //     `useUpdateProject.onError` fires FIRST and unconditionally: it
        //     rolls the optimistic patch back out of the cache — so the control
        //     visibly reverts — and pushes one of three toasts, chosen by what
        //     actually happened:
        //
        //       write denied  → the fix-549 §C message, naming who to ask
        //       OCC conflict  → "modified by someone else"
        //       anything else → "Could not save project — …"
        //
        //     There is no failure mode in which this `catch` is the difference
        //     between the user seeing something and seeing nothing.
        //
        // ★★★ WHAT IT IS ACTUALLY FOR: every one of the 23 call sites writes
        //     `void commit(…)`, because a blur handler cannot await. Without
        //     this, a refused write leaves a REJECTED PROMISE WITH NO HANDLER —
        //     an unhandled rejection on a path the user has already been
        //     notified about. **Measured before this ticket: `commit()` did
        //     reject, and all 14 of the hook's own call sites discarded it.**
        //
        // ★★ SO THIS IS THE COPY THAT WAS RIGHT. `ProjectTagsEditor` carried
        //    exactly this `catch` and the hook did not; unifying on the hook's
        //    behaviour would have created 23 unhandled-rejection paths instead
        //    of removing one. The right definition wins, not the oldest one.
        //
        // ⚠️ IF A CALLER EVER NEEDS TO KNOW, it must be a RETURNED VALUE, never
        //    a re-thrown error — `writeTypes` in `ProjectDataEditors` already
        //    does that (fix-572 §D returns `Promise<boolean>` so a field can
        //    confirm only a write that landed). fix-575 will want the same
        //    here; it is deliberately NOT added now, because nothing reads it
        //    yet and an unused return value is a claim nobody is checking.
      }
    },
    [projectId, updatedAt, updateMutation],
  );

  return { commit, occMissing, mayWrite, saving: updateMutation.isPending };
}
