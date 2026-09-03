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
  /** ★ fix-487: the Construction Admin. Project-level only — a permit's own
   *  `ca` is a deliberate, separate assignment and does NOT override this the
   *  way `ent_lead`/`dm`/`da` do (see `projectInternalTeam`). */
  ca: string | null;
}

/** The roster names on this project, as the Team card computes them.
 *
 *  @param bp the Building Permit (or whichever permit is in view) — its
 *            per-permit ent_lead / dm / da override the project-level values,
 *            exactly as the card renders them. */
export function projectInternalTeam(
  project: Pick<
    Project,
    | 'acq_lead'
    | 'entitlement_lead'
    | 'design_manager'
    | 'schematic_designer'
    | 'construction_admin'
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
    // ★★★ fix-487 — AND THE BP DOES **NOT** OVERRIDE IT, deliberately.
    //
    // The three above use `bp?.x ?? project.x` because a permit-level ENT/DM/DA
    // is the SAME job done by somebody else on that permit — the PAR/SDOT/ECA
    // routing pattern. A permit-level `ca` is not that: Bobby, *"he would only
    // get assigned to a permit by himself, or ENT in general"*, describing an
    // EXTRA person pulled onto one permit (his example was a PPR), not a
    // replacement for the project's CA. Reading the BP's `ca` here would make
    // one permit's exception rewrite the Team card for the whole project.
    ca: project.construction_admin ?? null,
  };
}

/** The same team as a flat list of names — deduped, in card order, with the
 *  unfilled roles simply absent.
 *
 *  ★ AN EMPTY ROLE IS NOT AN ERROR. fix-347's rule: "A smart tag on a project
 *  with an unfilled role simply resolves to fewer people." A project with no DA
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
  push(team.ca);
  return out;
}

/**
 * ★★★ fix-344 §3 — WHO `@project` NOTIFIES: ACQ · ENT · DM · DA.
 *
 * Bobby: *"For the @project, we generally don't need the SD mentioned. So
 * everyone but the SD!"*
 *
 * ★★ ONLY THE TAG CHANGES. `projectInternalTeam` still returns `sd` and the
 * Team card still renders it (fix-321 #78's five rows are Bobby's own order) —
 * one definition, two consumers with different needs. The alternative, dropping
 * `sd` from the shared shape, would have taken the schematic designer off the
 * card to fix a mention list, which is not what was asked and is the exact
 * "second definition" trap fix-347 §3 was written to avoid.
 *
 * ★ So this is a FILTER over the one definition, not a rival to it: same
 * source, same order, one role omitted, and the omission stated in one place.
 */
export function projectTagNames(team: ProjectInternalTeam): string[] {
  // ★★★ fix-487 DROPS `ca` FROM THE TAG TOO, and this is a judgement call
  //     flagged for Bobby rather than an obvious consequence.
  //
  // Bobby's fix-344 ruling was *"everyone but the SD"*, made when the card had
  // five rows. `ca` defaults to Steve on EVERY project (211 of 211), so
  // including him would turn `@project` — a tag for the handful of people on
  // this job — into a message to Steve about every job in the company. That is
  // not what the tag is for, and the noise would land on one person.
  //
  // ★★ THE CARD STILL SHOWS HIM. Same shape as the `sd` omission above: one
  //    definition (`projectInternalTeam`), two consumers with different needs,
  //    and the difference stated here rather than by a rival definition.
  return projectTeamNames({ ...team, sd: [], ca: null });
}
