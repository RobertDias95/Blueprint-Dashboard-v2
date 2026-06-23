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

/** projects.external_team shape: discipline name -> firm name. */
export type ExternalTeamBlob = Record<string, string>;

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
