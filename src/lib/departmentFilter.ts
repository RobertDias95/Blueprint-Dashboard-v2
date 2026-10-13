import type { Department, TeamMember } from './database.types';
import { DEPARTMENTS } from './roleLabels';
import { foldRosterToPeople } from './department';

// ===========================================================================
// ★★★ fix-660 (census 23, P-318) — THE DEPARTMENT FILTER, ONE DEFINITION
// ===========================================================================
//
// Department was filled for 37 of 43 people and only Settings read it. My
// Tasks and the board now filter by it, and both ask the SAME question through
// this file: "which people are in these departments?"
//
// ★★ A DEPARTMENT BELONGS TO A PERSON, NOT TO A ROW. `team_members` is one row
//    per (person, role) — 8 people hold two rows on prod (measured 2026-10-13).
//    `foldRosterToPeople` already folds them, and `bp_trg_team_department_sync`
//    keeps a person's rows in step, so this reads the folded person and never a
//    raw row.
//
// ★★ A SPLIT PERSON IS IN NO DEPARTMENT HERE. fix-461 refuses to pick one of
//    two disagreeing values, and a filter that silently picked one would undo
//    that. 0 split people on prod today.
//
// ★ THE FILTER SELECTS PEOPLE; EACH SCREEN THEN ASKS ITS OWN OWNERSHIP
//   QUESTION OF THEM. My Tasks resolves a task to people through
//   `useTaskOwnership` (fix-238b), which is the same resolver its person
//   dropdowns use, so "Department: Acquisitions" means exactly "tasks that any
//   Acquisitions person's My Work would show". The board's queue scopes to
//   people by DA / entitlement lead, the same way its "My team" scope does.

/** Whitelist a stored value back into departments. Anything not in the
 *  Settings list (a typo, a retired key, a non-string) is dropped rather than
 *  kept as an invisible filter nothing can match. Order follows the stored
 *  value; duplicates are removed. */
export function parseDepartments(raw: unknown): Department[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(DEPARTMENTS);
  const out: Department[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && allowed.has(v) && !out.includes(v as Department)) {
      out.push(v as Department);
    }
  }
  return out;
}

/** Every roster person in any of `departments`, by their roster name (trimmed,
 *  original case — the key every other name comparison in the app uses).
 *  Inactive people are INCLUDED: their tasks still exist and still filter.
 *  An empty selection returns null, meaning "no department filter". */
export function peopleInDepartments(
  members: readonly TeamMember[],
  departments: readonly Department[],
): string[] | null {
  if (departments.length === 0) return null;
  const want = new Set<Department>(departments);
  return foldRosterToPeople(members)
    .filter((p) => p.department !== null && want.has(p.department))
    .map((p) => p.name);
}

/** Narrow a list of names to the people in `departments`, case-insensitively.
 *  `null` people means no department filter — the list comes back unchanged. */
export function namesInDepartments(
  names: readonly string[],
  people: readonly string[] | null,
): string[] {
  if (people === null) return [...names];
  const keep = new Set(people.map((n) => n.trim().toLowerCase()));
  return names.filter((n) => keep.has(n.trim().toLowerCase()));
}

// ---------------------------------------------------------------------------
// The board's memory. My Tasks keeps its departments inside its existing
// `mytasks.filters.v2` object; the board had no filter object, so it gets a
// per-user key in the shape fix-365's lens uses (lib/boardByAssociate).
// ---------------------------------------------------------------------------

export function boardDepartmentsKey(userId: string): string {
  return `board.departments.v1.${userId}`;
}

export function loadBoardDepartments(userId: string | null | undefined): Department[] {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(boardDepartmentsKey(userId));
    return raw ? parseDepartments(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveBoardDepartments(
  userId: string | null | undefined,
  departments: readonly Department[],
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(boardDepartmentsKey(userId), JSON.stringify(departments));
  } catch {
    // localStorage full / disabled — persistence is best-effort.
  }
}
