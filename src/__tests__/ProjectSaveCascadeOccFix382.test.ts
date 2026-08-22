import { describe, it, expect } from 'vitest';
import migrationSql from '../../migrations/fix_382_project_save_cascade_occ.sql?raw';

// ===========================================================================
// fix-382 — the project save collides with its own cascade
// ===========================================================================
//
// Bobby opened Project Settings on 4412 Evanston Ave N, changed the
// entitlement lead Miles → Briana, and got "This project was modified
// elsewhere" with nobody else editing. bp_update_project_with_permits patched
// the project first, fix-377's projects_cascade_lead bumped every permit's
// updated_at, and then the permit loop OCC-checked those same permits against
// the expectations the CLIENT had measured before the save. Zero rows. False
// conflict — manufactured inside one transaction, against its own writes.
//
// No live DB in CI (fix-153 / fix-220 / fix-244 / fix-368 / fix-377
// precedent), so this is a pure-TS mirror of the RPC plus documented
// ROLLED-BACK prod probes. If the SQL and this mirror ever disagree, one of
// them is wrong — they are written to be read side by side.
//
// ---------------------------------------------------------------------------
// PROD PROBE A — 2026-08-22, prod eibnmwthkcuumyclyxoe, ROLLED BACK by
// RAISE EXCEPTION. The real row: 4412 Evanston Ave N, lead Miles, 3 unissued
// permits, only the lead edited, all 3 permits sent as the client sends them.
//
//   before  lead=Miles    permits = Miles, Miles, Miles
//   after   conflict=f    lead=Briana    permits = Briana, Briana, Briana
//
// ★★★ Run against step 0 ALONE (OCC fixed, order untouched) the same probe
// returned conflict=f but left `lead=Briana` with `permits = Miles, Miles,
// Miles` — the cascade written and then immediately overwritten by the
// client's restatement of the outgoing lead. That is the second defect the
// crash had been hiding, and it is why the permit writes moved BEFORE the
// project patch. See PROBE C.
//
// PROD PROBE B — same session, rolled back. Real conflicts still fail loudly:
//   B1 third party edits a permit between the client's read and the save
//      → conflict=t kind=permit id=10576, and nothing landed (lead=Miles)
//   B2 third party edits the PROJECT → conflict=t kind=project, and the
//      step-1 permit writes rolled back with it (permits = Miles ×3)
//   B3 a permit id not on this project → conflict=t kind=permit
//
// PROD PROBE C — same session, rolled back. A synthetic project carrying
// every edge of fix-377's contract, lead ZZ_Old_Ent → ZZ_New_Ent, with the
// user ALSO editing permit A's num and DA in the same save:
//
//   A unissued, was old lead → ZZ_New_Ent · num A-1-EDITED · da Marc · dm Brittani
//   B ISSUED,   was old lead → ZZ_Old_Ent            (frozen)
//   C filed under ZZ_Third   → ZZ_Third              (deliberate, kept)
//   D ent_lead NULL          → NULL                  (fix-312)
//   NEW permit created in the same save under the old lead → ZZ_New_Ent
//   open task on the old lead → ZZ_New_Ent ·  resolved task → ZZ_Old_Ent
//   dm Brittani = fix-379's permits_derive_dm still firing on the permit write
//
// PROD PROBE D/E — a project with NO permits saves (conflict=f), and a save
// that does not change the lead leaves every permit untouched.
// ---------------------------------------------------------------------------

const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');

// ---------------------------------------------------------------------------
// Mirror of the SQL
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  entitlement_lead: string | null;
  zone?: string | null;
  updated_at: string;
}
interface Permit {
  id: number;
  project_id: string;
  ent_lead: string | null;
  num?: string | null;
  actual_issue: string | null;
  updated_at: string;
}
interface Db {
  project: Project;
  permits: Permit[];
}
interface Upsert {
  id?: number;
  expected_updated_at?: string;
  ent_lead?: string | null;
  num?: string | null;
}
interface SaveResult {
  conflict: boolean;
  kind: 'project' | 'permit' | null;
  conflictId: string | null;
  permitsOut: { id: number; updated_at: string }[];
}

/** ★ now() is CONSTANT inside a transaction, so every write this save makes
 *  stamps the same value. That is exactly why the old check could not tell
 *  its own cascade apart from a stranger by timestamp alone. */
const TXN_NOW = '2026-08-22T01:52:30.627Z';

/** fix-377's projects_cascade_lead, unchanged by this ticket:
 *  rename the UNISSUED permits still filed under the OUTGOING lead. */
function cascadeLead(db: Db, oldLead: string | null, newLead: string | null) {
  const o = (oldLead ?? '').trim();
  const n = (newLead ?? '').trim();
  if (!o || !n || o === n) return;
  for (const p of db.permits) {
    if (p.project_id !== db.project.id) continue;
    if (p.actual_issue !== null) continue;
    if ((p.ent_lead ?? '').trim().toLowerCase() !== o.toLowerCase()) continue;
    p.ent_lead = n;
    p.updated_at = TXN_NOW;
  }
}

/**
 * `variant: 'legacy'` is the shipped-before-fix-382 function; `'fix382'` is
 * this migration. They differ in exactly two places, both asserted below.
 */
function runSave(
  db: Db,
  args: {
    projectExpected: string;
    patch: { entitlement_lead?: string | null; zone?: string | null };
    upserts: Upsert[];
  },
  variant: 'legacy' | 'fix382',
): SaveResult {
  const snapshot: Db = structuredClone(db);
  const conflict = (kind: 'project' | 'permit', id: string): SaveResult => {
    // The RPC catches its own occ_conflict and rolls the whole block back.
    db.project = snapshot.project;
    db.permits = snapshot.permits;
    return { conflict: true, kind, conflictId: id, permitsOut: [] };
  };

  const touched: number[] = [];
  const hasPatch = Object.keys(args.patch).length > 0;

  const applyPermits = (): SaveResult | null => {
    for (const u of args.upserts) {
      if (u.id == null) continue;
      const row = db.permits.find(
        (p) => p.id === u.id && p.project_id === db.project.id,
      );
      if (variant === 'legacy') {
        // ★★★ THE BUG: the predicate is re-tested here, AFTER the project
        // patch has already cascaded a new updated_at onto this very row.
        if (!row || row.updated_at !== u.expected_updated_at) {
          return conflict('permit', String(u.id));
        }
      } else if (!row) {
        return conflict('permit', String(u.id));
      }
      if ('ent_lead' in u) row!.ent_lead = u.ent_lead ?? null;
      if ('num' in u) row!.num = u.num ?? null;
      row!.updated_at = TXN_NOW;
      touched.push(row!.id);
    }
    return null;
  };

  const applyProject = (): SaveResult | null => {
    if (!hasPatch) return null;
    if (db.project.updated_at !== args.projectExpected) {
      return conflict('project', db.project.id);
    }
    const oldLead = db.project.entitlement_lead;
    if ('entitlement_lead' in args.patch) {
      db.project.entitlement_lead = args.patch.entitlement_lead ?? null;
    }
    if ('zone' in args.patch) db.project.zone = args.patch.zone ?? null;
    db.project.updated_at = TXN_NOW;
    cascadeLead(db, oldLead, db.project.entitlement_lead);
    return null;
  };

  if (variant === 'fix382') {
    // ★★★ STEP 0 — every expectation checked BEFORE anything writes, so the
    // value compared is the row as it stood before this transaction.
    for (const u of args.upserts) {
      if (u.id == null) continue;
      const row = db.permits.find(
        (p) => p.id === u.id && p.project_id === db.project.id,
      );
      if (!row || row.updated_at !== u.expected_updated_at) {
        return conflict('permit', String(u.id));
      }
    }
    // STEP 1 permits, then STEP 2 the project: the cascade gets the last word.
    const a = applyPermits();
    if (a) return a;
    const b = applyProject();
    if (b) return b;
  } else {
    const b = applyProject();
    if (b) return b;
    const a = applyPermits();
    if (a) return a;
  }

  // STEP 3 — the FINAL updated_at, read after every write.
  return {
    conflict: false,
    kind: null,
    conflictId: null,
    permitsOut: touched.map((id) => ({
      id,
      updated_at: db.permits.find((p) => p.id === id)!.updated_at,
    })),
  };
}

// 4412 Evanston Ave N, as prod actually holds it.
const READ_AT = '2026-08-21T18:28:47.476Z';
function evanston(): Db {
  return {
    project: {
      id: 'ca3950eb',
      entitlement_lead: 'Miles',
      updated_at: READ_AT,
    },
    permits: [10576, 10577, 10578].map((id) => ({
      id,
      project_id: 'ca3950eb',
      ent_lead: 'Miles',
      actual_issue: null,
      updated_at: READ_AT,
    })),
  };
}
/** What ProjectSettingsModal.tsx:455 sends: EVERY existing permit row, each
 *  restating the ent_lead it read. The user edited only the project field. */
function clientPayload(db: Db): Upsert[] {
  return db.permits.map((p) => ({
    id: p.id,
    expected_updated_at: p.updated_at,
    ent_lead: p.ent_lead,
    num: p.num ?? null,
  }));
}

// ---------------------------------------------------------------------------

describe('fix-382 — the save no longer collides with its own cascade', () => {
  it('★★★ reproduces the live regression on the legacy function', () => {
    const db = evanston();
    const res = runSave(
      db,
      {
        projectExpected: READ_AT,
        patch: { entitlement_lead: 'Briana' },
        upserts: clientPayload(db),
      },
      'legacy',
    );
    // Nobody else was editing. The conflict is against its own cascade.
    expect(res.conflict).toBe(true);
    expect(res.kind).toBe('permit');
    expect(db.project.entitlement_lead).toBe('Miles'); // rolled back
  });

  it('★★★ Miles → Briana now saves, and the permits follow', () => {
    const db = evanston();
    const res = runSave(
      db,
      {
        projectExpected: READ_AT,
        patch: { entitlement_lead: 'Briana' },
        upserts: clientPayload(db),
      },
      'fix382',
    );
    expect(res.conflict).toBe(false);
    expect(db.project.entitlement_lead).toBe('Briana');
    expect(db.permits.map((p) => p.ent_lead)).toEqual([
      'Briana',
      'Briana',
      'Briana',
    ]);
  });

  it('★★★ ordering matters: with the project patched first the cascade is overwritten', () => {
    // The defect PROBE A exposed once the false conflict stopped masking it.
    // Same step-0 OCC, legacy write order — the client's stale ent_lead wins.
    const db = evanston();
    const payload = clientPayload(db);
    // Step 0 passes (nothing has written yet), so legacy's own OCC would not
    // fire either if it checked up front; what remains is the write order.
    const oldLead = db.project.entitlement_lead;
    db.project.entitlement_lead = 'Briana';
    db.project.updated_at = TXN_NOW;
    cascadeLead(db, oldLead, 'Briana');
    expect(db.permits.map((p) => p.ent_lead)).toEqual([
      'Briana',
      'Briana',
      'Briana',
    ]);
    for (const u of payload) {
      const row = db.permits.find((p) => p.id === u.id)!;
      row.ent_lead = u.ent_lead ?? null; // the permit loop, running second
    }
    expect(db.permits.map((p) => p.ent_lead)).toEqual([
      'Miles',
      'Miles',
      'Miles',
    ]);
  });

  it('★★★ a genuine concurrent edit still raises a permit conflict', () => {
    const db = evanston();
    const payload = clientPayload(db); // the client's read
    // A third party edits one permit after that read.
    db.permits[0].updated_at = '2026-08-21T19:00:00.000Z';

    const res = runSave(
      db,
      {
        projectExpected: READ_AT,
        patch: { entitlement_lead: 'Briana' },
        upserts: payload,
      },
      'fix382',
    );
    expect(res.conflict).toBe(true);
    expect(res.kind).toBe('permit');
    expect(res.conflictId).toBe('10576');
    // Nothing landed.
    expect(db.project.entitlement_lead).toBe('Miles');
    expect(db.permits.map((p) => p.ent_lead)).toEqual([
      'Miles',
      'Miles',
      'Miles',
    ]);
  });

  it('★★★ a stranger who writes the row our cascade also writes is NOT absorbed', () => {
    // The trap in the rejected transaction_timestamp() rule: our cascade would
    // stamp this row with our own transaction time and the check would accept,
    // silently destroying the third party's edit. Step 0 sees it first.
    const db = evanston();
    const payload = clientPayload(db);
    db.permits[1].ent_lead = 'Miles';
    db.permits[1].updated_at = '2026-08-21T19:30:00.000Z'; // stranger's write

    const res = runSave(
      db,
      {
        projectExpected: READ_AT,
        patch: { entitlement_lead: 'Briana' },
        upserts: payload,
      },
      'fix382',
    );
    expect(res.conflict).toBe(true);
    expect(res.conflictId).toBe('10577');
  });

  it('★★ a genuine concurrent edit to the PROJECT still raises a project conflict', () => {
    const db = evanston();
    const payload = clientPayload(db);
    db.project.updated_at = '2026-08-21T19:00:00.000Z';

    const res = runSave(
      db,
      {
        projectExpected: READ_AT,
        patch: { entitlement_lead: 'Briana' },
        upserts: payload,
      },
      'fix382',
    );
    expect(res.conflict).toBe(true);
    expect(res.kind).toBe('project');
    // The step-1 permit writes rolled back with it — PROBE B2.
    expect(db.permits.map((p) => p.ent_lead)).toEqual([
      'Miles',
      'Miles',
      'Miles',
    ]);
  });

  it("★★ fix-377's contract survives: issued frozen, deliberate kept, NULL left", () => {
    const db: Db = {
      project: { id: 'zz', entitlement_lead: 'ZZ_Old', updated_at: READ_AT },
      permits: [
        { id: 1, project_id: 'zz', ent_lead: 'ZZ_Old', actual_issue: null, updated_at: READ_AT },
        { id: 2, project_id: 'zz', ent_lead: 'ZZ_Old', actual_issue: '2025-01-01', updated_at: READ_AT },
        { id: 3, project_id: 'zz', ent_lead: 'ZZ_Third', actual_issue: null, updated_at: READ_AT },
        { id: 4, project_id: 'zz', ent_lead: null, actual_issue: null, updated_at: READ_AT },
      ],
    };
    const res = runSave(
      db,
      {
        projectExpected: READ_AT,
        patch: { entitlement_lead: 'ZZ_New' },
        upserts: clientPayload(db),
      },
      'fix382',
    );
    expect(res.conflict).toBe(false);
    expect(db.permits.map((p) => p.ent_lead)).toEqual([
      'ZZ_New', // unissued, was the outgoing lead → moves
      'ZZ_Old', // ISSUED → frozen
      'ZZ_Third', // deliberately elsewhere → kept
      null, // never had one → still none
    ]);
  });

  it('★ a permit edit and the lead change in the same save both land', () => {
    const db = evanston();
    const payload = clientPayload(db);
    payload[0].num = 'A-1-EDITED';

    const res = runSave(
      db,
      {
        projectExpected: READ_AT,
        patch: { entitlement_lead: 'Briana' },
        upserts: payload,
      },
      'fix382',
    );
    expect(res.conflict).toBe(false);
    expect(db.permits[0].num).toBe('A-1-EDITED');
    expect(db.permits[0].ent_lead).toBe('Briana');
  });

  it('★ a project with no permits still saves, and an unchanged lead disturbs nothing', () => {
    const empty: Db = {
      project: { id: 'e', entitlement_lead: 'Miles', updated_at: READ_AT },
      permits: [],
    };
    expect(
      runSave(empty, { projectExpected: READ_AT, patch: { zone: 'ZZ-1' }, upserts: [] }, 'fix382')
        .conflict,
    ).toBe(false);
    expect(empty.project.zone).toBe('ZZ-1');

    const db = evanston();
    const res = runSave(
      db,
      { projectExpected: READ_AT, patch: { zone: 'ZZ-9' }, upserts: clientPayload(db) },
      'fix382',
    );
    expect(res.conflict).toBe(false);
    expect(db.permits.map((p) => p.ent_lead)).toEqual(['Miles', 'Miles', 'Miles']);
  });

  it('★ the returned updated_at is the post-cascade value, not the loop\'s', () => {
    const db = evanston();
    const res = runSave(
      db,
      {
        projectExpected: READ_AT,
        patch: { entitlement_lead: 'Briana' },
        upserts: clientPayload(db),
      },
      'fix382',
    );
    // Feeding the result straight back must not conflict — the client's next
    // save carries expectations that match what the cascade actually left.
    const again = runSave(
      db,
      {
        projectExpected: db.project.updated_at,
        patch: { zone: 'ZZ-2' },
        upserts: res.permitsOut.map((p) => ({
          id: p.id,
          expected_updated_at: p.updated_at,
        })),
      },
      'fix382',
    );
    expect(again.conflict).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The SQL says what the mirror says
// ---------------------------------------------------------------------------

describe('fix-382 — the migration itself', () => {
  it('★★★ checks and locks the children BEFORE any write', () => {
    const step0 = sqlCode.indexOf('FOR UPDATE');
    const firstWrite = sqlCode.search(/UPDATE\s+public\.(projects|permits)\s+SET/);
    expect(step0).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(step0).toBeLessThan(firstWrite);
    // Parent first, then children — the cascade's own order, so two savers
    // queue instead of deadlocking.
    expect(sqlCode.indexOf('public.projects WHERE id = p_project_id FOR UPDATE'))
      .toBeLessThan(sqlCode.indexOf('FROM public.permits'));
  });

  it('★★★ still raises a permit conflict — the check moved, it was not dropped', () => {
    expect(sqlCode).toMatch(/v_kind\s*:=\s*'permit'/);
    expect(sqlCode).toMatch(/v_kind\s*:=\s*'project'/);
    expect(sqlCode).toMatch(/RAISE EXCEPTION 'occ_conflict'/);
    expect(sqlCode).toContain(
      "v_pre_ua IS DISTINCT FROM (v_elem->>'expected_updated_at')::timestamptz",
    );
  });

  it('★★★ the permit UPDATE no longer carries the stale expectation', () => {
    const loop = sqlCode.slice(sqlCode.indexOf('UPDATE public.permits SET'));
    const updateStmt = loop.slice(0, loop.indexOf('RETURNING'));
    expect(updateStmt).toContain('WHERE id = (v_elem->>\'id\')::int');
    expect(updateStmt).toContain('AND project_id = p_project_id');
    // ★ this predicate is the bug; it must not come back.
    expect(updateStmt).not.toMatch(/updated_at\s*=\s*\(v_elem/);
  });

  it('★★★ the permits are written BEFORE the project patch', () => {
    expect(sqlCode.indexOf('UPDATE public.permits SET')).toBeLessThan(
      sqlCode.indexOf('UPDATE public.projects SET'),
    );
  });

  it('★★ the rejected transaction_timestamp() rule is not in the code', () => {
    // It would silently absorb a stranger's edit into our own cascade.
    expect(sqlCode).not.toContain('transaction_timestamp');
    expect(sqlCode).not.toContain('pg_current_xact_id');
  });

  it('★★ the cascade is untouched — no trigger is dropped or altered here', () => {
    expect(sqlCode).not.toMatch(/DROP\s+TRIGGER/i);
    expect(sqlCode).not.toMatch(/CREATE\s+(OR REPLACE\s+)?TRIGGER/i);
    expect(sqlCode).not.toMatch(/ALTER\s+TABLE/i);
  });

  it('★★★ no row is edited by this migration', () => {
    const ddl = migrationSql.replace(/^\s*--.*$/gm, '');
    const fnBody = ddl.slice(ddl.indexOf('$function$'));
    const outside = ddl.slice(0, ddl.indexOf('$function$'));
    expect(outside).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    // Everything that writes lives inside the function it defines.
    expect(fnBody).toContain('CASE WHEN v_elem');
  });

  it('★ returns the final updated_at, read after the cascade', () => {
    const step3 = sqlCode.indexOf('unnest(v_permit_ids)');
    expect(step3).toBeGreaterThan(sqlCode.indexOf('UPDATE public.projects SET'));
    expect(sqlCode).toContain("jsonb_build_object('id', p.id, 'updated_at', p.updated_at)");
  });
});
