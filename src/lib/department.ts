import type { Department, TeamMember, TeamRole } from './database.types';

// ===========================================================================
// ★★★ fix-461 §B2 — EDIT BY PERSON, NOT BY ROW
// ===========================================================================
//
// THE TRAP: `team_members` is one row per (person, role). Measured on prod
// 2026-08-30, six people carry two rows each — Bobby, Briana and Miles
// (ent + ent_lead), Derry and Lindsay (dm + schematic), Dave (director +
// schematic). 46 rows cover 40 people; 41 active rows cover 35 active people.
//
// ★★ So a panel that rendered ROWS would show Dave twice with two dropdowns,
// and the obvious next thing that happens is that they disagree. This module
// folds the roster into PEOPLE first, and the panel never sees a role row.
//
// ★★★ THE DATABASE IS STILL THE GUARANTEE, NOT THIS FILE.
// `bp_trg_team_department_sync` propagates any change across a person's rows in
// the same transaction, so a split cannot be created by this editor, by hand
// SQL, or by the add-a-person path. What this module adds is that a split which
// somehow already existed is REPORTED LOUDLY rather than silently resolved by
// whichever row happened to sort first (§B2).

export interface DepartmentPerson {
  /** ★ `team_members.name` — the join key, and the only person identity there
   *  is. There is no people table. */
  name: string;
  /** Every role this person holds, sorted for a stable render. */
  roles: TeamRole[];
  /** The person's department, or null when not yet classified. */
  department: Department | null;
  /** True when this person is currently active in any of their rows. */
  active: boolean;
  /** ★★★ §B2's alarm: the person's rows do NOT agree. The trigger makes this
   *  impossible going forward, so a true here means data that predates it or
   *  arrived around it — which is worth shouting about, not quietly averaging.
   *  `department` above is left NULL in that case: refusing to pick is the
   *  point. */
  split: Department[] | null;
}

/**
 * Fold the roster into one entry per person.
 *
 * ★ Matched on the trimmed name, the same way every other name comparison in
 *   this app is. Case is NOT folded here, deliberately: `bp_set_team_department`
 *   matches `name = v_name` exactly, so folding here would group two people the
 *   writer would then treat as one.
 */
export function foldRosterToPeople(
  members: readonly TeamMember[],
): DepartmentPerson[] {
  const byName = new Map<string, DepartmentPerson & { seen: Set<string> }>();
  for (const m of members) {
    const name = (m.name ?? '').trim();
    if (name === '') continue;
    let p = byName.get(name);
    if (!p) {
      p = {
        name,
        roles: [],
        department: null,
        active: false,
        split: null,
        seen: new Set<string>(),
      };
      byName.set(name, p);
    }
    if (m.role && !p.roles.includes(m.role)) p.roles.push(m.role);
    // ★ ACTIVE IF ANY ROW IS. A person whose `da` row was retired but whose
    //   `dm` row is live is an active person — the same OR the oversight flag
    //   uses (fix-298).
    if (m.active) p.active = true;
    if (m.department) p.seen.add(m.department);
  }
  return [...byName.values()]
    .map((p) => {
      const seen = [...p.seen] as Department[];
      return {
        name: p.name,
        roles: p.roles.sort(),
        // ★★★ TWO VALUES MEANS WE REFUSE TO PICK ONE. Choosing would hide the
        //     defect; the panel renders the disagreement instead.
        department: seen.length === 1 ? seen[0]! : null,
        active: p.active,
        split: seen.length > 1 ? seen.sort() : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * ★★ §B3 — the gap: active people with no department.
 *
 * On the day this ships that is every active person (35 of them, over 41 rows),
 * and the panel says so. The day Bobby finishes it is empty — and the empty
 * state is a sentence, not a blank, because an empty warning box reads as a
 * failure to load rather than as the goal.
 *
 * ★ Inactive people are NOT listed. Classifying somebody who has left is work
 *   nobody needs, and including them would make the list never reach zero.
 */
export function peopleWithNoDepartment(
  people: readonly DepartmentPerson[],
): DepartmentPerson[] {
  return people.filter((p) => p.active && p.department === null && !p.split);
}

/**
 * ★ §B4 — REPORTED, NOT ACTED ON.
 *
 * Seven active rows carry `role='viewer'` as a stand-in for "unclassified" —
 * Darin, EJ, Eric, Greg, Keenan, Lucas and Taylor, the CEO and the President
 * among them. Once a department exists, `viewer` may be redundant for some of
 * them. **That is Bobby's call and is not this ticket's.** This returns the
 * count so the panel can surface it; nothing here changes a role.
 */
export function viewerOverlap(
  people: readonly DepartmentPerson[],
): DepartmentPerson[] {
  return people.filter((p) => p.active && p.roles.includes('viewer'));
}
