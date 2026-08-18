import type { PermitWithCycles, Project } from './database.types';

// ===========================================================================
// ★★★ fix-347 §3 — ONE definition of "who is on this project"
// ===========================================================================
//
// Bobby, on the smart tag: *"Like @this project so it tags all the people in
// this project — that way it is a consistent tag type among every project but
// tags those who are actually in that project."*
//
// ★ THE ANSWER WAS ALREADY ON SCREEN. The Team card's INTERNAL section has
// rendered ACQ · ENT · SD · DM · DA since fix-321 #78, computed inline in
// TeamCell. `@project` is that list — so this file is that computation lifted
// out, and BOTH the card and the tag now read it. The brief's rule, verbatim:
// "do not write a second definition of who is on this project".
//
// ★★ WHY THAT MATTERS MORE THAN TIDINESS. A hand-built group tag goes stale the
// day a DA changes; the point of a smart tag is that it re-derives. If the
// derivation lived in two places, half of it would re-derive.
//
// ★ THE PER-PERMIT OVERRIDE IS PART OF THE DEFINITION, not a display detail:
// fix-22 Mig 3 lets a permit carry its own ent_lead (the PAR/SDOT/ECA pattern)
// and the card shows the override when there is one. So does the tag.

/** The five internal roles, in the order the card lists them — which is the
 *  order the work happens in: land, entitlement, schematic, manager, associate.
 *  ★ `sd` is a LIST: a project can carry more than one schematic designer, and
 *  fix-321 #78 chose to join rather than truncate them. */
export interface ProjectInternalTeam {
  acq: string | null;
  ent: string | null;
  sd: string[];
  dm: string | null;
  da: string | null;
}

/** The roster names on this project, as the Team card computes them.
 *
 *  @param bp the Building Permit (or whichever permit is in view) — its
 *            per-permit ent_lead / dm / da override the project-level values,
 *            exactly as the card renders them. */
export function projectInternalTeam(
  project: Pick<
    Project,
    'acq_lead' | 'entitlement_lead' | 'design_manager' | 'schematic_designer'
  >,
  bp?: Pick<PermitWithCycles, 'ent_lead' | 'dm' | 'da'> | null,
): ProjectInternalTeam {
  return {
    acq: project.acq_lead ?? null,
    ent: bp?.ent_lead ?? project.entitlement_lead ?? null,
    sd: Array.isArray(project.schematic_designer)
      ? project.schematic_designer.filter((s): s is string => !!s && s.trim() !== '')
      : [],
    dm: bp?.dm ?? project.design_manager ?? null,
    da: bp?.da ?? null,
  };
}

/** The same team as a flat list of names — deduped, in card order, with the
 *  unfilled roles simply absent.
 *
 *  ★ AN EMPTY ROLE IS NOT AN ERROR. The brief: "A smart tag on a project with
 *  an unfilled role simply resolves to fewer people." A project with no DA
 *  yields four names, not a failure and not a placeholder. */
export function projectTeamNames(team: ProjectInternalTeam): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (n: string | null | undefined) => {
    const name = (n ?? '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  push(team.acq);
  push(team.ent);
  team.sd.forEach(push);
  push(team.dm);
  push(team.da);
  return out;
}
