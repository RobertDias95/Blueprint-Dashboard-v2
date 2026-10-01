// ===========================================================================
// ★★★ fix-613 §A (P-166 step 3b) — PEOPLE AS ONE TABLE, THE RULES
// ===========================================================================
//
// ⚖️ Bobby, 2026-09-30: **People = one table** — one row per person, roles as
//    chips, email / department / agenda as columns, filter by role,
//    **Remove → Retire for every role.**
//
// This module holds the decisions; `PeopleTable.tsx` renders them. It is a lib
// so the retire/restore arithmetic can be tested without a DOM, and because the
// nine blocks it replaces had their rules spread across nine call sites.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT "ONE ROW PER PERSON" MEANS, AND WHY IT IS NOT A `.map()`
// ---------------------------------------------------------------------------
// `team_members` is one row per (person, role). Jade holds three — da, dm and
// schematic. The nine pill lists each rendered one role, so Jade appeared three
// times across three cards and no screen in the app ever said she was one
// person. `foldPersonDetails` (fix-487) already folds the roster by name and is
// reused verbatim; this module adds the columns Bobby asked for and the two
// lifecycle verbs.

import type { Department, TeamMember, TeamRole } from './database.types';
import { isCurrentMember } from './roster';
import { foldPersonDetails, type RosterPerson } from './personDetails';

/**
 * One person, as the Everyone table shows them.
 *
 * ★ `RosterPerson` already carries name / roles / full name / email / split.
 *   The three fields below are the ones the table adds, and each is folded with
 *   the same "what do their rows agree on" rule — because a person has one
 *   department and one agenda membership, whatever their row count.
 */
export interface PeopleTableRow extends RosterPerson {
  department: Department | null;
  agenda: boolean;
  /** Their underlying roster rows, so a retire can write every one of them. */
  members: TeamMember[];
  /** Any role whose row is retired while another is still live. */
  retiredRoles: TeamRole[];
}

/** ★ Every role the filter chips offer, in Bobby's order from the mock. */
export const PEOPLE_ROLE_FILTERS: readonly TeamRole[] = [
  'da',
  'dm',
  'ent',
  'ent_lead',
  'acq',
  'acq_lead',
  'schematic',
  'ca',
  'director',
  'viewer',
];

/**
 * Fold the roster into table rows.
 *
 * ★★ `active` HERE IS THE fix-298 / fix-461 **OR**: a person is on the active
 *    table when ANY of their rows is live. Jade retired as a DA but still a DM
 *    is an active person with one retired chip — which is exactly the state the
 *    nine pill lists could not show, because each list only knew its own role.
 */
export function foldPeopleTable(
  members: readonly TeamMember[],
): PeopleTableRow[] {
  const byName = new Map<string, TeamMember[]>();
  for (const m of members) {
    const name = (m.name ?? '').trim();
    if (name === '') continue;
    const rows = byName.get(name);
    if (rows) rows.push(m);
    else byName.set(name, [m]);
  }
  return foldPersonDetails(members).map((person) => {
    const rows = byName.get(person.name) ?? [];
    return {
      ...person,
      department: agreedDepartment(rows),
      // ★ The agenda flag is a fact about the person; the trigger propagates it
      //   to every row, so ANY row saying true is the honest read.
      agenda: rows.some((r) => r.agenda_member === true),
      members: rows,
      retiredRoles: rows
        .filter((r) => !isCurrentMember(r))
        .map((r) => r.role)
        .sort(),
    };
  });
}

/** ★ The one department their rows agree on. A split returns null rather than
 *  picking a winner — the same refusal `foldPersonDetails` makes, and the DB's
 *  `bp_trg_team_department_sync` makes a split impossible going forward. */
function agreedDepartment(rows: readonly TeamMember[]): Department | null {
  const seen = new Set<Department>();
  for (const r of rows) if (r.department) seen.add(r.department);
  return seen.size === 1 ? [...seen][0]! : null;
}

/** The people on the active table: anybody with at least one live row. */
export function activePeople(rows: readonly PeopleTableRow[]): PeopleTableRow[] {
  return rows.filter((p) => p.members.some(isCurrentMember));
}

/** ★★★ Former & inactive: NOBODY live. One list for every role, where today
 *  only DAs had one — Caleb is `acq_lead` with `active=false` and appeared on no
 *  Settings surface at all (fix-407 found him; this is the list that holds him). */
export function retiredPeople(rows: readonly PeopleTableRow[]): PeopleTableRow[] {
  return rows.filter(
    (p) => p.members.length > 0 && !p.members.some(isCurrentMember),
  );
}

/** How many active people hold each role — the filter chips' counts. */
export function roleCounts(
  rows: readonly PeopleTableRow[],
): Map<TeamRole, number> {
  const counts = new Map<TeamRole, number>();
  for (const p of activePeople(rows)) {
    for (const m of p.members) {
      if (!isCurrentMember(m)) continue;
      counts.set(m.role, (counts.get(m.role) ?? 0) + 1);
    }
  }
  return counts;
}

/** Rows matching the chosen filter. `null` = Everyone. */
export function filterByRole(
  rows: readonly PeopleTableRow[],
  role: TeamRole | null,
): PeopleTableRow[] {
  if (!role) return [...rows];
  return rows.filter((p) =>
    p.members.some((m) => m.role === role && isCurrentMember(m)),
  );
}

// ===========================================================================
// ★★★ RETIRE AND RESTORE — THE TWO FLAGS, AND WHY BOTH ARE NEEDED
// ===========================================================================
//
// ⚖️ Bobby: *"Remove → Retire for every role."* §A: *"DA keeps today's meaning
//    (`former = true`); every other role `active = false`."*
//
// ★★★ AND THAT ASYMMETRY IS NOT A TIDY-UP WAITING TO HAPPEN — it is what makes
//     a retire actually drop somebody out of the pickers. `isCurrentMember` is
//     `active !== false && former !== true`, so EITHER flag retires a row. But
//     the DA surfaces have read `former` specifically since Q7.3.b (the alumni
//     list, `formerDas`, `formerMemberNames`, the Team Structure chips), and a
//     DA retired with `active=false` instead would vanish from the pickers and
//     NOT appear in the alumni list — retired and unrestorable, which is worse
//     than either state alone.
//
// ★★ NO HARD DELETE ANYWHERE (census gap 37). `bp_delete_team_member_row` is
//    not reachable from this screen at all: a deleted row takes the person's
//    name off the roster while ~2,209 assignments across 11 columns still point
//    at that string, which is how a name nobody can map is created.

/** The patch that retires one roster row, by role. */
export function retirePatch(role: TeamRole): Partial<TeamMember> {
  return role === 'da' ? { former: true } : { active: false };
}

/** The patch that restores one roster row. ★ BOTH flags are cleared, whatever
 *  the role: a row retired under the old DA rule and then restored as a
 *  non-DA would otherwise keep `former=true` and stay invisible. */
export function restorePatch(): Partial<TeamMember> {
  return { active: true, former: false };
}

/** Every (row, patch) a whole-person retire has to write. ★ Rows already
 *  retired are skipped, so the save is the smallest honest one. */
export function retirePersonWrites(
  person: PeopleTableRow,
): Array<{ member: TeamMember; patch: Partial<TeamMember> }> {
  return person.members
    .filter(isCurrentMember)
    .map((member) => ({ member, patch: retirePatch(member.role) }));
}

/** Every (row, patch) a whole-person restore has to write. */
export function restorePersonWrites(
  person: PeopleTableRow,
): Array<{ member: TeamMember; patch: Partial<TeamMember> }> {
  return person.members
    .filter((m) => !isCurrentMember(m))
    .map((member) => ({ member, patch: restorePatch() }));
}

// ===========================================================================
// §A — adding a person WITHOUT a login (census gap 34)
// ===========================================================================
//
// ★★★ THE PILL "Add…" BOXES WERE THE SOURCE OF NAMES NOBODY CAN MAP. They sent
//     `{name, role}` and nothing else, so a new row arrived with no first name,
//     no last name and no email — and `resolveRosterIdentity` matches a login by
//     EMAIL, so that person could never be matched to their own sign-in. Ana's
//     split row (fix-487) was made exactly this way.
//
// ★★ So the replacement requires the three things that make a row usable, and
//    leaves optional only the one that genuinely may not exist yet.
export interface AddWithoutLoginInput {
  /** The credited name — `team_members.name`, the text join key. */
  name: string;
  first_name: string;
  last_name: string;
  role: TeamRole | '';
  /** Optional: somebody with no address yet is the case this path exists for. */
  email?: string;
}

/** What is still missing, as field keys. Empty = ready to save. */
export function addWithoutLoginRefusals(
  input: AddWithoutLoginInput,
): Array<'name' | 'first_name' | 'last_name' | 'role'> {
  const out: Array<'name' | 'first_name' | 'last_name' | 'role'> = [];
  if (input.name.trim() === '') out.push('name');
  if (input.first_name.trim() === '') out.push('first_name');
  if (input.last_name.trim() === '') out.push('last_name');
  if (input.role === '') out.push('role');
  return out;
}
