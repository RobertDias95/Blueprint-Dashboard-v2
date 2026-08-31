import { resolvePrimaryAssignee, type PrimaryResolutionContext } from './taskTeam';
import type { TeamRole } from './database.types';

// ===========================================================================
// ★★★ fix-458 (P-106) — WORK THAT REACHES NOBODY
// ===========================================================================
//
// MEASURED ON PROD 2026-08-30, with the app's own resolution rules:
//
//     323 open tasks
//     147 with no assigned_to and no co-assignee
//     130 of those still reach a person via the discipline fallback
//      17 REACH NOBODY  ← this predicate
//
// ★★★ SEVENTEEN, NOT FOURTEEN, AND THE SHAPE IS NOT WHAT THE BRIEF DESCRIBED.
// Fourteen are `discipline='ent'` on a permit with no entitlement lead — the
// population Bobby is fixing by hand. **Three more are `discipline='arch'` on
// permits that have an ent_lead (Miles) and NO DA**: two Demolition/LSM permits
// at 8236 120th Ave NE, human-created, open since 2026-08-07.
//
// ★★ So this is NOT an "ent_lead is missing" problem, it is a RESOLVED PRIMARY
// IS NULL problem, and the DA side has cases too. A predicate written against
// `ent_lead` would have shipped catching 14 of 17 and looked correct. That is
// why this asks the resolver rather than reading a column.
//
// ---------------------------------------------------------------------------
// ★★★ WHY THIS DOES NOT TOUCH resolvePrimaryAssignee
// ---------------------------------------------------------------------------
// The resolution rules are correct. fix-230's fallback — 'ent' → the permit's
// ent_lead, everything else → the DA — is exactly right, and when it returns
// null it is telling the truth: there is nobody. What was missing is a SURFACE
// for that answer, not a different answer. `resolvePrimaryAssignee`,
// `defaultPrimaryTeamKey`, `ownsDirectly`, `isCoAssigned` and
// `taskMatchesSelfResolved` are all untouched by this ticket.

/** The shape this predicate needs from a task. Deliberately narrower than
 *  MyTaskNode so a Settings panel or a test can hand in a plain object. */
export interface UnclaimableTask {
  assigned_to?: string | null;
  co_assignees?: ReadonlyArray<string> | null;
  discipline?: string | null;
}

/**
 * ★★★ Is this task reachable by NOBODY?
 *
 * Three conditions, in the order they eliminate fastest:
 *   1. nothing stored in `assigned_to`,
 *   2. no co-assignee — ★ fix-308b's rule: a co-assignee IS ownership, so a
 *      task somebody shares is claimed even with a blank primary, and
 *   3. the discipline fallback resolves to null.
 *
 * ★★ (3) IS THE ONE THAT MATTERS AND THE ONE EASIEST TO GET WRONG. Of the 147
 * tasks with no assignee and no co-assignee, 130 DO reach somebody through the
 * fallback. A surface built on (1) and (2) alone would swallow all 147 and bury
 * the 17 that are actually lost — which is the failure this ticket exists to
 * end, rebuilt one layer up.
 *
 * Callers pass the SAME context `useTaskOwnership` builds, so this cannot
 * answer from a different context than the ownership split does.
 */
export function isUnclaimedTask(
  task: UnclaimableTask,
  ctx: PrimaryResolutionContext,
): boolean {
  const named = (v: string | null | undefined) => (v ?? '').trim() !== '';
  if (named(task.assigned_to)) return false;
  if ((task.co_assignees ?? []).some(named)) return false;
  // ★★★ BLANK IS NOBODY, NOT SOMEBODY — and this line is not defensive noise.
  //
  // `resolvePrimaryTeamPerson` returns `ctx.entLead ?? null`, and `??` only
  // catches null/undefined. An `ent_lead` of `''` therefore resolves to `''`,
  // which is not `null`, and a strict `=== null` check would report the task as
  // CLAIMED BY AN EMPTY STRING. A unit test with `ent_lead: ''` caught it here.
  //
  // ★ Measured on prod 2026-08-30: all 15 lead-less permits hold a true NULL
  //   and zero hold '' or whitespace, so this changes no count today. It is
  //   here because the column is nullable text with no CHECK, three write paths
  //   reach it, and "nobody" arriving as '' must not read as an owner.
  return !named(resolvePrimaryAssignee(task.assigned_to, ctx, task.discipline));
}

/**
 * ★★ §B4 — WHO SEES THE QUEUE: admins and entitlement leads. Not the whole
 * company. This is a queue to clear, not a noticeboard, and the people who can
 * actually clear it are the ones who set a lead or take the task.
 *
 * ★ `ent` and `ent_lead` both count. They are the same three people on this
 * roster (Bobby, Briana, Miles hold both rows — fix-403), and gating on only
 * one of the two would hide the queue from somebody depending on which row the
 * identity resolver happened to surface first.
 */
const ENT_ROLES: ReadonlySet<TeamRole> = new Set<TeamRole>(['ent', 'ent_lead']);

export function canSeeUnclaimedQueue(
  isAdmin: boolean,
  roles: readonly TeamRole[] | null | undefined,
): boolean {
  if (isAdmin) return true;
  return (roles ?? []).some((r) => ENT_ROLES.has(r));
}

// ---------------------------------------------------------------------------
// ★★★ §A — THE SETTINGS PANEL'S ROWS
// ---------------------------------------------------------------------------
//
// MEASURED 2026-08-30: 15 permits of 651 carry no entitlement lead, and 14 of
// them are swallowing open work. The fifteenth carries none — which is exactly
// the distinction §A2 asks the count to draw: a lead-less permit with no work is
// housekeeping; one with three is a client waiting.
//
// ★★ WHY THE PANEL LISTS LEAD-LESS PERMITS AND NOT "PERMITS SWALLOWING WORK".
// 278 permits have no DA and only TWO of them swallow anything, so a panel
// keyed on "swallows work" would be right but a panel keyed on "no DA" would
// be 278 rows of noise. Missing ent_lead is the sized, nameable population
// Bobby is clearing; the My Tasks queue (§B) is what catches everything else,
// including those two.

/** One row of the "permits with no entitlement lead" panel. */
export interface MissingLeadRow {
  permitId: number;
  projectId: string;
  address: string;
  /** The permit number, or null when the city has not issued one yet. */
  num: string | null;
  type: string | null;
  status: string | null;
  da: string | null;
  updatedAt: string | null;
  /** ★ §A2: how many open tasks this permit is currently swallowing. */
  unclaimedCount: number;
  /** ★ §A3's tiebreak: the oldest swallowed task's created_at, or null. */
  oldestTaskAt: string | null;
}

interface PermitLike {
  id: number;
  project_id: string;
  num?: string | null;
  type?: string | null;
  status?: string | null;
  da?: string | null;
  ent_lead?: string | null;
  updated_at?: string | null;
}

interface TaskLike extends UnclaimableTask {
  permit_id: number;
  created_at?: string | null;
  completion_status?: string | null;
}

/**
 * ★★★ §A2/§A3 — the rows, counted and ordered.
 *
 * Sorted by swallowed-task count DESCENDING, then oldest task first. That order
 * is the argument: the permit costing the most reachable work is the one to fix
 * first, and among equals the one that has been costing it longest.
 *
 * ★ `isLive` is injected rather than imported so this stays a pure function
 *   with no dependency on taskStatus's vocabulary — the panel passes
 *   `isTaskLive`, and a test can pass its own.
 */
export function buildMissingLeadRows(
  permits: readonly PermitLike[],
  addressOf: (projectId: string) => string,
  tasks: readonly TaskLike[],
  isLive: (status: string | null | undefined) => boolean,
): MissingLeadRow[] {
  const blank = (v: string | null | undefined) => (v ?? '').trim() === '';
  const leadless = permits.filter((p) => blank(p.ent_lead));
  const byId = new Map(leadless.map((p) => [p.id, p]));

  const counts = new Map<number, { n: number; oldest: string | null }>();
  for (const t of tasks) {
    const permit = byId.get(t.permit_id);
    if (!permit) continue;
    if (!isLive(t.completion_status)) continue;
    // ★★ The SAME predicate the My Tasks queue uses, with this permit's own
    //    context — so the number on this row and the number on that switch
    //    cannot disagree.
    const ctx: PrimaryResolutionContext = {
      da: permit.da ?? null,
      dm: null,
      entLead: permit.ent_lead ?? null,
      schematicDesigners: [],
    };
    if (!isUnclaimedTask(t, ctx)) continue;
    const hit = counts.get(t.permit_id) ?? { n: 0, oldest: null };
    hit.n += 1;
    const at = t.created_at ?? null;
    if (at && (hit.oldest === null || at < hit.oldest)) hit.oldest = at;
    counts.set(t.permit_id, hit);
  }

  return leadless
    .map<MissingLeadRow>((p) => {
      const hit = counts.get(p.id);
      return {
        permitId: p.id,
        projectId: p.project_id,
        address: addressOf(p.project_id),
        num: blank(p.num) ? null : (p.num as string),
        type: p.type ?? null,
        status: p.status ?? null,
        da: blank(p.da) ? null : (p.da as string),
        updatedAt: p.updated_at ?? null,
        unclaimedCount: hit?.n ?? 0,
        oldestTaskAt: hit?.oldest ?? null,
      };
    })
    .sort((a, b) => {
      if (b.unclaimedCount !== a.unclaimedCount) {
        return b.unclaimedCount - a.unclaimedCount;
      }
      const ao = a.oldestTaskAt ?? '9999';
      const bo = b.oldestTaskAt ?? '9999';
      if (ao !== bo) return ao < bo ? -1 : 1;
      return a.address.localeCompare(b.address);
    });
}
