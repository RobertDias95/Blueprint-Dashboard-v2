import type { TeamRole } from './database.types';

// ===========================================================================
// fix-343 — job titles, not database keys
// ===========================================================================
//
// Bobby, on his own name plate: "it says Bobby and then it says entitlement
// lead, but it's like ENT underscore lead. First off, I am entitlements
// manager, so let's update that to reflect it."
//
// ★★ A MAP FOR EVERY ROLE, NOT A SPECIAL CASE FOR HIS. `ent_lead` was the one
// he happened to be looking at; `da`, `dm`, `acq_lead`, `schematic` and the new
// `viewer` were all reaching the screen exactly as stored. One map, so the next
// role that gets added has one place to be named.
//
// ★ AND IT IS PRESENTATION ONLY. The stored values stay what they are — they
// are join keys for ~2,209 rows across 11 columns, and the label is a fact
// about the screen, not about the row. Nothing here belongs in the database.
//
// ---------------------------------------------------------------------------
// ★★ THE OTHER HALF: `roles[0]` WAS A COIN TOSS
// ---------------------------------------------------------------------------
// A person holds ONE ROW PER ROLE, so `roles` is an array with no guaranteed
// order, and Chrome printed `roles[0]`. Bobby holds BOTH `ent` and `ent_lead`,
// as do Briana and Miles; Derry and Lindsay hold `dm` and `schematic`. Two
// people looking at the same screen could see different titles for the same
// person, and one person could see their own title change between reloads.
//
// ★ THE RULE, chosen deliberately (see `rosterRoleTitle`):
//
//   1. WITHIN a family, the most senior wins — `ent_lead` beats `ent`,
//      `acq_lead` beats `acq`. They are two grades of one job, and printing
//      both ("Entitlements Manager · Entitlements") says nothing twice.
//   2. ACROSS families, show BOTH, in a fixed order. `dm` and `schematic` are
//      not a hierarchy; they are two real jobs, and Derry does both. Dropping
//      one would be picking a favourite, which is the bug this replaces.
//   3. `viewer` yields to any real role and is never printed as a word.
//
// Deterministic in every case: the output depends on the SET of roles, never on
// the order they arrived in — which is what the shuffled test pins.

/** ★ SINGULAR — a person's title. "Bobby · Entitlements Manager". */
export const ROLE_TITLE: Record<TeamRole, string> = {
  ent_lead: 'Entitlements Manager', // ★ his words, and the one that started this
  ent: 'Entitlements',
  dm: 'Design Manager',
  da: 'Design Associate',
  schematic: 'Schematic Design',
  acq_lead: 'Acquisitions Lead',
  acq: 'Acquisitions',
  // ★ Never actually printed — see `rosterRoleTitle`. It is here so the map is
  // total over TeamRole (a missing key would be a type error, which is the
  // point of the Record) and so a future caller that must name the role in an
  // admin context has one word to use rather than inventing a second one.
  viewer: 'Viewer',
};

/** ★ PLURAL — a heading over a list of people. "Design Associates". Same
 *  source as the singular so the two cannot drift; Settings → Team owns the
 *  only screen that needs them. */
export const ROLE_TITLE_PLURAL: Record<TeamRole, string> = {
  ent_lead: 'Entitlement Leads',
  ent: 'Entitlement Leads',
  dm: 'Design Managers',
  da: 'Design Associates',
  schematic: 'Schematic Team',
  acq_lead: 'Acquisition Leads',
  acq: 'Acquisition Leads',
  viewer: 'Viewers',
};

/**
 * ★★ Seniority, most senior first. This array is the ONLY thing that decides
 * which of a person's roles leads their title, so the answer is a property of
 * the data rather than of the query plan.
 *
 * ★ `viewer` sits last on purpose: it is not a job, it is the absence of one
 * (see below), so any real role outranks it.
 */
export const ROLE_SENIORITY: readonly TeamRole[] = [
  'ent_lead',
  'acq_lead',
  'dm',
  'schematic',
  'ent',
  'acq',
  'da',
  'viewer',
];

/** Families of roles that are GRADES OF ONE JOB. Within a family only the most
 *  senior is shown; across families both are. */
const ROLE_FAMILY: Record<TeamRole, string> = {
  ent_lead: 'ent',
  ent: 'ent',
  acq_lead: 'acq',
  acq: 'acq',
  dm: 'dm',
  schematic: 'schematic',
  da: 'da',
  viewer: 'viewer',
};

/** Where a role sits in ROLE_SENIORITY — lower is more senior. Exported so the
 *  roster identity can SORT the roles it resolves (selfScope), which is what
 *  makes `roles[0]` a decision instead of an accident. */
export function roleSeniorityRank(role: TeamRole): number {
  const i = ROLE_SENIORITY.indexOf(role);
  // An unknown value sorts last rather than first — a role nobody has ranked
  // must never outrank one somebody did.
  return i === -1 ? ROLE_SENIORITY.length : i;
}

const seniorityIndex = roleSeniorityRank;

/**
 * ★ The roles that actually describe this person, most senior first, one per
 * family. Bobby's {ent, ent_lead} → ['ent_lead']; Derry's {dm, schematic} →
 * ['dm', 'schematic']; a pure viewer's {viewer} → ['viewer'].
 *
 * Exported because "which role is this person's primary" is a question other
 * code may need to ask without wanting a printable string.
 */
export function primaryRoles(roles: readonly TeamRole[]): TeamRole[] {
  const bestOfFamily = new Map<string, TeamRole>();
  for (const role of roles) {
    const family = ROLE_FAMILY[role] ?? role;
    const held = bestOfFamily.get(family);
    if (held === undefined || seniorityIndex(role) < seniorityIndex(held)) {
      bestOfFamily.set(family, role);
    }
  }
  const kept = [...bestOfFamily.values()].sort(
    (a, b) => seniorityIndex(a) - seniorityIndex(b) || a.localeCompare(b),
  );
  // ★ `viewer` means "in the roster, never assigned work". It is a statement
  // about what somebody does NOT do, so it is dropped the moment there is
  // something they DO do.
  const real = kept.filter((r) => r !== 'viewer');
  return real.length > 0 ? real : kept;
}

/** How two real jobs are joined on one line. */
const TITLE_SEPARATOR = ' · ';

/**
 * ★★ The title to print for a person, from the SET of roles they hold.
 *
 * ★ `viewer` IS THE INTERESTING ONE. Rendering the word "viewer" tells EJ he is
 * a viewer, which is true and useless — it names his permissions, not his job.
 * What he actually does is recorded in `team_members.notes` (Underwriting, IT,
 * Policy, CEO), deliberately kept out of `role` because `role` drives the
 * assignment dropdowns and none of these six is ever assigned work. So a viewer
 * shows their NOTES.
 *
 * ★ And when notes is empty there is nothing true to say about their job, so
 * this returns null and the caller falls back to its own neutral line (Chrome
 * already had one: "Blueprint Services"). Inventing "Team member" would be a
 * placeholder, and printing "Viewer" would be the thing this ticket removes.
 *
 * @param roles every role the person holds, in any order
 * @param notes team_members.notes for that person — the real function of a viewer
 */
export function rosterRoleTitle(
  roles: readonly TeamRole[] | null | undefined,
  notes?: string | null,
): string | null {
  const held = primaryRoles(roles ?? []);
  if (held.length === 0) return null;
  if (held.length === 1 && held[0] === 'viewer') {
    const fn = (notes ?? '').trim();
    return fn === '' ? null : fn;
  }
  return held.map((r) => ROLE_TITLE[r] ?? r).join(TITLE_SEPARATOR);
}
