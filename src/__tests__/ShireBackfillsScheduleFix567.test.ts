import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// ★★★ fix-567 (P-271) — SHIRE BACKFILLS THE DATES AND THE DRAW SCHEDULE
// ===========================================================================
//
// ★★★ CI HAS NO DATABASE, so every server claim here is mirrored against the
//     staged migration's TEXT and against the client's source. **The rolled-
//     back prod probe is the authority** (fix-153's pattern) and its results
//     are recorded at the foot of the migration; these tests are what stops
//     the file drifting away from what was proved.
//
// ---------------------------------------------------------------------------
// MEASURED ON PROD 2026-09-14, EVERY PROBE ROLLED BACK
// ---------------------------------------------------------------------------
//
//   Shire = smahdi@blueprintcap.com · team_members role `da`, active ·
//   profiles role `editor` · may_edit_library false · may_edit_all_projects
//   false. Holders of may_edit_all_projects before 1 (Cam) → after 2.
//   Holders of may_edit_draw_schedule after: 1.
//
//                                        Shire (flagged)  an editor, NO flag
//     1 upsert a draw_schedule row       ALLOWED          REFUSED 42501
//     2 create a da_time_blocks Vacation ALLOWED          REFUSED 42501
//     3 edit a project date              ALLOWED          REFUSED (0 rows)
//     4 write the quarter layout         ALLOWED          REFUSED 42501
//     5 bp_assert_draw_schedule_admin()  ALLOWED          REFUSED 42501
//     6 bp_can_edit_draw_schedule()      true             false
//     7 bp_delete_project_row()          REFUSED 42501    REFUSED 42501
//
// ★★★ CASE 4 IS THE ONE THAT MATTERS. A grant that accidentally opened the
//     draw schedule to every editor looks identical from Shire's seat.
//
// ⚠️ THE CROSS-TENANT CASE COULD NOT BE PROVED — `public.projects` holds
//    exactly ONE tenant, so there is no second tenant to be refused from. Said
//    plainly rather than reported green.
//
// ---------------------------------------------------------------------------
// ★★★ FIVE GATE SITES, OR THE SCREEN AND THE DATABASE DISAGREE
// ---------------------------------------------------------------------------
//   (1) draw_schedule                ALL policy   ← the INVOKER RPCs' gate
//   (2) da_time_blocks               ALL policy   ←   "
//   (3) draw_schedule_quarter_layout ALL policy   ←   "
//   (4) bp_can_edit_draw_schedule()               ← the UI asks this
//   (5) bp_assert_draw_schedule_admin()           ← 10 DEFINER RPCs call it
//
// Teaching four of five produces a button that appears and then fails, which
// is worse than no button.

const SQL = resolve(
  __dirname,
  '../../migrations/fix_567_shire_backfills_the_schedule_PENDING_APPROVAL.sql',
);

function sql(): string {
  return readFileSync(SQL, 'utf8');
}
function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}
/** ★ Source with `//` comments stripped, so an assertion about CODE cannot be
 *  satisfied by the prose explaining it — the gravestone trap, which this
 *  Brain has recorded seventeen times. */
function code(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
}

describe('fix-567 — the migration is staged, not applied', () => {
  it('★★★ the file exists and EVERY statement is commented out', () => {
    expect(existsSync(SQL)).toBe(true);
    const live = sql()
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
  });

  it('★★ it carries the lock_timeout, and says why', () => {
    // ★ ALTER TABLE public.profiles ADD COLUMN takes an AccessExclusiveLock and
    //   deadlocked against live readers when fix-549 probed the same statement.
    expect(sql()).toContain("set local lock_timeout = '5s'");
    expect(sql()).toContain('AccessExclusiveLock');
  });

  it('★★★ both grants are BY EMAIL — never a pasted uuid', () => {
    const s = sql();
    expect(s).toContain("lower(u.email) = 'smahdi@blueprintcap.com'");
    // ★ The uuid may appear in the measured header as a record; it must never
    //   be what a grant matches on.
    const grantLines = s
      .split(/\r?\n/)
      .filter((l) => l.includes('set may_edit_'));
    expect(grantLines.length).toBeGreaterThanOrEqual(2);
    for (const l of grantLines) {
      expect(l).not.toContain('44c0c6e2');
    }
  });
});

describe('fix-567 §B — all FIVE gate sites are taught, and the tenant check stays above', () => {
  const SITES: readonly [string, string][] = [
    ['1. draw_schedule policy', 'create policy draw_schedule_tenant_admin_write'],
    ['2. da_time_blocks policy', 'create policy da_time_blocks_tenant_admin_write'],
    ['3. quarter layout policy', 'create policy dsql_tenant_admin_write'],
    ['4. bp_can_edit_draw_schedule', 'create or replace function public.bp_can_edit_draw_schedule'],
    ['5. bp_assert_draw_schedule_admin', 'create or replace function public.bp_assert_draw_schedule_admin'],
  ];

  for (const [label, needle] of SITES) {
    it(`★★★ gate site ${label} is in the migration`, () => {
      // ★ Matched on the statement, not on prose naming it — an all-comments
      //   migration cannot be stripped, so the assertion has to name something
      //   only a statement would say.
      expect(sql().toLowerCase()).toContain(needle.toLowerCase());
    });
  }

  it('★★★ the grant appears in all three POLICIES, with the tenant check above it', () => {
    // ★★★ The grant crosses PROJECTS, never TENANTS. Each policy must read
    //     `tenant_id = any (auth_tenant_ids()) and <flag>` — never the flag
    //     alone — and must keep `is_tenant_admin(tenant_id)` as the first
    //     disjunct so today's admins are unaffected.
    const s = sql();
    const pairs = s.split('create policy').slice(1);
    expect(pairs).toHaveLength(3);
    for (const p of pairs) {
      const head = p.slice(0, 2000);
      expect(head).toContain('may_edit_draw_schedule');
      expect(head).toContain('auth_tenant_ids()');
      expect(head).toContain('is_tenant_admin(tenant_id)');
      // the flag never stands alone as the whole predicate
      expect(head).not.toMatch(/using\s*\(\s*--\s*exists \(select 1 from public\.profiles/i);
    }
  });

  it('★★★ bp_can_edit_draw_schedule KEEPS its service_role branch first', () => {
    // ★ The scraper runs as service_role and has no profiles row. If the new
    //   disjunct had replaced rather than joined the existing ones, every
    //   scraper write to the draw schedule would have started failing.
    const fn = sql().slice(
      sql().indexOf('create or replace function public.bp_can_edit_draw_schedule'),
    );
    const body = fn.slice(0, fn.indexOf('$function$;') + 11);
    expect(body).toContain("auth.role() = 'service_role'");
    expect(body).toContain('public.is_admin()');
    expect(body).toContain('tenant_memberships');
    expect(body).toContain('may_edit_draw_schedule');
    expect(body.indexOf("service_role")).toBeLessThan(
      body.indexOf('may_edit_draw_schedule'),
    );
  });

  it('★★ bp_assert_draw_schedule_admin still DELEGATES — the 10 RPCs inherit it', () => {
    const fn = sql().slice(
      sql().indexOf('create or replace function public.bp_assert_draw_schedule_admin'),
    );
    expect(fn).toContain('bp_can_edit_draw_schedule()');
    expect(fn).toContain("ERRCODE = '42501'");
    // ★ …and its message no longer says "admins", because it is no longer true.
    expect(fn).not.toContain('restricted to admins');
  });

  it('★★★ an assertion proves the grant landed on EXACTLY the right people', () => {
    // ★ A grant that hits 0 rows and one that hits 37 both look like success.
    const s = sql();
    expect(s).toContain('expected 2 holders');
    expect(s).toContain('expected only Shire');
    expect(s).toContain('cameron@blueprintcap.com');
  });

  it('★★★ an assertion catches "four of five" — a policy left on the old definition', () => {
    const s = sql();
    expect(s).toContain('does not carry the grant');
    expect(s).toContain('lost its tenant check');
    expect(s).toContain('expected 3 write policies');
  });

  it('★★ the neighbours are asserted unbroken — the tenant SELECT policies survive', () => {
    // fix-545's rule: assert what your change BROKE, not only what it landed.
    const s = sql();
    expect(s).toContain('draw_schedule_tenant_select');
    expect(s).toContain('a tenant SELECT policy went missing');
  });

  it('★★★ DELETE is untouched — fix-549 §D intact, and proved WITH both flags', () => {
    const s = sql();
    expect(s).toContain('bp_delete_project_row');
    expect(s).toContain('lost its explicit 42501');
    expect(s).toContain('only an admin can delete a project');
  });

  it('★★ the unprovable case is stated, not reported green', () => {
    const s = sql();
    expect(s).toMatch(/CROSS-TENANT CASE COULD NOT BE PROVED/i);
    expect(s).toContain('ONE tenant');
  });
});

describe('fix-567 §D — the screen ASKS the server, it does not re-derive', () => {
  it('★★★ the draw-schedule hook calls bp_can_edit_draw_schedule', () => {
    const src = code(read('hooks/useCanEditDrawSchedule.ts'));
    expect(src).toContain("supabase.rpc('bp_can_edit_draw_schedule')");
  });

  it('★★★ it FAILS CLOSED — an error and an in-flight query both read “no”', () => {
    const src = code(read('hooks/useCanEditDrawSchedule.ts'));
    expect(src).toContain('if (error) return false;');
    // `data === true` (never a truthiness test) is what makes undefined — the
    // in-flight value — read as no.
    expect(src).toContain('return q.data === true;');
  });

  it('★★★ the grid no longer re-derives the rule from the admin flag', () => {
    // ★★★ THE DEFECT THIS CLOSES: `canEdit = useIsTenantAdmin()` was a second
    //     statement of the rule in TypeScript. The first person to hold the new
    //     grant — Shire — would have been granted the capability and still met
    //     a read-only board.
    const src = code(read('components/DrawScheduleGrid.tsx'));
    expect(src).toContain('const canEdit = useCanEditDrawSchedule();');
    expect(src).not.toContain('useIsTenantAdmin');
  });

  it('★★★ the project DATE fields ask too — through the one shared commit hook', () => {
    // ★ fix-549 §B reached the five Project Data editors; the dates and the
    //   address commit through `useProjectFieldCommit` instead, which is why
    //   the ask belongs there rather than at fourteen `disabled=` sites.
    const src = code(read('hooks/useProjectFieldCommit.ts'));
    expect(src).toContain('useMayWriteProject(project.id)');
    expect(src).toContain('const occMissing = !project.updated_at || !mayWrite;');
  });

  it('★★ every field on that form is gated by the value the server decided', () => {
    // ★ The 14 call sites read `occMissing`, whose meaning ("this control
    //   cannot write") is unchanged — which is why none of them needed editing.
    const src = code(read('components/ProjectDetail/ProjectDetailsForm.tsx'));
    const gated = src.match(/disabled=\{occMissing\}/g) ?? [];
    expect(gated.length).toBeGreaterThanOrEqual(14);
  });
});
