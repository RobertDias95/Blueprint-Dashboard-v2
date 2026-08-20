import { describe, it, expect } from 'vitest';
import { coAssignEffect, dmForDa } from '../lib/dmCoAssign';
import type { DmDaGroupRow } from '../lib/database.types';
import migrationSql from '../../migrations/fix_368_coassign_project_manager.sql?raw';
import backfillSql from '../../migrations/fix_368_backfill_PENDING_APPROVAL.sql?raw';

// ===========================================================================
// fix-368 — some people's manager depends on the PROJECT, not on them
// ===========================================================================
//
// fix-346 keyed co-assignment on dm_da_groups. Cam and Shire have no row there,
// and the obvious reading was that the table was incomplete.
//
// ★★★ IT ISN'T. Bobby: "Their manager group would be dependent upon the permit
// they are working on… they work across multiple different projects… so we
// would just co-assign their tasks to the design manager of that project."
//
// MEASURED on prod 2026-08-20:
//     Cam    14 open tasks   4 projects   ★ Brittani, Jade AND Lindsay
//     Shire   6 open tasks   1 project      Brittani
//
// A single dm_da_groups row for Cam would have mis-filed two thirds of his
// work — which is why the fallback is keyed on the PROJECT and not on him.

/** The real mapping, in the roster's own order. */
const GROUPS: DmDaGroupRow[] = [
  ['Lindsay', 'Francesca'], ['Lindsay', 'Ainsley'], ['Lindsay', 'Trevor'],
  ['Derry', 'Nicky'], ['Derry', 'Qisheng'],
  ['Brittani', 'Marc'], ['Brittani', 'Ahmadi'], ['Brittani', 'Fisk'],
  ['Jade', 'Erick'],
].map(([dm, da], i) => ({
  id: `g${i}`,
  dm_name: dm,
  da_name: da,
  dm_order: i,
  da_order: i,
  updated_at: '2026-01-01T00:00:00Z',
}) as unknown as DmDaGroupRow);

/** ★ The roster half of `bp_is_unmapped_active_da` — who is an active DA. */
const ACTIVE_DAS = new Set(
  ['Cam', 'Shire', 'Ahmadi', 'Ainsley', 'Erick', 'Fisk', 'Francesca', 'Marc',
   'Nicky', 'Qisheng', 'Trevor'].map((n) => n.toLowerCase()),
);
const isActiveDa = (name: string) => ACTIVE_DAS.has(name.trim().toLowerCase());

function effect(
  nextAssignee: string | null,
  projectDm: string | null,
  over: Partial<Parameters<typeof coAssignEffect>[0]> = {},
) {
  return coAssignEffect({
    op: 'insert',
    nextAssignee,
    rows: GROUPS,
    projectDm,
    isActiveDa,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// ★★★ §1 — the rule, and the order IS the rule
// ---------------------------------------------------------------------------

describe("fix-368 §1: Cam's real shape — four projects, three managers", () => {
  it('★★★ every task reaches the manager of ITS project', () => {
    // The four projects Cam's 14 open tasks actually sit on.
    const real: [string, string][] = [
      ['233 31st Ave E', 'Lindsay'],
      ['4017 Corliss Ave N', 'Brittani'],
      ['4137 54th Ave SW', 'Jade'],
      ['554 N 75th St', 'Brittani'],
    ];
    for (const [, manager] of real) {
      const e = effect('Cam', manager);
      expect(e.add).toBe(manager);
      expect(e.addSource).toBe('dm_of_project');
    }
    // ★ THREE DIFFERENT MANAGERS from one person's work — which is exactly
    // what a single dm_da_groups row could not have expressed.
    expect(new Set(real.map(([, m]) => effect('Cam', m).add)).size).toBe(3);
  });

  it('★ Shire reaches Brittani, from her one project', () => {
    const e = effect('Shire', 'Brittani');
    expect(e.add).toBe('Brittani');
    expect(e.addSource).toBe('dm_of_project');
  });
});

describe('fix-368 §1: the EXISTING rule wins', () => {
  it('★★★ Ahmadi still reaches Brittani, even on a project Lindsay runs', () => {
    // Ahmadi, Marc, Fisk and the rest genuinely belong to a manager whatever
    // project they are on. The fallback must never override that.
    const e = effect('Ahmadi', 'Lindsay');
    expect(e.add).toBe('Brittani');
    expect(e.addSource).toBe('dm_of_da');
    // ★ …and the project's manager is not added as well. One manager per task.
    expect(e.add).not.toBe('Lindsay');
  });

  it('★★ the mapping wins for EVERY mapped DA, whoever runs the project', () => {
    for (const [da, dm] of [
      ['Marc', 'Brittani'], ['Nicky', 'Derry'], ['Trevor', 'Lindsay'],
      ['Erick', 'Jade'], ['Qisheng', 'Derry'],
    ]) {
      const e = effect(da, 'Jade'); // every one on a project Jade runs
      expect(e.add, `${da} must still reach ${dm}`).toBe(dm);
      expect(e.addSource).toBe('dm_of_da');
    }
  });

  it('★ dmForDa is untouched — fix-346s lookup still answers the same', () => {
    expect(dmForDa('Ahmadi', GROUPS)).toBe('Brittani');
    expect(dmForDa('Cam', GROUPS)).toBeNull();
  });
});

describe('fix-368 §1: the ROLE GATE, and the 127 it prevents', () => {
  it('★★★ an unmapped NON-associate gets nothing at all', () => {
    // Applied to every UNMAPPED assignee rather than to unmapped DESIGN
    // ASSOCIATES, this rule would have co-assigned a design manager to 127
    // more open tasks. Every one of these is a real assignee on prod.
    for (const who of [
      'Entitlements',      // a role token, 48 open tasks
      'Design Manager',    // a role token, 6
      'Schematic Team',    // a role token, 1
      'Miles',             // an entitlement lead, 40
      'Briana',            // an entitlement lead, 22
      'Bobby',             // an entitlement lead, 7
      'Ana',               // schematic, 1
    ]) {
      const e = effect(who, 'Brittani');
      expect(e.add, `${who} must not gain a design manager`).toBeNull();
      expect(e.addSource).toBeNull();
    }
  });

  it('★★ …including a DESIGN MANAGER on somebody else\'s project', () => {
    // Derry holds 2 open tasks on projects other people run. Without the role
    // gate she would become a co-assignee reporting to another DM.
    const e = effect('Derry', 'Jade');
    expect(e.add).toBeNull();
  });

  it('★★ a manager is NEVER her own co-assignee', () => {
    // fix-346 rule 4, with a new way to trip it: a DM working on her own
    // project. Asserted through BOTH paths.
    expect(effect('Jade', 'Jade').add).toBeNull();
    // …and case-insensitively, because assignees are free text typed by people.
    expect(effect('jade', 'Jade').add).toBeNull();
  });

  it('★ an unset or blank assignee is nobody, and does not error', () => {
    for (const v of [null, '', '   ']) {
      expect(effect(v, 'Brittani').add).toBeNull();
    }
  });
});

describe('fix-368 §3: when there is nobody', () => {
  it('★ a task on a project with no design manager co-assigns nobody', () => {
    // 20 of 161 active projects. That is correct — there genuinely is no one
    // to tell — and it is a real answer rather than a failure.
    for (const dm of [null, '', '  ']) {
      const e = effect('Cam', dm);
      expect(e.add).toBeNull();
      expect(e.addSource).toBeNull();
    }
  });

  it('★★ …and the silence is a NUMBER somebody can see', () => {
    // fix-352's reasoning: the silence is the thing that hides. The report
    // returns zero rows today, and exists so that stays visible if it changes.
    expect(migrationSql).toMatch(/CREATE OR REPLACE FUNCTION public\.bp_coassign_gap_report/);
    expect(migrationSql).toMatch(/design_manager, ''\)\), ''\) IS NULL/);
    expect(migrationSql).toMatch(/bp_is_unmapped_active_da\(t\.assigned_to/);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §2 — the project's manager CHANGES
// ---------------------------------------------------------------------------

describe('fix-368 §2: a stale project-derived co-assignee cannot survive', () => {
  it('★★★ the answer moves when the PROJECT moves, with the task untouched', () => {
    // ★★ This is the half fix-346 never had to handle: its answer depended
    // only on the task, so one trigger on permit_tasks.assigned_to was the
    // whole story. This one depends on a field on ANOTHER TABLE.
    const before = effect('Cam', 'Jade');
    const after = effect('Cam', 'Lindsay');
    expect(before.add).toBe('Jade');
    expect(after.add).toBe('Lindsay');
    // Same task, same assignee — only the project's manager changed.
  });

  it('★★★ …and a SECOND TRIGGER exists to notice, on the other table', () => {
    // Nothing on permit_tasks fires when projects.design_manager is edited, so
    // the rule needs its own trigger there or every project-derived row on the
    // project is quietly wrong.
    expect(migrationSql).toMatch(
      /CREATE TRIGGER projects_dm_coassign[\s\S]{0,120}AFTER UPDATE OF design_manager ON public\.projects/,
    );
    // ★ It WITHDRAWS the stale row — the failure this section exists to
    // prevent — and only the project-derived kind.
    expect(migrationSql).toMatch(/a\.source = 'dm_of_project'\s+AND a\.assignee IS DISTINCT FROM v_dm/);
  });

  it('★★ ONLY the project-derived rows move — manual is never touched', () => {
    // A `manual` co-assignee somebody added by hand is not touched by a
    // project reassignment, ever. Nor is a dm_of_da row, whose manager does
    // not depend on the project at all.
    const del = migrationSql.slice(
      migrationSql.indexOf('DELETE FROM public.permit_task_assignees a'),
    );
    expect(del.slice(0, 400)).toContain("a.source = 'dm_of_project'");
    expect(del.slice(0, 400)).not.toContain("'manual'");
    // ★ And the task trigger's withdrawal names the two auto kinds explicitly
    // rather than deleting by absence.
    expect(migrationSql).toMatch(/source IN \('dm_of_da', 'dm_of_project'\)/);
  });

  it('★ the project trigger only adds to LIVE work', () => {
    // Adding a manager to a task that closed months ago is the noise fix-355
    // spent a ticket removing. Withdrawing a stale one is unconditional,
    // because a wrong name is wrong whatever the status.
    const ins = migrationSql.slice(
      migrationSql.indexOf('4b. Add the new one'),
    );
    expect(ins.slice(0, 700)).toContain("completion_status NOT IN ('Resolved', 'Cancelled')");
  });
});

// ---------------------------------------------------------------------------
// ★★ §4 — do not disturb what is there
// ---------------------------------------------------------------------------

describe('fix-368 §4: the existing rows survive', () => {
  it('★★★ the new source value is distinguishable from BOTH existing ones', () => {
    expect(migrationSql).toMatch(
      /CHECK \(source IN \('manual', 'dm_of_da', 'dm_of_project'\)\)/,
    );
    // ★ Not a reuse of dm_of_da: the project-derived row is a different FACT,
    // and somebody will eventually want to keep one and drop the other.
    expect(effect('Cam', 'Jade').addSource).toBe('dm_of_project');
    expect(effect('Ahmadi', 'Jade').addSource).toBe('dm_of_da');
    expect(effect('Cam', 'Jade').addSource).not.toBe(
      effect('Ahmadi', 'Jade').addSource,
    );
  });

  it('★★ nothing in the migration rewrites an existing assignee row', () => {
    // 48 dm_of_da and 268 manual rows exist. A rule that quietly rewrote
    // hand-made assignments would be far worse than the gap it fixes.
    expect(migrationSql).not.toMatch(/UPDATE public\.permit_task_assignees/);
    // The only DELETEs are the two withdrawals, both scoped to an auto source.
    const deletes = migrationSql.match(/DELETE FROM public\.permit_task_assignees/g) ?? [];
    expect(deletes).toHaveLength(2);
    for (const m of migrationSql.matchAll(/DELETE FROM public\.permit_task_assignees[\s\S]{0,500}?;/g)) {
      expect(m[0]).toMatch(/source (IN \('dm_of_da', 'dm_of_project'\)|= 'dm_of_project')/);
    }
  });

  it('★ an existing row of any source is left as it is', () => {
    // ON CONFLICT DO NOTHING — a hand-made co-assignment naming the same
    // manager keeps its `manual` marker rather than being relabelled.
    const inserts = migrationSql.match(/INSERT INTO public\.permit_task_assignees[\s\S]{0,900}?;/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const ins of inserts) {
      expect(ins).toMatch(/ON CONFLICT \(task_id, assignee\) DO NOTHING/);
    }
  });
});

// ---------------------------------------------------------------------------
// ★★★ §5 — the hard stop
// ---------------------------------------------------------------------------

describe('fix-368 §5: the backfill is written and NOT applied', () => {
  it('★★★ every statement in the backfill file is commented out', () => {
    // The trigger only fires on future writes, so Cam's 14 and Shire's 6 need
    // a backfill — and a backfill is a data change. Bobby approves the ROWS.
    const live = backfillSql
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
  });

  it('★★ it names the rows it would write, and the managers they reach', () => {
    for (const s of [
      'Cam', 'Shire', 'Lindsay', 'Brittani', 'Jade',
      '233 31st Ave E', '4017 Corliss Ave N', '4137 54th Ave SW',
      '554 N 75th St', '10431 SE 19th St',
    ]) {
      expect(backfillSql).toContain(s);
    }
    expect(backfillSql).toMatch(/NOT APPLIED/);
  });

  it('★ and it would use the SAME rule the triggers use', () => {
    // A backfill with its own copy of the predicate is a backfill that can
    // disagree with what happens from then on.
    expect(backfillSql).toContain('bp_is_unmapped_active_da');
    expect(backfillSql).toContain("'dm_of_project'");
    expect(backfillSql).toMatch(/ON CONFLICT \(task_id, assignee\) DO NOTHING/);
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-368: prior contracts survive', () => {
  it("★★ fix-346's identical-value guard is still there", () => {
    // "UPDATE OF assigned_to" fires whenever the column is in the SET list,
    // even unchanged — so editing a due date must not resurrect a manager the
    // user deliberately removed.
    const e = coAssignEffect({
      op: 'update',
      prevAssignee: 'Cam',
      nextAssignee: 'Cam',
      rows: GROUPS,
      projectDm: 'Jade',
      isActiveDa,
    });
    expect(e).toEqual({ add: null, addSource: null, remove: null });
    expect(migrationSql).toMatch(/NEW\.assigned_to IS NOT DISTINCT FROM OLD\.assigned_to/);
  });

  it('★★ the manager still FOLLOWS the assignee across the two rules', () => {
    // Cam → Ahmadi on a project Jade runs: the project-derived Jade goes, the
    // person-derived Brittani arrives.
    const e = coAssignEffect({
      op: 'update',
      prevAssignee: 'Cam',
      nextAssignee: 'Ahmadi',
      rows: GROUPS,
      projectDm: 'Jade',
      isActiveDa,
    });
    expect(e.remove).toBe('Jade');
    expect(e.add).toBe('Brittani');
    expect(e.addSource).toBe('dm_of_da');
  });

  it('★ clearing the assignee takes the manager with it', () => {
    const e = coAssignEffect({
      op: 'update',
      prevAssignee: 'Cam',
      nextAssignee: null,
      rows: GROUPS,
      projectDm: 'Jade',
      isActiveDa,
    });
    expect(e.remove).toBe('Jade');
    expect(e.add).toBeNull();
  });

  it('★ every function is SECURITY DEFINER with a pinned search_path', () => {
    // Six: the two predicates, the one rule, the two triggers, and the gap
    // report — each named here so adding a seventh is a deliberate act.
    const fns = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? [];
    expect(fns.map((f) => f.split('.')[1])).toEqual([
      'bp_is_unmapped_active_da',
      'bp_project_dm_for_permit',
      'bp_coassign_for_task',
      'bp_trg_task_coassign_dm',
      'bp_trg_project_dm_coassign',
      'bp_coassign_gap_report',
    ]);
    expect(migrationSql).not.toMatch(/GRANT EXECUTE[^;]*anon/);
    expect((migrationSql.match(/SECURITY DEFINER/g) ?? []).length).toBe(fns.length);
    expect((migrationSql.match(/SET search_path TO 'public'/g) ?? []).length).toBe(
      fns.length,
    );
    // ★ anon is revoked from every one of them.
    expect((migrationSql.match(/FROM PUBLIC, anon/g) ?? []).length).toBe(fns.length);
  });
});
