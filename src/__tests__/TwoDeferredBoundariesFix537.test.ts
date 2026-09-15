import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';

// ===========================================================================
// fix-537 (P-240, P-222) — two boundaries that were deliberately deferred
// ===========================================================================
//
// ★★★ BOTH HALVES WERE HELD FOR A STATED REASON, AND THE REASONS EXPIRED AT
//     DIFFERENT SPEEDS. P-240 was held because flipping the view wrong blanks
//     the plan-of-record card on 196 projects; P-222 because `DROP COLUMN` is
//     irreversible and the DEPLOYED build, not the merged branch, had to be
//     the one that stopped writing it. Neither reason was wrong. Both were
//     re-checked against prod on 2026-09-13 before anything was written.
//
// ★★★ CI HAS NO DATABASE, so every server-side claim below is a MIRROR of a
//     rolled-back probe run against prod (the fix-153 pattern): the probe is
//     what establishes the fact, and these assertions keep the staged file
//     from drifting away from what was measured. A number that lives only in
//     a header is a number nobody can check — fix-450's lesson, applied to
//     two files that will sit on the shelf until Cowork reads them.

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

// ★ Source assertions strip comments first — a "must not appear" scan that
//   matches its own explanation is the oldest trap in this suite.
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}

/** Every statement in a shelf file must be commented out. */
function uncommentedStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|DO|BEGIN|COMMIT)\b/i.test(l))
    .map((l) => l.trim());
}

const A = 'migrations/fix_537a_plan_of_record_sets_security_invoker_PENDING_APPROVAL.sql';
const B = 'migrations/fix_537b_drop_draw_schedule_color_override_PENDING_APPROVAL.sql';
const DEAD = 'migrations/fix_521_drop_draw_schedule_color_override_SUPERSEDED.sql';

// ---------------------------------------------------------------------------
// §A — P-240: the view stops reading around its own RLS policy
// ---------------------------------------------------------------------------

describe('fix-537 §A — the plan-of-record view joins the other eleven', () => {
  const sql = read(A);

  it('★★★ it is STAGED, not applied', () => {
    // ⚠️ The brief's first instruction. Cowork applies; the ticket that writes
    //    a migration does not run it.
    expect(sql).toContain('NOT APPLIED');
    expect(uncommentedStatements(sql)).toEqual([]);
    expect(sql).toMatch(/MEASURED ON PROD \d{4}-\d{2}-\d{2}/);
  });

  it('★★★ it flips exactly one view, and names it', () => {
    expect(sql).toContain('ALTER VIEW public.project_plan_of_record_sets SET (security_invoker = true)');
  });

  it('★★★ both reads either side of the flip are recorded, with their numbers', () => {
    // ★★★ THE ASSERTION THE HOLD WAS ABOUT. fix-523 reported this view and did
    //     not flip it because it feeds the plan-of-record card on almost every
    //     project and the logged-out `/s/` page. Rolled-back probe, prod,
    //     2026-09-13 — signed-in as a real tenant member:
    //
    //       invoker OFF  →  415 rows · 196 projects
    //       invoker ON   →  415 rows · 196 projects
    //
    //     Identical. 196 of 220 reproduces fix-529's number exactly.
    expect(sql).toContain('415 rows');
    expect(sql).toContain('196 projects');
  });

  it('★★★ the share path was VERIFIED, not inherited', () => {
    // ★★ §A.2 said to verify rather than assume, and the difference matters:
    //    the reasoning ("the function is SECURITY DEFINER so its owner bypasses
    //    RLS either way") is sound, and a sound argument for an unchecked
    //    conclusion is still an unchecked conclusion. Both halves were read off
    //    `pg_proc` — the function IS SECURITY DEFINER, owned by postgres, and
    //    its body DOES read this view — and then a live token was resolved as
    //    `anon` on both sides of the flip: 1 row, 1 row.
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('bp_resolve_plan_share');
    expect(sql.toLowerCase()).toContain('logged-out');
  });

  it('★★★ the fix is shown to have TEETH — the negative control', () => {
    // ★★★ "Same rows either side" is exactly what a change that does nothing
    //     looks like. The control is an account belonging to NO tenant:
    //
    //       the view, invoker OFF        →  415 rows   ← everything
    //       the view, invoker ON         →  0 rows
    //       project_file_index, directly →  0 rows     ← RLS already works
    //
    //     The third line is the finding: the boundary this restores ALREADY
    //     holds one level down, and the view is the single place it does not.
    expect(sql).toContain('415 rows');
    expect(sql).toContain('0 rows');
    expect(sql).toContain('project_file_index');
  });

  it('★★ it says plainly that the practical risk today is low', () => {
    // ★ §A.4. Blueprint is single-tenant in practice, so nobody is presently
    //   reading a row this hides. **This is the boundary not existing, not the
    //   boundary being crossed** — which is the argument for doing it now,
    //   cheaply, rather than the argument for not bothering.
    expect(sql).toContain('single-tenant');
    expect(sql).toContain('the boundary not existing');
  });

  it('★★★ the OTHER two views without the flag are reported, NOT flipped', () => {
    // ⚠️ The brief called this view "the odd one out". It is not: 11 views set
    //    `security_invoker`, and **three** do not. The advisor's finding has
    //    count 2 — this view and `project_consultant_current` — while
    //    `juris_permit_stats` lacks the flag without being raised.
    //
    // ★★ Both are named in the file so the next reader inherits the measurement,
    //    and neither is touched. A second flip on the strength of this one's
    //    before/after is the same mistake as a second DROP on the strength of
    //    this ticket's scan.
    expect(sql).toContain('project_consultant_current');
    expect(sql).toContain('juris_permit_stats');
    expect(sql).not.toContain('ALTER VIEW public.project_consultant_current');
    expect(sql).not.toContain('ALTER VIEW public.juris_permit_stats');
  });

  it('★★ it carries its own undo', () => {
    // ★ The one real asymmetry between fix-537's two halves: this one is
    //   reversible in a line, which is why it can be a one-liner at all.
    expect(sql).toContain('security_invoker = false');
  });
});

// ---------------------------------------------------------------------------
// §B — P-222: the column nothing uses
// ---------------------------------------------------------------------------

describe('fix-537 §B — the drop, staged with its writer patched first', () => {
  const sql = read(B);

  it('★★★ it is STAGED, not applied', () => {
    expect(sql).toContain('NOT APPLIED');
    expect(uncommentedStatements(sql)).toEqual([]);
    expect(sql).toMatch(/MEASURED ON PROD \d{4}-\d{2}-\d{2}/);
  });

  it('★★★ the writer is patched BEFORE the column goes — the ordering IS the risk', () => {
    // ⚠️ `bp_upsert_draw_schedule_row` WRITES the column. Drop it first and
    //    every draw-schedule save raises `column "color_override" does not
    //    exist`. Run both or neither.
    expect(sql.indexOf('bp_upsert_draw_schedule_row')).toBeLessThan(
      sql.indexOf('ALTER TABLE public.draw_schedule DROP COLUMN'),
    );
    // ★ …and it refuses to proceed if its anchors miss, rather than dropping
    //   the column out from under a function that still names it.
    expect(sql).toContain('still names color_override after patching');
  });

  it('★★★ the anchors tolerate whitespace — this is the defect that made fix-521 unrunnable', () => {
    // ★★★ THE REAL FINDING OF THIS HALF. fix-521's file matched fixed-width
    //     literals: six spaces, one space either side of the `=`. The live
    //     function reads `    color_override  = …` — four spaces, two before
    //     the `=`, because the assignments are column-aligned. **A literal
    //     anchor encodes somebody's indentation as if it were syntax.**
    //
    // ★★ And it never got that far: three of its anchors were written `E"…"`
    //    with DOUBLE quotes, which Postgres parses as an identifier, so the
    //    block died at parse time with `42601`.
    expect(sql).toContain('regexp_replace');
    // ★★★ THE GRAVESTONE TRAP, FIFTEENTH RECORDING — and it caught this very
    //     assertion. The first draft read `expect(sql).not.toContain('E"')`,
    //     which fails against the paragraph ABOVE explaining that fix-521 was
    //     written with `E"…"`. In a file that is comments end to end there is
    //     nothing left to strip, so the assertion has to name the defect
    //     itself: the fixed-width literal anchor is what must be absent.
    expect(sql).not.toContain("color_override = p_data->>'color_override'");
    // ★ All three replacements were executed against prod, rolled back, and
    //   the guard did not fire.
    expect(sql).toContain('rolled-back');
  });

  it('★★★ the 14 values are preserved before anything is destroyed', () => {
    // ★ §B.4. The content is 14 empty strings — there is no colour to lose, and
    //   saying so is the honest version of "preserve the values". What is worth
    //   keeping is WHICH 14 rows carried the marker, so both a snapshot table
    //   and the literal ids are in the file.
    expect(sql).toContain('_fix537_color_override_snapshot');
    expect(sql).toContain('13eded98-7f6f-4bf6-b302-fd397918af9d');
    expect(sql).toContain('ff6be8fd-f6de-4ebd-9fc9-270c0cbe65e9');
    // 14 ids, one per line, in the header block
    const ids = sql.match(/^--\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s/gm);
    expect(ids).toHaveLength(14);
  });

  it('★★★ `status_override` is REPORTED and NOT dropped', () => {
    // ★★★ §B.3 asked a question nobody had answered: does anything read it?
    //     Checked on 2026-09-13 — every function, view and index in the
    //     database returns exactly one object naming it (the writer), and in
    //     `src/` it is the row type, the write list and fixtures. Nothing reads
    //     it.
    //
    // ⚠️⚠️ **And it is still not dropped.** A verification is not a permission.
    //      Two irreversible drops on the strength of one afternoon's scan is
    //      how one clean ticket becomes an incident.
    expect(sql).toContain('DOES NOT RIDE ALONG');
    expect(sql).not.toContain('DROP COLUMN IF EXISTS status_override');
    expect(sql).toContain('a verification is not a permission');
  });

  it('★★★ the DEPLOYED build was confirmed from the deploy, not from the merge', () => {
    // ★★★ THE HOLD, AND HOW IT WAS DISCHARGED. fix-521 merged 2026-09-10
    //     21:36:48Z. `plan_share_links` holds 3 rows created 2026-09-11 by
    //     Bobby and Dave — a table only reachable from the share control that
    //     shipped in fix-523 / PR #461, which merged AFTER #459. Real people
    //     ran post-fix-521 code in the deployed app.
    //
    // ⚠️ And the draw-schedule table itself proves NOTHING, which is the part
    //    worth keeping: its newest write is 15 minutes after the merge and
    //    carries NULL rather than `''`, which looks like proof and is not —
    //    the audit row says `op=INSERT, actor_uid=null, source=null`. No
    //    editor save has happened since the deploy at all.
    expect(sql).toContain('plan_share_links');
    expect(sql).toContain('PR #461');
    expect(sql).toContain('actor_uid=null');
  });

  it('★★★ …and the drop is safe against ANY deployed build anyway', () => {
    // ★★★ THE STRONGER ANSWER, and the one that retires the hold rather than
    //     satisfying it. Rolled-back probe on prod: patch applied, column
    //     dropped, then a save sent the way each client sends it —
    //
    //       today's client (key present, null)  →  saved
    //       a PRE-fix-521 client (key, '')      →  saved
    //
    //     `p_data` is a jsonb blob; once the function stops naming the key, an
    //     extra key is ignored. **The thing that would have made this dangerous
    //     is an explicit select naming the column — PostgREST fails the whole
    //     query with 42703 — and the only read path is `select('*')`.**
    expect(sql).toContain('42703');
    expect(sql).toContain("select('*')");
  });
});

// ---------------------------------------------------------------------------
// §B — the client side
// ---------------------------------------------------------------------------

describe('fix-537 §B — the app stops naming a column it asked to have dropped', () => {
  it('★★★ the writer no longer sends it, and still sends the one that stays', () => {
    const writer = read('src/hooks/useUpdateDsRow.ts');
    expect(code(writer)).not.toContain('color_override');
    expect(code(writer)).toContain('status_override');
    expect(code(writer)).toContain('notes');
  });

  it('★★★ nothing under src/ references the dropped column — comments stripped', () => {
    // ★★★ THE GRAVESTONE TRAP, and this suite would have walked straight into
    //     it: `useUpdateDsRow`'s header still explains the drop by name, and
    //     the staged filename contains it. A raw scan matches both and calls
    //     the tidiest file in the diff a failure. Strip comments, then assert.
    //
    // ★ Two files are exempt and both name the column in order to assert it is
    //   GONE: this suite, and fix-521's — whose own scan now runs on
    //   comment-stripped source for the same reason. An exemption that is not
    //   explained is how a scan quietly stops scanning.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      // ★★ fix-550: `withFileTypes` rather than a `statSync` per entry — one
      //    syscall instead of two for every file under src/. This walk is
      //    I/O-bound and grows with the repo; under full-suite parallelism it
      //    had started tipping past vitest's 5s default. Same traversal, same
      //    assertion — only the syscall count changed.
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const entry = ent.name;
        const full = join(dir, entry);
        if (ent.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/Fix537|Fix521/.test(entry)) {
          const stripped = code(readFileSync(full, 'utf8'));
          if (stripped.includes('color_override')) offenders.push(full);
        }
      }
    };
    walk(resolvePath(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });

  it('★★ `status_override` is deliberately still there, in exactly two places', () => {
    // ★ The asymmetry is the point of the ticket: two equally dead columns,
    //   one dropped because it was asked for and one kept because it was not.
    const writer = code(read('src/hooks/useUpdateDsRow.ts'));
    const types = code(read('src/lib/database.types.ts'));
    expect(writer).toContain('status_override');
    expect(types).toContain('status_override');
    expect(types).not.toContain('color_override');
  });
});

// ---------------------------------------------------------------------------
// The shelf
// ---------------------------------------------------------------------------

describe('fix-537 — both files sit on the approval shelf, under the guard', () => {
  it('★★★ the superseded fix-521 file is kept, renamed and inert', () => {
    // ★★★ IT WAS NEVER ON THE SHELF, WHICH IS WHY NOBODY KNEW IT COULD NOT RUN.
    //     It went into `migrations/` without the `_PENDING_APPROVAL` suffix, so
    //     fix-450's guard — which refuses uncommented DDL and demands a
    //     measurement date — never read it, and the index never listed it. A
    //     staged migration that is not on the shelf gets no guard at all.
    const dead = read(DEAD);
    expect(dead).toContain('SUPERSEDED 2026-09-13');
    expect(dead).toContain('COULD NEVER HAVE RUN');
    // ★★ The parse error itself, kept: three anchors written with double
    //    quotes, which Postgres reads as an identifier.
    expect(dead).toContain('E"');
    expect(uncommentedStatements(dead)).toEqual([]);
    // ★ …and its reasoning survives, which is why it is renamed not deleted.
    expect(dead).toContain('DOES NOT RIDE ALONG');
  });

  it('★★★ every fix-537 file is listed in the index Bobby reads', () => {
    const index = read('migrations/PENDING_APPROVAL_INDEX.md');
    for (const f of [A, B, DEAD]) {
      expect(index, `${f} missing from PENDING_APPROVAL_INDEX.md`).toContain(
        f.replace('migrations/', ''),
      );
    }
    // ★ The shelf's first CANNOT RUN entry, and the index says so out loud.
    expect(index).toContain('CANNOT RUN');
  });

  it('★★ neither new file is still called by fix-521\'s name', () => {
    const names = readdirSync(resolvePath(process.cwd(), 'migrations'));
    expect(names).not.toContain('fix_521_drop_draw_schedule_color_override.sql');
  });
});
