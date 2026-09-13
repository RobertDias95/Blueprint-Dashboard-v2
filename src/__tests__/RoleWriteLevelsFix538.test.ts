import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  ROLE_WRITE_CAPS,
  capsForRoles,
  hasCap,
  mayWrite,
  type WriteCap,
} from '../lib/writeLevel';

// ===========================================================================
// fix-538 (P-026, P-234) — the roster decides who may write. STAGE ONE.
// ===========================================================================
//
// ★★★ CI HAS NO DATABASE, so the enforcement itself is established by a
//     rolled-back probe against prod (the fix-153 / fix-527 §B pattern) and
//     mirrored here. What these tests own is the part that can drift in a pull
//     request: the map, the collapse rule, the staged SQL, and whether the
//     browser is being asked to do a job the server should do.
//
// ★★★ THE PROBE, PASTED — prod, rolled back, 2026-09-13:
//
//   person   roster roles              caps                   set SD          reassign DA
//   -------  ------------------------  ---------------------  --------------  --------------
//   Ana      schematic                 schematic_designer     ALLOWED         REFUSED 42501
//   Jade     da+dm+schematic           all three              ALLOWED         ALLOWED
//   Lucas    ent+viewer                project_details        REFUSED 42501   REFUSED 42501
//   EJ       viewer                    (none)                 REFUSED 42501   REFUSED 42501
//   Ainsley  da                        (none)                 REFUSED 42501   REFUSED 42501
//   Dave     director+schematic ADMIN  all three              ALLOWED         ALLOWED

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}

const MIGRATION = 'migrations/fix_538_role_write_levels_PENDING_APPROVAL.sql';

// ---------------------------------------------------------------------------
// §A.1 / §A.3 — a roster role becomes a write level, in one place
// ---------------------------------------------------------------------------

describe('fix-538 §A — the roster role IS the write level', () => {
  it('★★★ every stage-one level, both directions', () => {
    // ★ §A.3, bullet by bullet. `dm` and `director` edit anything; `ent` and
    //   `ent_lead` edit the project details; `schematic` sets its own field.
    expect(capsForRoles(['dm'])).toEqual([
      'project_details',
      'reassign_da',
      'schematic_designer',
    ]);
    expect(capsForRoles(['director'])).toEqual([
      'project_details',
      'reassign_da',
      'schematic_designer',
    ]);
    expect(capsForRoles(['ent'])).toEqual(['project_details']);
    expect(capsForRoles(['ent_lead'])).toEqual(['project_details']);
    expect(capsForRoles(['schematic'])).toEqual(['schematic_designer']);
  });

  it('★★★ `da` is granted NOTHING, and that is deliberate', () => {
    // ⚠️⚠️ §A.3: *"Do not approximate row scoping with a flat grant — a DA who
    //      can edit every project is worse than a DA who can edit none."* The
    //      DA's scope is row-level and belongs to stage two; a flat grant here
    //      would be the wrong answer arriving early and would be very hard to
    //      take back.
    expect(capsForRoles(['da'])).toEqual([]);
    expect(ROLE_WRITE_CAPS.da).toBeUndefined();
  });

  it('★★ the roles stage one does not touch stay untouched', () => {
    for (const role of ['viewer', 'acq', 'acq_lead', 'ca']) {
      expect(capsForRoles([role]), role).toEqual([]);
    }
  });

  it('★★★ an unknown role grants nothing rather than throwing', () => {
    // ★ fix-406's lesson: removing a value from a union does not stop a stored
    //   string arriving. The roster is edited by people, so a role this map has
    //   never heard of is a **no**, not a crash.
    expect(capsForRoles(['chief_vibes_officer'])).toEqual([]);
    expect(capsForRoles(['DM'])).toEqual([]); // case-sensitive by design: the
    // stored values are lower-case tokens and fix-535 left them alone.
  });
});

// ---------------------------------------------------------------------------
// §A.2 — one account, one answer
// ---------------------------------------------------------------------------

describe('fix-538 §A.2 — many roster rows collapse to one level', () => {
  it('★★★ Jade holds THREE rows and gets exactly one answer', () => {
    // ★ The case §A.2 names. Measured on prod 2026-09-13: `da + dm + schematic`.
    //   The `da` row adds nothing, the `dm` row carries everything, and the
    //   result is one set rather than three opinions.
    expect(capsForRoles(['da', 'dm', 'schematic'])).toEqual([
      'project_details',
      'reassign_da',
      'schematic_designer',
    ]);
  });

  it('★★★ …and it is not just Jade — EIGHT of 37 accounts hold more than one', () => {
    // ⚠️ The brief names one person; prod names eight. The rule had to be
    //    written for all of them, so all of them are here.
    const measured: Array<[string, string[], WriteCap[]]> = [
      ['Jade', ['da', 'dm', 'schematic'], ['project_details', 'reassign_da', 'schematic_designer']],
      ['Dave', ['director', 'schematic'], ['project_details', 'reassign_da', 'schematic_designer']],
      ['Derry', ['dm', 'schematic'], ['project_details', 'reassign_da', 'schematic_designer']],
      ['Lindsay', ['dm', 'schematic'], ['project_details', 'reassign_da', 'schematic_designer']],
      ['Briana', ['ent', 'ent_lead'], ['project_details']],
      ['Miles', ['ent', 'ent_lead'], ['project_details']],
      ['Bobby', ['ent', 'ent_lead'], ['project_details']],
      ['Lucas', ['ent', 'viewer'], ['project_details']],
    ];
    for (const [who, roles, expected] of measured) {
      expect(capsForRoles(roles), who).toEqual(expected);
    }
  });

  it('★★★ a row can only ADD — Lucas is why', () => {
    // ★★★ §A.6 asks for "two rows that disagree" to fail closed. Read as "two
    //     different strings", that denies all eight above — every `ent_lead`,
    //     both of P-234's design managers, and Bobby himself. **The rows do not
    //     disagree; they are an additive list of what a person does.**
    //
    // ★★ Lucas is `ent + viewer`. A `viewer` row beside a real one is a second
    //    listing, not a demotion — so the union is the rule and subtraction is
    //    not available to any row.
    expect(capsForRoles(['ent', 'viewer'])).toEqual(['project_details']);
    expect(capsForRoles(['viewer', 'ent'])).toEqual(['project_details']);
    // ★ Order cannot matter, and neither can repetition.
    expect(capsForRoles(['dm', 'dm', 'viewer', 'da'])).toEqual(
      capsForRoles(['da', 'viewer', 'dm']),
    );
  });
});

// ---------------------------------------------------------------------------
// §A.6 — fail closed
// ---------------------------------------------------------------------------

describe('fix-538 §A.6 — the genuine fail-closed cases are all "no"', () => {
  it('★★★ nothing to union is always an empty capability set', () => {
    // ★★★ Proved on prod (rolled back, 2026-09-13), all four `(none)`:
    //     no such account · an account with no roster row · every roster row
    //     `active = false` · a null uid. The SQL puts `tm.active` in the join,
    //     so a deactivated person derives nothing without a second rule.
    expect(capsForRoles([])).toEqual([]);
    expect(capsForRoles(null)).toEqual([]);
    expect(capsForRoles(undefined)).toEqual([]);
    expect(hasCap(undefined, 'project_details')).toBe(false);
    expect(hasCap([], 'schematic_designer')).toBe(false);
  });

  it('★★ the admin hatch is applied the way the SERVER applies it', () => {
    // ★ The RPC reads `is_tenant_admin(tenant) OR bp_may_…()`, so the browser
    //   reads `isAdmin || hasCap(…)` — same shape, same order. `profiles.role`
    //   is left exactly as it is: admin 7 · editor 30, and **seven admins is
    //   not a role model**, which is the whole reason for this ticket.
    expect(mayWrite(true, [], 'reassign_da')).toBe(true);
    expect(mayWrite(false, [], 'reassign_da')).toBe(false);
    expect(mayWrite(false, ['schematic_designer'], 'schematic_designer')).toBe(true);
    expect(mayWrite(false, ['schematic_designer'], 'reassign_da')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The staged migration
// ---------------------------------------------------------------------------

describe('fix-538 — the SQL is staged, and it is the gate', () => {
  const sql = read(MIGRATION);

  it('★★★ it is STAGED, not applied', () => {
    expect(sql).toContain('NOT APPLIED');
    expect(sql).toMatch(/MEASURED ON PROD \d{4}-\d{2}-\d{2}/);
    const live = sql
      .split(/\r?\n/)
      .filter((l) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DO|BEGIN|COMMIT)\b/i.test(l));
    expect(live).toEqual([]);
  });

  it('★★★ the TS mirror and the SQL map agree, role for role', () => {
    // ★★★ THE DRIFT GUARD. Two implementations of one rule is how a UI and a
    //     gate stop agreeing, so the map is parsed out of the migration and
    //     compared with this module's. If somebody edits one, this fails.
    const fromSql = new Map<string, string[]>();
    for (const m of sql.matchAll(/ARRAY\[([^\]]+)\]\s+THEN\s+'(\w+)'/g)) {
      const roles = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
      fromSql.set(m[2]!, roles.sort());
    }
    expect(fromSql.size, 'the migration should define three capabilities').toBe(3);

    const fromTs = new Map<string, string[]>();
    for (const [role, caps] of Object.entries(ROLE_WRITE_CAPS)) {
      for (const cap of caps) {
        fromTs.set(cap, [...(fromTs.get(cap) ?? []), role].sort());
      }
    }
    for (const [cap, roles] of fromSql) {
      expect(fromTs.get(cap), `capability ${cap}`).toEqual(roles);
    }
  });

  it('★★★ both gates are WIDENED, never narrowed — nobody loses anything', () => {
    // ★★★ THE REASON STAGE ONE IS SAFE TO SHIP. Both RPCs check
    //     `is_tenant_admin` today; the patch appends an OR, so every caller
    //     allowed before is allowed after. A role model that begins by taking
    //     something away is a role model nobody lets you finish.
    expect(sql).toContain('AND NOT public.bp_may_set_schematic_designer() THEN');
    expect(sql).toContain('AND NOT public.bp_may_reassign_da() THEN');
    expect(sql).toContain('is_tenant_admin(v_tenant)');
  });

  it('★★★ it refuses to patch if the anchor is not exactly where it thinks', () => {
    // ★ fix-537's lesson, one ticket old: an anchor that silently matches
    //   nothing leaves a gate unpatched and a UI open onto a refusal. This one
    //   counts its hits and raises rather than guessing.
    expect(sql).toContain('expected exactly one admin gate');
    expect(sql).toContain('pg_get_functiondef');
  });

  it('★★ `anon` is revoked from PUBLIC as well as from anon', () => {
    // ⚠️ fix-157: `REVOKE … FROM anon` alone reports success and does nothing,
    //    because `anon` inherits from PUBLIC.
    expect(sql).toMatch(/REVOKE EXECUTE[\s\S]*FROM public, anon/);
    expect(sql).toContain('has_function_privilege');
  });

  it('★★★ the probe output is recorded, with its 42501s', () => {
    // ★ *A gate described is not a gate proved*, and every browser-only gate in
    //   this codebase was described. These are the refusals, pasted.
    expect(sql).toContain('REFUSED 42501');
    for (const who of ['Ana', 'Jade', 'Lucas', 'EJ', 'Ainsley', 'Dave']) {
      expect(sql, who).toContain(who);
    }
  });
});

// ---------------------------------------------------------------------------
// §A.5 — the control and the server agree
// ---------------------------------------------------------------------------

describe('fix-538 §A.5 — the UI asks the same question the server answers', () => {
  it('★★★ the Schematic Designer control has its OWN gate', () => {
    // ★★★ THE DEFECT §A.5 PREDICTED, FOUND. One prop — `canReassignDa`, wired
    //     to `isAdmin` — was disabling BOTH the DA control and the Schematic
    //     Designer control, in front of TWO different server checks. So four of
    //     the five people holding a `schematic` roster row (Ana, Derry, Jade,
    //     Lindsay — all `editor`) saw a dead control. That is P-234.
    const form = code(read('src/components/ProjectDetail/ProjectDetailsForm.tsx'));
    expect(form).toContain('disabled={!canReassignSd || sdPending}');
    expect(form).not.toContain('disabled={!canReassignDa || sdPending}');
    // ★★★ …AND ALL THREE READS MOVED, not just the disabled one. The control
    //     also guarded its own onChange and printed a hint, both off the same
    //     wrong flag. A half-moved gate is a control that looks enabled and
    //     drops the change on the floor.
    expect(form).toContain('if (!canReassignSd) return;');
    expect(form).not.toContain('if (!canReassignDa) return;');
    // ★★ The hint told people the rule. It was still saying the OLD rule.
    expect(form).not.toContain('Only a tenant admin can reassign the schematic designer.');
    expect(form).toContain('Your roster role does not include setting the schematic designer.');
  });

  it('★★★ the prop that gated it was named after a DIFFERENT control', () => {
    // ★★★ HOW P-234 STAYED INVISIBLE. `InternalTeamFields` took a prop called
    //     `canReassignDa`, and the only thing it gated was the **Schematic
    //     Designer**. The name said one control, the job was another, and a
    //     reader checking "is the SD control gated correctly?" saw a plausible
    //     flag and moved on. It is gone from this component now — the DA
    //     control lives in the Actions tab and keeps its own.
    const form = code(read('src/components/ProjectDetail/ProjectDetailsForm.tsx'));
    expect(form).not.toContain('canReassignDa');
    const modal = code(read('src/components/ProjectDetail/ProjectDetailsModal.tsx'));
    // ★ still threaded to the Actions tab, where the DA control actually is
    expect(modal).toContain('canReassignDa={canReassignDa}');
  });

  it('★★★ the page derives BOTH from the one hook', () => {
    const page = code(read('src/pages/ProjectDetail.tsx'));
    expect(page).toContain('useProjectTeamCaps');
    expect(page).toContain('canReassignDa={canReassignDa}');
    expect(page).toContain('canReassignSd={canReassignSd}');
    // ★ …and no longer hands the admin flag straight to a control.
    expect(page).not.toContain('canReassignDa={isAdmin}');
  });

  it('★★★ NO NEW BROWSER-ONLY GATE — every capability the UI reads is a server gate', () => {
    // ★★★ THE TEST THAT KEEPS STAGE ONE HONEST. `project_details` is derived
    //     and deliberately NOT used to gate any control, because gating it in
    //     the browser without a matching RPC check is exactly the pattern this
    //     ticket exists to stop. The two capabilities the UI does read —
    //     `schematic_designer` and `reassign_da` — are both enforced in SQL.
    const hook = code(read('src/hooks/useWriteCaps.ts'));
    const sql = read(MIGRATION);
    for (const cap of ['schematic_designer', 'reassign_da']) {
      expect(hook, `${cap} must be read by the UI`).toContain(cap);
      expect(sql, `${cap} must be enforced in SQL`).toContain(`bp_may_${cap === 'reassign_da' ? 'reassign_da' : 'set_schematic_designer'}()`);
    }
    // ★★ `project_details` has no UI gate in stage one. If a later change adds
    //    one before the RPC exists, this fails — which is the point.
    expect(hook).not.toContain('project_details');
  });

  it('★★★ the hook fails closed, which is what lets it ship before the SQL', () => {
    // ★ The migration is staged, so `bp_write_caps` does not exist yet. The
    //   error path returns NO capabilities, so today the app behaves exactly as
    //   it does now — admin-only — and starts honouring the roster the moment
    //   Cowork applies the file. No flag day, no second deploy.
    const hook = code(read('src/hooks/useWriteCaps.ts'));
    expect(hook).toContain('if (error) return [];');
    expect(hook).toContain("q.data ?? []");
  });
});

// ---------------------------------------------------------------------------
// §C — stage two, measured
// ---------------------------------------------------------------------------

describe('fix-538 §C — stage two starts from a number', () => {
  const sql = read(MIGRATION);

  it('★★★ the row scope is measured, not estimated', () => {
    // ★★★ Using My Work's own definition — `projectMatchesSelf ∪
    //     permitMatchesSelf` — measured on prod 2026-09-13:
    //       220 projects · **198** reachable by at least one active DA ·
    //       **22** reachable by none · **318** membership pairs.
    //     Cam alone would hold **106 of 220**.
    expect(sql).toContain('318');
    expect(sql).toContain('198');
    expect(sql).toContain('106');
  });

  it('★★★ `draw_schedule.da_assigned` is named as NOT the membership list', () => {
    // ★★ The brief's warning, confirmed with the number that settles it: the
    //    board holds 220 rows over 220 projects with **0** projects carrying
    //    more than one DA slot, against 318 membership pairs. It is a capacity
    //    slot; using it would silently drop 98 pairs.
    expect(sql).toContain('da_assigned');
    expect(sql).toContain('capacity slot');
  });

  it('★★★ stage two must close the bypass in the SAME change', () => {
    // ★★★ THE FINDING STAGE TWO CANNOT BE PLANNED WITHOUT. `projects` RLS says
    //     `tenant_id = ANY (auth_tenant_ids())` and `authenticated` holds a
    //     direct UPDATE grant, so **every editor can already write every
    //     project from the console**. A row-scoped RPC is not a boundary while
    //     that policy stands — and tightening the policy first would take every
    //     DA's editing away. One change, both halves.
    expect(sql).toContain('auth_tenant_ids()');
    expect(sql).toContain('One\n--    change, both halves.');
  });
});
