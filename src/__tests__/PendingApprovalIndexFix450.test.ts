import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// ★★★ fix-450 (P-043) — THE GUARD THAT KEEPS THE BACKFILL SHELF HONEST
// ===========================================================================
//
// Seven files sat in migrations/ carrying the rows six shipped fixes never
// moved, each quoting counts measured on the day it was written — up to nine
// days stale, and one wrong by the whole ticket. Re-measuring them is a
// one-off; keeping them from drifting again is this.
//
// ★★★ THE PRECEDENT: fix-377's header claimed "one yes moves 67 rows".
// Running the file's ACTUAL predicate returned 0 — the 67 came from a looser
// paraphrase that dropped the discriminator. So the rule is: never measure a
// paraphrase, and never let a file's header be the only place its number
// lives. The index is the second place, and this test keeps the two in step.
//
// ===========================================================================
// ★★★ fix-545 — THE THIRD SHELF RULE: ASSERT WHAT YOUR CHANGE **BROKE**
// ===========================================================================
//
// fix-540's rule was *"an anchor needs a hit assertion"* — assert your change
// LANDED. This one is its opposite number, and it cost three real tasks.
//
// ★★★ fix-536 recreated `permit_tasks_auto_event_uniq` with a third excluded
//     event. `bp_create_lifecycle_task`'s `ON CONFLICT … WHERE …` still named
//     two. **`ON CONFLICT` does not name an index, it INFERS one**, and
//     inference needs the statement's predicate to IMPLY the index's — so the
//     two drifted apart while both objects looked perfectly healthy, and
//     nothing complained until somebody wrote: `42P10` → PostgREST 400 →
//     *"Lifecycle tasks created: 0"*.
//
// ★★★ EVERY GUARD IN fix-536 PASSED. It asserted its own index existed and was
//     satisfiable. **The damage was in a different object** — the neighbour,
//     not the target.
//
// ★★★ THE RULE: **a migration that changes an index's columns or predicate
//     must list every `ON CONFLICT` that infers it and re-assert them after
//     applying.** The census that does it for you, engine-decided and writing
//     nothing, is `scripts/sql/on_conflict_census.sql`.
//
// ★ Enforced below: a shelf file that creates or drops a unique index has to
//   show it thought about the neighbours.

const MIGRATIONS = resolve(process.cwd(), 'migrations');
const INDEX = resolve(MIGRATIONS, 'PENDING_APPROVAL_INDEX.md');

/** Every file on the approval shelf: awaiting a yes, or kept after a no. */
function shelfFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter(
      (f) =>
        f.endsWith('_PENDING_APPROVAL.sql') || f.endsWith('_SUPERSEDED.sql'),
    )
    .sort();
}

describe('fix-450: the pending-approval shelf', () => {
  const files = shelfFiles();
  const index = readFileSync(INDEX, 'utf8');

  it('★★ the shelf is not empty (the test would pass vacuously otherwise)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('★★★ every file on the shelf appears in the index', () => {
    // ★ Add a backfill, and this tells you to add a row to the page Bobby
    //   reads — rather than leaving a seventh file nobody knows to look at.
    for (const f of files) {
      expect(index, `${f} is missing from PENDING_APPROVAL_INDEX.md`).toContain(f);
    }
  });

  it('★★★ the index names no file that does not exist', () => {
    // The other direction: a renamed or applied file must leave the table.
    const named = [...index.matchAll(/`(fix_[A-Za-z0-9_]+\.sql)`/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const n of new Set(named)) {
      expect(files, `${n} is in the index but not on disk`).toContain(n);
    }
  });

  it('★★★ NOT ONE of them contains uncommented DML **or DDL**', () => {
    // ★★★ The load-bearing assertion. These files are read, approved and then
    //     applied by hand from Cowork — never by CI, never by a migration
    //     runner that walks the folder. A single uncommented INSERT is the
    //     difference between a document and a loaded gun.
    //
    // ★★★ fix-456 WIDENED THIS, AND IT MATTERED. The original list was
    //     INSERT/UPDATE/DELETE/TRUNCATE, which was the whole vocabulary of the
    //     shelf while every file MOVED rows. fix-456 is the first file here
    //     that DESTROYS things — `DROP TABLE` and `ALTER TABLE … DROP COLUMN`
    //     — and neither word was in the list. The guard would have passed a
    //     fully-armed drop file. DROP and ALTER are in it now.
    //
    // ★★ And these are the least reversible statements on the shelf: a moved
    //    row can be moved back, a dropped table cannot.
    for (const f of files) {
      const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
      const offenders = sql
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) =>
          /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i.test(line),
        );
      expect(
        offenders.map(([n, l]) => `${f}:${n}: ${l.trim()}`),
        `${f} has uncommented DML/DDL`,
      ).toEqual([]);
    }
  });

  it('★★★ fix-456 keeps NO drop statement for the two parking records', () => {
    // ★★★ The two tables that must survive are protected by ABSENCE, not by a
    //     comment: no DROP is written for them at all, commented or otherwise,
    //     so an approving skim that uncomments a block cannot take them with
    //     it. If somebody later "completes" the file by adding them, this
    //     fails — which is the point.
    //
    //     `_parking_site_archive_2026_08_25`  — 182 rows, 181 types, 180 stalls
    //     `_fix22_permits_dropped_cols_snapshot` — 171 stalls, 30 types
    //     Together they are the only record of site parking; projects.parking_*
    //     is 0-non-null on all 202 rows and only 8 projects carry unit parking.
    const sql = readFileSync(
      resolve(MIGRATIONS, 'fix_456_drop_backup_tables_PENDING_APPROVAL.sql'),
      'utf8',
    );
    for (const keep of [
      '_parking_site_archive_2026_08_25',
      '_fix22_permits_dropped_cols_snapshot',
    ]) {
      expect(sql, `${keep} must be discussed in the file`).toContain(keep);
      expect(
        sql,
        `${keep} must have NO drop statement, not even a commented one`,
      ).not.toMatch(new RegExp(`drop\\s+table[^\\n]*${keep}`, 'i'));
    }
    // ★ …while the file does still carry the drops it is for.
    expect(sql).toMatch(/drop table if exists public\._fix415_zone_remap/i);
  });

  it('★★★ fix-545: a file that reshapes a UNIQUE INDEX names its ON CONFLICT neighbours', () => {
    // ★★★ THE RULE THAT COST THREE TASKS. `ON CONFLICT` INFERS an index; change
    //     the index's columns or predicate and every statement that inferred it
    //     silently stops matching. fix-536's own guards all passed — the damage
    //     was in a different object.
    //
    // ★★ So a shelf file touching a unique index must show it considered the
    //    neighbours: name `ON CONFLICT`, or point at the census that finds them
    //    (`scripts/sql/on_conflict_census.sql`). This is deliberately a LOW bar
    //    — it cannot verify the neighbours are right, only that the author knew
    //    they existed. The census verifies; this makes the author look.
    for (const f of files) {
      const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
      const reshapes = /(CREATE|DROP)\s+(UNIQUE\s+)?INDEX/i.test(sql)
        && /UNIQUE/i.test(sql);
      if (!reshapes) continue;
      expect(
        /ON CONFLICT/i.test(sql) || /on_conflict_census/i.test(sql),
        `${f} reshapes a unique index but names no ON CONFLICT that infers it — `
          + 'see fix-545, or run scripts/sql/on_conflict_census.sql and list what it finds',
      ).toBe(true);
    }
  });

  it('★★ every file carries a measurement date', () => {
    // A header that has stopped saying when it was measured is how this
    // started. The date is the thing that goes stale, so the date is what the
    // guard looks for.
    //
    // ★★★ WIDENED BY fix-474, AND THE ORIGINAL WAS TOO NARROW BY ACCIDENT.
    //     This read `/RE-MEASURED 2026-08-30|SUPERSEDED 2026-08-30/` — fix-450's
    //     own sweep date, hard-coded. That is not what the comment above says
    //     the guard is for, and it means **any file added to the shelf after
    //     that sweep fails**, with the only ways to pass being to backdate a
    //     header (a lie) or to delete the guard. fix-474's file was measured
    //     2026-09-01 and hit exactly that.
    //
    // ★ So the assertion is now the one the comment always described: the
    //   header names a date, in a recognised form, whatever that date is. The
    //   two original markers still match — nothing on the shelf changed.
    for (const f of files) {
      const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
      expect(sql, `${f} has no measurement date in its header`).toMatch(
        /(RE-MEASURED|SUPERSEDED|MEASURED ON PROD) \d{4}-\d{2}-\d{2}/,
      );
    }
  });

  it('★★ …and fix-450\'s own seven still carry ITS sweep date', () => {
    // ★ The widening above must not lose what fix-450 actually established:
    //   that it re-measured every file it found on 2026-08-30. That claim is
    //   about those files, so it is asserted about those files.
    for (const f of [
      'fix_368_backfill_PENDING_APPROVAL.sql',
      'fix_377_backfill_SUPERSEDED.sql',
      'fix_379_backfill_SUPERSEDED.sql',
      'fix_379_mapping_rows_PENDING_APPROVAL.sql',
      'fix_381_backfill_PENDING_APPROVAL.sql',
      'fix_384_label_candidates_PENDING_APPROVAL.sql',
      'fix_387_entry_drafts_PENDING_APPROVAL.sql',
    ]) {
      const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
      expect(sql, `${f} lost its fix-450 re-measurement`).toMatch(
        /RE-MEASURED 2026-08-30|SUPERSEDED 2026-08-30/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// §2 · A supersession KEEPS the predicate — it does not delete it
// ---------------------------------------------------------------------------
describe('fix-450: superseded files keep what made them worth reading', () => {
  it('★★★ fix-377 still carries its discriminator', () => {
    // ★ The reasoning outlives the rows: "a name that is never a project lead
    //   cannot have been left behind by a reassignment" is the finding, and it
    //   is expressed as that EXISTS clause. Deleting the file would delete it.
    const sql = readFileSync(
      resolve(MIGRATIONS, 'fix_377_backfill_SUPERSEDED.sql'),
      'utf8',
    );
    expect(sql).toContain('SUPERSEDED 2026-08-30');
    expect(sql).toContain('x.entitlement_lead');
    expect(sql).toContain('UPDATE public.permits p');
    // …and it is still commented out.
    expect(sql).not.toMatch(/^\s*UPDATE\b/m);
  });

  it('★★★ fix-379 still carries all four groups', () => {
    const sql = readFileSync(
      resolve(MIGRATIONS, 'fix_379_backfill_SUPERSEDED.sql'),
      'utf8',
    );
    expect(sql).toContain('SUPERSEDED 2026-08-30');
    for (const g of ['GROUP A1', 'GROUP A2', 'GROUP B', 'GROUP C']) {
      expect(sql, g).toContain(g);
    }
    expect(sql).toContain('public.bp_dm_for_da');
    expect(sql).not.toMatch(/^\s*UPDATE\b/m);
  });

  it('★★ neither superseded file is still called PENDING_APPROVAL', () => {
    // The name is the signal. A file Bobby has nothing to approve in must stop
    // asking him for a decision.
    const names = shelfFiles();
    expect(names).not.toContain('fix_377_backfill_PENDING_APPROVAL.sql');
    expect(names).not.toContain('fix_379_backfill_PENDING_APPROVAL.sql');
  });
});
