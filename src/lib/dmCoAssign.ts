import type { DmDaGroupRow } from './database.types';

// ===========================================================================
// fix-346 §2 — a design associate's tasks are co-assigned to their design
// manager. This is the CLIENT TWIN of the SQL that actually does it.
// ===========================================================================
//
// ★★ THE RULE LIVES IN THE DATABASE, not here. `bp_trg_task_coassign_dm`
// (migrations/fix_346_dm_coassign.sql) fires AFTER INSERT OR UPDATE OF
// assigned_to on permit_tasks, so it holds for every writer — the two task
// editors, the OCC row editor, the v1-parity bulk replace, project seeding and
// anything the indexer or a future automation writes directly. A hook in one
// RPC (or worse, in a React component) would be silently absent from the rest,
// and silence is the failure mode: nobody ever sees the co-assignee that was
// not added.
//
// ★ THIS MODULE EXISTS FOR TWO REASONS, and neither of them is "run the rule":
//
//   1. TESTABILITY. There is no live database in CI, so the SQL is
//      regression-tested through a pure-TS mirror plus a documented,
//      rolled-back prod probe — the fix-153 pattern this codebase already uses
//      for bp_permit_in_corrections (fix-214) and bp_discipline_for_team
//      (fix-244). If you change the trigger, change `coAssignEffect` in the
//      same commit; the tests here are what notices when you don't.
//
//   2. THE GAP SURFACE. `unmappedActiveDas` is what Settings → Team uses to
//      name the active DAs the rule cannot help, which was Bobby's condition
//      for skipping them.
//
// ★ KEEP IN LOCKSTEP with the SQL. Same trim, same case-fold, same tie-break.

/** ★ The SQL twin of `bp_dm_for_da(p_da, p_tenant)`.
 *
 *  Trimmed and case-folded on both sides, because a stored assignee is free
 *  text typed by people, and "nicky " must not silently mean "not a DA".
 *
 *  ★ THE TIE-BREAK IS (dm_order, da_order, dm_name, da_name) — the exact order
 *  `useDmDaGroups` reads the table in, so a duplicated `da_name` resolves to
 *  the same manager here, on the server, and in the Settings matrix (whose
 *  index is "the first row wins"). Rows are sorted internally rather than
 *  assumed sorted, so a caller passing an unordered array still agrees with
 *  the database. */
export function dmForDa(
  assignee: string | null | undefined,
  rows: DmDaGroupRow[],
): string | null {
  const key = (assignee ?? '').trim().toLowerCase();
  if (key === '') return null;
  const hit = [...rows]
    .sort(
      (a, b) =>
        (a.dm_order ?? 999) - (b.dm_order ?? 999) ||
        (a.da_order ?? 999) - (b.da_order ?? 999) ||
        a.dm_name.localeCompare(b.dm_name) ||
        a.da_name.localeCompare(b.da_name),
    )
    .find(
      (r) =>
        (r.da_name ?? '').trim().toLowerCase() === key &&
        (r.dm_name ?? '').trim() !== '',
    );
  return hit ? hit.dm_name.trim() : null;
}

/** What the trigger does to one task's co-assignee rows. */
export interface CoAssignEffect {
  /** The manager to add as a `source = 'dm_of_da'` co-assignee, or null. */
  add: string | null;
  /** The previous assignee's manager to withdraw — and ONLY if the row it
   *  names carries `source = 'dm_of_da'`. Never a name a person chose. */
  remove: string | null;
}

export interface CoAssignInput {
  op: 'insert' | 'update';
  /** `OLD.assigned_to` — ignored on insert. */
  prevAssignee?: string | null;
  /** `NEW.assigned_to`. */
  nextAssignee: string | null | undefined;
  rows: DmDaGroupRow[];
}

/**
 * ★★ The TS twin of `bp_trg_task_coassign_dm`. Five rules, all measured on prod:
 *
 *  1. ★★★ THE KEY IS THE ASSIGNEE'S NAME, NEVER THE DISCIPLINE. Derry — a
 *     design MANAGER — holds 3 open `discipline = 'arch'` tasks and Ana
 *     (schematic) holds 1. Keying off discipline would co-assign Derry to her
 *     own task. The only question asked is "is this assignee a `da_name` in
 *     `dm_da_groups`?".
 *  2. ★★ A ROLE IS NOT A PERSON. `assigned_to` also holds team keys — open
 *     today: 'Design Manager' (8), 'Design Associate' (1), 'Schematic Team'
 *     (1), 'Architecture' (1). The rule acts on the LITERAL stored value,
 *     BEFORE fix-238's role→person resolution, which is to say it never
 *     resolves a role at all: "Design Associate" names no particular DA, and
 *     the person it DISPLAYS as is derived at read time from `permits.da` and
 *     changes when the project changes hands. A co-assignee row is a stored
 *     fact and cannot follow a derivation, so resolving one would freeze
 *     today's answer and quietly go wrong later. The same argument covers an
 *     UNSET assignee, whose displayed owner is derived from the task's
 *     DISCIPLINE — the one input this rule is forbidden to use.
 *  3. ★★ AN UNMAPPED DA GETS NOTHING, and does not error. Cam, Shire and
 *     George are active DAs with no row in `dm_da_groups`; Bobby chose to skip
 *     them rather than invent a manager. Cam has the largest task load on the
 *     team, which is exactly why the skip is named out loud in Settings — see
 *     `unmappedActiveDas`.
 *  4. NOBODY IS CO-ASSIGNED TO THEIR OWN TASK.
 *  5. ★ THE MANAGER FOLLOWS THE ASSIGNEE. Change the assignee and the manager
 *     swaps with them (Nicky → Marc drops Derry, adds Brittani); clear the
 *     assignee and the manager goes too, rather than being stranded as the
 *     lone co-assignee on a task nobody owns.
 *
 * ★ A save that rewrites `assigned_to` with the SAME value is not a change and
 * has no effect — the guard that keeps an unrelated edit (a due date, a status)
 * from resurrecting a manager the user deliberately removed.
 */
export function coAssignEffect(input: CoAssignInput): CoAssignEffect {
  const next = (input.nextAssignee ?? '').trim();
  const prev = (input.prevAssignee ?? '').trim();

  // ★ Identical value = not a change. Compared raw (like SQL's IS NOT
  // DISTINCT FROM on the column), so only a real edit re-applies the rule.
  if (input.op === 'update' && (input.prevAssignee ?? null) === (input.nextAssignee ?? null)) {
    return { add: null, remove: null };
  }

  const nextDm = dmForDa(next, input.rows);
  const prevDm = input.op === 'update' ? dmForDa(prev, input.rows) : null;

  const remove = prevDm !== null && prevDm !== nextDm ? prevDm : null;
  const add = nextDm !== null && nextDm !== next ? nextDm : null;
  return { add, remove };
}

/** ★★ The active DAs this rule cannot help: no row in `dm_da_groups`, so no
 *  manager to derive. Bobby chose to skip them — "★★ BUT IT MUST NOT BE
 *  SILENT" was the condition, so Settings → Team names them.
 *
 *  Matched trimmed + case-folded, the same way `dmForDa` matches, so a roster
 *  name that differs only in spacing is not reported as a gap it isn't. */
export function unmappedActiveDas(
  activeDaNames: string[],
  rows: DmDaGroupRow[],
): string[] {
  const mapped = new Set(
    rows
      .filter((r) => (r.dm_name ?? '').trim() !== '')
      .map((r) => (r.da_name ?? '').trim().toLowerCase()),
  );
  return activeDaNames.filter((n) => {
    const key = (n ?? '').trim().toLowerCase();
    return key !== '' && !mapped.has(key);
  });
}
