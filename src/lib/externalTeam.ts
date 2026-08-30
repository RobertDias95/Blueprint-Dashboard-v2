// fix-190d: the ONE resolver from a project's external team to the firm working
// a discipline. The external-team editor writes projects.external_team (a
// discipline -> firm-name blob, e.g. {"Surveyor":"Emerald","Civil":"Facet"});
// EVERY surface that needs "who's the firm for discipline X on this project"
// (My Tasks → Waiting, the per-task Waiting-On sub-label) resolves through this
// single function against that same store — no second code path, one term, one
// store (the bidirectional principle).
//
// The discipline vocabulary is the shared WAITING_ON_OPTIONS list (canonical
// survey term = "Surveyor"), so the waiting-on picker and the external-team
// picker speak the same words and a task waiting on "Surveyor" matches the
// blob's "Surveyor" key.

import {
  WAITING_ON_OPTIONS,
  type ExternalTeamDirectoryFirm,
  type WaitingOnDiscipline,
} from './database.types';

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

/** fix-193: the near-always-needed disciplines, ALWAYS shown as slots. */
export const EXTERNAL_TEAM_COMMON_DISCIPLINES: readonly WaitingOnDiscipline[] = [
  'Civil',
  'Surveyor',
  'Structural',
  'Arborist',
];

export interface ExternalTeamShowRules {
  /** Disciplines with a non-empty firm in the blob. */
  assignedDisciplines: Set<WaitingOnDiscipline>;
  /** Disciplines to render as slots: common four ∪ assigned ∪ user-added. */
  shownDisciplines: WaitingOnDiscipline[];
  /** Disciplines not yet shown — the "+ Add discipline" options. */
  addableDisciplines: WaitingOnDiscipline[];
  /** True when the project has NO external firm assigned at all (→ show CTA). */
  noneAssigned: boolean;
}

/** fix-196: pure show-rule decision given the project's blob + the disciplines
 *  the user has locally surfaced via "+ Add discipline". Both external-team
 *  editors consume this (via useExternalTeamShowRules) so they share one rule. */
export function externalTeamShowRules(
  blob: ExternalTeamBlob | null | undefined,
  added: ReadonlySet<WaitingOnDiscipline>,
): ExternalTeamShowRules {
  const assignedDisciplines = new Set<WaitingOnDiscipline>();
  for (const d of WAITING_ON_OPTIONS) {
    const firm = blob?.[d];
    if (typeof firm === 'string' && firm.trim() !== '') assignedDisciplines.add(d);
  }
  const shownDisciplines = WAITING_ON_OPTIONS.filter(
    (d) =>
      EXTERNAL_TEAM_COMMON_DISCIPLINES.includes(d) ||
      assignedDisciplines.has(d) ||
      added.has(d),
  );
  const shownSet = new Set(shownDisciplines);
  const addableDisciplines = WAITING_ON_OPTIONS.filter((d) => !shownSet.has(d));
  return {
    assignedDisciplines,
    shownDisciplines,
    addableDisciplines,
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
