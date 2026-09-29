import type { Project } from './database.types';

// ===========================================================================
// ★★★ fix-557 (P-250) — "DELETED" IS A FLAG, AND THIS IS THE ONLY PLACE
//                        TypeScript SAYS SO
// ===========================================================================
//
// P-250, ruled 2026-09-14: **admins only, and delete is SOFT.** fix-549 shipped
// the gate half; fix-557 turns the removal into `projects.archived = true`. The
// row survives, and so do its permits, its chat and its plan sets — what changes
// is that every surface stops reaching it.
//
// ---------------------------------------------------------------------------
// ★★★ ONE DERIVATION, NOT FIFTY-FOUR COPIES
// ---------------------------------------------------------------------------
//
// §A.2 of the brief: *"Prefer one derivation — a view or predicate both sides
// call — over 29 copies of `and not archived`. Two writers of one rule is this
// Brain's most repeated defect (P-207, P-179, P-244)."*
//
// Measured on prod 2026-09-29: **55 server-side readers of `projects`, and
// exactly ONE of them honoured the flag** (the view `juris_permit_stats`). On the
// client, seven places spelled the rule out by hand and an eighth had forgotten
// to. So the rule now lives in three named things and nowhere else:
//
//   `projects_tenant_select`      the RLS policy — every reader that respects
//                                 RLS, which is the whole client and 25 of the
//                                 38 server readers
//   `public.active_projects`      the SQL view — the 13 SECURITY DEFINER
//                                 enumerators, which bypass RLS
//   **this file**                 the TypeScript twin, for lists already in
//                                 memory
//
// ★★ THIS FILE AND THE VIEW ARE TWINS AND MUST STAY IN LOCKSTEP — the same
//    relationship `isPermitInCorrections` ⇄ `bp_permit_in_corrections` has, and
//    the suite asserts the predicate's shape against the migration text.
//
// ---------------------------------------------------------------------------
// ★★★ WHY THE CLIENT FILTERS AT ALL, GIVEN THE POLICY ALREADY DOES
// ---------------------------------------------------------------------------
//
// Because the policy lets an **admin** read an archived project, and it must:
// otherwise nobody could see the row to un-delete it and recovery would be a
// `psql` session. So for the one group who can delete, every list arrives with
// deleted projects in it — and they are exactly the group who must not see a
// deleted project sitting in the Pipeline.
//
// ⚠️ 23 of 29 logins are non-admin editors ([[project_fix331_overview_ui_pass]]),
//    so testing this as an editor would show the right answer for the wrong
//    reason, in the one configuration where the client filter is redundant.

/** Everything the rule reads. Structural, so a `Pick` satisfies it. */
export interface ArchivableProject {
  archived?: boolean | null;
}

/**
 * Is this project NOT deleted?
 *
 * ★★★ `=== true` ON THE FLAG, so `null` and `undefined` both read as ACTIVE.
 *     The column is `DEFAULT false` and the migration makes it `NOT NULL`, but
 *     an explicit select list that omits it hands us `undefined` — and this repo
 *     has recorded that trap **five times in `useProjects` alone** (fix-122,
 *     fix-386, fix-410, fix-487, fix-488). Treating an absent column as
 *     "deleted" would empty the Pipeline; treating it as "active" shows one row
 *     too many. Only one of those is recoverable by looking at the screen.
 *
 * ★ Mirrors the SQL exactly: `COALESCE(archived, false) = false`.
 */
export function isActiveProject(p: ArchivableProject | null | undefined): boolean {
  return !!p && p.archived !== true;
}

/** Is this project deleted? The complement, for the places that ask that way. */
export function isDeletedProject(p: ArchivableProject | null | undefined): boolean {
  return p?.archived === true;
}

/** Drop deleted projects from a list. ★ The shape most callers want. */
export function excludeDeleted<T extends ArchivableProject>(
  projects: readonly T[] | undefined,
): T[] {
  return (projects ?? []).filter(isActiveProject);
}

/**
 * ★★★ THE ONE CONTROL THAT DELETES AND RESTORES, named so the UI and the tests
 *     agree about what it is.
 *
 * `ProjectDetailsForm`'s `psm-archived` checkbox IS the delete, and unticking it
 * IS the recovery §B asks for. It is admin-only from fix-557 onward — before
 * this ticket it was an ordinary editable flag that happened to do almost
 * nothing, because nothing filtered on it.
 */
export const ARCHIVE_IS_ADMIN_ONLY = true;

/** What the checkbox says, and what it says when you may not use it. */
export const ARCHIVE_LABEL = 'Deleted (hidden from every list; admins only)';
export const ARCHIVE_DENIED_NOTE =
  'Only an admin can delete or restore a project.';

/** ★ A deleted project keeps everything. Rendered where somebody needs telling. */
export const ARCHIVE_KEEPS_NOTE =
  'The project, its permits, chat and plan sets are all kept. An admin can '
  + 'restore it by unticking this.';

export type { Project };
