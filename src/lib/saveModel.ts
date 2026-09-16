// ===========================================================================
// ★★★ fix-575 §C (P-227) — THE MODAL HAS TWO SAVE MODELS, AND SAYS SO TWICE
// ===========================================================================
//
// §A buffers the 23 single-column project scalars behind Save. Every CASCADING
// writer stays immediate, because holding one in memory and replaying it on
// Save means reimplementing its cascade client-side:
//
//   the DD window        two-phase — the first call returns an overlap verdict
//                        that drives the second (`bp_set_bp_dd_dates`)
//   target submit        writes the Building Permit, not the project
//   the reuse-DD lane    writes `draw_schedule`
//   BP Design Associate  writes a `permits` row
//   the Schematic        `bp_reassign_project_sd` MOVES THAT PERSON'S OPEN
//   Designer             TASKS — the side effect cannot be buffered at all
//   the consultant band  `project_consultants`, five separate RPCs
//   the hold panel       `project_holds` + a task sweep
//   the reuse picker     overwrites `product_types` AND `unit_types` together,
//                        behind its own confirm()
//   unit types           a JSONB whitelist rebuild (`writeTypes`)
//
// ---------------------------------------------------------------------------
// ★★★ WHY SAYING IT TWICE IS THE RULING, NOT A COMPROMISE
// ---------------------------------------------------------------------------
//
// fix-520 §A: *"a blanket promise that holds for one tab in nine is worse than
// no promise — it is what teaches somebody their edit is safe."*
//
// ★★★ THE SIN THERE WAS THE FALSE BLANKET PROMISE, NOT THE MIXED MODEL. A
//     promise that names its own boundary is not blanket. So the boundary is
//     stated in the footer (which describes the modal) **and on each control
//     that sits outside it** (which is what somebody looking at the hold panel
//     actually reads — nobody consults a footer before clicking a button).
//
// ★★ ONE STRING, NOT NINE LITERALS. Nine copies of a sentence is how the two
//    Library surfaces came to say different words about one unit (fix-519 §A),
//    and it is how this modal's own Units caption came to contradict its tab
//    (fix-520 §A). The marker below is the only place these words exist.

/** The marker's visible text. ★ Lower case and two words: it rides beside a
 *  control, not over it, and a sentence would compete with the field's label. */
export const SAVES_NOW_LABEL = 'saves now';

/** The marker's hover text — the same fact, said in full for somebody who
 *  needs it. ★ It explains the CONSEQUENCE ("Cancel will not undo it"), which
 *  is the half a person can act on; "writes immediately" alone is trivia. */
export const SAVES_NOW_TITLE =
  'This control writes immediately — it does not wait for Save, and Cancel will not undo it.';

// ---------------------------------------------------------------------------
// ★★★ THE FOOTER SENTENCE — true for all nine tabs at once
// ---------------------------------------------------------------------------
//
// ★★ IT POINTS AT THE MARKER rather than listing the exceptions. A list of nine
//    controls is unreadable at 9.5px and goes stale the first time one moves;
//    the marker is on the control, so the footer only has to teach the word.
//
// ★ "Changes" rather than "Fields": permit ROWS ride this button too, and a row
//   added or removed is not a field.
export const SAVE_MODEL_CLEAN =
  'Changes wait for Save. Controls marked “saves now” write immediately.';

/** ★ Names both exits, because Cancel is the new one and a person who has just
 *  typed something needs to know it is there. */
export const SAVE_MODEL_DIRTY =
  'Unsaved changes — Save to write them, or Cancel to discard.';
