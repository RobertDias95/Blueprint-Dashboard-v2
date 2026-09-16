import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  writeDeniedMessage,
  projectMembersFromCache,
  ProjectWriteDeniedError,
  WRITE_DENIED_FALLBACK,
} from '../lib/projectWriteScope';

// ===========================================================================
// fix-549 (P-255 · the gate half of P-250)
// ===========================================================================
//
// ★★★ NINE REFUSALS IN FOUR MINUTES, ONE PERSON. `error_reports` 718–726 —
//     nine rows, not eight; the range is inclusive — all Cam, all
//     `projects.update`, all on 1917 3rd Ave W. **Six `Lot Size`, then three
//     `Unit Size`.**
//
// ★★★ AND THE RULE WAS RIGHT. Cam is roster `da`, on none of that project's
//     member columns, and the project has a DA (Nicky), so
//     `bp_may_write_project` returned false correctly. The scope is not being
//     "fixed" — Bobby: *"Cam is a different person because he's not assigned to
//     a project — he goes back and backfills all this."*
//
// ★★★ THE PROBE, prod 2026-09-14, rolled back:
//     Cam → lot_size_sf ALLOWED · Cam → unit_types ALLOWED ·
//     **Cam → another TENANT REFUSED** · a plain da → not-theirs REFUSED ·
//     a plain da → no-DA project ALLOWED · both other callers REFUSED 42501 ·
//     delete: da REFUSED 42501, da direct BLOCKED, **Cam REFUSED**, admin OK.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIGRATION = 'migrations/fix_549_cam_edits_any_project_PENDING_APPROVAL.sql';

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}

// ---------------------------------------------------------------------------
// §A — the grant
// ---------------------------------------------------------------------------

describe('fix-549 §A — a per-person grant, in the shape the app already has', () => {
  const sql = read(MIGRATION);

  it('★★★ it is STAGED, fully commented, and dated', () => {
    expect(sql).toContain('NOT APPLIED');
    expect(sql).toMatch(/MEASURED ON PROD \d{4}-\d{2}-\d{2}/);
    const live = sql
      .split(/\r?\n/)
      .filter((l) =>
        /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DO|BEGIN|COMMIT|SET)\b/i.test(l),
      );
    expect(live).toEqual([]);
  });

  it('★★★ the flag is read INLINE — the house shape, found not assumed', () => {
    // ★★★ §A asked for a helper "the same shape as whatever `may_edit_library`
    //     is read by today". Measured: it is read INLINE in
    //     `bp_update_library_fields` (`p.id = auth.uid() and p.may_edit_library
    //     is true`), not through a helper and not in a policy. So this reads
    //     the new flag inline too, rather than inventing a second pattern.
    expect(sql).toContain('It is read INLINE');
    expect(sql).toContain('p.id = auth.uid() and p.may_edit_all_projects is true');
    // ★ and no helper function is created
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.bp_may_edit_all_projects/i);
  });

  it('★★★ the tenant check stays ABOVE the new branch', () => {
    // ⚠️ The grant crosses PROJECTS, never TENANTS — and the probe proved it
    //    with a real call against a project in a second tenant, not by reading
    //    the code.
    expect(sql).toContain('THE TENANT CHECK STAYS ABOVE IT');
    expect(sql).toContain('a project in ANOTHER TENANT ................... **REFUSED**');
    // ★ the branch is spliced above the `da` branch, which sits below the
    //   tenant guard in the live function
    expect(sql).toContain("'  if ''da'' = any (public.bp_roster_roles()) then'");
  });

  it('★★★ the grant is by EMAIL, and exactly one holder is asserted', () => {
    // ★★★ *A grant that hits 0 rows and a grant that hits 37 both look like
    //     success today* — `UPDATE 0` and `UPDATE 37` are equally quiet.
    expect(sql).toContain("lower(u.email) = 'cameron@blueprintcap.com'");
    expect(sql).not.toMatch(/may_edit_all_projects = true[\s\S]{0,120}id = '[0-9a-f]{8}-/i);
    expect(sql).toContain('expected exactly Cam to hold the flag');
  });

  it('★★★ (c) the LIVE definition is re-read after the EXECUTE', () => {
    // ★ fix-540's rule. And the anchor refuses rather than guessing — fix-545's.
    expect(sql).toContain('executed but the LIVE definition lacks the branch');
    expect(sql).toContain('a replace that matches nothing reports success');
    expect(sql.indexOf('EXECUTE v_def;')).toBeLessThan(
      sql.indexOf('executed but the LIVE definition lacks the branch'),
    );
  });

  it('★★★ (d) every caller of bp_may_write_project is named and re-asserted', () => {
    // ★★★ fix-545's rule — assert what you may have BROKEN. Four callers: the
    //     RLS policy plus three functions.
    for (const caller of [
      'bp_add_project_consultant',
      'bp_update_project_fields',
      'bp_set_consultant_firm',
      'projects_tenant_update',
    ]) {
      expect(sql, caller).toContain(caller);
    }
    expect(sql).toContain('REFUSED 42501');
  });

  it('★★ the ALTER TABLE lock hazard is recorded, because it actually bit', () => {
    // ★ The first probe run DEADLOCKED: `ALTER TABLE profiles` takes an ACCESS
    //   EXCLUSIVE lock and prod is live. `lock_timeout` turns a stall into a
    //   clean retry.
    expect(sql).toContain('DEADLOCK');
    expect(sql).toContain("lock_timeout");
  });
});

// ---------------------------------------------------------------------------
// §B — the field asks before it accepts typing
// ---------------------------------------------------------------------------

describe('fix-549 §B — the screen asks the server, it does not re-derive', () => {
  it('★★★ the hook calls bp_may_write_project — the same function the gate calls', () => {
    // ⚠️ Two writers of one rule is the most repeated defect in this Brain
    //    (P-207, P-179, P-244, fix-531, fix-541 §A). The browser asks; the rule
    //    stays in one place.
    const hook = code(read('src/hooks/useMayWriteProject.ts'));
    expect(hook).toContain("supabase.rpc('bp_may_write_project'");
    // ★ no re-derivation: the hook must not reason about roles or membership
    expect(hook).not.toMatch(/roster|is_member|bp_write_caps|'da'/);
  });

  it('★★★ it fails CLOSED — read-only is the safe wrong answer', () => {
    const hook = code(read('src/hooks/useMayWriteProject.ts'));
    expect(hook).toContain('if (error) return false;');
    expect(hook).toContain('q.data === true');
  });

  it('★★★ every Project Data editor that writes `projects` asks it', () => {
    // ★ Five editors, including the unit-size field — which is literally the
    //   second field in Cam's refusals.
    //
    // ★★★ fix-575a REPOINTED THIS FROM A SPELLING TO THE PROPERTY, and the
    //     ruling got STRONGER rather than weaker. This counted textual
    //     `useMayWriteProject(project.id)` calls in the component file. Three
    //     of those editors — SiteEditor, ClosingRow, ProjectTagsEditor — now
    //     ask through `useProjectFieldCommit`, which calls it internally and
    //     returns the answer as `occMissing`. Counting the old spelling would
    //     have demanded they each keep a private copy of the very thing
    //     fix-575a folded away.
    //
    // ★★ SO IT COUNTS BOTH FORMS, and separately pins that the shared hook
    //    really does ask — which is what makes the indirect form legitimate.
    //    Without that second assertion this test could be satisfied by a hook
    //    that gates on nothing at all.
    const editors = code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'));
    const direct = editors.split('useMayWriteProject(project.id)').length - 1;
    const viaHook = editors.split('useProjectFieldCommit(project)').length - 1;
    expect(direct + viaHook).toBeGreaterThanOrEqual(5);

    const hook = code(read('src/hooks/useProjectFieldCommit.ts'));
    expect(hook).toContain('useMayWriteProject(project.id)');
    expect(hook).toContain('!project.updated_at || !mayWrite');

    // ★★ and no control is left on the old answer alone — the assertion that
    //    caught the tag ADD select, which read `occMissing` while the remove ×
    //    six lines above it read `locked` (fix-575a).
    expect(editors).not.toContain('disabled={occMissing}');
    expect(editors).not.toContain('disabled={occMissing || addable.length === 0}');
  });
});

// ---------------------------------------------------------------------------
// §C — the refusal names the person
// ---------------------------------------------------------------------------

describe('fix-549 §C — name who to ask, and degrade cleanly', () => {
  it('★★★ it names the DA, who was sitting on the project the whole time', () => {
    const msg = writeDeniedMessage({ da: 'Nicky', designManager: 'Derry' });
    expect(msg).toContain('Nicky');
    expect(msg).toContain('Derry');
    expect(msg).toContain('DA');
  });

  it('★★★ …and falls back when the project names nobody', () => {
    // ⚠️ 22 of 220 projects have no DA (measured 09-13). `"Ask ."` is worse
    //    than a vague sentence.
    expect(writeDeniedMessage({ da: null, designManager: null })).toBe(WRITE_DENIED_FALLBACK);
    expect(writeDeniedMessage()).toBe(WRITE_DENIED_FALLBACK);
    expect(writeDeniedMessage({ da: '  ', designManager: '  ' })).toBe(WRITE_DENIED_FALLBACK);
    // ★ one name is still better than none
    expect(writeDeniedMessage({ da: 'Nicky' })).toContain('Nicky');
    expect(writeDeniedMessage({ designManager: 'Derry' })).toContain('Derry');
    for (const m of [
      writeDeniedMessage({ da: null, designManager: null }),
      writeDeniedMessage({ da: 'Nicky' }),
    ]) {
      expect(m).not.toContain('Ask .');
      expect(m).not.toContain('undefined');
    }
  });

  it('★★★ the DA comes from the PERMITS, which is why both caches are read', () => {
    // ★★★ The design manager is on the project row; the DA is on its permits.
    //     A message composed from the project alone would have named Derry and
    //     MISSED NICKY — the person the refusal was actually about.
    const members = projectMembersFromCache(
      [{ id: 'p1', design_manager: 'Derry' }],
      [{ project_id: 'p1', da: 'Nicky' }],
      'p1',
    );
    expect(members).toEqual({ da: 'Nicky', designManager: 'Derry' });
    // ★ and it survives a cold cache
    expect(projectMembersFromCache(undefined, undefined, 'p1')).toEqual({
      da: null,
      designManager: null,
    });
    // ★ a blank DA on one permit does not win over a real one on another
    expect(
      projectMembersFromCache(
        [{ id: 'p1' }],
        [
          { project_id: 'p1', da: '  ' },
          { project_id: 'p1', da: 'Nicky' },
        ],
        'p1',
      ).da,
    ).toBe('Nicky');
  });

  it('★★ the error carries the composed message', () => {
    const e = new ProjectWriteDeniedError('p1', { da: 'Nicky', designManager: 'Derry' });
    expect(e.message).toContain('Nicky');
    expect(new ProjectWriteDeniedError('p1').message).toBe(WRITE_DENIED_FALLBACK);
  });
});

// ---------------------------------------------------------------------------
// §D — delete is admins only
// ---------------------------------------------------------------------------

describe('fix-549 §D — delete is admins only, gate only', () => {
  const sql = read(MIGRATION);

  it('★★★ exactly one function deletes a project, and it is named', () => {
    // ★ P-250 counted seven WRITERS. Exactly one DELETES.
    expect(sql).toContain('Exactly one DELETES');
    expect(sql).toContain('bp_delete_project_row');
  });

  it('★★★ the policy AND a loud 42501 — because a policy alone would lie', () => {
    // ★★★ Blocked by RLS the DELETE matches 0 rows, the function re-reads the
    //     row and returns `conflict = true` — *"changed since you loaded it"*.
    //     fix-539's lesson, a second time.
    expect(sql).toContain('A POLICY ALONE WOULD HAVE LIED');
    expect(sql).toContain('ALTER POLICY projects_tenant_delete');
    expect(sql).toContain('is_tenant_admin(tenant_id)');
    expect(sql).toContain("only an admin can delete a project");
  });

  it('★★★ CAM is refused the delete, even holding the all-projects flag', () => {
    // ★ The grant is about EDITING. Deleting is a different power and the probe
    //   proved they do not travel together.
    expect(sql).toContain('**CAM, who may edit every project** ................ REFUSED 42501');
  });

  it('★★★ the button is ABSENT for everyone else, not disabled', () => {
    const page = code(read('src/pages/ProjectDetail.tsx'));
    expect(page).toContain('isTenantAdmin');
    expect(page).toContain(': undefined');
    expect(page).toContain('useIsTenantAdmin');
  });

  it('★★★ the conversion is NOT here, and fix-557 is sized', () => {
    // ⚠️ Flipping `archived` instead of removing a row is only safe once every
    //    reader filters it. 31 server-side readers, 2 of which do → 29 to
    //    review. That number is why it is its own ticket.
    expect(sql).toContain('NOT this ticket');
    expect(sql).toContain('29 to review');
    expect(sql).not.toMatch(/SET archived = true/i);
  });
});
