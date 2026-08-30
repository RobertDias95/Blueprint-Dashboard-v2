import type {
  MyTaskNode,
  Permit,
  Project,
  TeamRole,
} from './database.types';
import { roleSeniorityRank } from './roleLabels';
import {
  resolveCoAssignee,
  resolvePrimaryAssignee,
  type ResolutionContext,
} from './taskTeam';

// fix-176: default the Dashboard / Project Overview / My-tab to the logged-in
// user's own work, switchable + remembered per-user.
//
// The crux (resolved in fix-176): permit/project role fields store roster NAMES
// ("Miles", "Cam"), but users log in by email. The bridge is team_members:
// a roster row carries name + email + role (discipline). fix-176's data
// migration filled team_members.email for the login accounts, so matching the
// auth email against team_members yields the user's roster name(s).
//
// fix-179: the scope tier is decided by REAL ASSIGNMENTS, not the roster role
// column. The role column was wrong for per-permit leads — e.g. Bobby holds the
// 'ent_lead' role but leads ZERO projects at the project level (he's the ent_lead
// on 49 permits), so role-driven project-scope matched nothing and his "My Work"
// was empty. Now:
//   * name leads >=1 project (entitlement_lead / design_manager) -> PROJECT scope
//   * name is mapped but leads no project                         -> PERMIT scope
//   * no roster match                                             -> 'all'
// The role column is left in place; it's just no longer the scope decider.

export type SelfScopeKind = 'project' | 'permit' | 'all';

/** Which surface the toggle persists for (keyed alongside the user id). */
export type SelfScopeView = 'dashboard' | 'projects' | 'mytasks';

/** Mine = show only the logged-in user's work; All = everyone. */
export type ScopeMode = 'mine' | 'all';

export interface RosterIdentity {
  /** Roster name that matches permit.da / project.entitlement_lead etc.
   *  null when the login has no roster row (-> scope 'all'). */
  name: string | null;
  /** Every roster discipline the user holds (kept for reference; fix-179 no
   *  longer uses it to decide scope).
   *
   *  ★★ fix-343: ORDERED BY SENIORITY, most senior first. It used to arrive in
   *  whatever order the roster query returned, and Chrome printed `roles[0]` —
   *  so Bobby (`ent` AND `ent_lead`) could see either title, and two people
   *  could see different ones for him on the same screen. The order is now a
   *  property of the roles held, not of the query. */
  roles: TeamRole[];
  /** ★ fix-343: the person's roster note. It carries the real function of a
   *  `viewer` — Underwriting, IT, Policy, CEO — which is deliberately NOT in
   *  `role`, because `role` drives the assignment dropdowns and these six are
   *  never assigned work. `rosterRoleTitle` is what turns it into a title. */
  notes: string | null;
  /** fix-179: scope derived from real assignments — 'project' when the name
   *  leads ≥1 project, 'permit' when mapped but leads none, 'all' when unmapped. */
  scope: SelfScopeKind;
}

/** Case/whitespace-insensitive name+email compare. Empty/null never matches. */
function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** fix-179: decide a mapped user's scope from REAL project-level assignments
 *  (reusing the unchanged projectMatchesSelf predicate): project-scope iff the
 *  name leads at least one project (entitlement_lead / design_manager), else
 *  permit-scope. An unmapped name (null) is always 'all'. */
export function deriveSelfScope(
  name: string | null,
  projects: ReadonlyArray<Pick<Project, 'entitlement_lead' | 'design_manager'>>,
): SelfScopeKind {
  if (!norm(name)) return 'all';
  return projects.some((p) => projectMatchesSelf(p, name)) ? 'project' : 'permit';
}

// ===========================================================================
// ★★★ fix-428 — "nothing assigned to you" WAS NEVER ASKED
// ===========================================================================
//
// Bobby, 2026-08-28: *"for people like dave, gena, darin, eric, lucas, certain
// people in acquisitions, who are not assigned any permits/projects, their
// default view should be everyone… nothing assigned to you, your default view
// is everyone vs my work."*
//
// ★★★ HE GUESSED FIVE NAMES. MEASURED ON PROD THE SAME DAY IT IS SIXTEEN, of
// twenty-nine logins — every account with a roster row and zero project leads,
// zero permit assignments and (bar one) zero tasks:
//
//   Ana · Darin · Dave · Dom · EJ · Eric · Gena · Greg · Jake · Jason ·
//   Jessie · Keelie · Keenan · Lucas · Scott · Taylor
//
// More than half the company opens a blank Pipeline, a blank Project View and
// a blank My Tasks. It already shows: Gena has not signed in since 2026-07-08,
// Lucas since 2026-07-07, Greg/EJ/Taylor since late July.
//
// ---------------------------------------------------------------------------
// ★★★ THE RULE BOBBY WANTS ALREADY EXISTS — THE QUESTION WAS ASKED TOO NARROWLY
// ---------------------------------------------------------------------------
//
// `initialScopeMode` already returns 'all' for an identity scoped 'all'. The
// defect is upstream, in `deriveSelfScope` above: it decides the tier from
// PROJECTS ONLY, so a roster name leading no project is filed 'permit' — "you
// have permit-level work" — WITHOUT ANYONE EVER CHECKING WHETHER THEY ARE ON A
// PERMIT. All sixteen land there, 'permit' defaults to 'mine', and 'mine' is
// empty.
//
// ★★ `deriveSelfScope` IS DELIBERATELY LEFT ALONE. It is fix-179's, its result
// is `RosterIdentity.scope`, and that is read by the name plate (fix-343), the
// board lens and PersonalBoard — none of which want a permits query. The
// widening is a SEPARATE pure function applied where the toggle default is
// computed, and only there. See useScopeMode.

/**
 * ★★★ fix-428: a roster name with no project AND no permit has nothing to show
 * in "My Work", so it starts on Everyone.
 *
 * Pure, so it is trivially testable without a browser or a query client.
 *
 * ★ 'project' and 'all' pass straight through UNTOUCHED — a project lead has
 *   work by definition, and an unmapped name is already Everyone. Only
 *   'permit' is re-examined, because 'permit' is the tier `deriveSelfScope`
 *   assigns by ELIMINATION rather than by evidence.
 *
 * ★★ It reuses `permitMatchesSelf`, which already implements the four-role
 *    match (ent_lead | dm | da | dual_da). There is no second predicate here,
 *    and there must not be one: two matchers that agree today are two matchers
 *    that disagree after the next role is added.
 *
 * ★★★ DERIVED LIVE, NEVER STAMPED. Because this is recomputed from real
 *     assignments on every render, the day Gena is given her first permit her
 *     default becomes My Work by itself. Anything that wrote the answer at
 *     account creation would be wrong within a week, and silently.
 */
export function widenScopeWhenUnassigned(
  scope: SelfScopeKind,
  name: string | null,
  permits: ReadonlyArray<Pick<Permit, 'ent_lead' | 'dm' | 'da' | 'dual_da'>>,
): SelfScopeKind {
  if (scope !== 'permit') return scope;
  if (!norm(name)) return 'all';
  return permits.some((p) => permitMatchesSelf(p, name)) ? 'permit' : 'all';
}

/** Resolve the logged-in user's roster identity from the team_members roster by
 *  matching the auth email. A person may hold multiple rows — collect every
 *  role, and take the (consistent) name from the first match. The scope is then
 *  decided from real project-level assignments (fix-179), NOT the role column.
 *  Returns an all-scope identity with name=null when nothing matches. */
export function resolveRosterIdentity(
  email: string | null | undefined,
  members: ReadonlyArray<{
    name: string;
    email: string | null;
    role: TeamRole;
    notes?: string | null;
  }>,
  projects: ReadonlyArray<Pick<Project, 'entitlement_lead' | 'design_manager'>>,
): RosterIdentity {
  const target = norm(email);
  if (!target) return { name: null, roles: [], notes: null, scope: 'all' };

  const matches = members.filter((m) => norm(m.email) === target);
  if (matches.length === 0) {
    return { name: null, roles: [], notes: null, scope: 'all' };
  }

  const name = matches[0].name;
  // ★★ fix-343: SORTED, not "whatever came back". See RosterIdentity.roles —
  // `roles[0]` is printed as the user's title, and an array with no guaranteed
  // order made that title a coin toss for the five people who hold two roles.
  const roles = [...new Set(matches.map((m) => m.role))].sort(
    (a, b) => roleSeniorityRank(a) - roleSeniorityRank(b) || a.localeCompare(b),
  );
  // ★ One row per role, so the note may sit on any of them; take the first
  // non-empty rather than the first row's.
  const notes =
    matches.map((m) => (m.notes ?? '').trim()).find((n) => n !== '') ?? null;

  return { name, roles, notes, scope: deriveSelfScope(name, projects) };
}

/** Project-scope match: the person is on a PROJECT-level role for this project. */
export function projectMatchesSelf(
  project: Pick<Project, 'entitlement_lead' | 'design_manager'>,
  name: string | null,
): boolean {
  const n = norm(name);
  if (!n) return false;
  return norm(project.entitlement_lead) === n || norm(project.design_manager) === n;
}

/** Permit-scope match: the person is assigned to this permit in ANY role —
 *  ent_lead, dm, da, or dual_da. fix-180: was da/dual_da only (built for DAs in
 *  fix-176), which missed permit-level entitlement leads like Bobby (ent_lead on
 *  49 permits, da on 0) — his permit-scoped "My Work" was blank. */
export function permitMatchesSelf(
  permit: Pick<Permit, 'ent_lead' | 'dm' | 'da' | 'dual_da'>,
  name: string | null,
): boolean {
  const n = norm(name);
  if (!n) return false;
  return (
    norm(permit.ent_lead) === n ||
    norm(permit.dm) === n ||
    norm(permit.da) === n ||
    norm(permit.dual_da) === n
  );
}

/** Task-scope match (My tab): the person is the primary or a co-assignee.
 *  Legacy shape — matches on the server-DERIVED `primary_assignee` (arch→da,
 *  ent→ent_lead) only. Superseded on the My Tasks board + Waiting On view by
 *  taskMatchesSelfResolved, which resolves the overloaded `assigned_to` role
 *  placeholders (Design Manager / Schematic Team / …) to real people. Kept for
 *  callers that only have the derived primary + co-assignees. */
export function taskMatchesSelf(
  task: Pick<MyTaskNode, 'primary_assignee' | 'co_assignees'>,
  name: string | null,
): boolean {
  const n = norm(name);
  if (!n) return false;
  if (norm(task.primary_assignee) === n) return true;
  return (task.co_assignees ?? []).some((a) => norm(a) === n);
}

/** fix-238: the per-project role context needed to resolve a task's owner(s).
 *  Populated the SAME way the task chip resolves its displayed owner, so a
 *  task always routes to the person it is shown as. */
export interface TaskOwnershipContext {
  /** permit.da for this task's permit (the Design Associate). Drives rule 3
   *  (the arch blanket) and the 'Design Associate' assignment target. */
  da: string | null;
  /** The Design Manager for this task — resolved dm_da_groups(da) the way the
   *  chip is, with project.design_manager / permit.dm as fallbacks. */
  dm: string | null;
  /** The Entitlement lead — permit.ent_lead, with project.entitlement_lead as
   *  a fallback. */
  entLead: string | null;
  /** project.schematic_designer(s). */
  schematicDesigners: string[];
}

/** fix-238: does task T belong in user U's My Tasks? U matches when ANY of:
 *   1. ASSIGNMENT — assigned_to resolves to U. The overloaded assigned_to text
 *      column holds a ROLE placeholder ("Design Manager", "Schematic Team",
 *      "Entitlements", "Design Associate", "Architecture"), a LITERAL person, or
 *      null. resolvePrimaryAssignee maps a role to the person who fills it on
 *      THIS project (the same mapping the task chip shows), a literal name to
 *      itself, and an unset value to the discipline's default lead (ent→entLead,
 *      else da). This is what fixes the reported bug: a task switched to "Design
 *      Manager" now routes to the DM (Derry), not the DA.
 *   2. CO-ASSIGNEE — U is one of the task's co-assignees (person names; role
 *      tokens resolved for safety).
 *   3. DA BLANKET (arch only) — U is the project's DA and the task is an
 *      architecture task; the DA sees EVERY arch task on their permit whatever
 *      the assignee. Entitlement tasks have no blanket rule. */
/** The subset of a task the three ownership rules read. */
type OwnableTask = Pick<
  MyTaskNode,
  'assigned_to' | 'discipline' | 'co_assignees' | 'permit_da'
>;

// ===========================================================================
// ★★★ fix-445 §A1 — THE SAME THREE RULES, SPLIT INTO "MINE" AND "SHARED"
// ===========================================================================
//
// Bobby, 2026-08-29 (D-2026-08-29-board-is-the-snapshot-my-tasks-is-everything,
// ruling 4 / P-047): *"Design managers want to see the tasks they own, then
// flip co-assigned work on and off on top — so 'mine' and 'shared' are
// distinguishable rather than blended."*
//
// ★★★ THE PARTITION IS EXHAUSTIVE AND DISJOINT, AND THAT IS THE WHOLE DESIGN.
// `taskMatchesSelfResolved` is now LITERALLY `ownsDirectly || isCoAssigned`,
// so the board's definition of ownership cannot drift from My Tasks' — it is
// the same expression, not a second one that agrees today. And `isCoAssigned`
// ends with "AND NOT ownsDirectly", so no task is ever both: if you own it,
// you own it, and being listed as a co-assignee on top does not demote it to
// somebody else's work you happen to see.
//
// ★★ WHY "BOTH" IS NOT AN EMPTY CASE. Measured on prod 2026-08-29 over 323
// open tasks: Miles has 24 tasks he owns directly AND is separately listed on,
// Trevor has 4. Those 24 rows must not carry the "co-assigned" mark, or the
// person who owns the most work on the board would see most of it labelled as
// somebody else's.
//
// ★ Rule ORDER is preserved exactly (3 → 1 → 2), because
// `resolvePrimaryAssignee` is not free and Rule 3 is a cheap string compare.

/** Rules 3 + 1 — the task is YOURS: you are the project's DA on an arch task,
 *  or `assigned_to` resolves to you (literal name, role placeholder, or the
 *  discipline's default lead when unset). */
export function ownsDirectly(
  task: OwnableTask,
  name: string | null,
  ctx: TaskOwnershipContext,
): boolean {
  const n = norm(name);
  if (!n) return false;

  // Rule 3 — DA blanket (arch only).
  if (task.discipline === 'arch' && norm(task.permit_da) === n) return true;

  // Rule 1 — ASSIGNMENT (role placeholder / literal person / unset default).
  const primary = resolvePrimaryAssignee(
    task.assigned_to,
    {
      da: ctx.da,
      entLead: ctx.entLead,
      dm: ctx.dm,
      schematicDesigners: ctx.schematicDesigners,
    },
    task.discipline,
  );
  return norm(primary) === n;
}

/** Rule 2 — the task reaches you ONLY through the co-assignee join
 *  (`permit_task_assignees`, surfaced as `co_assignees` by
 *  `bp_task_co_assignees`). Shared work, not yours.
 *
 *  ★★★ THIS IS NOT A SMALL SLICE. Measured on prod 2026-08-29, open tasks
 *  reachable ONLY this way, as a share of everything that person sees:
 *  Brittani 29 of 30 (97%), Lindsay 19 of 22 (86%), Derry 20 of 25 (80%),
 *  Jade 4 of 4, Keelie 3 of 3 — against Miles's 2 of 122. For five people on
 *  the roster the co-assigned list IS their list, which is why the toggle
 *  defaults ON and why turning it off must be a deliberate, session-scoped
 *  act rather than a setting that quietly persists. */
export function isCoAssigned(
  task: OwnableTask,
  name: string | null,
  ctx: TaskOwnershipContext,
): boolean {
  const n = norm(name);
  if (!n) return false;
  // ★ "AND NOT ownsDirectly" — the half that makes the partition disjoint.
  if (ownsDirectly(task, name, ctx)) return false;

  const coCtx: ResolutionContext = {
    da: ctx.da,
    dm: ctx.dm,
    schematicDesigners: ctx.schematicDesigners,
  };
  for (const entry of task.co_assignees ?? []) {
    for (const person of resolveCoAssignee(entry, coCtx)) {
      if (norm(person) === n) return true;
    }
  }
  return false;
}

export function taskMatchesSelfResolved(
  task: OwnableTask,
  name: string | null,
  ctx: TaskOwnershipContext,
): boolean {
  // ★★★ Unchanged by construction. See the block above.
  return ownsDirectly(task, name, ctx) || isCoAssigned(task, name, ctx);
}

// ---- per-user persistence of the Mine/All choice ----
//
// Keyed per user id so one login's choice never leaks to another on the same
// browser (Bobby's explicit ask). loadScopeMode returns null when the user has
// never made an explicit choice for this view — the caller then applies the
// role-aware self-default rather than overriding a deliberate "All".

function scopeStorageKey(userId: string, view: SelfScopeView): string {
  return `selfScope.${view}.${userId}`;
}

export function loadScopeMode(
  userId: string | null | undefined,
  view: SelfScopeView,
): ScopeMode | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(scopeStorageKey(userId, view));
    return raw === 'mine' || raw === 'all' ? raw : null;
  } catch {
    return null;
  }
}

export function saveScopeMode(
  userId: string | null | undefined,
  view: SelfScopeView,
  mode: ScopeMode,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(scopeStorageKey(userId, view), mode);
  } catch {
    // localStorage full / disabled — persistence is best-effort.
  }
}

/** The mode a view should start in: the user's remembered choice if any, else
 *  the role-aware self-default ('mine' when they have a roster scope, 'all'
 *  when unmapped). Pure so it's trivially testable. */
export function initialScopeMode(
  stored: ScopeMode | null,
  identityScope: SelfScopeKind,
): ScopeMode {
  if (stored !== null) return stored;
  return identityScope === 'all' ? 'all' : 'mine';
}
