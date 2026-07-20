import type {
  MyTaskNode,
  Permit,
  Project,
  TeamRole,
} from './database.types';
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
   *  longer uses it to decide scope). */
  roles: TeamRole[];
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

/** Resolve the logged-in user's roster identity from the team_members roster by
 *  matching the auth email. A person may hold multiple rows — collect every
 *  role, and take the (consistent) name from the first match. The scope is then
 *  decided from real project-level assignments (fix-179), NOT the role column.
 *  Returns an all-scope identity with name=null when nothing matches. */
export function resolveRosterIdentity(
  email: string | null | undefined,
  members: ReadonlyArray<{ name: string; email: string | null; role: TeamRole }>,
  projects: ReadonlyArray<Pick<Project, 'entitlement_lead' | 'design_manager'>>,
): RosterIdentity {
  const target = norm(email);
  if (!target) return { name: null, roles: [], scope: 'all' };

  const matches = members.filter((m) => norm(m.email) === target);
  if (matches.length === 0) return { name: null, roles: [], scope: 'all' };

  const name = matches[0].name;
  const roles = [...new Set(matches.map((m) => m.role))];

  return { name, roles, scope: deriveSelfScope(name, projects) };
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
export function taskMatchesSelfResolved(
  task: Pick<
    MyTaskNode,
    'assigned_to' | 'discipline' | 'co_assignees' | 'permit_da'
  >,
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
  if (norm(primary) === n) return true;

  // Rule 2 — CO-ASSIGNEE.
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
