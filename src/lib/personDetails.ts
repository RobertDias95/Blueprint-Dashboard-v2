import type { TeamMember, TeamRole } from './database.types';

// ===========================================================================
// ★★★ fix-487 §B (P-120) — A PERSON'S DETAILS, FOLDED OUT OF THEIR ROLE ROWS
// ===========================================================================
//
// Bobby: *"have the ability to edit our team database so i can enter their last
// names too."* Ruled scope: first name / last name / email. `name` is the join
// key (~1,850 references, no FK, no cascade) and keeps its existing rename
// path; `role` is not this editor's business either.
//
// ---------------------------------------------------------------------------
// ★★★ WHY THIS IS A FOLD AND NOT A `.map()` OVER THE ROSTER
// ---------------------------------------------------------------------------
// `team_members` is ONE ROW PER (person, role) and seven people carry two rows.
// A screen that rendered rows would show Ana twice, with two surname boxes, and
// the obvious next thing that happens is that they disagree — fix-461's
// reasoning for `department`, unchanged, applied to the three fields fix-343
// added and nobody folded.
//
// ★★★ AND THEY HAD ALREADY DISAGREED. Measured on prod 2026-09-03:
//
//     Ana / schematic   Ana · Buttrey · ana@blueprintcap.com
//     Ana / da          —   ·   —     ·   —
//
// because AdminTeamTab's "add to this list" sends `{name, role}` and nothing
// else. The consequence was not cosmetic: `resolveRosterIdentity` (lib/selfScope)
// matches the signed-in address against `team_members.email` and keeps the
// roles of the rows that MATCH, so Ana resolved as `['schematic']` and her
// Design Associate role was invisible to her own self-scope, to My Tasks' role
// routing and to her name plate. The fix-487 migration healed her row and added
// `team_members_person_details_inherit` so a second role row cannot start blank
// again.
//
// ★★ THE DATABASE IS THE GUARANTEE, NOT THIS FILE — same division as fix-461.
// The sync trigger makes a split impossible going forward; what this adds is
// that a split which somehow exists is REPORTED rather than silently resolved
// by whichever row sorted first.

export interface RosterPerson {
  /** `team_members.name` — the join key, and the only person identity there is.
   *  Read-only everywhere in this feature. */
  name: string;
  /** Every role this person holds, sorted for a stable render. */
  roles: TeamRole[];
  /** True when ANY of their rows is active (the fix-298 / fix-461 OR). */
  active: boolean;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  /** How many roster rows back this person — shown so an editor knows their
   *  save touches more than the line they clicked. */
  rows: number;
  /** ★★★ The alarm: this person's rows do not agree about one of the three
   *  fields. The disagreeing field is left NULL above, because refusing to pick
   *  is the point. Empty when they agree. */
  split: Array<'first_name' | 'last_name' | 'email'>;
}

/** The one value the rows agree on, or `null` when they do not (or nobody has
 *  said). `disagreed` reports which case it was. */
function agreed(values: Array<string | null | undefined>): {
  value: string | null;
  disagreed: boolean;
} {
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v ?? '').trim();
    if (t !== '') seen.add(t);
  }
  if (seen.size === 0) return { value: null, disagreed: false };
  if (seen.size === 1) return { value: [...seen][0]!, disagreed: false };
  return { value: null, disagreed: true };
}

/**
 * Fold the roster into one entry per person, with their details.
 *
 * ★ Matched on the TRIMMED name and NOT case-folded — `bp_set_person_details`
 *   matches `name = v_name` exactly, so folding case here would group two
 *   people the writer would then treat as one. Same rule, same reason, as
 *   `foldRosterToPeople`.
 */
export function foldPersonDetails(
  members: readonly TeamMember[],
): RosterPerson[] {
  const byName = new Map<string, TeamMember[]>();
  for (const m of members) {
    const name = (m.name ?? '').trim();
    if (name === '') continue;
    const rows = byName.get(name);
    if (rows) rows.push(m);
    else byName.set(name, [m]);
  }
  return [...byName.entries()]
    .map(([name, rows]) => {
      const first = agreed(rows.map((r) => r.first_name));
      const last = agreed(rows.map((r) => r.last_name));
      const mail = agreed(rows.map((r) => r.email));
      const split: RosterPerson['split'] = [];
      if (first.disagreed) split.push('first_name');
      if (last.disagreed) split.push('last_name');
      if (mail.disagreed) split.push('email');
      return {
        name,
        roles: [...new Set(rows.map((r) => r.role).filter(Boolean))].sort(),
        active: rows.some((r) => r.active),
        first_name: first.value,
        last_name: last.value,
        email: mail.value,
        rows: rows.length,
        split,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** ★ Who still has something missing — the gap this panel exists to close.
 *
 *  ★★ EMAIL COUNTS AS A GAP, and that is the half worth arguing for. A missing
 *  surname is cosmetic; a missing address means `resolveRosterIdentity` cannot
 *  match that person to their login at all, so they sign in and the Bridge
 *  shows them somebody else's scope or none. Steve and David ship with NULL
 *  emails on purpose (nobody knows them), so they are the first two rows here. */
export function peopleMissingDetails(
  people: readonly RosterPerson[],
): RosterPerson[] {
  return people.filter(
    (p) =>
      p.active &&
      (!p.first_name || !p.last_name || !p.email || p.split.length > 0),
  );
}
