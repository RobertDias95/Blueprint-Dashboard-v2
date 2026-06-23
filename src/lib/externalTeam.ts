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
