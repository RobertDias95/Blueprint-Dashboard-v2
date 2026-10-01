import type { Permit, Project, TeamMember } from './database.types';
import { normalizePrimaryTeamKey } from './taskTeam';

// ===========================================================================
// ★★★ fix-527 §A (P-243) — THE NAMES THE WORK DATA KNOWS, AND WHO THEY ARE
// ===========================================================================
//
// Bobby's role model says a Design Associate may edit *"only projects they are
// part of."* P-026 recorded that as blocked on permissions. **It is not: it is
// blocked on identity** — until an account can be tied to a person, no
// permission rule can name one.
//
// ★★★ AND THE TIE ALREADY EXISTS, WHICH IS THIS TICKET'S MAIN FINDING. §0 says
//     *"DA names matching any account: 0"*, measured against `profiles.name` —
//     which is NULL on all 37 accounts and always has been. **The mapping was
//     never meant to live there.** It lives in `team_members.email`, matched
//     against the auth email, and `resolveRosterIdentity` has read it since
//     fix-176. Measured on prod 2026-09-11:
//
//       distinct names across all six work-data columns        26
//       …that are in the roster                                26  ← all of them
//       …that resolve to a real account                        22
//       name→project hits behind the resolved 22              848
//       name→project hits behind the unresolved 4              22  ← not 119
//       names mapping to MORE than one account                  0
//
// ★★★ SO THE GAP IS FOUR NAMES — `George · Alex · Chad · Nidhi` — holding 22 of
//     870 hits. Every one of them has a roster row with **no email**. The
//     ambiguity is not *"who is this"*; it is that **a blank email cannot say
//     whether nobody has filled it in yet or whether this person has no login
//     at all.** That distinction is the only thing §A genuinely needs a column
//     for, and it is the thing the brief is right about.
//
// ★ This module is PURE. It collects the names, counts what each one holds, and
//   resolves each to an account **through the roster that already does it** —
//   there is no second matcher here and there must not be one. Two matchers
//   that agree today are two matchers that disagree after the next role.

/** The columns a person's name is typed into. ★ Named once: the panel, the
 *  counts and the test all read this list, so a new column is one edit.
 *
 *  ★★ fix-619 (census gap 22): the first six were ALL the name columns this
 *     knew about — six more hold names too, and a name only typed there
 *     (an acquisition lead, a construction admin, a task owner) was invisible
 *     to the one screen that asks who each name is. */
export const WORK_DATA_COLUMNS = [
  'draw_schedule.da_assigned',
  'permits.da',
  'permits.ent_lead',
  'permits.dm',
  'permits.architect',
  'permits.ca',
  'projects.design_manager',
  'projects.schematic_designer',
  'projects.acq_lead',
  'projects.entitlement_lead',
  'projects.construction_admin',
  'permit_tasks.assigned_to',
] as const;
export type WorkDataColumn = (typeof WORK_DATA_COLUMNS)[number];

export interface WorkDataName {
  /** The name exactly as it is typed in the data. */
  name: string;
  /** Distinct projects this name holds across all the columns. ★ The number
   *  Bobby needs in order to see what a mapping decision COSTS. */
  projects: number;
  /** Which columns it appears in, for the ones that look like a typo. */
  columns: WorkDataColumn[];
}

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * Every distinct name in the work data, with how many projects it holds.
 *
 * ★★ Counted by DISTINCT PROJECT, not by row: a person on four of a project's
 *    permits is on one project, and a list that said "4" would make a
 *    one-project decision look like a four-project one.
 */
export function collectWorkDataNames(
  projects: ReadonlyArray<
    Pick<Project, 'id' | 'design_manager' | 'schematic_designer'> &
      Partial<Pick<Project, 'acq_lead' | 'entitlement_lead' | 'construction_admin'>>
  >,
  permits: ReadonlyArray<
    Pick<Permit, 'project_id' | 'da' | 'ent_lead' | 'dm'> &
      Partial<Pick<Permit, 'id' | 'architect' | 'ca'>>
  >,
  draw: ReadonlyArray<{ project_id: string; da_assigned: string | null }>,
  /** ★ fix-619: tasks, by permit — `assigned_to` holds names AND role tokens
   *  ("Design Manager"); only names are people, so tokens are skipped. */
  tasks: ReadonlyArray<{ permit_id: number | null; assigned_to: string | null }> = [],
): WorkDataName[] {
  const byName = new Map<string, { name: string; projects: Set<string>; columns: Set<WorkDataColumn> }>();

  function add(raw: string | null | undefined, projectId: string, column: WorkDataColumn) {
    const name = (raw ?? '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const entry = byName.get(key) ?? {
      // ★ The first spelling seen wins the display, and the key is folded —
      //   `marc` and `Marc` are one person with one project count, not two
      //   rows Bobby has to map twice.
      name,
      projects: new Set<string>(),
      columns: new Set<WorkDataColumn>(),
    };
    entry.projects.add(projectId);
    entry.columns.add(column);
    byName.set(key, entry);
  }

  for (const d of draw) add(d.da_assigned, d.project_id, 'draw_schedule.da_assigned');
  const projectOfPermit = new Map<number, string>();
  for (const p of permits) {
    if (p.id != null) projectOfPermit.set(p.id, p.project_id);
    add(p.da, p.project_id, 'permits.da');
    add(p.ent_lead, p.project_id, 'permits.ent_lead');
    add(p.dm, p.project_id, 'permits.dm');
    add(p.architect, p.project_id, 'permits.architect');
    add(p.ca, p.project_id, 'permits.ca');
  }
  for (const t of tasks) {
    const projectId = t.permit_id != null ? projectOfPermit.get(t.permit_id) : undefined;
    if (!projectId) continue;
    // ★ A role placeholder is not a person — the task picks its person by role.
    if (normalizePrimaryTeamKey(t.assigned_to) !== null) continue;
    add(t.assigned_to, projectId, 'permit_tasks.assigned_to');
  }
  for (const pr of projects) {
    add(pr.design_manager, pr.id, 'projects.design_manager');
    add(pr.acq_lead, pr.id, 'projects.acq_lead');
    add(pr.entitlement_lead, pr.id, 'projects.entitlement_lead');
    add(pr.construction_admin, pr.id, 'projects.construction_admin');
    // ★ `schematic_designer` is an ARRAY column — the only one that is.
    for (const sd of pr.schematic_designer ?? []) {
      add(sd, pr.id, 'projects.schematic_designer');
    }
  }

  return [...byName.values()]
    .map((e) => ({
      name: e.name,
      projects: e.projects.size,
      columns: WORK_DATA_COLUMNS.filter((c) => e.columns.has(c)),
    }))
    .sort((a, b) => b.projects - a.projects || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// ★★★ THE THREE ANSWERS, AND WHY "UNMAPPED" IS NOT ONE OF THE OTHER TWO
// ---------------------------------------------------------------------------

export type NameLinkStatus =
  /** A roster row carries an email and an account exists for it. */
  | 'linked'
  /** ★ Somebody has said, deliberately, that this name has no login. A real
   *  answer — not the absence of one. A mapping that cannot say "nobody"
   *  invites a wrong guess, which is how 33 projects get granted to a person
   *  because their initials looked right. */
  | 'no-account'
  /** ★★★ NOBODY HAS DECIDED YET, and this is the SAFE DEFAULT. It must behave
   *  as NO ACCESS — never as all access. A name in the roster with a blank
   *  email is here, and so is a name typed yesterday that no roster row
   *  mentions. */
  | 'unmapped';

export interface NameLink extends WorkDataName {
  status: NameLinkStatus;
  /** The roster row's email, when there is one. Null otherwise. */
  email: string | null;
  /** The account id, when one exists for that email. */
  accountId: string | null;
  /** True when the name is not in the roster at all — a name typed into the
   *  work data that nobody has ever filed. ★ These are the standing
   *  reconciliation: see the panel. */
  unknownToRoster: boolean;
}

export interface AccountRow {
  id: string;
  email: string | null;
}

/**
 * Resolve each work-data name to an account, **through the roster**.
 *
 * ★★★ FAIL CLOSED. Every branch that cannot prove an account returns
 *     `unmapped`, and `mayEditLibrary` below returns false for it. There is no
 *     branch that grants anything on a partial match, a fuzzy name or an
 *     email local-part — §A: *"probably is not good enough to grant access to
 *     33 projects."*
 *
 * ★★ A NAME MAPS TO AT MOST ONE ACCOUNT, by construction: the roster rows for
 *    one name are folded to the FIRST email, and a name whose roster rows
 *    disagree about the email is reported `unmapped` rather than resolved to
 *    one of them. Measured 2026-09-11: 0 names map to more than one account, so
 *    this guards a case that does not exist yet rather than one it fixes.
 */
export function resolveNameLinks(
  names: readonly WorkDataName[],
  members: ReadonlyArray<
    Pick<TeamMember, 'name' | 'email'> & { has_no_account?: boolean | null }
  >,
  accounts: readonly AccountRow[] | undefined,
): NameLink[] {
  const accountByEmail = new Map<string, string>();
  for (const a of accounts ?? []) {
    const e = norm(a.email);
    if (e) accountByEmail.set(e, a.id);
  }

  const rosterByName = new Map<
    string,
    { emails: Set<string>; noAccount: boolean }
  >();
  for (const m of members) {
    const key = norm(m.name);
    if (!key) continue;
    const entry = rosterByName.get(key) ?? { emails: new Set<string>(), noAccount: false };
    const e = norm(m.email);
    if (e) entry.emails.add(e);
    // ★ ANY row saying "no account" is the person's answer. A person with three
    //   roster rows (one per role — Jade has exactly that on prod) should not
    //   need the flag set three times.
    if (m.has_no_account === true) entry.noAccount = true;
    rosterByName.set(key, entry);
  }

  return names.map((n) => {
    const roster = rosterByName.get(norm(n.name));
    if (!roster) {
      return { ...n, status: 'unmapped', email: null, accountId: null, unknownToRoster: true };
    }
    if (roster.noAccount) {
      return { ...n, status: 'no-account', email: null, accountId: null, unknownToRoster: false };
    }
    // ★ Disagreeing emails are NOT arbitrated — see the note above.
    const emails = [...roster.emails];
    const email = emails.length === 1 ? emails[0] : null;
    if (!email) {
      return { ...n, status: 'unmapped', email: null, accountId: null, unknownToRoster: false };
    }
    // ★★★ `accounts` UNDEFINED means we could not read the account list — which
    //     is what happens before the migration, and for a non-admin. It must
    //     resolve to `unmapped`, not to `linked`: an unknown is not a yes.
    const accountId = accountByEmail.get(email) ?? null;
    return {
      ...n,
      status: accountId ? 'linked' : 'unmapped',
      email,
      accountId,
      unknownToRoster: false,
    };
  });
}

/** How many names are still waiting on a decision. ★ The number the panel's
 *  heading prints, so the screen says what it is for before it is read. */
export function unmappedCount(links: readonly NameLink[]): number {
  return links.filter((l) => l.status === 'unmapped').length;
}

// ---------------------------------------------------------------------------
// ★★★ §B — THE CAPABILITY, READ THE SAME WAY EVERYWHERE
// ---------------------------------------------------------------------------
//
// Bobby, 2026-09-10: **one capability — *may edit Library fields* — attached to
// named people, enforced in the RPCs, not the browser.**
//
// ⚠️⚠️ THIS FUNCTION IS NOT A GATE AND MUST NEVER BE USED AS ONE. ~20
//      `useIsTenantAdmin` sites in this app hide a control in the BROWSER, and
//      within a tenant every user is equivalent server-side — so those are not
//      enforcement, they are decoration on top of an open door.
//      `bp_reassign_project_sd` (fix-520 §E) is the single site that checks in
//      the RPC, and **the outlier is the correct one.**
//
// ★★★ SO THE REAL GATE IS `bp_update_library_fields`, which raises `42501` for a
//      caller without the capability — and this predicate exists only so the UI
//      can EXPLAIN a refusal it did not prevent. A test calls the RPC as a user
//      without the capability and asserts the refusal; no test asserts a hidden
//      button, because that assertion passes against the broken pattern.

export interface CapabilityRow {
  /** ★ Optional because it does not exist until Cowork applies the migration.
   *  `undefined` is treated exactly like `false` — fail closed. */
  may_edit_library?: boolean | null;
}

/** ★★★ FAIL CLOSED: anything that is not literally `true` is `false`. A missing
 *  column, a null, an unread row and an unmapped person all mean NO. */
export function mayEditLibrary(row: CapabilityRow | null | undefined): boolean {
  return row?.may_edit_library === true;
}
