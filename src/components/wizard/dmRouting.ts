import type { DmDaGroupRow } from '../../lib/database.types';

// fix-91: pure helpers for the wizard's DA-driven role derivation.
// Lives separately from Step3Permits.tsx + NewProjectWizard.tsx so the
// react-refresh rule stays happy (those files only export components,
// these are plain helpers).

/** Which DM owns this DA in dm_da_groups. Returns null when the DA
 *  isn't in any group — caller leaves the DM chip off in that case. */
export function findDmForDa(
  da: string,
  rows: DmDaGroupRow[],
): string | null {
  if (!da) return null;
  const hit = rows.find((r) => r.da_name === da);
  return hit?.dm_name ?? null;
}
