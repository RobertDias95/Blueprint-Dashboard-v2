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

/** ★★ fix-368: the THREE kinds of co-assignee row.
 *
 *  ★ The project-derived row is a DIFFERENT FACT from the person-derived one —
 *  one says "this is who they report to", the other "this is who runs this
 *  project" — so it gets its own value rather than reusing `dm_of_da`.
 *  Somebody will eventually want to keep one and drop the other, and that is
 *  impossible if they share a label. */
export type CoAssignSource = 'manual' | 'dm_of_da' | 'dm_of_project';

/** What the trigger does to one task's co-assignee rows. */
export interface CoAssignEffect {
  /** The manager to add, or null. */
  add: string | null;
  /** ★ fix-368: WHICH FACT `add` came from — the value written to
   *  `permit_task_assignees.source`. Null when there is nothing to add. */
  addSource: Exclude<CoAssignSource, 'manual'> | null;
  /** The previous assignee's manager to withdraw — and ONLY if the row it
   *  names carries an auto source. Never a name a person chose. */
  remove: string | null;
}

export interface CoAssignInput {
  op: 'insert' | 'update';
  /** `OLD.assigned_to` — ignored on insert. */
  prevAssignee?: string | null;
  /** `NEW.assigned_to`. */
  nextAssignee: string | null | undefined;
  rows: DmDaGroupRow[];
  /** ★★ fix-368: the design manager of the task's PROJECT, or null. The twin
   *  of `bp_project_dm_for_permit` — supplied rather than looked up, because a
   *  pure function does not go fetching. */
  projectDm?: string | null;
  /** ★★★ fix-368: is this assignee an ACTIVE DESIGN ASSOCIATE? The twin of the
   *  roster half of `bp_is_unmapped_active_da`, and the gate that makes the
   *  fallback correct rather than merely available — see the note on
   *  `coAssignEffect`. */
  isActiveDa?: (assignee: string) => boolean;
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
 *  6. ★★★ fix-368 — AN UNMAPPED DESIGN ASSOCIATE FALLS BACK TO THE PROJECT'S
 *     manager, and rule 3 above is now the case where the PROJECT has none
 *     either. See `resolveCoAssign` for the order, the role gate, and the 127
 *     wrong co-assignments the gate prevents.
 *  7. ★★ fix-368 — AND THE ANSWER CAN CHANGE WITHOUT THE TASK CHANGING. It
 *     depends on `projects.design_manager`, so a project reassignment makes
 *     every project-derived row on it stale with nothing to fire the task
 *     trigger. `bp_trg_project_dm_coassign` is the second trigger that exists
 *     for that; there is no TS twin of it because it acts on rows rather than
 *     computing an answer.
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
    return { add: null, addSource: null, remove: null };
  }

  const nextResolved = resolveCoAssign(next, input);
  const prevResolved = input.op === 'update' ? resolveCoAssign(prev, input) : null;

  const remove =
    prevResolved?.manager != null && prevResolved.manager !== nextResolved.manager
      ? prevResolved.manager
      : null;
  const add =
    nextResolved.manager !== null &&
    nextResolved.manager.toLowerCase() !== next.toLowerCase()
      ? nextResolved.manager
      : null;
  return { add, addSource: add ? nextResolved.src : null, remove };
}

/** ★★★ fix-368 — THE ONE RULE, and the ORDER IS THE RULE.
 *
 *  The TS twin of `bp_coassign_for_task`.
 *
 *  1. ★★ THE PERSON-DERIVED ANSWER WINS. Ahmadi, Marc, Fisk and the rest
 *     genuinely belong to a manager whatever project they are on, so a
 *     `dm_da_groups` mapping is never overridden by the project. Measured: on
 *     a project Jade runs, Ahmadi still reaches Brittani.
 *
 *  2. ★★★ THE PROJECT-DERIVED ANSWER, FOR AN UNMAPPED DESIGN ASSOCIATE ONLY.
 *     Bobby: "their manager group would be dependent upon the permit they are
 *     working on… we would just co-assign their tasks to the design manager of
 *     that project." Cam's 14 open tasks span four projects and THREE
 *     different managers, so a single dm_da_groups row would have mis-filed
 *     two thirds of his work.
 *
 *     ★★★ AND THE ROLE GATE IS LOAD-BEARING. Applied to every UNMAPPED
 *     assignee rather than to unmapped DESIGN ASSOCIATES, this rule would have
 *     co-assigned a design manager to 127 more open tasks, every one wrong:
 *     the role tokens 'Entitlements' (48), 'Design Manager' (6) and 'Schematic
 *     Team' (1); the entitlement leads Miles (40), Briana (22) and Bobby (7);
 *     Derry, who IS a design manager (2); and Ana, schematic (1). An
 *     entitlement lead does not report to a design manager.
 *
 *  3. Nobody — and that is a real answer, not a failure. 20 of 161 active
 *     projects have no design_manager.
 */
function resolveCoAssign(
  assignee: string,
  input: CoAssignInput,
): { manager: string | null; src: Exclude<CoAssignSource, 'manual'> | null } {
  if (assignee === '') return { manager: null, src: null };

  const mapped = dmForDa(assignee, input.rows);
  if (mapped !== null) return { manager: mapped, src: 'dm_of_da' };

  const isDa = input.isActiveDa?.(assignee) ?? false;
  if (!isDa) return { manager: null, src: null };

  const projectDm = (input.projectDm ?? '').trim();
  return projectDm === ''
    ? { manager: null, src: null }
    : { manager: projectDm, src: 'dm_of_project' };
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
