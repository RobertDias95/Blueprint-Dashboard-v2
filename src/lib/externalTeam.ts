// fix-190d: the ONE resolver from a project's external team to the firm working
// a discipline. The external-team editor writes projects.external_team (a
// discipline -> firm-name blob, e.g. {"Surveyor":"Emerald","Civil":"Facet"});
// EVERY surface that needs "who's the firm for discipline X on this project"
// (My Tasks → Waiting, the per-task Waiting-On sub-label) resolves through this
// single function against that same store — no second code path, one term, one
// store (the bidirectional principle).
//
// ★★★ fix-606 (P-302 part 2): THE VOCABULARY IS NO LONGER A CODE CONSTANT. It
// used to be `WAITING_ON_OPTIONS` from database.types, which meant a discipline
// an admin added to Settings → Waiting On could never appear here, and therefore
// never reach the firm directory or a project. It is now PASSED IN — resolved by
// the caller from `app_config.waitingOnOptions` through
// `firmDisciplineOptions()` — because this module is pure and cannot read a hook.
//
// ★★ The words still match the waiting-on picker's, which was fix-190d's whole
//    point: a task waiting on "Surveyor" matches the blob's "Surveyor" key. They
//    match more reliably now, because there is one list instead of two.

import { type ExternalTeamDirectoryFirm } from './database.types';

/** projects.external_team shape: discipline name -> firm name. */
export type ExternalTeamBlob = Record<string, string>;

// ===========================================================================
// ★★★ fix-451 §G (P-101) — "NOT REQUIRED" IS AN ANSWER, NOT A FIRM
// ===========================================================================
//
// The blob has held two states: a firm name, or nothing. "Nothing" means
// *nobody has answered yet* — fix-193's empty slot is a REMINDER, and that is
// the right behaviour for a question still open. What it could not say is *"we
// checked; this project does not need one"*, and the difference matters: one
// is work outstanding, the other is work finished.
//
// ★★★ SO SOMEBODY TYPED IT AS A FIRM. On prod today 4017 Corliss Ave N holds
// `Geotech: "Not Required"`, and the DIRECTORY holds a matching Geotech firm
// row literally named "Not Required" (active) — offered in the picker for every
// project, on every discipline it was filed under. Both are the same mistake
// made through "+ Add new firm…", because the vocabulary had no word for it.
//
// ★★ THE SENTINEL IS THE STRING PROD ALREADY CARRIES. Choosing a new token
// (`__none__`) would have made the existing row an off-list value needing a
// migration to READ; matching what is there makes the one data row already
// correct and the migration purely cosmetic (the directory row, which should
// never have been a firm). fix-449's shape: the value is KEPT and MARKED.
//
// ★ Compared case-insensitively and trimmed, because it was typed by hand.
export const NOT_REQUIRED = 'Not Required';

/** Is this blob value the "we checked, none needed" answer? */
export function isNotRequired(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === NOT_REQUIRED.toLowerCase();
}

// fix-193 / fix-196: the external-team SHOW-RULES, shared so the Settings panel
// (ProjectExternalTeamPanel) and the Project Overview editor (ExternalTeamEditor)
// can't drift. The near-always-needed COMMON FOUR always render as fill-in
// slots; every other discipline shows only when it has a firm OR the user
// surfaced it via "+ Add discipline"; an empty-state CTA shows when nothing is
// assigned. One source of the rules (bidirectional principle).

/** fix-193: the near-always-needed disciplines, ALWAYS shown as slots.
 *
 *  ★ fix-606 widened the type from `WaitingOnDiscipline` to `string`. These four
 *    are still exactly Bobby's four; what changed is that the surrounding
 *    vocabulary is now an admin-editable list, so a closed union of 13 literals
 *    can no longer describe a discipline. See the note on `disciplineSlots`. */
export const EXTERNAL_TEAM_COMMON_DISCIPLINES: readonly string[] = [
  'Civil',
  'Surveyor',
  'Structural',
  'Arborist',
];

export interface ExternalTeamShowRules {
  /** Disciplines with a non-empty firm in the blob. */
  assignedDisciplines: Set<string>;
  /** Disciplines to render as slots: common four ∪ assigned ∪ user-added. */
  shownDisciplines: string[];
  /** Disciplines not yet shown — the "+ Add discipline" options. */
  addableDisciplines: string[];
  /** True when the project has NO external firm assigned at all (→ show CTA). */
  noneAssigned: boolean;
}

// ===========================================================================
// ★★★ fix-606 §A.1 — ONE SLOT RULE, TWO KINDS OF "ASSIGNED"
// ===========================================================================
//
// The Settings firm directory and a project's external team ask the same
// question — *which discipline rows do I render, and which are left to add?* —
// but they answer "assigned" differently: the project reads its BLOB, the
// directory reads WHICH DISCIPLINES HOLD FIRMS. Before this ticket they each had
// their own copy of the rule, and the copies had drifted apart in the one way
// that mattered: both filtered through `WAITING_ON_OPTIONS`.
//
// ★★★ WHICH WAS A LATENT BUG, NOT ONLY A STYLE PROBLEM. Filtering the blob
//     THROUGH the vocabulary means a blob key outside it is INVISIBLE — the firm
//     is in the data, the row is not on the screen, and nobody can clear it.
//     `assignedFrom` below reads the blob's OWN keys, so a stored discipline
//     always has a row, which is §A.3's rule applied to the slot list rather
//     than only to a `<select>`.
/** The slot decision, shared. `disciplines` is the admin's list; `assigned` is
 *  whatever the caller means by it. */
export function disciplineSlots(
  assigned: ReadonlySet<string>,
  added: ReadonlySet<string>,
  disciplines: readonly string[],
): { shown: string[]; addable: string[] } {
  const shown = disciplines.filter(
    (d) =>
      EXTERNAL_TEAM_COMMON_DISCIPLINES.includes(d) ||
      assigned.has(d) ||
      added.has(d),
  );
  // ★ A stored discipline the admin has since removed keeps its row, APPENDED —
  //   the same placement `waitingOnOptions` uses, so a retired value reads as
  //   "this is what it is" rather than as a live choice.
  const known = new Set(disciplines);
  const retired = [...assigned].filter((d) => !known.has(d)).sort();
  const shownSet = new Set([...shown, ...retired]);
  return {
    shown: [...shown, ...retired],
    addable: disciplines.filter((d) => !shownSet.has(d)),
  };
}

/** The disciplines a blob actually assigns a firm to — read from ITS OWN KEYS. */
export function assignedFrom(blob: ExternalTeamBlob | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const [discipline, firm] of Object.entries(blob ?? {})) {
    if (typeof firm === 'string' && firm.trim() !== '') out.add(discipline);
  }
  return out;
}

/** fix-196: pure show-rule decision given the project's blob + the disciplines
 *  the user has locally surfaced via "+ Add discipline". Both external-team
 *  editors consume this (via useExternalTeamShowRules) so they share one rule.
 *
 *  ★★ fix-606: `disciplines` is REQUIRED rather than defaulted. A default would
 *     be the code constant again, silently, in exactly the place this ticket
 *     exists to fix — so the caller must say where its vocabulary came from. */
export function externalTeamShowRules(
  blob: ExternalTeamBlob | null | undefined,
  added: ReadonlySet<string>,
  disciplines: readonly string[],
): ExternalTeamShowRules {
  const assignedDisciplines = assignedFrom(blob);
  const { shown, addable } = disciplineSlots(assignedDisciplines, added, disciplines);
  return {
    assignedDisciplines,
    shownDisciplines: shown,
    addableDisciplines: addable,
    noneAssigned: assignedDisciplines.size === 0,
  };
}

/** Normalize an unknown external_team value to a typed blob (or null). */
export function asExternalTeamBlob(value: unknown): ExternalTeamBlob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as ExternalTeamBlob;
}

/** The firm assigned to `discipline` on this project, or null when none is set.
 *  This is the single source Waiting mode + the per-task sub-label both read. */
export function resolveExternalFirm(
  blob: ExternalTeamBlob | null | undefined,
  discipline: string | null | undefined,
): string | null {
  if (!blob || !discipline) return null;
  const firm = blob[discipline];
  return typeof firm === 'string' && firm.trim() !== '' ? firm : null;
}

/** fix-195: the distinct firm names already used across every project's
 *  external_team blob — sorted, deduped (case-preserving, trimmed). Since firms
 *  are free text in the blob (no registry), this backs the external-team
 *  editor's firm <datalist> so existing firms (Emerald, Facet, SSS, …) are
 *  one-click reusable while new names can still be typed. */
export function distinctExternalFirms(
  projects: ReadonlyArray<{ external_team?: unknown }>,
): string[] {
  const seen = new Map<string, string>(); // lowercased key -> first-seen display
  for (const p of projects) {
    const blob = asExternalTeamBlob(p.external_team);
    if (!blob) continue;
    for (const v of Object.values(blob)) {
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

// fix-227: the central External Team directory (external_team_directory) feeds
// the per-project firm picker's dropdown. These pure helpers group + list the
// directory firms by discipline so the Settings panel and both per-project
// editors read one shared vocabulary (bidirectional principle) — no editor
// re-derives the grouping on its own.

/** Group directory firms by discipline, each list sorted by name (A→Z, active
 *  before inactive). `activeOnly` (default false) drops deactivated firms. */
export function directoryFirmsByDiscipline(
  firms: ReadonlyArray<ExternalTeamDirectoryFirm> | null | undefined,
  opts?: { activeOnly?: boolean },
): Map<string, ExternalTeamDirectoryFirm[]> {
  const activeOnly = opts?.activeOnly ?? false;
  const m = new Map<string, ExternalTeamDirectoryFirm[]>();
  for (const f of firms ?? []) {
    if (activeOnly && !f.active) continue;
    const arr = m.get(f.discipline);
    if (arr) arr.push(f);
    else m.set(f.discipline, [f]);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  return m;
}

/** The ACTIVE directory firm names for a discipline (sorted, deduped display).
 *  Backs the per-project picker's dropdown options for that discipline. */
export function directoryFirmNamesForDiscipline(
  firms: ReadonlyArray<ExternalTeamDirectoryFirm> | null | undefined,
  discipline: string,
): string[] {
  const seen = new Map<string, string>(); // lower -> first-seen display
  for (const f of firms ?? []) {
    if (!f.active || f.discipline !== discipline) continue;
    const t = f.name.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
