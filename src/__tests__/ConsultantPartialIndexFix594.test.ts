import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// ★★★ fix-594 — A REMOVED CONSULTANT FREES ITS SLOT
// ===========================================================================
//
// **Bobby's ruling, 2026-09-28 (P-291, the remainder after fix-592):**
// `project_consultants_one_per_discipline` becomes a **partial** unique index —
// `(project_id, discipline) WHERE removed_at IS NULL`. "One LIVE consultant per
// discipline" is unchanged; a removed row no longer holds the slot.
//
// ★ Not a revive RPC, not a hand-clear of the two rows. The rule was always about
//   live consultants; the index just did not say so.
//
// ---------------------------------------------------------------------------
// VERIFIED READ-ONLY ON PROD, 2026-09-29, before the migration was written
// ---------------------------------------------------------------------------
//
//   index today        (project_id, discipline), no predicate — as fix-592 said
//   rows                                    198
//   rows with removed_at                      2   Civil + Geotech,
//                                                 3020 E Yesler Way, both 09-23
//   slots held only by a removed row          2   ← what this frees
//   live duplicates under the NEW predicate   0   ← ★ what makes it safe to run
//
// No live DB in CI, so this file asserts the migration's TEXT — the fix-153 /
// fix-520 / fix-590 pattern — and the app-side retirement is asserted by
// `ConsultantDuplicateDisciplineFix592`.

const FILE = resolve(process.cwd(), 'migrations/fix_594_consultant_partial_index.sql');
const SQL = readFileSync(FILE, 'utf8');
/** ★ Comments stripped before asserting behaviour: this file is mostly prose and
 *  a `--` line quoting the old DDL would satisfy an assertion about the new one.
 *  The comment-stripping trap, recorded eight times in this Brain. */
const CODE = SQL.replace(/^\s*--.*$/gm, '');

describe('fix-594 — the migration', () => {
  it('★★★ exists, and is staged rather than applied', () => {
    expect(existsSync(FILE)).toBe(true);
    // ★ Said where somebody opening the file reads it first, not only in a PR
    //   nobody re-reads. fix-520's convention, which fix-590 also follows.
    expect(SQL).toContain('NOT APPLIED');
    expect(SQL.indexOf('NOT APPLIED')).toBeLessThan(1200);
  });

  it('★★★ drops the CONSTRAINT and creates the PARTIAL index', () => {
    // ═════════════════════════════════════════════════════════════════════
    // ★★★ THE BRIEF'S EXACT DDL CANNOT RUN, AND A PROBE IS HOW I KNOW.
    // ═════════════════════════════════════════════════════════════════════
    //
    // §2 step 1 specifies `DROP INDEX IF EXISTS …`. On prod that raises:
    //
    //   ERROR 2BP01: cannot drop index project_consultants_one_per_discipline
    //   because constraint project_consultants_one_per_discipline … requires it
    //
    // `pg_constraint` says `contype='u'`, `UNIQUE (project_id, discipline)` — it
    // is a CONSTRAINT, and `pg_indexes` lists constraint-backed indexes too,
    // which is why fix-592 and this brief both read it as a plain index.
    //
    // ★★★ AND A UNIQUE CONSTRAINT CANNOT BE PARTIAL — Postgres has no
    //     `UNIQUE (…) WHERE …` syntax. So the ruling is only expressible as a
    //     partial unique INDEX, and the constraint must go for the index to take
    //     its name.
    expect(CODE).toMatch(
      /ALTER TABLE public\.project_consultants\s+DROP CONSTRAINT IF EXISTS project_consultants_one_per_discipline/,
    );
    // ★ Kept as well, so a re-run after it has become an index still works.
    expect(CODE).toContain('DROP INDEX IF EXISTS public.project_consultants_one_per_discipline');
    expect(CODE).toMatch(
      /CREATE UNIQUE INDEX project_consultants_one_per_discipline\s+ON public\.project_consultants \(project_id, discipline\)\s+WHERE removed_at IS NULL/,
    );
  });

  it('★★★ keeps the SAME index name, which is load-bearing', () => {
    // `addConsultantMessage` matches on this constraint name to turn a raw
    // Postgres error into a sentence. Renaming the index would silently return
    // the genuine-race path to showing `duplicate key value violates unique
    // constraint …` at somebody.
    const created = CODE.match(/CREATE UNIQUE INDEX (\w+)/)?.[1];
    const dropped = CODE.match(/DROP CONSTRAINT IF EXISTS (\w+)/)?.[1];
    expect(created).toBe('project_consultants_one_per_discipline');
    expect(dropped).toBe(created);
    // ★★★ VERIFIED ON PROD, rolled back: a unique-INDEX violation reports as
    //     `duplicate key value violates unique constraint "<index name>"` —
    //     the SAME text and the SAME name a constraint produces. That is what
    //     keeps `addConsultantMessage` working after the object changes kind.
  });

  it('★★★ the predicate is exactly the ruling — no wider, no narrower', () => {
    // ★★ A predicate of `WHERE removed_at IS NULL` preserves "one LIVE consultant
    //    per discipline" exactly. Anything wider (e.g. dropping the uniqueness,
    //    or keying on more columns) would be a different ruling than the one
    //    Bobby gave, and this is where that would show.
    const create = CODE.match(/CREATE UNIQUE INDEX[\s\S]*?;/)?.[0] ?? '';
    expect(create).toContain('UNIQUE');
    expect(create).toContain('(project_id, discipline)');
    expect(create).toContain('WHERE removed_at IS NULL');
    // Exactly one WHERE, and nothing ORed onto it.
    expect((create.match(/WHERE/g) ?? []).length).toBe(1);
    expect(create).not.toMatch(/\bOR\b/i);
  });

  it('★★ it is idempotent on re-run', () => {
    // `DROP INDEX IF EXISTS` then `CREATE` — running the file again after it has
    // landed drops the partial index and rebuilds the identical one.
    expect(CODE).toContain('DROP INDEX IF EXISTS');
    expect(CODE).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });

  it('★★ wrapped in a transaction, so a failed CREATE leaves the old index standing', () => {
    // ★★★ THIS IS WHY THE TRANSACTION MATTERS AND NOT JUST TIDINESS. The DROP
    //     comes first. If any (project, discipline) had two LIVE rows the CREATE
    //     would fail — and without the transaction the table would be left with
    //     NO uniqueness at all. Measured 0 live duplicates on 2026-09-29; the
    //     file says to re-check before applying.
    expect(CODE.indexOf('BEGIN;')).toBeLessThan(CODE.indexOf('DROP INDEX'));
    expect(CODE.indexOf('COMMIT;')).toBeGreaterThan(CODE.indexOf('CREATE UNIQUE INDEX'));
    expect(SQL).toMatch(/live duplicates under the NEW predicate\s+0/);
  });

  it('★★ states the rule in words, on the index itself', () => {
    expect(CODE).toContain('COMMENT ON INDEX public.project_consultants_one_per_discipline');
    expect(CODE).toMatch(/one LIVE consultant per/i);
  });

  it('★★★ it touches NOTHING else — no data change, no RPC, no view, no policy', () => {
    // §4: remove stays a soft delete (`bp_remove_project_consultant` untouched),
    // `project_consultant_current` unchanged, and the two removed rows are left
    // exactly as they are — after the migration they simply stop mattering.
    // ★ STATEMENTS, not bare words. The first version asserted `/\bDELETE\b/`
    //   and failed on the phrase "soft delete" inside the index COMMENT — which
    //   is code, so stripping `--` lines does not reach it. A word-level ban on
    //   SQL keywords cannot survive prose that is part of the SQL.
    expect(CODE).not.toMatch(/^\s*UPDATE\s+/im);
    expect(CODE).not.toMatch(/^\s*DELETE\s+FROM\b/im);
    expect(CODE).not.toMatch(/^\s*INSERT\s+INTO\b/im);
    // ★★ AND THE SAME LESSON ONE LINE DOWN: these assert that the file does not
    //    MODIFY those objects, not that it never NAMES them. The index COMMENT
    //    names `bp_remove_project_consultant` precisely to record that remove
    //    stays a soft delete — banning the mention would forbid the comment that
    //    documents the constraint.
    expect(CODE).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(CODE).not.toMatch(/DROP\s+FUNCTION/i);
    expect(CODE).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i);
    expect(CODE).not.toMatch(/DROP\s+VIEW/i);
    expect(CODE).not.toMatch(/CREATE\s+POLICY|ALTER\s+POLICY|DROP\s+POLICY/i);
    // ★ ONE `ALTER TABLE`, and only to drop the constraint being replaced —
    //   asserted narrowly rather than banned, because the ticket cannot be done
    //   without it. Anything else on that table would show here.
    const alters = CODE.match(/ALTER TABLE[\s\S]*?;/gi) ?? [];
    expect(alters).toHaveLength(1);
    expect(alters[0]).toMatch(/DROP CONSTRAINT IF EXISTS project_consultants_one_per_discipline/);
    expect(alters[0]).not.toMatch(/ADD|SET|RENAME|OWNER/i);
    // ★ The only two DROPs are the constraint and the index it replaces.
    expect((CODE.match(/DROP\s+\w+/gi) ?? []).sort()).toEqual(['DROP CONSTRAINT', 'DROP INDEX']);
  });
});

describe('fix-594 §3 — the workaround is retired, not left dead', () => {
  const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  /** ★ Comments stripped, for the same reason the SQL is: this file's own notes
   *  QUOTE the retired copy to explain why it went, and a bare `toContain` on the
   *  raw text reads that quotation as the copy still shipping. Caught by this
   *  assertion failing on my own comment. */
  const code = (p: string) =>
    src(p)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('★★★ `useBlockedConsultantDisciplines` is DELETED, not left returning []', () => {
    // Once the index is partial, "blocked" is the empty set by construction. A
    // hook that can only ever return nothing is a thing the next reader has to
    // disprove before they can trust the screen.
    expect(existsSync(resolve(process.cwd(), 'src/hooks/useBlockedConsultantDisciplines.ts')))
      .toBe(false);
    const all = readdirSync(resolve(process.cwd(), 'src/hooks'));
    expect(all).not.toContain('useBlockedConsultantDisciplines.ts');
  });

  it('★★★ nothing references it, the query key, or the note', () => {
    for (const p of [
      'src/components/ProjectDetail/ConsultantBand.tsx',
      'src/lib/queryKeys.ts',
    ]) {
      const s = src(p);
      expect(s, `${p} still mentions the hook`).not.toContain('useBlockedConsultantDisciplines');
      expect(s, `${p} still mentions the key`).not.toContain('projectConsultantsBlocked');
      expect(s, `${p} still renders the note`).not.toContain('pd-consultant-blocked-note');
    }
  });

  it('★★ the picker is back to fix-474 one rule', () => {
    const band = code('src/components/ProjectDetail/ConsultantBand.tsx');
    // One exclusion — the live `taken` set — and no second filter beside it.
    expect(band).toMatch(/const taken = new Set\(/);
    expect(band).not.toMatch(/blockedSet/);
    // ★ No `blocked` identifier survives in code. (The word still appears in the
    //   comment explaining why it went, which is why this reads stripped source.)
    expect(band).not.toMatch(/\bblocked\b/);
  });

  it('★★ the exhausted message is one sentence again', () => {
    const band = code('src/components/ProjectDetail/ConsultantBand.tsx');
    expect(band).toContain('Every discipline in the firm directory is already on this project.');
    // ★★★ ASSERTED AGAINST STRIPPED SOURCE, and the first version of this test
    //     was not — it failed on my own comment, which QUOTES the retired copy to
    //     explain why it went. A `toContain` over raw text cannot tell a shipped
    //     string from a quoted one. The comment-stripping trap, again.
    expect(band).not.toContain('held by a removed record');
  });

  it('★★★ `addConsultantMessage` SURVIVES — it is the genuine race now', () => {
    // §3: keep it, reword it. It is the only thing standing between a person and
    // a raw `duplicate key value violates unique constraint` toast when two
    // people add the same live discipline at once.
    const hook = src('src/hooks/useProjectConsultants.ts');
    expect(hook).toContain('export function addConsultantMessage');
    expect(hook).toContain("const ONE_PER_DISCIPLINE = 'project_consultants_one_per_discipline'");
  });

  it('★ and `bp_remove_project_consultant` is untouched — remove stays a soft delete', () => {
    const hook = src('src/hooks/useProjectConsultants.ts');
    expect(hook).toContain('bp_remove_project_consultant');
    // fix-514 §D's soft delete: nothing in this ticket hard-deletes a consultant.
    expect(hook).not.toMatch(/\.delete\(\)/);
  });
});
