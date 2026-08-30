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

  it('★★★ NOT ONE of them contains uncommented DML', () => {
    // ★★★ The load-bearing assertion. These files are read, approved and then
    //     applied by hand from Cowork — never by CI, never by a migration
    //     runner that walks the folder. A single uncommented INSERT is the
    //     difference between a document and a loaded gun.
    for (const f of files) {
      const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
      const offenders = sql
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(line));
      expect(
        offenders.map(([n, l]) => `${f}:${n}: ${l.trim()}`),
        `${f} has uncommented DML`,
      ).toEqual([]);
    }
  });

  it('★★ every file carries its re-measurement date', () => {
    // A header that has stopped saying when it was measured is how this
    // started. The date is the thing that goes stale, so the date is what the
    // guard looks for.
    for (const f of files) {
      const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
      expect(sql, `${f} has no fix-450 re-measurement`).toMatch(
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
