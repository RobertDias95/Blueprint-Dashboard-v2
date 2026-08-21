import { describe, it, expect } from 'vitest';
import migrationSql from '../../migrations/fix_379_dm_derived.sql?raw';
import mappingRowsSql from '../../migrations/fix_379_mapping_rows_PENDING_APPROVAL.sql?raw';
import backfillSql from '../../migrations/fix_379_backfill_PENDING_APPROVAL.sql?raw';
import fix377Sql from '../../migrations/fix_377_lead_cascade.sql?raw';
import {
  derivePermitDm,
  applyPermitDmDerivation,
} from '../lib/permitDmDerivation';
import { coAssignEffect } from '../lib/dmCoAssign';
import type { DmDaGroupRow } from '../lib/database.types';

/** Assertions about what the SQL DOES must read the code, not the prose. */
const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');

// ===========================================================================
// fix-379 — a design manager sees a permit because their associate is on it
// ===========================================================================
//
// permits.dm IS DERIVED: the manager of the permit's DA via dm_da_groups.
// No DA → no DM. A ULS carries neither. An unmapped DA resolves to nothing
// and is reported, never guessed. fix-377's design_manager → dm project
// cascade is REMOVED (its entitlement half stays).
//
// No live DB in CI (fix-153 pattern): pure-TS mirror in
// src/lib/permitDmDerivation.ts + SQL-text assertions on the migration.
// If the SQL and the mirror disagree, one of them is wrong.
//
// ---------------------------------------------------------------------------
// PROD PROBE — 2026-08-21, project eibnmwthkcuumyclyxoe, ROLLED BACK by
// RAISE EXCEPTION ('PROBE_OK'). One DO block, eleven assertions, all passed:
//
//   INSERT  BP  da Ahmadi, dm Jade sent    → dm Brittani   (snapped)
//   INSERT  ULS da Nicky,  dm Derry sent   → both NULL     (stripped)
//   INSERT  Demo no da,    dm Lindsay sent → dm NULL       (no DA, no DM)
//   INSERT  SDOT Tree da Shire             → dm NULL       (not resolved)
//   INSERT  Demo da Cam,   dm Lindsay sent → dm Lindsay    (unmapped: kept)
//   UPDATE  da Ahmadi → Nicky              → dm Derry      (follows the DA)
//   UPDATE  da Nicky → Cam (dm carried)    → dm NULL       (stale, cleared)
//   UPDATE  da Cam, dm Lindsay (no-op)     → dm Lindsay    (guard: no change)
//   UPDATE  project design_manager         → permit dm untouched (377 half gone)
//   UPDATE  project entitlement_lead       → permit ent_lead moved (377 half kept)
//   DELETE  dm_da_groups row for Nicky     → SQLSTATE P0379 (guard refused);
//           an unreferenced ZZ row deleted fine; the override GUC let the
//           Nicky delete through — then everything rolled back (9 rows kept).
// ---------------------------------------------------------------------------

// The prod mapping as it stands (nine rows, all currently-active DAs).
const ROWS: DmDaGroupRow[] = [
  ['Lindsay', 'Francesca', 1, 1],
  ['Lindsay', 'Ainsley', 1, 2],
  ['Lindsay', 'Trevor', 1, 3],
  ['Derry', 'Nicky', 2, 1],
  ['Derry', 'Qisheng', 2, 3],
  ['Brittani', 'Marc', 3, 1],
  ['Brittani', 'Ahmadi', 3, 2],
  ['Brittani', 'Fisk', 3, 3],
  ['Jade', 'Erick', 4, 2],
].map(([dm, da, dmo, dao], i) => ({
  id: `g-${i}`,
  dm_name: dm as string,
  da_name: da as string,
  dm_order: dmo as number,
  da_order: dao as number,
  updated_at: '2026-08-21T00:00:00Z',
}));

// The three PENDING rows (fix_379_mapping_rows_PENDING_APPROVAL.sql) — the
// departed associates whose mapping outlives them.
const PENDING: DmDaGroupRow[] = [
  ['Jade', 'Alex', 4, 1],
  ['Jade', 'Nidhi', 4, 3],
  ['Gena', 'George', 5, 1],
].map(([dm, da, dmo, dao], i) => ({
  id: `p-${i}`,
  dm_name: dm as string,
  da_name: da as string,
  dm_order: dmo as number,
  da_order: dao as number,
  updated_at: '2026-08-21T00:00:00Z',
}));

const ALL = [...ROWS, ...PENDING];

// ---------------------------------------------------------------------------
describe('fix-379 §1 — the derivation: dm is whoever manages the DA', () => {
  it('★★★ a permit with a DA resolves to that DA\'s manager — from the real rows', () => {
    expect(derivePermitDm('Building Permit', 'Ahmadi', ROWS)).toEqual({
      dm: 'Brittani',
      determinate: true,
    });
    expect(derivePermitDm('Demolition', 'Nicky', ROWS)).toEqual({
      dm: 'Derry',
      determinate: true,
    });
  });

  it('★★★ a permit with NO DA resolves to NO DM — a manager overseeing nobody', () => {
    expect(derivePermitDm('Building Permit', null, ROWS)).toEqual({
      dm: null,
      determinate: true,
    });
    expect(derivePermitDm('IPR', '   ', ROWS)).toEqual({ dm: null, determinate: true });
    // The 12-permit clear class: dm set, da empty → the write comes out clean.
    expect(
      applyPermitDmDerivation({
        op: 'update', type: 'IPR', da: null, dm: 'Lindsay',
        prevDa: null, prevDm: 'Lindsay', rows: ROWS,
      }),
    ).toEqual({ da: null, dm: null });
  });

  it('★ matches the way bp_dm_for_da matches: trimmed and case-folded', () => {
    expect(derivePermitDm('Building Permit', '  nicky ', ROWS).dm).toBe('Derry');
  });

  it('★ dm cannot be stored against the derivation — the write is snapped', () => {
    // A writer tries dm = Jade on Ahmadi's permit; Brittani is the answer.
    expect(
      applyPermitDmDerivation({
        op: 'update', type: 'Building Permit', da: 'Ahmadi', dm: 'Jade',
        prevDa: 'Ahmadi', prevDm: 'Brittani', rows: ROWS,
      }).dm,
    ).toBe('Brittani');
    // And on INSERT the same rule holds — the wizard cannot seed a wrong dm.
    expect(
      applyPermitDmDerivation({
        op: 'insert', type: 'Building Permit', da: 'Erick', dm: 'Derry', rows: ROWS,
      }).dm,
    ).toBe('Jade');
  });
});

// ---------------------------------------------------------------------------
describe('fix-379 §2 — ULS carries neither, whatever the project says', () => {
  it('★★★ a ULS permit is stripped of BOTH dm and da', () => {
    expect(
      applyPermitDmDerivation({
        op: 'update', type: 'ULS', da: 'Marc', dm: 'Jade',
        prevDa: 'Marc', prevDm: 'Jade', rows: ROWS,
      }),
    ).toEqual({ da: null, dm: null });
    expect(
      applyPermitDmDerivation({ op: 'insert', type: 'ULS', da: 'Nicky', dm: null, rows: ROWS }),
    ).toEqual({ da: null, dm: null });
  });

  it('★★ a NO-OP write does not strip a pre-backfill violation — the rule acts on a CHANGE', () => {
    // "UPDATE OF da, dm, type" fires even when the SET values are identical
    // (a scraper upsert, a bulk save). Without the guard, those writes would
    // silently apply the pending backfill to the rows they touch — a data
    // change nobody approved. fix-346's guard, for a new reason.
    expect(
      applyPermitDmDerivation({
        op: 'update', type: 'ULS', prevType: 'ULS',
        da: 'Marc', prevDa: 'Marc', dm: 'Jade', prevDm: 'Jade', rows: ROWS,
      }),
    ).toEqual({ da: 'Marc', dm: 'Jade' });
    expect(sqlCode).toMatch(/NEW\.da\s+IS NOT DISTINCT FROM OLD\.da/);
    expect(sqlCode).toMatch(/NEW\.type IS NOT DISTINCT FROM OLD\.type/);
  });

  it('★★ the derivation never reads the project at all — no fallback to design_manager', () => {
    // "whatever the project says" is enforced structurally: neither the
    // derivation function nor the trigger joins projects.
    const triggerHalf = sqlCode.slice(
      sqlCode.indexOf('bp_derived_dm_for_permit'),
      sqlCode.indexOf('bp_trg_dm_da_group_guard'),
    );
    expect(triggerHalf).not.toMatch(/design_manager/);
    expect(triggerHalf).not.toMatch(/JOIN\s+public\.projects/i);
  });

  it('★ ULS is the ONE excluded type — not the NO_ISSUANCE set', () => {
    // SDOT Tree / PAR/Pre-Sub / ECA Waiver must NOT be swept in: Shire runs
    // the SDOT Trees and Bobby runs PAR/Pre-Sub intake himself.
    expect(sqlCode).not.toMatch(/SDOT|PAR|ECA/);
    expect(derivePermitDm('SDOT Tree', 'Shire', ROWS).determinate).toBe(false);
    expect(derivePermitDm('PAR/Pre-Sub', 'Cam', ROWS).determinate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('fix-379 §3 — the deliberate exceptions: Cam and Shire', () => {
  it("★★★ Shire's SDOT Tree permits do NOT acquire a DM — the naive rule breaks here", () => {
    const out = applyPermitDmDerivation({
      op: 'update', type: 'SDOT Tree', da: 'Shire', dm: null,
      prevDa: 'Shire', prevDm: null, rows: ROWS,
    });
    expect(out.dm).toBeNull();
    expect(out.da).toBe('Shire');
  });

  it('★ an unmapped DA resolves to nothing and is REPORTED, not guessed', () => {
    expect(derivePermitDm('Demolition', 'Cam', ROWS)).toEqual({
      dm: null,
      determinate: false,
    });
    // The report surface ships in the migration, keyed on the same lookup,
    // ULS excluded (a ULS with a DA is a violation, not a gap).
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.bp_dm_gap_report()');
    expect(sqlCode).toMatch(/bp_dm_for_da\(p\.da, p\.tenant_id\) IS NULL/);
    expect(sqlCode).toMatch(/p\.type IS DISTINCT FROM 'ULS'/);
  });

  it("★ Cam's human-set managers survive — an unmapped DA's dm stays a person's call", () => {
    // 20 of Cam's permits carry a dm somebody chose (mostly the project's
    // manager). An unrelated write must not clear them.
    expect(
      applyPermitDmDerivation({
        op: 'update', type: 'Demolition', da: 'Cam', dm: 'Lindsay',
        prevDa: 'Cam', prevDm: 'Lindsay', rows: ROWS,
      }).dm,
    ).toBe('Lindsay');
  });

  it('★★ a hand-off FROM a mapped DA clears the stale manager; a plain rename keeps it', () => {
    // Nicky → Cam: Derry rode along and is now nobody's answer.
    expect(
      applyPermitDmDerivation({
        op: 'update', type: 'Building Permit', da: 'Cam', dm: 'Derry',
        prevDa: 'Nicky', prevDm: 'Derry', rows: ROWS,
      }).dm,
    ).toBeNull();
    // bp_rename_da rewriting Cam → Cameron changes da with dm untouched —
    // Cam's manager was never derived, so nothing is stale. Kept.
    expect(
      applyPermitDmDerivation({
        op: 'update', type: 'Building Permit', da: 'Cameron', dm: 'Lindsay',
        prevDa: 'Cam', prevDm: 'Lindsay', rows: ROWS,
      }).dm,
    ).toBe('Lindsay');
    // And a write that sets dm EXPLICITLY alongside the da change keeps it
    // (bp_move_draw_schedule_da sends both).
    expect(
      applyPermitDmDerivation({
        op: 'update', type: 'Building Permit', da: 'Cam', dm: 'Brittani',
        prevDa: 'Nicky', prevDm: 'Derry', rows: ROWS,
      }).dm,
    ).toBe('Brittani');
  });

  it("★★★ Cam's TASKS still reach a manager via fix-368's project fallback — untouched", () => {
    // The fallback lives on permit_tasks/permit_task_assignees, not on
    // permits.dm. Assert the behaviour still stands…
    const eff = coAssignEffect({
      op: 'insert',
      nextAssignee: 'Cam',
      rows: ROWS,
      projectDm: 'Jade',
      isActiveDa: (n) => n === 'Cam',
    });
    expect(eff.add).toBe('Jade');
    expect(eff.addSource).toBe('dm_of_project');
    // …and that fix-379 does not redefine any of fix-368's machinery.
    for (const fn of [
      'bp_coassign_for_task',
      'bp_trg_task_coassign_dm',
      'bp_trg_project_dm_coassign',
      'bp_is_unmapped_active_da',
      'bp_project_dm_for_permit',
    ]) {
      expect(sqlCode).not.toContain(`FUNCTION public.${fn}`);
    }
  });

  it('★ no dm_da_groups row is added for Cam or Shire', () => {
    expect(mappingRowsSql).not.toMatch(/'Cam'|'Shire'/);
  });
});

// ---------------------------------------------------------------------------
describe('fix-379 §4 — the mapping outlives the person', () => {
  it('★★ a departed DA with a mapping row still resolves — Alex → Jade', () => {
    // derivePermitDm consults ONLY the mapping, never team_members.active —
    // that flag means "no new work", not "history stops resolving".
    expect(derivePermitDm('Building Permit', 'Alex', ALL)).toEqual({
      dm: 'Jade',
      determinate: true,
    });
    expect(derivePermitDm('Building Permit', 'Nidhi', ALL).dm).toBe('Jade');
    expect(derivePermitDm('Building Permit', 'George', ALL).dm).toBe('Gena');
  });

  it("★★★ without the pending rows the departed DAs resolve to nothing — why §5(a) gates §5(b)", () => {
    expect(derivePermitDm('Building Permit', 'Alex', ROWS).determinate).toBe(false);
    expect(derivePermitDm('Building Permit', 'Nidhi', ROWS).determinate).toBe(false);
  });

  it('★★ the guard is a MECHANISM, not a comment: BEFORE DELETE, refusing while permits reference the DA', () => {
    expect(migrationSql).toMatch(
      /CREATE TRIGGER dm_da_groups_guard_departed\s+BEFORE DELETE ON public\.dm_da_groups/,
    );
    expect(sqlCode).toMatch(/RAISE EXCEPTION/);
    // Counts ALL permits — issued included — which is what makes the
    // protection permanent: issued permits keep their DA forever.
    const guard = sqlCode.slice(
      sqlCode.indexOf('bp_trg_dm_da_group_guard'),
      sqlCode.indexOf('bp_replace_app_config_and_roster'),
    );
    expect(guard).not.toMatch(/actual_issue/);
    // A deliberate removal stays possible, but must be typed on purpose.
    expect(sqlCode).toContain("current_setting('app.bp_allow_dm_da_group_delete', true)");
  });

  it('★★ the config import RETAINS protected rows instead of recreating the fix-346 §3 hole', () => {
    // bp_replace_app_config_and_roster's reconciling DELETE gets the same
    // permit-reference carve-out, so importing a roster JSON that omits a
    // departed DA keeps the mapping silently.
    const replaceFn = sqlCode.slice(sqlCode.indexOf('bp_replace_app_config_and_roster'));
    const del = replaceFn.slice(replaceFn.indexOf('delete from public.dm_da_groups'));
    expect(del.slice(0, del.indexOf(';'))).toMatch(
      /not exists \(\s*select 1 from public\.permits/,
    );
  });

  it('★ the trigger sorts after permits_default_tenant, so the tenant is set before the lookup', () => {
    expect('permits_default_tenant' < 'permits_derive_dm').toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('fix-379 §5 — fix-377, minus its design half', () => {
  it("★★ the projects trigger now watches entitlement_lead ONLY", () => {
    expect(migrationSql).toMatch(
      /CREATE TRIGGER projects_cascade_lead\s+AFTER UPDATE OF entitlement_lead ON public\.projects/,
    );
    expect(migrationSql).not.toMatch(
      /AFTER UPDATE OF entitlement_lead, design_manager/,
    );
  });

  it('★★ the redefined cascade renames ent_lead and never writes dm', () => {
    const cascade = sqlCode.slice(
      sqlCode.indexOf('bp_trg_project_lead_cascade'),
      sqlCode.indexOf('bp_lead_drift_report'),
    );
    expect(cascade).toMatch(/SET ent_lead = v_new/);
    expect(cascade).not.toMatch(/SET\s+dm\s*=/i);
    expect(cascade).not.toMatch(/OLD\.design_manager/);
  });

  it('★ the drift report drops its dm arm — disagreeing with the project is now the EXPECTED state', () => {
    const report = sqlCode.slice(
      sqlCode.indexOf('bp_lead_drift_report'),
      sqlCode.indexOf('bp_dm_gap_report'),
    );
    expect(report).toMatch(/ent_lead/);
    expect(report).not.toMatch(/p\.dm/);
  });

  it("★ fix-377's PERMIT-level cascade (dm change moves the old manager's open tasks) is untouched", () => {
    expect(sqlCode).not.toContain('bp_trg_permit_lead_cascade');
    expect(fix377Sql).toMatch(
      /CREATE TRIGGER permits_lead_cascade\s+AFTER UPDATE OF ent_lead, dm, da ON public\.permits/,
    );
  });
});

// ---------------------------------------------------------------------------
describe('fix-379 §6 — the two data changes are produced and NOT applied', () => {
  it('the mapping rows: every statement commented out, and says so on its face', () => {
    const live = mappingRowsSql
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
    expect(mappingRowsSql).toMatch(/NOT\s+APPLIED/i);
    expect(mappingRowsSql).toMatch(/AWAITING/i);
  });

  it('the mapping rows are exactly the three, and Gena is flagged as new', () => {
    expect(mappingRowsSql).toMatch(/'Jade',\s*'Alex'/);
    expect(mappingRowsSql).toMatch(/'Jade',\s*'Nidhi'/);
    expect(mappingRowsSql).toMatch(/'Gena',\s*'George'/);
    expect(mappingRowsSql).toMatch(/GENA IS NEW/i);
  });

  it('the backfill: every statement commented out, and says so on its face', () => {
    const live = backfillSql
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
    expect(backfillSql).toMatch(/NOT\s+APPLIED/i);
    expect(backfillSql).toMatch(/AWAITING/i);
  });

  it('the backfill keeps the three decisions separate — clears, fills, corrections', () => {
    expect(backfillSql).toMatch(/GROUP A/);
    expect(backfillSql).toMatch(/GROUP B/);
    expect(backfillSql).toMatch(/GROUP C/);
    // The applied migration contains none of it: no bulk permit UPDATE.
    expect(sqlCode).not.toMatch(/UPDATE public\.permits p\s+SET dm =/i);
  });

  it('the applied migration mutates no data — triggers and reports only', () => {
    // The one statement class that would be a data change is an un-triggered
    // UPDATE/INSERT/DELETE against user tables outside a function body.
    // Everything in fix_379_dm_derived.sql lives inside CREATE FUNCTION /
    // CREATE TRIGGER / COMMENT / GRANT / REVOKE.
    const topLevel = sqlCode
      .replace(/AS \$function\$[\s\S]*?\$function\$/g, '')
      .replace(/AS \$\$[\s\S]*?\$\$/g, '');
    expect(topLevel).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/im);
  });
});
