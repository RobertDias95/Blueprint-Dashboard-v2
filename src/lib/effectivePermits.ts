// ===========================================================================
// ★★★ fix-556 §A (P-263, and P-073 Ask 2 with it) — THE EFFECTIVE PERMITS OF A
//     PROJECT, DEFINED ONCE
// ===========================================================================
//
// **The prod defect this closes: 8 projects with 13 in-flight permits were on
// no Pipeline lane at all.** 2443 5th Ave W · 12238 4th Ave NW · 220 N 58th St
// · 3623 SW Othello St · 4000 SW Concord St · 548 3rd Ave N · 5537 35th Ave NE
// · 725 N 92nd ST — real work, invisible on the board people plan from.
//
// ★★★ THE CAUSE, IN ONE SENTENCE: the Pipeline buckets **permit rows**, and a
//     reuse-redesign has none of its own while its original — whose permits
//     they are — is filtered off the board by fix-524 §B before the loop that
//     collects them ever runs. fix-150's parent-chase is real but lives in
//     `deriveLaneStatus`, which decides a project's **lane**; nothing chased
//     the parent for the **cards**. So the redesign had a correct lane and
//     nothing to put on it, and the original had the cards and no board.
//
// ★★★ SO THE UNION IS WRITTEN ONCE, HERE, AND EVERY SURFACE ASKS IT. The
//     Pipeline, the Overview permits table, the permits rail, Schedule Health,
//     the Quick Edit resolver and the `?permit=` deep link all read the same
//     answer. A second copy of "does this project reuse its original's
//     permits" is the shape P-220 named the fourth two-writers trap.
//
// ★★★ `null` IS NOT `false` AND NEITHER IS `true`. Measured on prod
//     2026-09-14: 17 redesigns — **12 true · 3 false · 2 null**. Only `true`
//     mirrors. `null` means nobody answered the question, and fix-421 §2 already
//     ruled that it renders *"No permits yet"* rather than a No — so it takes
//     the same branch as `false` here while being asserted separately in the
//     tests, because the two are different facts that happen to agree.
//
// ★★ THE ROWS DO NOT MOVE. This returns the original's `permits` rows
//    themselves — the same objects, the same ids — so a control that saves
//    writes to the one row that exists. Nothing is copied, nothing is frozen,
//    and there is no second editor. Bobby ruled this on P-220, 09-10:
//    *copy → freeze the original → if it reuses the permits, **mirror** them
//    onto the redesign so there is no duplicate input.*

/** The project shape this module needs — structural, so `Project`, a Pipeline
 *  `BucketInput`'s project, and a test fixture all satisfy it without importing
 *  the full row type. */
export interface RedesignLinkedProject {
  id: string;
  redesign_of_project_id?: string | null;
  redesign_reuses_original_permit?: boolean | null;
}

/**
 * Does this project render its original's permits as its own?
 *
 * ★ BOTH HALVES ARE REQUIRED. `reuse === true` with no parent is a
 *   contradiction nothing writes today, and treating it as "yes" would send
 *   every caller looking up `undefined`.
 */
export function reusesOriginalPermits(
  project: RedesignLinkedProject | null | undefined,
): boolean {
  if (!project) return false;
  return (
    project.redesign_reuses_original_permit === true &&
    !!project.redesign_of_project_id
  );
}

/**
 * The project whose permits this one renders — itself, unless it mirrors.
 *
 * ★ ONE HOP, DELIBERATELY. A redesign of a redesign would chase again, and
 *   `deriveLaneStatus` has stopped at one hop since fix-150; two surfaces
 *   disagreeing about depth is worse than a depth nobody has created (0 such
 *   chains on prod, 2026-09-14).
 */
export function permitSourceProjectId(
  project: RedesignLinkedProject | null | undefined,
): string | null {
  if (!project) return null;
  if (reusesOriginalPermits(project)) return project.redesign_of_project_id!;
  return project.id;
}

/**
 * The effective permits of a project: its own ∪ its original's, **iff** it
 * reuses them.
 *
 * ★★ A UNION, NOT A REPLACEMENT. The 12 reuse-redesigns hold 0 permits of their
 *    own today, so in practice this returns the original's list — but a
 *    redesign that later files a permit of its own must not lose it, and
 *    writing `own.length ? own : parent` would have done exactly that,
 *    silently, on the day it mattered.
 * ★ De-duplicated by id: a caller that passes the same map for both lookups
 *   (or a future self-referencing row) must not render a permit twice.
 */
export function effectivePermitsBy<T>(
  project: RedesignLinkedProject | null | undefined,
  own: readonly T[] | undefined,
  originalPermits: readonly T[] | undefined,
  idOf: (item: T) => number,
): T[] {
  const mine = own ? [...own] : [];
  if (!reusesOriginalPermits(project)) return mine;
  const seen = new Set<number>(mine.map(idOf));
  for (const p of originalPermits ?? []) {
    const key = idOf(p);
    if (seen.has(key)) continue;
    seen.add(key);
    mine.push(p);
  }
  return mine;
}

/** {@link effectivePermitsBy} for a plain permit row.
 *
 *  ★ The Pipeline carries permits WRAPPED (`{ permit, cycles, reviewers }`),
 *    which is why the core takes a key function: one union, two shapes, still
 *    one rule. */
export function effectivePermits<T extends { id: number }>(
  project: RedesignLinkedProject | null | undefined,
  own: readonly T[] | undefined,
  originalPermits: readonly T[] | undefined,
): T[] {
  return effectivePermitsBy(project, own, originalPermits, (p) => p.id);
}

/**
 * The same union, for a caller that already holds every permit keyed by
 * project — the Pipeline's shape.
 *
 * ★ The map is read twice rather than the list being walked: the board holds
 *   `permitsByProjectId` already, and re-walking every permit per project is
 *   the thing fix-383 removed from this page.
 */
export function effectivePermitsFromMap<T>(
  project: RedesignLinkedProject,
  permitsByProjectId: ReadonlyMap<string, T[]>,
  idOf: (item: T) => number,
): T[] {
  return effectivePermitsBy(
    project,
    permitsByProjectId.get(project.id),
    reusesOriginalPermits(project)
      ? permitsByProjectId.get(project.redesign_of_project_id!)
      : undefined,
    idOf,
  );
}

/**
 * A mirrored permit, presented as belonging to the project that renders it.
 *
 * ★★★ FOR A READ-ONLY BOARD, AND THE COMMENT IS THE GUARD. The Pipeline reads
 *     `permit.project_id` in four places — the draw row that splits D&E into
 *     early/late, the address a card groups under (twice), and fix-383's
 *     distribution counts — and for a mirrored permit the right answer in all
 *     four is **the redesign**: its schedule, its address, its pill. Threading
 *     an owner map through four modules would have made four call sites able to
 *     disagree; one re-key makes them agree by construction.
 *
 * ★★★ `id` IS UNTOUCHED, WHICH IS WHAT MAKES THIS SAFE. Nothing on the Pipeline
 *     mutates a permit (verified: no mutation hook on the page or its cards),
 *     and any surface that DOES write resolves by `id` — so no write can ever
 *     see this clone. **Do not hand the result to an editor.** §B deliberately
 *     does not use this: the Overview renders the original's rows unchanged, so
 *     Quick Edit saves the row that exists.
 */
export function asPermitOfProject<P extends { project_id?: string | null }>(
  permit: P,
  ownerProjectId: string,
): P {
  if (permit.project_id === ownerProjectId) return permit;
  return { ...permit, project_id: ownerProjectId };
}

/**
 * The provenance sentence a mirrored surface prints, or `null`.
 *
 * ★ fix-524 §C's shape: it names the project the rows belong to and says why
 *   they are here, so nobody reads them as this project's own filings and
 *   nobody has to guess which address a permit number belongs to.
 * ★ Takes the address ALREADY stripped by `displayAddress` — the caller has it
 *   and this module must not become a second address-strip (fix-530 §C).
 */
export function permitProvenanceLine(
  originalDisplayAddress: string | null | undefined,
): string | null {
  const a = (originalDisplayAddress ?? '').trim();
  if (!a) return null;
  return `Permits from ${a} — this project reuses the original's permits.`;
}
