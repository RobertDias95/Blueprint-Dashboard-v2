import type { TeamMember, TeamRole } from './database.types';

// fix-321 #79 — ONE definition of "on the team today", and one place that says
// what a picker may offer.
//
// Bobby: "when I click design associate, it is showing design associates who are
// no longer active and/or employed. It would be great if we can get them removed
// and only show your active roster."
//
// ★★ THE TRAP THIS FILE EXISTS TO KEEP OUT OF THE CODE:
//
//     CHOOSING someone   → the current roster only
//     SHOWING who it is  → whatever is recorded, former or not
//
// If Nidhi is the DA on a permit, that permit keeps showing Nidhi. Hiding a
// recorded owner would make the permit look unassigned, which is a worse lie
// than the one being fixed and would undo two tickets' work (fix-308) making
// "who owns this" honest. Nothing in this file is allowed near a display path.
//
// ★ THE RULE, chosen and written down because `active` and `former` are
// SEPARATE COLUMNS that may disagree: a person is CURRENT when neither column
// says otherwise — `active !== false && former !== true`. Either flag alone
// retires them. Missing/undefined counts as current, so a roster row that
// predates a column is never silently dropped.
//
// It is the rule fix-233 already used for the task-assignee dropdowns
// (`activeMemberNamesOf`); this generalises it rather than adding a second
// answer. Measured in prod 2026-08-15: 3 of 41 roster rows are retired — Alex,
// Chad and Nidhi, all DAs — and on all three the two columns AGREE
// (active=false, former=true). So today the rule is not load-bearing; it is
// written down for the first row where they disagree.

/** The two columns the rule reads. Both OPTIONAL on purpose: "a missing flag
 *  counts as current" is only a real claim if a caller can actually pass a row
 *  without them — a projection, a fixture, a row from before the column. */
export interface MembershipFlags {
  active?: boolean | null;
  former?: boolean | null;
}

/** Is this person on the team today? See the rule above. */
export function isCurrentMember(m: MembershipFlags | null | undefined): boolean {
  if (!m) return false;
  return m.active !== false && m.former !== true;
}

/** The inverse, for readability at call sites that mean "has left". */
export function isFormerMember(m: MembershipFlags | null | undefined): boolean {
  return !!m && !isCurrentMember(m);
}

// ---------------------------------------------------------------------------
// ★★ fix-343 — the second reason a roster row must not be OFFERED
// ---------------------------------------------------------------------------
//
// The `viewer` role landed on prod 2026-08-18: six people who are in the roster
// and are NEVER ASSIGNED WORK — EJ, Greg and Taylor (Underwriting), Keenan
// (IT), Lucas (Policy) and Darin (CEO).
//
// ★ THEY ARE CURRENT MEMBERS. `active` is true and `former` is false, all six,
// and that is correct — they work here. So `isCurrentMember` says yes, and the
// task-assignee pickers (which source `activeMemberNamesOf`) started offering
// the CEO as a Design Associate the moment the rows landed.
//
// ★ WHICH IS WHY THIS IS A SECOND PREDICATE AND NOT A CHANGE TO THE FIRST.
// fix-321's rule answers "is this person here?"; this one answers "may a
// picker offer them work?". Conflating them would make a viewer look departed
// everywhere else — in a filter, in a roster list, beside a name they are
// recorded against — which is the display lie lib/roster exists to keep out.
//
// ★ AND IT IS STILL NOT A DISPLAY RULE. A viewer's name shows wherever it is
// recorded, exactly like a former member's.

/** The role flag this predicate reads, optional for the same reason
 *  MembershipFlags' are: a projection or a pre-`viewer` fixture must not be
 *  silently treated as unassignable. */
export interface AssignableFlags extends MembershipFlags {
  role?: TeamRole | null;
}

/** May a picker OFFER this person work? Current, and not a viewer. */
export function isAssignableMember(
  m: AssignableFlags | null | undefined,
): boolean {
  return isCurrentMember(m) && m?.role !== 'viewer';
}

/**
 * ★ fix-343: the full name behind a roster key, for the one thing a key cannot
 * do — initials. `team_members.name` is "Bobby", so `initialsOf` returned BO;
 * `initialsOf(rosterFullName('Bobby', roster))` returns BD.
 *
 * ★ IT RETURNS THE INPUT WHEN IT CANNOT DO BETTER — an unknown name, a departed
 * row with no first/last, a partial pair. A caller gets a usable string every
 * time and never has to decide what "no full name" looks like.
 *
 * ★ Matched trimmed + case-folded, the same way every other name comparison in
 * this app is (`norm` in selfScope, `dmForDa` in dmCoAssign).
 */
export function rosterFullName(
  name: string | null | undefined,
  members:
    | readonly Pick<TeamMember, 'name' | 'first_name' | 'last_name'>[]
    | null
    | undefined,
): string {
  const raw = (name ?? '').trim();
  if (!raw) return raw;
  const key = raw.toLowerCase();
  const hit = (members ?? []).find(
    (m) => (m.name ?? '').trim().toLowerCase() === key,
  );
  const first = (hit?.first_name ?? '').trim();
  const last = (hit?.last_name ?? '').trim();
  if (first && last) return `${first} ${last}`;
  return raw;
}

/**
 * Names the roster says are RETIRED.
 *
 * ★ Deliberately not "every name that is not current". A name can appear on a
 * permit without appearing in `team_members` at all — legacy scraper values,
 * someone never added to the roster — and treating unknown as departed would
 * quietly hide live people from their own filter. Unknown means unknown: only a
 * roster row that actually says so puts a name in this set.
 *
 * ★ And a name held by BOTH a current and a retired row (the schema has one row
 * per role, so a person can hold several) counts as CURRENT. One live role is
 * enough to still be here.
 */
export function formerMemberNames(
  members: readonly TeamMember[] | null | undefined,
): Set<string> {
  const current = new Set<string>();
  const former = new Set<string>();
  for (const m of members ?? []) {
    if (!m.name) continue;
    (isCurrentMember(m) ? current : former).add(m.name);
  }
  for (const name of current) former.delete(name);
  return former;
}

/**
 * The suffix a name wears when a list MUST keep offering someone who has left —
 * because rows are already assigned to them and omitting the option would
 * strand those rows behind a filter nobody can select.
 *
 * ★ DISPLAY ONLY. Callers put this in the option's LABEL and keep the raw name
 * as the option's VALUE; a marked name must never reach a filter comparison or
 * a stored column, which is how "Nidhi (former)" would end up written to a
 * layout row.
 */
export function formerLabel(name: string): string {
  return `${name} (former)`;
}
