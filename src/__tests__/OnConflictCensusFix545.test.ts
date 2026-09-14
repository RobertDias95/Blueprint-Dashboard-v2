import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// fix-545 — an `ON CONFLICT` must still infer an index
// ===========================================================================
//
// ★★★ THE INCIDENT, 2026-09-14. fix-536 recreated
//     `permit_tasks_auto_event_uniq` with a THIRD excluded event.
//     `bp_create_lifecycle_task`'s generic insert still named two:
//
//       ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx,-1))
//         WHERE is_auto_generated = true
//           AND auto_event NOT IN ('scrape_reconcile','city_target_chase')
//
//     **`ON CONFLICT` does not name an index — it INFERS one**, and inference
//     needs the statement's predicate to IMPLY the index's. It no longer did →
//     `42P10` → PostgREST 400 → *"Lifecycle tasks created: 0"*, and three real
//     tasks were never made.
//
// ★★★ EVERY GUARD IN fix-536 PASSED. It asserted its own index was created and
//     satisfiable. **The damage was in a neighbouring object**, and nothing in
//     Postgres complains until somebody writes.
//
// ★★★ SO fix-540's RULE HAS AN OPPOSITE NUMBER. fix-540: *assert your change
//     LANDED*. fix-545: **assert what your change BROKE** — the neighbours, not
//     the target.

const CENSUS = 'scripts/sql/on_conflict_census.sql';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------------------
// §A — the census, and how it decides
// ---------------------------------------------------------------------------

describe('fix-545 §A — the engine answers, not a parser', () => {
  const sql = read(CENSUS);

  it('★★★ it exists, it writes nothing, and it installs nothing', () => {
    expect(existsSync(resolve(process.cwd(), CENSUS))).toBe(true);
    // ★ Wrapped BEGIN…ROLLBACK, so the extension it needs is created and undone.
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS plpgsql_check');
  });

  it('★★★ it asks POSTGRES whether the inference works — §A.1 and §A.3', () => {
    // ★★★ `plpgsql_check` PLANS every statement in every plpgsql function,
    //     which is exactly when Postgres resolves an ON CONFLICT to an index,
    //     and it reports `42P10` itself. **Against the live database**, which
    //     is the whole point: the failure is drift between two objects, so a
    //     test comparing two files could not have caught it.
    expect(sql).toContain('plpgsql_check_function');
    expect(sql).toContain('42P10');
  });

  it('★★★ …and it says why hand-parsing was rejected, with the evidence', () => {
    // ★★★ THE FIRST DRAFT USED A REGEX AND MISSED THE INCIDENT STATEMENT.
    //     `ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx,
    //     -1))` has a nested paren; `\([^)]*\)` stops at the first `)`. A
    //     parser that cannot read the failing statement cannot police it —
    //     which is §A.3's instruction, learned rather than assumed.
    expect(sql).toContain('DO NOT HAND-PARSE');
    expect(sql).toContain('COALESCE(cycle_idx, -1)');
  });

  it('★★ trigger functions are checked with their table, not skipped', () => {
    // ★ Without `relid` the checker refuses every trigger function with
    //   `22023: missing trigger relation` — 216 functions all "failing" is that
    //   mistake, not 216 defects. A census that reports everything reports
    //   nothing.
    expect(sql).toContain('relid := r.relid');
    expect(sql).toContain('missing trigger relation');
  });

  it('★★ the set-returning call is not wrapped in a CASE', () => {
    // ★ A CASE around `plpgsql_check_function` errors for every row and looks
    //   exactly like "every function is broken" — which is what the first run
    //   reported. Two branches instead.
    expect(sql).not.toMatch(/CASE\s+WHEN[^\n]*plpgsql_check_function/i);
  });
});

// ---------------------------------------------------------------------------
// §A.4 / §C — the census result, recorded
// ---------------------------------------------------------------------------

describe('fix-545 §A.4 — the number is the finding', () => {
  const sql = read(CENSUS);

  it('★★★ 216 functions checked, and ONE still cannot infer its index', () => {
    // ★★★ Run on prod 2026-09-14, rolled back:
    //
    //   plpgsql functions checked ..................... 216
    //   42P10 — ON CONFLICT cannot infer an index ....... 1
    //   other classes ................. 42P01 ×17 · 42703 ×6
    //
    // ★★★ THE ONE IS NOT THE INCIDENT — that one fix-544 already repaired.
    //     `bp_upsert_permit_cycle_reviewer` says
    //     `ON CONFLICT (permit_id, cycle_index, reviewer_name)` while the only
    //     unique index is `(permit_id, cycle_index, discipline) WHERE
    //     discipline IS NOT NULL`. **fix-44's per-NAME → per-discipline-SLOT
    //     remodel moved the index and left this statement behind** — the same
    //     class, from a different ticket, sitting unnoticed since.
    expect(sql).toContain('216');
    expect(sql).toContain('bp_upsert_permit_cycle_reviewer');
    expect(sql).toContain('per-discipline-SLOT');
  });

  it('★★★ …and it is REPORTED, not repaired — this ticket has no migration', () => {
    // ⚠️ Nothing calls it: not the app, not another function. `authenticated`
    //    and `service_role` may execute it, so it is a landmine rather than an
    //    outage — reviewers ARE being written (2,964 rows, newest on the day of
    //    the census) through another path. Repairing it needs a migration and
    //    the brief says there is none, so it is named and costed instead.
    expect(sql).toContain('Reported, not repaired');
  });

  it('★★ the other error classes are recorded and NOT confused with this one', () => {
    // ★ 42P01 ×17 are runtime temp tables the checker cannot see (`_cc_items`,
    //   `_pn`). 42703 ×6 are three functions naming columns that no longer
    //   exist — real, a different class, recorded rather than swept in.
    expect(sql).toContain('42P01');
    expect(sql).toContain('42703');
    expect(sql).toContain('permits.go_date');
    expect(sql).toContain('task_templates.default_assignee');
  });

  it('★★★ §C: ON CONSTRAINT and the partial indexes are covered by the same run', () => {
    // ★★★ §C asks about `ON CONFLICT ON CONSTRAINT` and partial-index upserts.
    //     **The census already answers both**, because the engine plans every
    //     statement whatever its form: 4 `ON CONSTRAINT draw_schedule_pkey1`
    //     sites (the constraint exists) and every one of the 11 partial unique
    //     indexes' upserts plan clean. One statement fails, and it is the one
    //     above.
    //
    // ★ The mirror question — an index no statement infers — is an UNUSED
    //   index, not a broken one. Not a correctness defect, so not raised as one.
    expect(sql).toContain('ON CONSTRAINT');
  });
});

// ---------------------------------------------------------------------------
// §B — the shelf rule
// ---------------------------------------------------------------------------

describe('fix-545 §B — the rule lives where the other shelf rules live', () => {
  const guard = read('src/__tests__/PendingApprovalIndexFix450.test.ts');

  it('★★★ the rule is written into the shelf guard header', () => {
    expect(guard).toContain('ASSERT WHAT YOUR CHANGE **BROKE**');
    expect(guard).toContain('must list every `ON CONFLICT` that infers it');
    // ★ and it points at the tool rather than asking for hand work
    expect(guard).toContain('on_conflict_census.sql');
  });

  it('★★★ …and it is ENFORCED, not just written down', () => {
    // ★ A shelf file that creates or drops a unique index must name an
    //   ON CONFLICT or the census. A low bar on purpose: it cannot check the
    //   neighbours are right, only that the author knew they existed.
    expect(guard).toContain('reshapes a UNIQUE INDEX names its ON CONFLICT neighbours');
  });

  it('★★ every shelf file that reshapes a unique index already satisfies it', () => {
    // ★ fix-542 creates `project_messages_source_note_key` and names the
    //   ON CONFLICT that infers it — the rule passing on a real file rather
    //   than vacuously.
    const dir = resolve(process.cwd(), 'migrations');
    const shelf = readdirSync(dir).filter(
      (f) => f.endsWith('_PENDING_APPROVAL.sql') || f.endsWith('_SUPERSEDED.sql'),
    );
    const reshaping = shelf.filter((f) => {
      const s = readFileSync(resolve(dir, f), 'utf8');
      return /(CREATE|DROP)\s+(UNIQUE\s+)?INDEX/i.test(s) && /UNIQUE/i.test(s);
    });
    expect(reshaping.length).toBeGreaterThan(0);
    for (const f of reshaping) {
      const s = readFileSync(resolve(dir, f), 'utf8');
      expect(/ON CONFLICT/i.test(s) || /on_conflict_census/i.test(s), f).toBe(true);
    }
  });
});
