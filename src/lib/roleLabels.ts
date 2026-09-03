import type { TeamRole, Department } from './database.types';

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
  // ★★ fix-354 §6: Dave, over Design AND Entitlements — which is why it is its
  // own family below rather than a grade of either one.
  director: 'Director',
  ent_lead: 'Entitlements Manager', // ★ his words, and the one that started this
  ent: 'Entitlements',
  dm: 'Design Manager',
  da: 'Design Associate',
  schematic: 'Schematic Design',
  acq_lead: 'Acquisitions Lead',
  acq: 'Acquisitions',
  // ★ fix-487 (P-144). Bobby's own words for the position, unabbreviated —
  //   this map exists because `ent_lead` reached a name plate as "ENT_LEAD".
  ca: 'Construction Admin',
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
  director: 'Directors',
  ent_lead: 'Entitlement Leads',
  ent: 'Entitlement Leads',
  dm: 'Design Managers',
  da: 'Design Associates',
  schematic: 'Schematic Team',
  acq_lead: 'Acquisition Leads',
  acq: 'Acquisition Leads',
  ca: 'Construction Admins',
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
  // ★★ fix-354 §6: above ent_lead, per Bobby — he is the Director OVER Design
  // and Entitlements, so he outranks the manager of either.
  //
  // ★ NOTE THIS ARRAY IS NOT TYPE-CHECKED FOR TOTALITY the way the two Records
  // above are: it is a list, so a role omitted here compiles and silently sorts
  // LAST via roleSeniorityRank's -1 guard. A test asserts it covers every
  // TeamRole, because that is the one part of adding a role the compiler cannot
  // catch for you.
  'director',
  'ent_lead',
  'acq_lead',
  'dm',
  'schematic',
  'ent',
  'acq',
  'da',
  // ★★ fix-487: below the design roles and above `viewer`, and the placement
  //    only decides ONE thing — which title leads when a person holds a CA row
  //    AND another. Nobody does today. It is not a statement about anybody's
  //    standing; it is the tie-break `roles[0]` used to make by accident.
  'ca',
  'viewer',
];

/** Families of roles that are GRADES OF ONE JOB. Within a family only the most
 *  senior is shown; across families both are.
 *
 *  ★ Exported since fix-487 so the role-vocabulary suite can assert it is TOTAL
 *    the same way it asserts ROLE_SENIORITY is. `Record<TeamRole, …>` already
 *    makes a missing key a type error; the test catches the reverse (a key with
 *    no role), which is what a deleted role leaves behind. */
export const ROLE_FAMILY: Record<TeamRole, string> = {
  // ★★ ITS OWN FAMILY, deliberately. Put `director` in the `ent` family and it
  // would REPLACE `ent_lead` rather than print beside it — and Dave's is not a
  // grade of entitlements, it is a job over both. Its own family is what makes
  // "Director · Schematic Design" come out of {director, schematic}.
  director: 'director',
  ent_lead: 'ent',
  ent: 'ent',
  acq_lead: 'acq',
  acq: 'acq',
  dm: 'dm',
  schematic: 'schematic',
  da: 'da',
  // ★★ fix-487: ITS OWN FAMILY. A family means "grades of one job, print only
  //    the senior" — putting `ca` in the `dm` family would make a Design
  //    Manager who is also a Construction Admin print as one of the two. They
  //    are two real jobs, which is the `dm` + `schematic` case Derry already
  //    proves.
  ca: 'ca',
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


// ===========================================================================
// ★★★ fix-461 — THE FOUR DEPARTMENTS, AS BOBBY SAID THEM
// ===========================================================================
//
// Bobby, 2026-08-26, final: **Policy · Design & Entitlements · Acquisitions ·
// Underwriting.** He offered *"accounting, which is like EJ, Greg and them"*
// first and then settled on **Underwriting**; newest-first applies, so
// ACCOUNTING IS NOT ONE OF THE FOUR and there is no fifth.
//
// ★★★ AMENDED 2026-08-31 (fix-464) — THERE ARE SIX, AND "no fifth" IS
// SUPERSEDED. Having classified 32 of 35 people himself, Bobby found three the
// picker could not fit — Darin, Eric and Keenan, whose roster notes read CEO,
// President and IT: *"eric and darin are president and ceo, so they need a
// department. keenan is investor relations/IT so he needs a department too."*
// Offered one new department or two, he took **two**, so that IT is its own
// function rather than filed under the CEO.
//
// ★★ ACCOUNTING IS STILL NOT ONE OF THEM. Only the "no fifth" half of the note
// above expired; the Accounting half did not, and blurring the two would undo a
// decision he made in the same conversation.
//
// ★★ SAME SPLIT AS ROLE_TITLE ABOVE: a stable key in the database, the words
// he used on the screen. `design_entitlements` is a join-safe key;
// "Design & Entitlements" is the department.
//
// ★ WHY THE AXIS EXISTS — Bobby: *"[Lucas is] a director, like Dave, but two
// different departments."* `role` mixes discipline with seniority, so it can
// say "director" and it can say "schematic", but it cannot say "director of
// Policy". This can.

export const DEPARTMENT_LABEL: Record<Department, string> = {
  policy: 'Policy',
  design_entitlements: 'Design & Entitlements',
  acquisitions: 'Acquisitions',
  underwriting: 'Underwriting',
  // ★ fix-464. "IT & Investor Relations" is his phrasing turned into a name
  //   plate — he wrote "investor relations/IT"; the ampersand reads as a
  //   department where the slash reads as a job description.
  executive: 'Executive',
  it_investor_relations: 'IT & Investor Relations',
  // ★ fix-487 (P-144). See the `Department` union for the naming question this
  //   raises: every other department here is a FUNCTION and this one is a job
  //   title. Renaming it to "Construction" would change this line only.
  construction_admin: 'Construction Admin',
};

/** The four, in the order Bobby listed them — which is the order the picker
 *  offers and the panel groups by. Not alphabetical: his order is the one he
 *  will scan for. */
export const DEPARTMENTS: readonly Department[] = [
  'policy',
  'design_entitlements',
  'acquisitions',
  'underwriting',
  // ★★ fix-464 APPENDS — it does not reshuffle. The four above stay exactly
  //    where they were: this array's order is the one Bobby scans, and he has
  //    just spent a session using it to classify 32 people. Moving Executive to
  //    the top would be tidier and would cost him the muscle memory he built.
  'executive',
  'it_investor_relations',
  // ★★ fix-487 APPENDS, exactly as fix-464 did and for the same reason: this
  //    array's order is the one Bobby scans, and he has classified 32 people
  //    using it. A tidier position costs him the muscle memory he built.
  'construction_admin',
];

/** What to print for a department, including the un-classified case.
 *
 *  ★ NULL renders as a WORD, not a blank. 41 active rows hold NULL the day
 *  this ships, and a column of empty cells reads as a loading bug rather than
 *  as the work it is. */
export const NO_DEPARTMENT_LABEL = 'No department';

export function departmentLabel(d: Department | null | undefined): string {
  return d ? DEPARTMENT_LABEL[d] : NO_DEPARTMENT_LABEL;
}
