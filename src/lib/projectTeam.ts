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
 * ★★★ fix-503 §C (P-163) — WHO `@project` NOTIFIES: **ENT · DM · DA**.
 *
 * Bobby, 2026-09-04: *"The app project chat function, it should not be
 * including schematic, construction administration, or acquisitions in that
 * tag."* Three names, and two of them had already gone — this ticket removes
 * the third.
 *
 * ★★★ THE TAG IS FOR THE THREE PEOPLE DOING THE WORK. That is the rule the
 *     three exclusions add up to, and it is worth saying as one sentence rather
 *     than as three separate omissions: entitlement, design manager, design
 *     associate are who a question about this project is FOR. Acquisitions,
 *     Schematic and Construction Admin are on the project and belong on the
 *     card; they are not who you are asking.
 *
 * ★★ AN EVOLUTION, NOT A CORRECTION — the two earlier rulings were right when
 *    they were made and are kept here as the record of how the list narrowed:
 *
 *      fix-344 §3  ACQ · ENT · DM · DA   *"we generally don't need the SD
 *                                        mentioned. So everyone but the SD!"*
 *      fix-487     ENT · DM · DA + ACQ   `ca` dropped: it defaults to Steve on
 *                                        EVERY project (211 of 211), so the tag
 *                                        would have become a message to one
 *                                        person about every job in the company.
 *      fix-503 §C  ENT · DM · DA         `acq` dropped, on Bobby's ruling.
 *
 * ★★ ONLY THE TAG CHANGES — and this is the third time that sentence has been
 *    needed, which is why it is load-bearing. `projectInternalTeam` still
 *    returns all five roles and the Team card still renders every one of them
 *    (fix-321 #78's rows are Bobby's own order). One definition, two consumers
 *    with different needs. Dropping a role from the shared shape to fix a
 *    mention list would take that person off the card — not what was asked, and
 *    the exact "second definition" trap fix-347 §3 was written to avoid.
 *
 * ★ So this is a FILTER over the one definition, not a rival to it: same
 * source, same order, three roles omitted, and the omissions stated in one
 * place. The hint string (`N on this project`) counts what this returns, so it
 * needs no change and gets none.
 */
export function projectTagNames(team: ProjectInternalTeam): string[] {
  return projectTeamNames({ ...team, sd: [], ca: null, acq: null });
}
