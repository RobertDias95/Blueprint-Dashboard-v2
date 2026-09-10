import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// ★★★ fix-520 §D (P-233) — `projects` gets an audit trail
// ===========================================================================
//
// ⚠️⚠️ **THE MIGRATION IS NOT APPLIED.** It is written for Cowork to apply, and
//       nothing in the app depends on it existing. These tests hold its RULE,
//       not its presence in a database.
//
// ★★★ NO LIVE DB IN CI, so this is the fix-153 pattern: a pure-TS mirror of the
//     diff rule that runs on every build, plus a documented read-only prod
//     probe of the same expression. The probe was run on 2026-09-10 against
//     `2621 Eastlake Ave E` and created nothing:
//
//       changes            {"zone": {"before": "LR1", "after": "LR2"}}
//       changes_when_noop  {}
//
//     — a single-column edit produces one before/after pair, and an UPDATE
//     that moved only `updated_at` produces an empty object, which the trigger
//     turns into no row at all.
// ===========================================================================

type Row = Record<string, unknown>;

/**
 * The TS mirror of `bp_audit_projects_row`'s body.
 *
 * ★★ IT MUST STAY IN LOCKSTEP WITH THE SQL, which is the standing rule for
 *    every twin in this codebase (`isPermitInCorrections` ⇄
 *    `bp_permit_in_corrections`, `disciplineForTeam` ⇄ `bp_discipline_for_team`).
 *    The assertion at the bottom of this file reads the migration and checks
 *    the three decisions below are all visible in it.
 */
function auditDiff(oldRow: Row, newRow: Row): Row {
  const changes: Row = {};
  for (const key of Object.keys(newRow)) {
    // ★ 1. `updated_at` is excluded: every UPDATE moves it, so including it
    //   would make a no-op write look like a change and give every real change
    //   a field nobody asked about.
    if (key === 'updated_at') continue;
    // ★ 2. `IS DISTINCT FROM` — null-safe on both sides. `null !== undefined`
    //   in JS would report a change where Postgres sees none, so the mirror
    //   compares the way the SQL does.
    const before = oldRow[key] ?? null;
    const after = newRow[key] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes[key] = { before, after };
    }
  }
  return changes;
}

/** ★ 3. An empty diff writes NO ROW. */
function writesARow(changes: Row): boolean {
  return Object.keys(changes).length > 0;
}

const BASE: Row = {
  id: 'p-1',
  address: '2621 Eastlake Ave E',
  zone: 'LR1',
  units: 3,
  is_backfill: null,
  product_types: ['Detached'],
  updated_at: '2026-09-10T00:00:00Z',
};

describe('fix-520 §D (P-233) — the projects audit trigger', () => {
  it('★★★ a single-column change records BEFORE and AFTER, and only that column', () => {
    // ★★★ The brief's own test: *"the trigger records before and after for a
    //     single-column change."* Confirmed against a real prod row by the
    //     read-only probe quoted at the top of this file.
    const changes = auditDiff(BASE, { ...BASE, zone: 'LR2', updated_at: 'later' });
    expect(changes).toEqual({ zone: { before: 'LR1', after: 'LR2' } });
    expect(Object.keys(changes)).toHaveLength(1);
    expect(writesARow(changes)).toBe(true);
  });

  it('★★★ an UPDATE that changed nothing writes NO ROW', () => {
    // ★★★ `projects_set_updated_at` fires on every UPDATE including the no-op
    //     ones a bulk job produces. Without this, a backfill migration that
    //     touched 219 rows and changed none would leave 219 audit rows saying
    //     nothing — and fix-341 already spent a ticket on what phantom writes
    //     cost elsewhere.
    const changes = auditDiff(BASE, { ...BASE, updated_at: 'later' });
    expect(changes).toEqual({});
    expect(writesARow(changes)).toBe(false);
  });

  it('★★★ null → value and value → null are both recorded', () => {
    // ★★ fix-386's three states reach the audit too: `is_backfill` going
    //    null → true is the answer being GIVEN, which is a different fact from
    //    true → false, and the log has to be able to tell them apart.
    expect(auditDiff(BASE, { ...BASE, is_backfill: true })).toEqual({
      is_backfill: { before: null, after: true },
    });
    expect(auditDiff({ ...BASE, is_backfill: true }, BASE)).toEqual({
      is_backfill: { before: true, after: null },
    });
  });

  it('★★ an array column diffs by VALUE, not by reference', () => {
    expect(auditDiff(BASE, { ...BASE, product_types: ['Detached'] })).toEqual({});
    expect(auditDiff(BASE, { ...BASE, product_types: ['Detached', 'Attached'] })).toEqual({
      product_types: { before: ['Detached'], after: ['Detached', 'Attached'] },
    });
  });

  it('★★ several columns in one UPDATE produce ONE row carrying both', () => {
    // ★ One row per UPDATE, not one per column. `audit_log.changes` is already
    //   `jsonb`; a row per column multiplies the count for no extra fact — and
    //   §A has just made most updates single-column anyway.
    const changes = auditDiff(BASE, { ...BASE, zone: 'LR2', units: 9 });
    expect(Object.keys(changes).sort()).toEqual(['units', 'zone']);
  });
});

describe('fix-520 §D — the migration says what the mirror says', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'migrations/fix_520_projects_audit_trail.sql'),
    'utf8',
  );

  it('★★★ the three decisions are all in the SQL', () => {
    // ★★ A mirror is worth nothing if it drifts from the thing it mirrors.
    //    These are the three rules the tests above encode.
    expect(sql).toContain("IF v_key = 'updated_at' THEN");
    expect(sql).toContain('IS DISTINCT FROM');
    expect(sql).toContain("IF v_changes = '{}'::jsonb THEN");
    expect(sql).toContain("jsonb_build_object('before'");
  });

  it('★★★ it is an AFTER trigger, and it records WHO', () => {
    // ★ AFTER, so a failure to audit cannot roll back the edit it records.
    // ★ `auth.uid()` is NULL for a service-role or migration write, which is
    //   how a machine write is told from a person's — the distinction the
    //   backfill will need.
    expect(sql).toContain('AFTER UPDATE ON public.projects');
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain("'project_updated'");
  });

  it('★★★ it is NOT applied, and it says so at the top', () => {
    // ★★★ The brief: *"§D writes a migration — do NOT apply it to prod; report
    //     it for Cowork to apply."* The file has to say that where somebody
    //     opening it will read it first, not only in a PR nobody re-reads.
    expect(sql).toContain('NOT APPLIED');
    expect(sql.indexOf('NOT APPLIED')).toBeLessThan(1200);
  });

  it('★★ it states the row growth and the fate of `project_sd_handoffs`', () => {
    // ⚠️ The two things the brief requires reporting BEFORE anyone applies it.
    expect(sql).toContain('EXPECTED ROW GROWTH');
    expect(sql).toContain('project_sd_handoffs');
    expect(sql).toContain('IT STAYS');
  });
});
