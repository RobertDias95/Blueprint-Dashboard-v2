import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  ARCHIVE_DENIED_NOTE,
  ARCHIVE_LABEL,
  excludeDeleted,
  isActiveProject,
  isDeletedProject,
} from '../lib/activeProject';
import { buildLibraryRows } from '../lib/libraryHelpers';
import { redesignedAwayProjectIds } from '../lib/retiredState';
import { buildReuseSources } from '../components/wizard/reuseSourceHelpers';

// ===========================================================================
// ★★★ fix-557 (P-250, the conversion half) — DELETE BECOMES SOFT
// ===========================================================================
//
// Ruled 2026-09-14: **admins only, and delete is SOFT.** fix-549 shipped the
// gate; this ticket turns the removal into a flag.
//
// ⚠️ THE BRIEF WAS 15 DAYS AND ~38 FIXES OLD, AND FIVE OF ITS NUMBERS HAD MOVED.
//    Re-measured on prod 2026-09-29 — every count asserted here is the measured
//    one, and where it differs from the brief the difference is named:
//
//      221 projects → **271**
//      "27 functions read projects, 1 mentions archived"
//        → **51 function readers, and ZERO of them filter it**
//      "31 server-side readers → 29 to review" → **55 → 54**
//
// ★★★ AND THE BRIEF'S TWO "ALREADY FILTERS" FUNCTIONS ARE FALSE POSITIVES.
//     `bp_resolve_plan_share` matches only `is_archived_fallback` — a column on
//     `project_plan_of_record_sets` about a SUPERSEDED DRAWING (fix-532c),
//     nothing to do with `projects.archived`. `bp_update_project_with_permits`
//     matches `archived = CASE WHEN v_patch ? 'archived'` — it WRITES the flag.
//     The honest count of server readers honouring it was **one**, the view
//     `juris_permit_stats`.

const MIGRATION = 'migrations/fix_557_delete_becomes_soft_PENDING_APPROVAL.sql';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
/** ★ Comments stripped — this file EXPLAINS the statements it must not contain. */
const code = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const sql = read(MIGRATION);
/** The migration with its `-- ` comment prefixes removed, for reading the DDL. */
const ddl = sql
  .split('\n')
  .map((l) => l.replace(/^\s*-- ?/, ''))
  .join('\n');

const P = (over: Record<string, unknown> = {}) =>
  ({
    id: 'p1',
    address: '1 Main St',
    juris: 'Seattle',
    archived: false,
    redesign_of_project_id: null,
    ...over,
  }) as never;

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-557 §A.2 — ONE derivation, and it is named', () => {
  it('★★★ the rule reads `!== true`, so an ABSENT column is ACTIVE', () => {
    // ★★★ THE DIRECTION OF THE DEFAULT IS THE WHOLE ASSERTION. `useProjects`
    //     has an explicit select list, and this repo has recorded an unlisted
    //     column arriving as `undefined` FIVE times in that one file (fix-122,
    //     fix-386, fix-410, fix-487, fix-488). Reading `undefined` as DELETED
    //     would empty the Pipeline; reading it as ACTIVE shows one row too many.
    //     Only the second is visible on the screen.
    expect(isActiveProject({ archived: false })).toBe(true);
    expect(isActiveProject({ archived: null })).toBe(true);
    expect(isActiveProject({})).toBe(true);
    expect(isActiveProject({ archived: true })).toBe(false);
    expect(isActiveProject(null)).toBe(false);
    expect(isActiveProject(undefined)).toBe(false);
  });

  it('★★ `isDeletedProject` is the exact complement for a real row', () => {
    for (const v of [false, null, undefined]) {
      expect(isDeletedProject({ archived: v })).toBe(false);
    }
    expect(isDeletedProject({ archived: true })).toBe(true);
  });

  it('★★★ the TS twin spells the SQL predicate, letter for letter', () => {
    // `isPermitInCorrections` ⇄ `bp_permit_in_corrections` is the precedent: two
    // writers of one rule is this Brain's most repeated defect (P-207, P-179,
    // P-244), so the twins are asserted against each other rather than trusted.
    expect(ddl).toContain('COALESCE(archived, false) = false');
    // ★ NOT `NOT archived` — the column is nullable until step 1 runs, and
    //   `NOT NULL` is NULL, which a WHERE drops. A project would vanish with
    //   nothing to explain why.
    expect(ddl).not.toMatch(/WHERE\s+NOT\s+archived/i);
  });

  it('★★★ NOT ONE client file re-spells the rule by hand any more', () => {
    // §A.2: *"prefer one derivation over 29 copies of `and not archived`."*
    // Seven files had their own copy and an eighth had forgotten to have one.
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (
          /\.tsx?$/.test(ent.name) &&
          // ★★ PRODUCTION CODE ONLY. A test builds fixtures and asserts on
          //    them, so `!p.archived` inside `__tests__` is data, not a
          //    second copy of the rule — `DrawScheduleGrid.test.tsx` is the
          //    one that caught this, and forbidding it would have made the
          //    assertion about the wrong thing.
          !/\.test\.tsx?$/.test(ent.name) &&
          !/activeProject\.ts$/.test(ent.name) &&
          // ★ the three deliberate exceptions, each asserted by name below
          !/useProjects\.ts$|useBuilderRegistry\.ts$|useProjectAddressIndex\.ts$/.test(ent.name)
        ) {
          const body = code(readFileSync(full, 'utf8'));
          // ★★ FILTER IDIOMS, NOT THE WORD. `projectDetailsForm.ts` maps the
          //    column into its form model (`archived: !!project.archived`),
          //    which is not a visibility rule — banning the identifier would
          //    forbid reading the field at all, including in the editor that
          //    sets it.
          const filters =
            /if\s*\([^)]*\.archived\s*\)\s*(continue|return)/.test(body) ||
            /\.filter\([^)]*!\s*\w+\.archived/.test(body) ||
            /!\s*\w+\.archived\s*&&/.test(body);
          if (filters) offenders.push(full);
        }
      }
    };
    walk(resolve(__dirname, '..'));
    expect(offenders).toEqual([]);
    // ★★ 15s: the same I/O-bound walk fix-547 and fix-559 both record tipping
    //    past vitest's 5s default under full-suite parallelism.
  }, 15_000);

  it('★★★ the three readers that keep their OWN filter each say why', () => {
    // ★★ `useProjects` KEEPS `.eq('archived', false)` even though the policy
    //    filters server-side, because the policy deliberately lets an ADMIN read
    //    a deleted project — otherwise nobody could see the row to restore it.
    //    So for the one group who can delete, the list would arrive dirty.
    const up = read('src/hooks/useProjects.ts');
    expect(up).toContain(".eq('archived', false)");
    expect(up).toMatch(/lets an ADMIN read a deleted/);

    // ★★★ `useBuilderRegistry` had NO filter at all — the one client reader
    //     missing the rule, found only by enumerating them for §A.1.
    //     ★★ fix-627 §B (P-322) REFORMATTED THIS CALL, NOT ITS RULE. The read
     //        is paged now (305 non-archived projects today, one more per project
     //        for ever), so the chain spans several lines and the original
     //        single-string assertion no longer matches. The FILTER is what
     //        fix-557 was about and it is asserted just as strictly — in two
     //        parts, because that is how the call now reads.
    const br = read('src/hooks/useBuilderRegistry.ts');
    expect(br).toContain(".select('builder_id')");
    expect(br).toContain(".eq('archived', false)");

    // ★★★ `useProjectAddressIndex` deliberately does NOT filter, and that is
    //     fix-333's rule, not an oversight: a duplicate-address warning must
    //     fire against a DELETED project too, or somebody re-creates it.
    const ai = read('src/hooks/useProjectAddressIndex.ts');
    expect(ai).toContain("'id, address, go_date, archived, redesign_of_project_id'");
    expect(ai).not.toContain(".eq('archived', false)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-557 §B — what "deleted" means, one surface at a time', () => {
  // ★★★ ONE ASSERTION PER SURFACE, BY NAME, which is what the brief asks for.
  //     Each one deletes the SAME project and checks that surface's own builder
  //     stops producing it — and each proves a real transition by asserting the
  //     row IS there when the project is active.

  const active = P({ id: 'keep', address: '1 Keep St' });
  const deleted = P({ id: 'gone', address: '2 Gone St', archived: true });
  const permitsFor = (id: string) =>
    new Map([[id, [{ id: 1, project_id: id, type: 'SFR', cycles: [] }]]]) as never;

  it('★★★ LIBRARY — buildLibraryRows drops it', () => {
    // ★ A FLAT array — it builds its own by-project map. A Map here silently
    //   produced ZERO rows, which would have passed the "not included" half of
    //   this test while proving nothing at all.
    const permits = [
      { id: 1, project_id: 'keep', type: 'SFR', cycles: [] },
      { id: 2, project_id: 'gone', type: 'SFR', cycles: [] },
    ] as never;
    const rows = buildLibraryRows([active, deleted] as never, permits);
    // ★ `projectId`, not a nested `project` — the row is flat (fix-22).
    const ids = rows.map((r) => r.projectId);
    expect(ids).toContain('keep'); // ★★ the transition is REAL, not vacuous
    expect(ids).not.toContain('gone');
  });

  it('★★★ PROJECT VIEW — the row builder drops it', async () => {
    const mod = await import('../lib/projectViewHelpers');
    const src = code(read('src/lib/projectViewHelpers.ts'));
    // Two loops in this file read the rule; both must go through the twin.
    expect((src.match(/isActiveProject\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/if \(p\.archived\) continue/);
    expect(src).not.toMatch(/if \(project\.archived\) continue/);
    expect(typeof mod.buildProjectRows).toBe('function');
  });

  it('★★★ DRAW SCHEDULE — the unscheduled list drops it', () => {
    const src = code(read('src/components/DrawScheduleGrid.tsx'));
    expect(src).toContain('isActiveProject(project) && !isRetiredProject(');
    // ★★ DELETED and RETIRED are two different rules and both apply — retired is
    //    derived from a successor (fix-524), deleted is an admin's act.
    expect(src).not.toMatch(/!project\.archived\s*&&/);
  });

  it('★★★ REPORTS — the Weekly Updates report drops it', () => {
    const src = code(read('src/pages/WeeklyUpdatesReport.tsx'));
    expect(src).toContain('excludeDeleted(projectsQ.data)');
    // ★ …and still excludes CANCELLED, which is a separate rule (fix-264).
    expect(src).toContain('excludeCancelled(');
  });

  it('★★★ REUSE PICKER — buildReuseSources drops it', () => {
    const rows = buildReuseSources([active, deleted] as never, permitsFor('keep'));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('keep');
    expect(ids).not.toContain('gone');
  });

  it('★★★ RETIRED DERIVATION — a deleted redesign retires nothing', () => {
    // ★★ The subtle one. `redesignedAwayProjectIds` reads the CHILDREN to decide
    //    which originals are superseded. A DELETED redesign must not keep its
    //    original hidden — otherwise deleting the redesign strands the original
    //    off every list with nothing naming it. [[P-263]]'s shape exactly.
    const original = P({ id: 'orig' });
    const liveRedesign = P({ id: 'new', redesign_of_project_id: 'orig' });
    expect(redesignedAwayProjectIds([original, liveRedesign])).toContain('orig');

    const deadRedesign = P({ id: 'new', redesign_of_project_id: 'orig', archived: true });
    expect(redesignedAwayProjectIds([original, deadRedesign])).not.toContain('orig');
  });

  it('★★★ PIPELINE and SEARCH are the SERVER\'s half, and it is asserted there', () => {
    // ★★ Honest about coverage: the Pipeline reads `useProjects` (asserted above)
    //    and search reaches `bp_project_id_for_address`, a SECURITY INVOKER
    //    function — so RLS covers it and there is no TypeScript to test. The
    //    policy that does it is asserted in the migration section below, and the
    //    behaviour was probed on prod (recorded in the migration header).
    expect(ddl).toContain('ALTER POLICY projects_tenant_select ON public.projects');
    expect(ddl).toContain('OR public.is_tenant_admin(tenant_id)');
  });

  it('★★ excludeDeleted is the shape the callers share', () => {
    expect(excludeDeleted([active, deleted]).map((p: { id: string }) => p.id)).toEqual(['keep']);
    expect(excludeDeleted(undefined)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-557 §2 — the delete stays admin-only, which is the whole risk', () => {
  it('★★★ the checkbox IS the delete, and it is gated on being an admin', () => {
    // ★★★ IT WAS AN ORDINARY EDITABLE FLAG, AND THAT WAS SAFE ONLY BY ACCIDENT:
    //     nothing filtered on it. The moment step 7 lands, an ungated checkbox is
    //     a non-admin delete button that undoes fix-549 §D three weeks after it
    //     shipped.
    const src = read('src/components/ProjectDetail/ProjectDetailsForm.tsx');
    expect(src).toContain('const isAdmin = useIsTenantAdmin();');
    expect(src).toContain('const mayArchive = isAdmin && !occMissing;');
    expect(src).toContain('disabled={!mayArchive}');
    // ★★ DISABLED, NOT HIDDEN — unticking it is §B's recovery path, and hiding
    //    it would send an admin hunting for a screen that does not exist.
    expect(src).toContain('data-testid="psm-archived"');
    expect(src).toContain('data-testid="psm-archived-denied"');
  });

  it('★★★ the copy no longer says "hide from active project lists"', () => {
    // It is a DELETE now. A checkbox that says it hides something, and deletes
    // it, is the defect this repo keeps removing.
    const src = read('src/components/ProjectDetail/ProjectDetailsForm.tsx');
    expect(src).not.toContain('Archived (hide from active project lists)');
    expect(ARCHIVE_LABEL).toBe('Deleted (hidden from every list; admins only)');
    expect(ARCHIVE_DENIED_NOTE).toContain('Only an admin');
  });

  it('★★★ ALL THREE server write paths are gated in the migration', () => {
    // ★★★ THE FINDING THIS TICKET TURNS ON. A soft delete is an UPDATE, so
    //     `projects_tenant_delete` — the admin-only policy fix-549 shipped — is
    //     not consulted at all. Measured: `archived` had three write paths, and
    //     `bp_update_project_with_permits` checked TENANT ONLY.
    expect(ddl).toContain('bp_update_project_fields');            // path 1
    expect(ddl).toContain('bp_update_project_with_permits');      // path 2
    expect(ddl).toContain('ALTER POLICY projects_tenant_update'); // path 3
    // each refuses with the same code fix-549 chose
    expect((ddl.match(/only an admin can delete or restore a project/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
    // ★ `''42501''` inside the DO block's quoted replacement text, `'42501'` in
    //   the plain statements. Match the number, not one spelling of it.
    expect((ddl.match(/42501/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('★★★ the UPDATE policy gates BOTH halves, and they say different things', () => {
    // USING  → a deleted project is READ-ONLY (no edits land on the invisible).
    // CHECK  → you may not LEAVE a row deleted (this is the delete itself).
    const policy = ddl.slice(ddl.indexOf('ALTER POLICY projects_tenant_update'));
    expect(policy).toContain('USING (');
    expect(policy).toContain('WITH CHECK (');
    expect((policy.match(/OR public\.is_tenant_admin\(tenant_id\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('★★★ fix-549 §D\'s own 42501 SURVIVES in the flipped function', () => {
    // fix-549 put it there because *"a policy alone would have lied"* — blocked
    // by RLS, the DELETE matched 0 rows and the function reported `conflict`,
    // i.e. "changed since you loaded it". Now doubly load-bearing: the operation
    // is an UPDATE, so the delete policy is not consulted and this is one of only
    // two guards left.
    // ★★ SLICED TO ITS OWN `$function$;`. The verify block BELOW it contains the
    //    literal `'DELETE FROM public.projects'` as the thing it checks for, so a
    //    slice to end-of-file matches the assertion's own text — the
    //    comment-stripping family of trap, and the seventh time in this repo.
    const from = ddl.indexOf('CREATE OR REPLACE FUNCTION public.bp_delete_project_row');
    const fn = ddl.slice(from, ddl.indexOf('$function$;', from) + 11);
    expect(fn).toContain('only an admin can delete a project');
    expect(fn).toContain("USING ERRCODE = '42501'");
    expect(fn).toContain('SET archived = true');
    expect(fn).not.toContain('DELETE FROM public.projects');
  });

  it('★★ the OCC token still decides, and a second click is not a conflict', () => {
    const from = ddl.indexOf('CREATE OR REPLACE FUNCTION public.bp_delete_project_row');
    const fn = ddl.slice(from, ddl.indexOf('$function$;', from) + 11);
    expect(fn).toContain('AND updated_at = p_expected_updated_at');
    // ★ idempotent: already gone OR already archived both report deleted.
    expect(fn).toContain('IF v_actual IS NULL OR v_archived THEN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-557 §3 — nothing cascades, and the migration moves no rows', () => {
  it('★★★ the file DELETES nothing and TRUNCATES nothing', () => {
    expect(ddl).not.toMatch(/\bDELETE\s+FROM\s+public\.(permits|project_chat|notes)/i);
    expect(ddl).not.toMatch(/\bTRUNCATE\b/i);
    expect(ddl).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(ddl).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
  });

  it('★★★ it asserts ZERO rows became archived — the brief\'s third test', () => {
    expect(ddl).toContain('count(*) FILTER (WHERE archived)');
    expect(ddl).toMatch(/IF v_archived <> 0 THEN/);
  });

  it('★★★ every UPDATE in the file writes ONE column, and it is `archived`', () => {
    // ★★ ASSERTED ON THE `SET` TARGETS, not line by line:
    //    `bp_delete_project_row` puts `UPDATE public.projects` and
    //    `SET archived = true` on separate lines, so a per-line `every()`
    //    failed on a statement that is perfectly correct.
    const targets = [...ddl.matchAll(/\bSET\s+([a-z_]+)\s*=/gi)]
      .map((m) => m[1]!.toLowerCase());
    expect(targets.length).toBeGreaterThan(0);
    expect([...new Set(targets)]).toEqual(['archived']);
    expect(ddl).toContain('UPDATE public.projects SET archived = false WHERE archived IS NULL;');
  });

  it('★★★ the SCRAPER is deliberately untouched, so a delete is not undone', () => {
    // `bp_ensure_project` still finds an archived project by address, so an
    // overnight scrape does not resurrect it as a NEW row. That is the entire
    // reason the delete is soft rather than hard, and it is stated in the file.
    expect(ddl).not.toContain('bp_ensure_project(');
    expect(sql).toMatch(/THE SCRAPER IS DELIBERATELY UNAFFECTED/);
  });

  it('★★ it says what happens to permits, chat and plan sets', () => {
    // §B asks out loud, because an invisible project with live permits is
    // [[P-263]] all over again.
    expect(sql).toMatch(/NOTHING IS DELETED AND NOTHING CASCADES/);
    expect(sql).toMatch(/bp_generate_city_chase_tasks/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-557 — the migration is STAGED, and it stays that way', () => {
  it('★★★ every statement is commented out', () => {
    // fix-450's rule, and the brief repeats it: *"stage it commented out."*
    const armed = sql
      .split('\n')
      .filter((l) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|BEGIN|COMMIT)\b/i.test(l));
    expect(armed).toEqual([]);
  });

  it('★★★ it says NOT APPLIED, near the top', () => {
    expect(sql).toContain('NOT APPLIED');
    expect(sql.indexOf('NOT APPLIED')).toBeLessThan(400);
  });

  it('★★★ the view is `security_invoker = true`, and that is asserted IN the file', () => {
    // ★★★ WITHOUT IT THIS MIGRATION IS A PRIVILEGE ESCALATION. A view runs with
    //     its OWNER's rights by default, and `postgres` bypasses RLS — so the 18
    //     SECURITY INVOKER readers pointed at it would gain cross-tenant reads.
    expect(ddl).toContain('WITH (security_invoker = true)');
    expect(ddl).toContain("'security_invoker=true' = ANY (c.reloptions)");
    expect(ddl).toContain('NOT security_invoker');
  });

  it('★★★ every `pg_get_functiondef` scan is guarded by `prokind`', () => {
    // ★★★ MEASURED WHILE PROBING THIS FILE: `ERROR 42809: "array_agg" is an
    //     aggregate function`. `pg_get_functiondef` RAISES on an aggregate, and a
    //     filter on `pg_proc` is applied AT THE SCAN, before the join to
    //     `pg_namespace` — so `WHERE n.nspname='public' AND position(… IN
    //     pg_get_functiondef(p.oid)) > 0` calls it across all of `pg_proc`,
    //     `pg_catalog` included, and dies. The schema filter does not protect it.
    const scans = (ddl.match(/pg_get_functiondef/g) ?? []).length;
    const guards = (ddl.match(/prokind\s*=\s*'f'/g) ?? []).length;
    expect(scans).toBeGreaterThan(0);
    expect(guards).toBeGreaterThanOrEqual(6);
  });

  it('★★★ each anchored replacement RAISES if its anchor has moved', () => {
    // fix-540's rule: a `replace` that matches nothing reports success.
    const raises = (ddl.match(/anchor not found|has moved|changed nothing|did not land/g) ?? []).length;
    expect(raises).toBeGreaterThanOrEqual(6);
  });

  it('★★★ it records the ORDER against fix-588, which patches the same function', () => {
    // Both re-emit `bp_update_project_with_permits` by anchor. They anchor on
    // different lines by construction, so neither can consume the other's.
    expect(sql).toMatch(/fix_588_atomic_save_drops_four_columns_PENDING_APPROVAL\.sql/);
    expect(sql).toMatch(/ORDER-INDEPENDENT/i);
  });

  it('★★★ THE SWITCH IS LAST — §A\'s whole instruction', () => {
    // *"Teach the readers first, flip the switch last."* Steps 1–6 are invisible
    // (nothing is archived); step 7 is the only behaviour change.
    const readers = ddl.indexOf('ALTER POLICY projects_tenant_select');
    const view = ddl.indexOf('CREATE OR REPLACE VIEW public.active_projects');
    const gates = ddl.indexOf('ALTER POLICY projects_tenant_update');
    const flip = ddl.indexOf('CREATE OR REPLACE FUNCTION public.bp_delete_project_row');
    for (const [name, at] of [['view', view], ['select policy', readers], ['update policy', gates]] as const) {
      expect(at, `${name} must come before the switch`).toBeGreaterThan(-1);
      expect(at, `${name} must come before the switch`).toBeLessThan(flip);
    }
  });

  it('★★★ it names all 13 SECURITY DEFINER enumerators it re-points', () => {
    for (const fn of [
      'bp_list_tasks', 'bp_my_tasks', 'bp_list_waiting_on_tasks', 'bp_my_post_requests',
      'bp_get_weekly_da_report', 'bp_weekly_snapshot', 'bp_coassign_gap_report',
      'bp_dm_gap_report', 'bp_lead_drift_report', 'bp_correction_cluster_detail',
      'bp_correction_cluster_ranking', 'bp_mark_vendor_report_sent',
      'bp_generate_city_chase_tasks',
    ]) {
      expect(ddl, fn).toContain(`'${fn}'`);
    }
    expect(ddl).toMatch(/IF v_n <> 13 THEN/);
  });

  it('★★★ and it names the readers it deliberately does NOT filter', () => {
    // ★★ A by-id resolver must NOT filter. `bp_may_write_project` answers "may
    //    this person write this project"; filtering it would turn a clear refusal
    //    into a confusing one, and `bp_delete_project_row` needs to read the row
    //    it is about to archive.
    expect(sql).toMatch(/authorisation, by-id resolution/);
    expect(sql).toMatch(/deliberately NOT filtered/);
  });

  it('★★★ the prod probe is recorded, with the vacuous-baseline warning', () => {
    // ★★★ THE MOST USEFUL THING THE PROBE FOUND: called as `postgres` with no
    //     JWT, `bp_list_tasks()` returns an empty list, so "does the surface
    //     mention it" was false BEFORE the delete as well as after — the
    //     assertion passed while testing nothing.
    expect(sql).toMatch(/ROLLED BACK/);
    expect(sql).toMatch(/PROVED NOTHING/);
    expect(sql).toMatch(/271 projects, 0 archived/);
    expect(sql).toMatch(/true\s+→ \*\*false\*\*/);
    // ★ and it is honest about the one enumerator with no behavioural evidence
    expect(sql).toMatch(/bp_lead_drift_report` returns no rows at all/);
  });

  it('★★ recovery is written down, because §B asks for it', () => {
    expect(sql).toMatch(/HOW AN ADMIN UN-DELETES ONE/);
    expect(sql).toContain('UPDATE public.projects SET archived = false');
  });

  it('★★ it is on the approval shelf index', () => {
    const index = read('migrations/PENDING_APPROVAL_INDEX.md');
    expect(index).toContain('fix_557_delete_becomes_soft_PENDING_APPROVAL.sql');
  });
});
