import { describe, it, expect } from 'vitest';
// Vite `?raw` rather than node:fs — the app tsconfig has no @types/node, so a
// filesystem read typechecks in CI only by accident (fix-253's note).
import COASSIGN_SQL from '../../migrations/fix_346_dm_coassign.sql?raw';
import DEPARTED_SQL from '../../migrations/fix_346_dm_da_groups_departed.sql?raw';
import { coAssignEffect, dmForDa, unmappedActiveDas } from '../lib/dmCoAssign';
import type { DmDaGroupRow } from '../lib/database.types';

// ===========================================================================
// fix-346 §2 — a design associate's tasks are co-assigned to their design
// manager, and §3 — three departed DAs leave routing.
// ===========================================================================
//
// ★★ THE RULE RUNS IN POSTGRES (`bp_trg_task_coassign_dm`, AFTER INSERT OR
// UPDATE OF assigned_to on permit_tasks), because four different things insert
// tasks — the two editors, the v1-parity bulk replace and project seeding —
// plus anything the indexer writes directly, and a rule installed in one RPC
// would be silently absent from the rest.
//
// ★ THERE IS NO LIVE DATABASE IN CI, so the SQL is regression-tested the way
// this codebase has done it since fix-153: a pure-TS mirror (src/lib/dmCoAssign
// .ts) asserted here, plus a documented rolled-back prod probe. The probe was
// run against production inside a transaction that ends in RAISE EXCEPTION, so
// nothing it wrote survived. Its output, verbatim:
//
//   1  mapped DA Nicky                    -> Derry/dm_of_da
//   2  unmapped DA Cam                    -> (none)
//   3  DM Derry, discipline='arch'        -> (none)
//   4  role "Design Associate"            -> (none)
//   5  unassigned (NULL)                  -> (none)
//   6  "  nicky " (untrimmed, lowercase)  -> Derry/dm_of_da
//   7  Nicky -> Marc                      =  Brittani/dm_of_da   (Derry gone)
//   8  Marc  -> NULL                      =  (none)              (not stranded)
//   9  manual Derry row + assign Nicky    =  Derry/manual        (no duplicate,
//                                                                 not relabelled)
//   10 removed by hand, then an unrelated save with the SAME assignee
//                                         -> (none)              (no resurrection)
//   11 dm_of_da rows on pre-existing tasks = 0                   (no backfill)
//
// Every line of that probe has a mirror test below. When you change the
// trigger, change `coAssignEffect` in the same commit — these are what notice.

// The prod mapping AS IT STANDS AFTER §3 (Alex, Chad and Nidhi removed).
const ROWS: DmDaGroupRow[] = [
  ['Lindsay', 'Francesca', 1, 1],
  ['Lindsay', 'Ainsley', 1, 2],
  ['Lindsay', 'Trevor', 1, 3],
  ['Derry', 'Nicky', 2, 1],
  ['Derry', 'Qisheng', 2, 3],
  ['Brittani', 'Marc', 3, 1],
  ['Brittani', 'Ahmadi', 3, 2],
  ['Brittani', 'Fisk', 3, 3],
  ['Jade', 'Erick', 4, 2],
].map(([dm, da, dmo, dao], i) => ({
  id: `g-${i}`,
  dm_name: dm as string,
  da_name: da as string,
  dm_order: dmo as number,
  da_order: dao as number,
  updated_at: '2026-08-18T00:00:00Z',
}));

const ACTIVE_DAS = [
  'Ahmadi', 'Ainsley', 'Cam', 'Erick', 'Fisk', 'Francesca',
  'George', 'Marc', 'Nicky', 'Qisheng', 'Shire', 'Trevor',
];

describe('fix-346 §2: dmForDa — the twin of bp_dm_for_da', () => {
  it('★ a mapped DA resolves to their manager', () => {
    expect(dmForDa('Nicky', ROWS)).toBe('Derry');
    expect(dmForDa('Marc', ROWS)).toBe('Brittani');
    expect(dmForDa('Erick', ROWS)).toBe('Jade');
  });

  // ★ assigned_to is free text people type. Probe line 6.
  it('★ trimmed and case-folded, like the SQL', () => {
    expect(dmForDa('  nicky ', ROWS)).toBe('Derry');
    expect(dmForDa('NICKY', ROWS)).toBe('Derry');
  });

  it('★ an unmapped DA, a DM, a role and an empty value all resolve to nobody', () => {
    expect(dmForDa('Cam', ROWS)).toBeNull();
    expect(dmForDa('Shire', ROWS)).toBeNull();
    expect(dmForDa('George', ROWS)).toBeNull();
    expect(dmForDa('Derry', ROWS)).toBeNull();
    expect(dmForDa('Design Associate', ROWS)).toBeNull();
    expect(dmForDa('', ROWS)).toBeNull();
    expect(dmForDa(null, ROWS)).toBeNull();
  });

  // ★ The tie-break is the order useDmDaGroups reads the table in, so a
  // duplicated da_name resolves the same way in the trigger, in this mirror and
  // in the Settings matrix (whose index is "the first row wins").
  it('★ a duplicated da_name resolves by (dm_order, da_order)', () => {
    const dupes: DmDaGroupRow[] = [
      { id: 'z', dm_name: 'Jade', da_name: 'Nicky', dm_order: 4, da_order: 9, updated_at: '' },
      ...ROWS,
    ];
    expect(dmForDa('Nicky', dupes)).toBe('Derry');
  });
});

// ★★ fix-368 widened `CoAssignEffect` with `addSource` — WHICH FACT the manager
// came from, written to `permit_task_assignees.source`. Every case below is
// the person-derived rule, so the answer is `dm_of_da` wherever there is one;
// asserting it here is what proves fix-368's fallback did not quietly relabel
// fix-346's rows. The project-derived cases live in
// CoAssignProjectManagerFix368.test.ts.
describe('fix-346 §2: coAssignEffect — the twin of bp_trg_task_coassign_dm', () => {
  const insert = (assignee: string | null) =>
    coAssignEffect({ op: 'insert', nextAssignee: assignee, rows: ROWS });

  // ★★ Probe line 1 — the headline behaviour.
  it('★★ a task assigned to a mapped DA gains that DA\'s manager, on creation', () => {
    expect(insert('Nicky')).toEqual({ add: 'Derry', addSource: 'dm_of_da', remove: null });
    expect(insert('Fisk')).toEqual({ add: 'Brittani', addSource: 'dm_of_da', remove: null });
  });

  // ★★★ Probe line 2 — Bobby's decision: skip, never invent. Cam has the
  // largest task load on the team, which is why the skip is surfaced in
  // Settings rather than left to be discovered.
  it('★★★ an unmapped DA gains nobody, and nothing errors', () => {
    expect(insert('Cam')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('Shire')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('George')).toEqual({ add: null, addSource: null, remove: null });
  });

  // ★★★ Probe line 3 — THE DISCIPLINE TRAP. Derry is a design MANAGER and holds
  // 3 open discipline='arch' tasks; keying off discipline would co-assign her to
  // her own task. Nothing about this call mentions a discipline, which is the
  // point: the rule has no way to look at one.
  it('★★ a task assigned to a DM gains nobody', () => {
    expect(insert('Derry')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('Brittani')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('Ana')).toEqual({ add: null, addSource: null, remove: null });
  });

  // ★★ Probe lines 4 and 5 — the decision the brief asked for, stated as a
  // test: the rule acts on the LITERAL stored value, BEFORE fix-238's
  // role→person resolution, so a role names nobody and gets nobody. Resolving
  // "Design Associate" would freeze today's permits.da into a row that cannot
  // follow it when the project changes hands.
  it('★★ a role-valued assignee gains nobody — unresolved, deliberately', () => {
    expect(insert('Design Associate')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('Design Manager')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('Schematic Team')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('Architecture')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('Entitlements')).toEqual({ add: null, addSource: null, remove: null });
  });

  it('★ an unassigned task gains nobody', () => {
    expect(insert(null)).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('')).toEqual({ add: null, addSource: null, remove: null });
    expect(insert('   ')).toEqual({ add: null, addSource: null, remove: null });
  });

  // ★★ Probe line 7 — reassignment. The manager follows the ASSIGNEE.
  it('★★ changing the assignee swaps the manager with them', () => {
    expect(
      coAssignEffect({ op: 'update', prevAssignee: 'Nicky', nextAssignee: 'Marc', rows: ROWS }),
    ).toEqual({ add: 'Brittani', addSource: 'dm_of_da', remove: 'Derry' });
  });

  // ★★ Probe line 8 — removing the DA must not strand the DM as the lone
  // co-assignee on a task nobody owns.
  it('★★ clearing the assignee withdraws the manager', () => {
    expect(
      coAssignEffect({ op: 'update', prevAssignee: 'Marc', nextAssignee: null, rows: ROWS }),
    ).toEqual({ add: null, addSource: null, remove: 'Brittani' });
  });

  it('★ moving between two DAs of the SAME manager changes nothing', () => {
    expect(
      coAssignEffect({ op: 'update', prevAssignee: 'Marc', nextAssignee: 'Fisk', rows: ROWS }),
    ).toEqual({ add: 'Brittani', addSource: 'dm_of_da', remove: null });
  });

  it('★ moving to an unmapped DA withdraws the old manager and adds none', () => {
    expect(
      coAssignEffect({ op: 'update', prevAssignee: 'Nicky', nextAssignee: 'Cam', rows: ROWS }),
    ).toEqual({ add: null, addSource: null, remove: 'Derry' });
  });

  // ★★ Probe line 10 — "UPDATE OF assigned_to" fires whenever the column is in
  // the SET list, and bp_upsert_permit_task* always set it. Without the
  // no-change guard, editing a due date would resurrect a manager the user had
  // deliberately removed.
  it('★★ a save that rewrites the same assignee is not a change', () => {
    expect(
      coAssignEffect({ op: 'update', prevAssignee: 'Nicky', nextAssignee: 'Nicky', rows: ROWS }),
    ).toEqual({ add: null, addSource: null, remove: null });
    expect(
      coAssignEffect({ op: 'update', prevAssignee: null, nextAssignee: null, rows: ROWS }),
    ).toEqual({ add: null, addSource: null, remove: null });
  });

  // ★ Ordinary correctness: nobody is ever co-assigned to their own task. It
  // cannot happen through dm_da_groups as it stands (no name is both a dm_name
  // and its own da_name), so the guard is asserted against a mapping that tries.
  it('★ never co-assigns somebody to their own task', () => {
    const selfish: DmDaGroupRow[] = [
      { id: 's', dm_name: 'Nicky', da_name: 'Nicky', dm_order: 1, da_order: 1, updated_at: '' },
    ];
    expect(coAssignEffect({ op: 'insert', nextAssignee: 'Nicky', rows: selfish })).toEqual({
      add: null,
      addSource: null,
      remove: null,
    });
  });

  // ★ The empty mapping table — the state a fresh tenant is in.
  it('★ no mapping at all is a no-op, not an error', () => {
    expect(coAssignEffect({ op: 'insert', nextAssignee: 'Nicky', rows: [] })).toEqual({
      add: null,
      addSource: null,
      remove: null,
    });
  });
});

// ---------------------------------------------------------------------------
// ★★ The gap that must not be silent
// ---------------------------------------------------------------------------

describe('fix-346 §2: unmappedActiveDas — the DAs the rule cannot help', () => {
  it('★★ names exactly the three active DAs with no manager', () => {
    expect(unmappedActiveDas(ACTIVE_DAS, ROWS)).toEqual(['Cam', 'George', 'Shire']);
  });

  it('★ a name differing only in spacing or case is NOT reported as a gap', () => {
    expect(unmappedActiveDas([' nicky '], ROWS)).toEqual([]);
  });

  // ★ A row with a blank dm_name routes nowhere, so the DA on it is still a gap
  // — the same condition bp_dm_for_da applies.
  it('★ a mapping with no manager on it is not a mapping', () => {
    const blank: DmDaGroupRow[] = [
      { id: 'b', dm_name: '  ', da_name: 'Cam', dm_order: 1, da_order: 1, updated_at: '' },
    ];
    expect(unmappedActiveDas(['Cam'], blank)).toEqual(['Cam']);
    expect(dmForDa('Cam', blank)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ★★ NO BACKFILL, and §3's three rows
// ---------------------------------------------------------------------------

describe('fix-346: the migrations say what the brief said', () => {
  const coassign = COASSIGN_SQL;
  const departed = DEPARTED_SQL;

  // ★★ "No existing task gained a co-assignee." The rule is a trigger on rows
  // written FROM NOW ON; the migration that installs it writes no
  // permit_task_assignees rows at all, which is the strongest form of that
  // assertion available without a live database — and the prod probe's line 11
  // confirmed it after the fact (0 dm_of_da rows outside the probe's own).
  it('★★★ the co-assign migration backfills nothing', () => {
    // ★ Strip every dollar-quoted body (the trigger, the lookup, the RPC, the
    // DO block) and what remains is what this migration DOES when it runs.
    const topLevel = coassign
      .replace(/^\s*--.*$/gm, '')
      .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' <body> ');
    expect(topLevel).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(topLevel).not.toMatch(/\bUPDATE\s+public\./i);
    expect(topLevel).not.toMatch(/\bDELETE\s+FROM\b/i);
    // The two INSERTs in the file are both inside function bodies: the
    // trigger's single-row add, and the RPC's rewrite of one task's set.
    expect(coassign.match(/INSERT INTO public\.permit_task_assignees/g) ?? []).toHaveLength(2);
  });

  it('★★ the trigger fires on INSERT and on a CHANGE of assigned_to', () => {
    expect(coassign).toMatch(/AFTER INSERT OR UPDATE OF assigned_to ON public\.permit_tasks/);
    expect(coassign).toMatch(/NEW\.assigned_to IS NOT DISTINCT FROM OLD\.assigned_to/);
  });

  // ★★★ "Do not key the rule off discipline."
  it('★★★ the rule never mentions discipline', () => {
    const body = coassign.replace(/^\s*--.*$/gm, '');
    expect(body).not.toMatch(/discipline/i);
  });

  // ★ §3 — three rows, named explicitly, and nothing else leaves the table.
  it('★★ §3 removes exactly Alex, Chad and Nidhi', () => {
    const statements = departed.replace(/^\s*--.*$/gm, '').trim();
    expect(statements).toMatch(
      /DELETE FROM public\.dm_da_groups\s+WHERE da_name IN \('Alex', 'Chad', 'Nidhi'\);/,
    );
    // One statement, and it is a DELETE narrowed by name.
    expect(statements.split(';').filter((s: string) => s.trim() !== '')).toHaveLength(1);
    for (const keeper of ['Nicky', 'Marc', 'Erick', 'Fisk', 'Ahmadi', 'Trevor', 'Ainsley', 'Francesca', 'Qisheng']) {
      expect(statements).not.toContain(keeper);
    }
  });

  // ★ And the mapping the mirror tests run against is the post-§3 one: nine
  // rows, none of them a departed DA.
  it('★ the nine surviving mappings are the ones the rule routes on', () => {
    expect(ROWS).toHaveLength(9);
    for (const gone of ['Alex', 'Chad', 'Nidhi']) {
      expect(dmForDa(gone, ROWS)).toBeNull();
    }
  });
});
