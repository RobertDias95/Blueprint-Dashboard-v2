import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  ProjectWriteDeniedError,
  isDeniedResponse,
  isMissingFunction,
  isWriteDenied,
  WRITE_DENIED_CODE,
} from '../lib/projectWriteScope';
import { capsForRoles } from '../lib/writeLevel';

// ===========================================================================
// fix-539 (P-026) — a DA edits their own projects. STAGE TWO, and the bypass
// ===========================================================================
//
// ★★★ THE RULE: `member_of(project) OR project_has_no_da(project)`, computed
//     per read and never frozen. Membership is My Work's definition,
//     unnarrowed — `projectMatchesSelf ∪ permitMatchesSelf`.
//
// ★★★ THE PROBE, PASTED — prod, rolled back, 2026-09-13. Every cell run twice:
//     once through the RPC, once as a DIRECT TABLE UPDATE. They agree in all
//     24 cases, which is the only evidence that both halves carry one rule.
//
//   person                   A: theirs        B: has a DA, not theirs   C: no DA
//   -----------------------  ---------------  ------------------------  --------------
//   Ainsley (da, pure)       ALLOWED/WROTE    REFUSED 42501/BLOCKED     ALLOWED/WROTE
//   Derry   (dm+schematic)   ALLOWED/WROTE    ALLOWED/WROTE             ALLOWED/WROTE
//   EJ      (viewer)         REFUSED/BLOCKED  REFUSED/BLOCKED           REFUSED/BLOCKED
//   Blake   (no roster row)  REFUSED/BLOCKED  REFUSED/BLOCKED           REFUSED/BLOCKED

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}

const MIGRATION = 'migrations/fix_539_da_row_scope_PENDING_APPROVAL.sql';

// ---------------------------------------------------------------------------
// §A.1 — one derivation, two callers
// ---------------------------------------------------------------------------

describe('fix-539 §A.1 — the membership test is written ONCE', () => {
  const sql = read(MIGRATION);

  it('★★★ the membership expression appears exactly once', () => {
    // ★★★ Two derivations of one rule is P-244, P-179 and fix-531 — three
    //     times this month. The columns My Work matches on (`dual_da` is the
    //     distinctive one) may appear in `bp_is_project_member` and NOWHERE
    //     else in this file.
    // ★★★ THE GRAVESTONE TRAP, SIXTEENTH RECORDING — and it caught the first
    //     draft of this very assertion. Splitting on `CREATE OR REPLACE
    //     FUNCTION` and looking for `dual_da` matched TWICE: once in the
    //     function, once in the header explaining which columns membership
    //     matches on. **In a migration that is commented end to end there is
    //     nothing left to strip**, so the assertion has to name something only
    //     the code can contain — the expression, not the column.
    const matches = sql.match(/lower\(btrim\(p\.dual_da\)\)/g) ?? [];
    expect(matches).toHaveLength(1);
    const bodies = sql.split(/CREATE OR REPLACE FUNCTION/i);
    const withMembership = bodies.filter((b) => /lower\(btrim\(p\.dual_da\)\)/.test(b));
    expect(withMembership).toHaveLength(1);
    expect(withMembership[0]).toMatch(/bp_is_project_member/);
  });

  it('★★★ the fallback asks the SAME function, it does not restate the rule', () => {
    // ★★★ "No DA is on it" is not a second membership rule — it is this rule,
    //     quantified over every active DA. If membership ever changes, the
    //     fallback changes with it for free.
    const fallback = sql.slice(sql.indexOf('bp_project_has_no_da'));
    expect(fallback).toContain('NOT public.bp_is_project_member');
    expect(fallback.slice(0, fallback.indexOf('bp_may_write_project'))).not.toMatch(
      /entitlement_lead|dual_da/,
    );
  });

  it('★★★ BOTH halves call the one answer — the policy and the RPC', () => {
    // ⚠️ "Ship the RPC without the policy, or the policy without the RPC" is
    //    the thing this ticket exists to not do.
    // ★★ Scoped to the HALF TWO block, because the undo at the foot of the file
    //    also names this policy — a loose match passed while the USING clause
    //    had been gutted, which a red-proof caught.
    const halfTwo = sql.slice(sql.indexOf('HALF TWO'), sql.indexOf('7. The two INVOKER'));
    const clauses = halfTwo.match(/(USING|WITH CHECK) \([^\n]*/g) ?? [];
    expect(clauses).toHaveLength(2);
    for (const c of clauses) expect(c).toContain('bp_may_write_project(id)');
    // ★ …and the RPC asks the same question before it writes anything.
    const rpc = sql.slice(sql.indexOf('HALF ONE'), sql.indexOf('HALF TWO'));
    expect(rpc).toContain('NOT public.bp_may_write_project(p_project_id)');
    expect(rpc.indexOf('bp_may_write_project')).toBeLessThan(rpc.indexOf('update public.projects'));
  });

  it('★★★ `draw_schedule.da_assigned` is NOT the membership list, and is not used', () => {
    // ★★ 220 rows / 220 projects with 0 holding more than one DA slot, against
    //    318 membership pairs. It is a capacity slot; it would cut 98 pairs.
    const gate = sql.slice(sql.indexOf('1. The names behind one account'));
    expect(code(gate)).not.toContain('da_assigned');
    expect(sql).toContain('capacity slot');
  });

  it('★★ the one answer takes NO uid — it always speaks for the session', () => {
    // ★ So there is no way to ask it about somebody else and act on the reply.
    expect(sql).toContain('bp_may_write_project(p_project_id uuid)');
    expect(sql).not.toMatch(/bp_may_write_project\(p_project_id uuid, p_uid/);
  });
});

// ---------------------------------------------------------------------------
// The staged migration
// ---------------------------------------------------------------------------

describe('fix-539 — staged, dated, and honest about the cost', () => {
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

  it('★★★ §C is re-measured on the day, and the fallback is named as NOT a constant', () => {
    // ★ "22 is today's number, not a constant." A project that loses its last
    //   DA re-opens; one that gains its first closes.
    expect(sql).toContain('318');
    expect(sql).toContain('198');
    expect(sql).toContain('22');
    expect(sql).toContain('1,877');
    expect(sql.toLowerCase()).toContain('never frozen');
  });

  it('★★★ §A.4 IS CONTRADICTED IN THE FILE, with the number', () => {
    // ★★★ The brief says "a narrowing for nobody". Measured, it narrows 25 of
    //     37 accounts: 11 DAs scoped, and **14 accounts to zero** — because
    //     closing the bypass is exactly what it sounds like. A migration that
    //     quietly disagrees with its brief is how a surprise ships.
    expect(sql).toContain('4,957');
    expect(sql).toContain('14 accounts');
    expect(sql).toContain('zero');
  });

  it('★★★ …and the reassurance is measured too, not asserted', () => {
    // ★ All fourteen have ZERO audited actions of any kind. The access being
    //   removed has never been exercised by anyone.
    expect(sql).toContain('never been exercised');
  });

  it('★★★ the scraper is proved unaffected', () => {
    // ⚠️ A tightened policy that took the indexer down would be the worst
    //    possible way to learn this. `service_role` has rolbypassrls.
    expect(sql).toContain('rolbypassrls');
    expect(sql).toContain('service_role');
  });

  it('★★★ fix-538 is re-asserted as surviving, and it was the real risk', () => {
    // ★★★ Ana holds `schematic` only: after this she may write NO project
    //     directly, and her Schematic Designer capability must still work —
    //     it does, because `bp_reassign_project_sd` is SECURITY DEFINER.
    //     A capability delivered through a definer function is unaffected by a
    //     table policy; one delivered through a direct write would have died.
    expect(sql).toContain('fix-538 SURVIVES');
    expect(sql).toContain('SECURITY DEFINER');
    // …and stage one's map is untouched by this ticket.
    expect(capsForRoles(['da'])).toEqual([]);
    expect(capsForRoles(['schematic'])).toEqual(['schematic_designer']);
    expect(capsForRoles(['dm'])).toEqual([
      'project_details',
      'reassign_da',
      'schematic_designer',
    ]);
    expect(capsForRoles(['ent', 'viewer'])).toEqual(['project_details']);
  });

  it('★★ the two INVOKER side-effect writers are handled, not left silent', () => {
    // ⚠️ `bp_add_project_consultant` and `bp_set_consultant_firm` sync
    //    `projects.external_team`. Under the new policy a non-member's sync
    //    would silently no-op and drift from `project_consultants`.
    expect(sql).toContain('bp_add_project_consultant');
    expect(sql).toContain('bp_set_consultant_firm');
    expect(sql).toContain('silently no-op');
    // ★ …and the one that cannot be patched by the shared anchor says so
    //   rather than compiling a reference to a variable it does not have.
    expect(sql).toContain('p_consultant_id');
  });

  it('★★ the RPC refuses protected columns and needs no whitelist', () => {
    // ★ fix-410's four-place trap avoided: a new `projects` column needs no
    //   edit here, because keys are validated against information_schema.
    expect(sql).toContain('information_schema.columns');
    expect(sql).toContain("k IN ('id','tenant_id','updated_at')");
    expect(sql).toContain('jsonb_populate_record');
  });

  it('★★ it carries a one-statement undo', () => {
    expect(sql).toMatch(/ALTER POLICY projects_tenant_update[\s\S]*USING \(tenant_id = ANY \(public\.auth_tenant_ids\(\)\)\)/);
  });
});

// ---------------------------------------------------------------------------
// The client — a refusal must not wear the OCC message
// ---------------------------------------------------------------------------

describe('fix-539 — a refused write says it was refused', () => {
  it('★★★ 42501 becomes its own error, not an OCC conflict', () => {
    // ★★★ THE FAILURE MODE THIS PREVENTS. A policy does not raise, it filters:
    //     a blocked UPDATE returns 0 rows, and 0 rows is already the OCC
    //     signal. Without this the app would refetch, RETRY, and then tell the
    //     user their edit was "changed since you loaded it" — fix-341's false
    //     alarm arriving by a new route, naming an editor who does not exist.
    expect(WRITE_DENIED_CODE).toBe('42501');
    expect(isDeniedResponse({ code: '42501' })).toBe(true);
    expect(isDeniedResponse({ code: '23505' })).toBe(false);
    expect(isDeniedResponse(null)).toBe(false);
    const err = new ProjectWriteDeniedError('p-1');
    expect(isWriteDenied(err)).toBe(true);
    expect(err.message).toContain('only edit projects you are on');
    expect(isWriteDenied(new Error('nope'))).toBe(false);
  });

  it('★★★ a refusal is NOT retried — the answer cannot change by refetching', () => {
    const hook = code(read('src/hooks/useUpdateProject.ts'));
    // ★ The guard sits BEFORE the OCC branch, so a denial never reaches the
    //   refetch-and-retry path fix-99 built for genuine races.
    const denyAt = hook.indexOf('isWriteDenied(err)');
    const occAt = hook.indexOf('!isOCCConflict(err)');
    expect(denyAt).toBeGreaterThan(-1);
    expect(occAt).toBeGreaterThan(-1);
    expect(denyAt).toBeLessThan(occAt);
  });

  it('★★★ the toast says the true thing, and does not invalidate', () => {
    const hook = code(read('src/hooks/useUpdateProject.ts'));
    const denialBranch = hook.slice(
      hook.indexOf('isWriteDenied(error)'),
      hook.indexOf('isOCCConflict(error)'),
    );
    expect(denialBranch).toContain('pushToast');
    // ★ Nothing changed on the server, so there is nothing to refetch.
    expect(denialBranch).not.toContain('invalidateQueries');
  });

  it('★★★ a MISSING function falls back — this is what lets it ship before the SQL', () => {
    // ★★★ The migration is staged. If the client simply called the RPC, every
    //     project edit in the app would break on deploy and stay broken until
    //     Cowork applied the file. `PGRST202` (and Postgres's own `42883`)
    //     fall through to the direct write, which is exactly today's
    //     behaviour, and the app crosses over by itself when the function
    //     appears — no flag day, no second deploy.
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunction({ code: '42883' })).toBe(true);
    expect(isMissingFunction({ code: '42501' })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
    const hook = code(read('src/hooks/useUpdateProject.ts'));
    expect(hook).toContain('bp_update_project_fields');
    expect(hook).toContain('isMissingFunction');
    // ★ …and the fallback is the ONLY thing a non-42501 RPC error does not do.
    expect(hook).toContain('if (!isMissingFunction(rpc.error)) throw rpc.error;');
  });

  it('★★ the denial is read off the CODE, never the message', () => {
    // ★ fix-357's rule: a message is environment-specific and gets rewritten;
    //   the SQLSTATE is the contract.
    const lib = code(read('src/lib/projectWriteScope.ts'));
    expect(lib).toContain("error?.code === WRITE_DENIED_CODE");
    expect(lib).not.toMatch(/message.*includes|includes.*message/);
  });
});
