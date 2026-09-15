import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ===========================================================================
// fix-547 (P-253) — the statements that cannot run
// ===========================================================================
//
// fix-545's census found them; this closes them. **No column is dropped or
// renamed, and `replace_permit_cycle_reviewers` is not touched** — it is the
// writer that works.
//
// ★★★ THE FINDING THAT CHANGED THE TICKET: the census UNDER-REPORTS column
//     errors. `plpgsql_check` stops at the first bad column in a statement, so
//     `bp_insert_permit` reported ONE (`go_date`) — and comparing its whole
//     INSERT list against `permits` found **FIFTEEN**, every one a
//     project-level fact fix-22 moved off permits. It is not a function with a
//     dead reference; **it is a pre-fix-22 fossil.**
//
// ★★★ THE CHOSEN STATE, proved on prod 2026-09-14 and rolled back:
//
//     drop  bp_upsert_permit_cycle_reviewer   the 42P10, no caller
//     drop  bp_insert_permit                  15 dead columns, no caller
//     drop  migrate_to_relational             one-shot, cannot complete
//     drop  migrate_auxiliary                 one-shot, cannot complete
//     fix   bp_replace_task_templates         exactly one dead column
//
//     census after → 42P10 **0** · 42703 **0** · 42P01 17 (expected) · 212 fns

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIGRATION = 'migrations/fix_547_statements_that_cannot_run_PENDING_APPROVAL.sql';

// ---------------------------------------------------------------------------
// §A — the ruling
// ---------------------------------------------------------------------------

describe('fix-547 §A — the index is right, the statement was the leftover', () => {
  const sql = read(MIGRATION);

  it('★★★ it rules for the INDEX, with fix-44 and the live writer as evidence', () => {
    // ★★★ fix-44 moved the model from per-NAME to per-discipline-SLOT
    //     deliberately, and `replace_permit_cycle_reviewers` — the writer that
    //     works — wrote rows at 2026-09-14 16:39Z. The index is that decision;
    //     the statement is what was left behind.
    expect(sql).toContain('The index is correct and the statement is the leftover');
    expect(sql).toContain('fix-44');
    expect(sql).toContain('replace_permit_cycle_reviewers');
  });

  it('★★★ the caller census is PROOF, not a grep', () => {
    // ★★★ A grep says "I could not find a caller". This says something
    //     stronger: the function raises 42P10 on EVERY call while its table
    //     took rows today — so a caller would have been failing continuously.
    //     There is no caller.
    expect(sql).toContain('A caller would have been failing');
    expect(sql).toContain('There is no caller');
  });

  it('★★ §A.2\'s partial-index trap is named and sidestepped, not walked into', () => {
    // ⚠️ A rewritten statement would have needed `WHERE discipline IS NOT NULL`
    //    to infer the partial index — exactly P-251. It does not arise, because
    //    the statement is dropped rather than rewritten.
    expect(sql).toContain('WHERE discipline IS NOT NULL');
    expect(sql).toContain('It does not arise');
  });

  it('★★★ …and it is DROPPED, not repaired', () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.bp_upsert_permit_cycle_reviewer/);
    expect(sql).toContain('third tested-but-');
  });
});

// ---------------------------------------------------------------------------
// §B — the classification and the one repair
// ---------------------------------------------------------------------------

describe('fix-547 §B — five functions, four dropped and one repaired', () => {
  const sql = read(MIGRATION);

  it('★★★ every one of the five is classified in the file', () => {
    for (const fn of [
      'bp_upsert_permit_cycle_reviewer',
      'bp_insert_permit',
      'bp_replace_task_templates',
      'migrate_to_relational',
      'migrate_auxiliary',
    ]) {
      expect(sql, fn).toContain(fn);
    }
    // ★ and the distinction §B.1 asked for: permissions are not callers.
    expect(sql).toContain('a fact about');
  });

  it('★★★ bp_insert_permit is dropped BECAUSE it is a fossil, with the numbers', () => {
    // ★★★ 15 dead columns, unrunnable since fix-22, and **187 permits created
    //     in the last 30 days** while it could not run. fix-498 flagged it as
    //     scraper-reachable, which is why it got a second look — and the
    //     scraper demonstrably does not call it either.
    expect(sql).toContain('FIFTEEN');
    expect(sql).toContain('187 permits were created in the last 30 days');
    expect(sql).toContain('pre-fix-22 fossil');
  });

  it('★★★ §B.2: permits.go_date was NOT a join that lost its table', () => {
    // ★ Checked rather than assumed: a plain positional INSERT of a payload
    //   value into a column fix-22 removed. `projects.go_date` exists and is
    //   the date the team uses, so nothing is lost.
    expect(sql).toContain('not a join that lost its');
    expect(sql).toContain('projects.go_date');
  });

  it('★★★ §B.4: permits.stage became stage_override and the derived stage', () => {
    // ★★★ And fix-498 ALREADY patched `bp_insert_permit` for it — its live list
    //     reads `stage_override, status,`. The only surviving `permits.stage`
    //     reference was in a one-shot, so nothing here needs to move: the move
    //     already happened and this removes the last fossil.
    expect(sql).toContain('stage_override');
    expect(sql).toContain('derived');
    expect(sql).toContain('that move already');
  });

  it('★★★ §B.3: the one-shots cannot COMPLETE — and can still half-run', () => {
    // ⚠️ "Cannot run" is too kind: each raises 42703 part-way, so a caller gets
    //    a partial import and then an error. That is the argument for dropping
    //    rather than leaving them.
    expect(sql).toContain('cannot complete');
    expect(sql).toContain('partial import');
  });

  it('★★★ the repair moves the column AND its value — one edit, not two', () => {
    // ★★★ fix-498's lesson: a column list and its VALUES list are ONE edit.
    //     Patch the list and not the values and every column after it shifts by
    //     one. The guard refuses unless both halves moved.
    // ★★ Matched within ONE line: the migration wraps this sentence, and an
    //    assertion that spans a newline breaks the moment the prose reflows.
    expect(sql).toContain('column after it would shift by one');
    expect(sql).toContain("position('assignedTo' IN v_def) > 0");
    // ★ fix-540's rule too: read the live definition back after EXECUTE.
    expect(sql).toContain('the LIVE definition still names default_assignee');
    expect(sql.indexOf('EXECUTE v_def;')).toBeLessThan(
      sql.indexOf('the LIVE definition still names default_assignee'),
    );
  });

  it('★★★ …and what the repair COSTS is said out loud, not buried', () => {
    // ★★★ It makes the function runnable and silently ignores the payload's
    //     `assignedTo`. Mapping that to `default_team` is NOT done: a person's
    //     name is not a team token, and inventing that mapping is the class
    //     fix-535 spent a ticket avoiding.
    expect(sql).toContain('silently ignores that payload key');
    expect(sql).toContain('fix-535');
  });
});

// ---------------------------------------------------------------------------
// The census is the acceptance test
// ---------------------------------------------------------------------------

describe('fix-547 — the chosen state comes back clean', () => {
  const sql = read(MIGRATION);

  it('★★★ it is STAGED, not applied, and drops no column', () => {
    expect(sql).toContain('NOT APPLIED');
    expect(sql).toMatch(/MEASURED ON PROD \d{4}-\d{2}-\d{2}/);
    const live = sql
      .split(/\r?\n/)
      .filter((l) =>
        /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DO|BEGIN|COMMIT)\b/i.test(l),
      );
    expect(live).toEqual([]);
    // ⚠️ the Do-NOT list: no column dropped or renamed, and the good writer
    //    is untouched.
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/ALTER TABLE[^\n]*RENAME/i);
    expect(sql).not.toMatch(/(CREATE OR REPLACE|DROP) FUNCTION[^\n]*replace_permit_cycle_reviewers/i);
  });

  it('★★★ the acceptance test is the census output, with its numbers', () => {
    // ★ §A.4: the chosen state must make the census come back clean. It does —
    //   proved in exactly that form on prod, rolled back.
    expect(sql).toContain('on_conflict_census.sql');
    expect(sql).toContain('42P10 ......................................... 0');
    expect(sql).toContain('42703 ......................................... 0');
    expect(sql).toContain('212');
  });

  it('★★★ the census UNDER-REPORTS, and the file says so', () => {
    // ★★★ The lesson that changed this ticket: one error per statement, so a
    //     42703 count is a floor. Audit the whole column list.
    expect(sql).toContain('a floor, not a total');
  });
});

// ---------------------------------------------------------------------------
// §C — the tripwire, and where the rule lives
// ---------------------------------------------------------------------------

describe('fix-547 §C — the census runs on a rule, not on memory', () => {
  it('★★★ when it must run is written beside the other shelf rules', () => {
    const guard = read('src/__tests__/PendingApprovalIndexFix450.test.ts');
    expect(guard).toContain('WHEN THE CENSUS RUNS');
    expect(guard).toContain('DROPS or RENAMES a column');
    expect(guard).toContain('REDEFINES a unique index');
    // ★ and its output is the acceptance test, not a report to skim
    expect(guard).toContain('must both be **0**');
  });

  it('★★★ no NEW repo SQL names one of the dead columns', () => {
    // ★★★ The cheap repo-side tripwire. The AUTHORITY is the census, which asks
    //     the live database — this only catches a dead column arriving in
    //     committed SQL, which is where the next one would come from.
    //
    // ★ Shelf documents are excluded: they are prose ABOUT these columns,
    //   commented end to end, and fix-547's own file names all three. A scan
    //   that cannot tell a gravestone from a corpse fails on the tidiest file
    //   in the diff — seventeen recordings of that in this suite already.
    const dir = resolve(process.cwd(), 'migrations');
    const applied = readdirSync(dir).filter(
      (f) =>
        f.endsWith('.sql') &&
        !f.endsWith('_PENDING_APPROVAL.sql') &&
        !f.endsWith('_SUPERSEDED.sql'),
    );
    const dead = [
      /permits[\s]*\.[\s]*go_date/i,
      /task_templates[\s]*\.[\s]*default_assignee/i,
      /permits[\s]*\.[\s]*stage\b(?!_override)/i,
    ];
    const offenders: string[] = [];
    for (const f of applied) {
      const body = readFileSync(join(dir, f), 'utf8')
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n');
      for (const re of dead) if (re.test(body)) offenders.push(`${f} :: ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it('★★ …and no src/ file resurrects one either', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      // ★★ fix-550: `withFileTypes` rather than a `statSync` per entry — one
      //    syscall instead of two for every file under src/. This walk is
      //    I/O-bound and grows with the repo; under full-suite parallelism it
      //    had started tipping past vitest's 5s default. Same traversal, same
      //    assertion — only the syscall count changed.
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const e = ent.name;
        const full = join(d, e);
        if (ent.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e) && !/Fix547|Fix545|Fix498/.test(e)) {
          const body = readFileSync(full, 'utf8')
            .split(/\r?\n/)
            .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
            .join('\n');
          if (/permits\.go_date|task_templates\.default_assignee/i.test(body)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(resolve(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});
