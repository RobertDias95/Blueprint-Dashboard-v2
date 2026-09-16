import { createContext, useContext } from 'react';
import type { Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-575 §A (P-227) — THE BUFFER, AND WHY IT IS A CONTEXT
// ===========================================================================
//
// Bobby, three times:
//
//   *"when editing in the modul, the save button doesnt appear when making a
//   change. so if i dont make any changes, it should be an exit button, if i
//   do make a change, then the options would be save and cancel."*
//
// ---------------------------------------------------------------------------
// ★★★ WHY A CONTEXT RATHER THAN A PROP
// ---------------------------------------------------------------------------
//
// fix-575a folded all 23 single-column project writes onto ONE function,
// `useProjectFieldCommit.commit`. That is the choke point this ticket needed —
// but the twenty-odd CONTROLS still read their VALUE from the `project` prop,
// and a buffered edit that nothing renders is an edit the person cannot see.
//
// ★★★ SO THE BUFFER HAS TO REACH TWO PLACES AT ONCE: the write (one function,
//     already unified) and the read (twenty controls, spread over two files and
//     five levels of nesting). Threading a prop to both would touch every
//     control — which is exactly the twenty-site change fix-575a was run first
//     to avoid.
//
// ★★ THE READ SIDE IS SOLVED WITHOUT TOUCHING A SINGLE CONTROL: every editor
//    takes a `project` object, so the modal hands them `project` WITH THE DRAFT
//    OVERLAID (`{ ...project, ...draft }`). A control that reads `project.zone`
//    shows the typed value for free, and nothing about it had to change.
//
// ★★ THE WRITE SIDE IS THIS CONTEXT. `useProjectFieldCommit` asks for a sink;
//    when the modal provides one, `commit` files the value in the draft instead
//    of calling the RPC.
//
// ★★★ NO PROVIDER MEANS WRITE IMMEDIATELY, WHICH IS THE OLD BEHAVIOUR EXACTLY.
//     Measured before building this: every consumer of `useProjectFieldCommit`
//     (`ProjectDetailsForm` ×6, `ProjectDataEditors` ×3) mounts only inside
//     `ProjectDetailsModal`, so today the fallback is never taken. It exists so
//     that mounting one of these editors on another surface degrades to a blur
//     commit rather than to a silent no-op — a buffer with no Save button is
//     the worst of the three possible behaviours.

/** What a buffering host offers `useProjectFieldCommit`. */
export interface ProjectDraftSink {
  /**
   * File one column's new value. The host decides when it reaches the
   * database.
   *
   * ⚠️ IT TAKES THE COLUMN'S REAL TYPE, not a form string. The draft is a
   *    `Partial<Project>` so it can be spread straight into the RPC's jsonb
   *    patch at save time — no second parse, and no second place for a
   *    date or a number to be formatted differently from how it is stored.
   */
  setDraft: <K extends keyof Project>(field: K, value: Project[K]) => void;
}

export const ProjectDraftContext = createContext<ProjectDraftSink | null>(null);

/** ★ `null` when nothing upstream is buffering — see the header. */
export function useProjectDraftSink(): ProjectDraftSink | null {
  return useContext(ProjectDraftContext);
}
