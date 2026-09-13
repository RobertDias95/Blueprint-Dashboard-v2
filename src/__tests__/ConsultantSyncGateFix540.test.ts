import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

// ===========================================================================
// fix-540 — the consultant gate fix-539's anchor would not have matched
// ===========================================================================
//
// ★★★ MY BUG, AND THE LESSON IS THE WHOLE TICKET. fix-539 step 7 anchored on
//     `BEGIN\n`; both function bodies open with lowercase `begin`. `replace()`
//     would have returned the text unchanged, `EXECUTE` would have succeeded on
//     that unchanged text, and the RAISE NOTICE would have printed success.
//
// ★★★ AN ANCHOR NEEDS A HIT ASSERTION, NOT A SHAPE ASSERTION. The guard I DID
//     write asked "does this function still write projects?" — a check that the
//     TARGET has not moved on, not that MY REPLACEMENT LANDED. Those are
//     different questions and only one of them was being asked.
//
// ★★★ THE PROBE, PASTED — prod, rolled back, 2026-09-13:
//
//   person        function                 scenario      outcome         external_team
//   ------------  -----------------------  ------------  --------------  ----------------------
//   Ainsley (da)  add_project_consultant   MEMBER        ALLOWED         Seattle Tree Consulting
//   Ainsley (da)  add_project_consultant   NOT a member  REFUSED 42501   (absent — unchanged)
//   Ainsley (da)  set_consultant_firm      MEMBER        ALLOWED         Arcxis
//   Ainsley (da)  set_consultant_firm      NOT a member  REFUSED 42501   Blueprint Civil (unchanged)
//   Derry   (dm)  set_consultant_firm      NOT a member  ALLOWED         Atwell

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');
const MIGRATION = 'migrations/fix_540_consultant_sync_gate_PENDING_APPROVAL.sql';

// ---------------------------------------------------------------------------
// ★★★ The two strategies, modelled — so the lesson is runnable, not prose
// ---------------------------------------------------------------------------
//
// ★ This mirrors the SQL's splice. It lives in the test because it is a
//   DEMONSTRATION of the failure, not app code — the rule's real home is the
//   migration, and the tests below assert the migration still carries it.

const MARKER = 'bp_may_write_project';

/** fix-539's approach: check the SHAPE, then replace and hope. */
function patchTheWayFix539Did(def: string, anchor: string, guard: string): string {
  // the guard it actually had — "has the target moved on?"
  if (!def.includes('update public.projects p')) {
    throw new Error('no longer writes public.projects');
  }
  return def.replace(anchor, anchor + guard); // …and no check that this did anything
}

/** fix-540's approach: the anchor must hit, and the count must move. */
function patchWithHitAssertion(def: string, anchor: string, guard: string): string {
  const before = def.split(MARKER).length - 1;
  const at = def.indexOf(anchor);
  if (at === -1) {
    throw new Error(
      'anchor not found — a replace that matches nothing reports success',
    );
  }
  const next =
    def.slice(0, at + anchor.length) + guard + def.slice(at + anchor.length);
  const after = next.split(MARKER).length - 1;
  if (after !== before + 1) {
    throw new Error(`the splice did not land (${before} -> ${after})`);
  }
  return next;
}

/** The real shape, as measured on prod: lowercase `begin`. */
const REAL_BODY = [
  'CREATE OR REPLACE FUNCTION public.bp_add_project_consultant(p_project_id uuid)',
  ' LANGUAGE plpgsql',
  'AS $function$',
  'declare',
  '  v_tenant uuid;',
  'begin',
  '  select p.tenant_id into v_tenant from public.projects p;',
  '  update public.projects p set external_team = 1;',
  'end;',
  '$function$',
].join('\n');

const GUARD = `  if not public.${MARKER}(p_project_id) then\n    raise exception 'nope';\n  end if;\n`;

describe('fix-540 §0 — the failure mode, demonstrated', () => {
  it('★★★ fix-539 would have returned an UNGATED definition and raised nothing', () => {
    // ★★★ THE EXACT BUG. The shape guard passes — the function does still write
    //     projects — and then the uppercase anchor matches nothing, so the
    //     definition comes back byte-identical. `EXECUTE` succeeds on it. The
    //     notice prints. Nothing anywhere says "I changed nothing".
    const out = patchTheWayFix539Did(REAL_BODY, '\nBEGIN\n', GUARD);
    expect(out).toBe(REAL_BODY); // ← unchanged
    expect(out).not.toContain(MARKER); // ← and ungated
  });

  it('★★★ …and the hit assertion REFUSES the same input', () => {
    expect(() => patchWithHitAssertion(REAL_BODY, '\nBEGIN\n', GUARD)).toThrow(
      /anchor not found/,
    );
  });

  it('★★★ the correct anchor patches the real shape', () => {
    const out = patchWithHitAssertion(REAL_BODY, '\nbegin\n', GUARD);
    expect(out).toContain(MARKER);
    expect(out.split(MARKER)).toHaveLength(2); // exactly once
    // ★ and the guard lands INSIDE the body, after `begin`, not in the declare
    expect(out.indexOf(MARKER)).toBeGreaterThan(out.indexOf('\nbegin\n'));
    expect(out.indexOf(MARKER)).toBeLessThan(out.indexOf('select p.tenant_id'));
  });

  it('★★ a definition already carrying the guard does not get a second one', () => {
    const once = patchWithHitAssertion(REAL_BODY, '\nbegin\n', GUARD);
    // re-running must not silently double it: the count check is what notices
    expect(() => patchWithHitAssertion(once, '\nbegin\n', GUARD)).not.toThrow();
    const twice = patchWithHitAssertion(once, '\nbegin\n', GUARD);
    expect(twice.split(MARKER)).toHaveLength(3);
    // …which is why the SQL skips when the count is already > 0 rather than
    // relying on the splice being idempotent.
    expect(read(MIGRATION)).toContain('already gated, skipping');
  });
});

// ---------------------------------------------------------------------------
// The staged migration
// ---------------------------------------------------------------------------

describe('fix-540 — the migration carries all three assertions', () => {
  const sql = read(MIGRATION);

  it('★★★ it is STAGED, not applied', () => {
    expect(sql).toContain('NOT APPLIED');
    expect(sql).toMatch(/MEASURED ON PROD \d{4}-\d{2}-\d{2}/);
    const live = sql
      .split(/\r?\n/)
      .filter((l) =>
        /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DO|BEGIN|COMMIT)\b/i.test(l),
      );
    expect(live).toEqual([]);
  });

  it('★★★ (a) anchor found, (b) count moves, (c) the LIVE definition is re-read', () => {
    // ★★★ (c) is the one that cannot be fooled: a replace that did nothing
    //     cannot make `pg_get_functiondef` come back containing the guard.
    //     A post-condition on the database beats any post-condition on a string.
    expect(sql).toContain('anchor not found in %');
    expect(sql).toContain('the splice did not land in %');
    expect(sql).toContain('executed but the LIVE definition is UNGATED');
    // the re-read happens AFTER the execute, not before
    expect(sql.indexOf('EXECUTE v_def;')).toBeLessThan(
      sql.indexOf('executed but the LIVE definition is UNGATED'),
    );
  });

  it('★★★ the anchors are the LOWERCASE ones that are actually there', () => {
    expect(sql).toContain("chr(10) || 'begin' || chr(10)");
    expect(sql).not.toMatch(/'BEGIN'\s*\|\|\s*chr\(10\)/);
  });

  it('★★★ the two guards DIFFER, and the second one derives its project', () => {
    // ★★ `bp_set_consultant_firm` has no `p_project_id`. Applying the same
    //    patch twice could never have worked, case or no case.
    expect(sql).toContain("'p_project_id'");
    expect(sql).toContain("'v_cur.project_id'");
    expect(sql).toContain('project_consultants');
    // ★ and the second guard sits after the not-found check, because that is
    //   the earliest point the project is known
    expect(sql).toContain("using errcode = ''P0002'';");
  });

  it('★★★ the probe is pasted, with the 42501s and the untouched external_team', () => {
    expect(sql).toContain('REFUSED 42501');
    expect(sql).toContain('unchanged');
    for (const who of ['Ainsley', 'Derry']) expect(sql, who).toContain(who);
    for (const fn of ['add_project_consultant', 'set_consultant_firm']) {
      expect(sql, fn).toContain(fn);
    }
  });
});

// ---------------------------------------------------------------------------
// §B — the siblings
// ---------------------------------------------------------------------------

describe('fix-540 §B — every INVOKER writer of public.projects, enumerated', () => {
  const sql = read(MIGRATION);

  it('★★★ there are SEVEN, and the file names all of them', () => {
    // ★ The brief expected "are there more?"; the answer is five more, found by
    //   widening the scan from UPDATE to INSERT and DELETE as well.
    for (const fn of [
      'bp_add_project_consultant',
      'bp_set_consultant_firm',
      'bp_delete_project_row',
      'bp_ensure_project',
      'bp_replace_draw_schedule',
      'migrate_auxiliary',
      'migrate_to_relational',
    ]) {
      expect(sql, fn).toContain(fn);
    }
    expect(sql).toContain('seven');
  });

  it('★★★ only the two UPDATE writers were in fix-539\'s position — nothing regressed', () => {
    // ★★ fix-539 tightened `projects_tenant_update` and nothing else, so the
    //    INSERT and DELETE paths are exactly as they were before it.
    expect(sql).toContain('nothing regressed');
    // ★★ Matched within ONE line: fix-539's own assertion embedded a newline and
    //    broke the moment git re-materialised the file with CRLF.
    expect(sql).toContain('GOVERNS `UPDATE` ONLY');
  });

  it('★★★ …but the DELETE hole is named, with what does and does not guard it', () => {
    // ⚠️ A design associate can still DELETE any project in the tenant:
    //    `bp_delete_project_row` is INVOKER, has no tenant check of its own, no
    //    admin check, and falls through to a tenant-wide DELETE policy — the
    //    browser is the only thing steering who sees the button. NOT a fix-539
    //    regression, NOT fixed here, and the obvious next question.
    expect(sql).toContain('DELETE any project in the tenant');
    expect(sql).toContain('a fix-539 regression');
    expect(sql).toContain('it is not fixed');
    // ★ and it is REPORTED rather than patched — no gate is spliced into it
    expect(sql).not.toMatch(/ARRAY\['bp_delete_project_row'/);
  });

  it('★★ anon cannot call any of them', () => {
    expect(sql).toContain('none by `anon`');
  });
});
