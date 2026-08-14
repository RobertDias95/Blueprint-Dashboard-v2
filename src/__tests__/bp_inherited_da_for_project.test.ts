import { describe, it, expect } from 'vitest';

// ★ fix-312 RETARGETED THIS FILE. It was fix-302's contract spec for "a
// secondary permit inherits the Building Permit's DA" — the function, the
// BEFORE INSERT trigger, and the backfill. fix-302 was wrong: it put a design
// associate on 102 permits that should not have one, and every ULS/IPR/LBA it
// touched came out equal to its project's BP DA, which is a cascade signature
// rather than human judgement.
//
//   Bobby: "A design associate and/or design manager should never be assigned
//   to a ULS. IPR records, never assigned ... I don't want us to make that rule
//   right now. I just kind of want us to undo all the design associates that
//   just got assigned to all those permits."
//
// So the trigger and its function are DROPPED and the writes reverted.
// Assignment is manual, by a human, at project creation. No replacement rule,
// no permit-type exclusion list — that was explicitly declined.
//
// What survives, and why this file was retargeted rather than deleted:
//   * bp_inherited_da_for_project(uuid) is KEPT. It reads and returns; it
//     assigns nothing. It is what makes the revert's predicate checkable, and
//     re-runnable later to see what the cascade WOULD have done. The danger was
//     never the function — it was the trigger that called it.
//   * the mirror below is now the spec for the REVERT, not the backfill.
//
// No live DB in CI (fix-153 / fix-220 / fix-244 precedent), so this is a
// pure-TS mirror of the SQL rule plus a documented read-only PROD probe.
// If the SQL and this mirror ever disagree, one of them is wrong — they are
// written to be read side by side.
//
// ---------------------------------------------------------------------------
// PROD PROBE (2026-08-14, project eibnmwthkcuumyclyxoe, READ-ONLY, pre-revert)
//
//   fix-302's fingerprint, 99 rows sharing updated_at = 2026-08-13 21:28:
//     ULS 71 · IPR 14 · SIP 4 · TRAO 4 · Grading / Clearing 2 · LSM 2 ·
//     Condo 1 · ECA Waiver 1        — no Building Permit, no Demolition.
//
//   ★ AND 8 MORE THE BRIEF DID NOT KNOW ABOUT. The brief models fix-302 as a
//   one-shot backfill, but its TRIGGER stayed live for a day afterwards and
//   assigned a DA to 8 permits CREATED since (6 ULS, 1 LBA, 1 TRAO — all
//   Ainsley, all equal to their project's BP DA, all scraped LU records the
//   scraper never sets `da` on). Those are cascade writes too, and 6 of them
//   are the exact type Bobby said must never carry a DA. Reverted with the 99.
//
//   3 backfill rows have drifted off the timestamp and are LEFT ALONE, listed
//   for Bobby rather than reverted silently (brief section 2).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mirror of SQL bp_inherited_da_for_project(uuid)
//   SELECT CASE WHEN count(DISTINCT btrim(da)) = 1 THEN min(btrim(da)) END
//   FROM permits
//   WHERE project_id = $1 AND type = 'Building Permit'
//     AND parent_permit_id IS NULL AND da IS NOT NULL AND btrim(da) <> '';
// ---------------------------------------------------------------------------
interface Row {
  project_id: string;
  type: string;
  da: string | null;
  parent_permit_id?: number | null;
}

function bpInheritedDaForProject(rows: Row[], projectId: string): string | null {
  const das = new Set(
    rows
      .filter(
        (r) =>
          r.project_id === projectId &&
          r.type === 'Building Permit' &&
          (r.parent_permit_id ?? null) === null &&
          r.da !== null &&
          r.da.trim() !== '',
      )
      .map((r) => r.da!.trim()),
  );
  // count(DISTINCT ...) = 1 → that value; 0 or >1 → NULL (SQL CASE falls through).
  return das.size === 1 ? [...das][0]! : null;
}

/** ★ fix-312: mirror of INSERT with NO trigger on the table. The row is stored
 *  with exactly the `da` the caller supplied — nothing is derived, nothing is
 *  filled in. `existing` is still a parameter so the test can hand this a
 *  project whose BP HAS a DA and prove it is not consulted. */
function onInsert(_existing: Row[], incoming: Row): string | null {
  return incoming.da;
}

const BP = (project_id: string, da: string | null, extra: Partial<Row> = {}): Row => ({
  project_id,
  type: 'Building Permit',
  da,
  parent_permit_id: null,
  ...extra,
});

describe('fix-302 bp_inherited_da_for_project — the rule', () => {
  it('returns the BP DA when the project has exactly one', () => {
    expect(bpInheritedDaForProject([BP('p1', 'Trevor')], 'p1')).toBe('Trevor');
  });

  it('returns null when the Building Permits DISAGREE (ambiguous is not a source)', () => {
    const rows = [BP('p1', 'Trevor'), BP('p1', 'Ainsley')];
    expect(bpInheritedDaForProject(rows, 'p1')).toBeNull();
  });

  it('treats multiple BPs naming the SAME DA as unambiguous', () => {
    const rows = [BP('p1', 'Trevor'), BP('p1', 'Trevor')];
    expect(bpInheritedDaForProject(rows, 'p1')).toBe('Trevor');
  });

  it('returns null when there is no Building Permit at all', () => {
    expect(bpInheritedDaForProject([], 'p1')).toBeNull();
  });

  it('returns null when the Building Permit has no DA', () => {
    expect(bpInheritedDaForProject([BP('p1', null)], 'p1')).toBeNull();
  });

  it('ignores a blank/whitespace DA rather than inheriting it', () => {
    expect(bpInheritedDaForProject([BP('p1', '   ')], 'p1')).toBeNull();
  });

  it('trims, so " Trevor " and "Trevor" are one DA and not an ambiguity', () => {
    const rows = [BP('p1', ' Trevor '), BP('p1', 'Trevor')];
    expect(bpInheritedDaForProject(rows, 'p1')).toBe('Trevor');
  });

  it('ignores SUB Building Permits as a source (they are placeholders)', () => {
    const rows = [BP('p1', 'Trevor'), BP('p1', 'Cam', { parent_permit_id: 7 })];
    expect(bpInheritedDaForProject(rows, 'p1')).toBe('Trevor');
  });

  it('never reads across projects', () => {
    expect(bpInheritedDaForProject([BP('p2', 'Trevor')], 'p1')).toBeNull();
  });
});

describe('fix-312 there is no cascade — a new permit never inherits a DA', () => {
  // A project whose Building Permit names a DA. Before fix-312 this was the
  // source every new secondary permit copied from.
  const project = [BP('p1', 'Trevor')];

  // ★ THE ACCEPTANCE TEST. Under fix-302 this returned 'Trevor'.
  it('★ a new ULS on a project whose BP has a DA gets NO DA', () => {
    expect(onInsert(project, { project_id: 'p1', type: 'ULS', da: null })).toBeNull();
  });

  it('and neither does any other type — IPR, LBA and the rest', () => {
    for (const type of [
      'IPR', 'LBA', 'SIP', 'LSM', 'Condo', 'TRAO', 'PPR',
      'ECA Waiver', 'Grading / Clearing', 'Building Permit', 'Demolition',
    ]) {
      expect(
        onInsert(project, { project_id: 'p1', type, da: null }),
        `${type} must not inherit`,
      ).toBeNull();
    }
  });

  // ★ Removing the cascade must not break ordinary assignment. This is the
  // half a revert usually gets wrong: deleting the rule AND the thing it was
  // bolted onto.
  it('★ an explicitly-supplied DA is still honoured on create', () => {
    expect(onInsert(project, { project_id: 'p1', type: 'ULS', da: 'Ainsley' })).toBe(
      'Ainsley',
    );
    // Including when it happens to match the BP's — a human may well assign
    // the same person; nothing about that is the cascade.
    expect(onInsert(project, { project_id: 'p1', type: 'ULS', da: 'Trevor' })).toBe(
      'Trevor',
    );
  });

  it('a blank string stays blank rather than being filled', () => {
    expect(onInsert(project, { project_id: 'p1', type: 'ULS', da: '  ' })).toBe('  ');
  });

  it('the BP DA is not consulted at all — an ambiguous one changes nothing', () => {
    const ambiguous = [BP('p1', 'Trevor'), BP('p1', 'Ainsley')];
    expect(onInsert(ambiguous, { project_id: 'p1', type: 'ULS', da: null })).toBeNull();
    // ...and neither does an unambiguous one. Same answer either way, which is
    // the point: the source is no longer read.
    expect(onInsert(project, { project_id: 'p1', type: 'ULS', da: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ★ fix-312: mirror of the REVERT's WHERE clause. This replaces fix-302's
// backfill mirror — the backfill is gone, and what needs pinning now is that
// the undo is SCOPED. A blanket "clear da on every ULS" would be easy, wrong,
// and would destroy the 7 ULS assignments that predate 13 August.
//
// The predicate has three parts and needs all of them:
//   * the fingerprint — fix-302's backfill timestamp, OR created after it
//     (the trigger stayed live for a day and assigned 8 more);
//   * da equals the project's BP DA — the cascade signature, and the
//     belt-and-braces that makes a coincidental timestamp match harmless;
//   * never a Building Permit, never a Demolition, never a sub-permit.
//
// audit_log recorded NOTHING for fix-302's writes — a migration-driven UPDATE
// does not go through the app's audit path — so there is no stored prior value
// to restore. Every row it touched went blank -> the BP's DA (its WHERE clause
// required `da IS NULL OR btrim(da) = ''`), so the undo is: back to NULL.
// ---------------------------------------------------------------------------

/** fix-302 ran at this instant; its 99 surviving rows still carry it. */
const FIX302_AT = '2026-08-13T21:28:00Z';
const FIX302_WINDOW_END = '2026-08-13T21:29:00Z';

interface RevertRow extends Row {
  id: number;
  created_at: string;
  updated_at: string;
}

function revertTargets(rows: RevertRow[]): RevertRow[] {
  return rows.filter((r) => {
    if (r.type === 'Building Permit' || r.type === 'Demolition') return false;
    if ((r.parent_permit_id ?? null) !== null) return false;
    if (r.da === null || r.da.trim() === '') return false;
    const bpDa = bpInheritedDaForProject(rows, r.project_id);
    if (bpDa === null || r.da.trim() !== bpDa) return false;
    const backfilled = r.updated_at >= FIX302_AT && r.updated_at < FIX302_WINDOW_END;
    const triggerCreated = r.created_at >= FIX302_AT;
    return backfilled || triggerCreated;
  });
}

/** Apply the revert, so idempotency is testable. */
function applyRevert(rows: RevertRow[]): { rows: RevertRow[]; changed: number } {
  const targets = new Set(revertTargets(rows).map((r) => r.id));
  const next = rows.map((r) => (targets.has(r.id) ? { ...r, da: null } : r));
  return { rows: next, changed: targets.size };
}

describe('fix-312 the revert is scoped, not a blanket wipe', () => {
  const OLD = '2026-06-01T00:00:00Z';
  const BACKFILLED = '2026-08-13T21:28:00Z';
  const DRIFTED = '2026-08-14T15:46:59Z';

  const fixture: RevertRow[] = [
    { id: 1, ...BP('p1', 'Trevor'), created_at: OLD, updated_at: OLD },
    // fix-302's backfill: blank -> Trevor, carrying the fingerprint.
    { id: 2, project_id: 'p1', type: 'ULS', da: 'Trevor', parent_permit_id: null,
      created_at: OLD, updated_at: BACKFILLED },
    { id: 3, project_id: 'p1', type: 'IPR', da: 'Trevor', parent_permit_id: null,
      created_at: OLD, updated_at: BACKFILLED },
    // ★ the 7 pre-existing ULS: a DA a person typed, long before 13 August.
    { id: 4, project_id: 'p1', type: 'ULS', da: 'Cam', parent_permit_id: null,
      created_at: OLD, updated_at: OLD },
    // ...including one that HAPPENS to equal the BP DA. Only the timestamp
    // saves it, which is why the timestamp is the strong discriminator.
    { id: 5, project_id: 'p1', type: 'ULS', da: 'Trevor', parent_permit_id: null,
      created_at: OLD, updated_at: OLD },
    // ★ created AFTER fix-302 — the live trigger assigned this one.
    { id: 6, project_id: 'p1', type: 'ULS', da: 'Trevor', parent_permit_id: null,
      created_at: '2026-08-14T19:33:03Z', updated_at: '2026-08-14T19:40:13Z' },
    // ...but a human's explicit choice on a new permit is NOT the cascade.
    { id: 7, project_id: 'p1', type: 'ULS', da: 'Ainsley', parent_permit_id: null,
      created_at: '2026-08-14T19:33:03Z', updated_at: '2026-08-14T19:40:13Z' },
    // ★ drifted: fix-302 wrote it, but it has been touched since. Left alone.
    { id: 8, project_id: 'p1', type: 'PPR', da: 'Trevor', parent_permit_id: null,
      created_at: OLD, updated_at: DRIFTED },
    // never in scope, whatever the timestamp says
    { id: 9, project_id: 'p1', type: 'Demolition', da: 'Trevor', parent_permit_id: null,
      created_at: OLD, updated_at: BACKFILLED },
    { id: 10, project_id: 'p1', type: 'ULS', da: 'Trevor', parent_permit_id: 1,
      created_at: OLD, updated_at: BACKFILLED },
  ];

  it('selects the backfilled rows and the trigger-created one, and nothing else', () => {
    expect(revertTargets(fixture).map((r) => r.id).sort((a, b) => a - b)).toEqual([2, 3, 6]);
  });

  it('★ the pre-existing ULS keep their DA — including the one matching the BP', () => {
    const { rows } = applyRevert(fixture);
    expect(rows.find((r) => r.id === 4)!.da).toBe('Cam');
    expect(rows.find((r) => r.id === 5)!.da).toBe('Trevor');
  });

  it('★ a drifted row is left exactly as it is, to be listed rather than reverted', () => {
    const { rows } = applyRevert(fixture);
    expect(rows.find((r) => r.id === 8)!.da).toBe('Trevor');
  });

  it('an explicit DA on a permit created after fix-302 survives', () => {
    const { rows } = applyRevert(fixture);
    expect(rows.find((r) => r.id === 7)!.da).toBe('Ainsley');
  });

  it('never touches a Building Permit, a Demolition or a sub-permit', () => {
    const { rows } = applyRevert(fixture);
    expect(rows.find((r) => r.id === 1)!.da).toBe('Trevor');
    expect(rows.find((r) => r.id === 9)!.da).toBe('Trevor');
    expect(rows.find((r) => r.id === 10)!.da).toBe('Trevor');
  });

  it('★ is idempotent — the second run changes nothing', () => {
    const first = applyRevert(fixture);
    expect(first.changed).toBe(3);
    const second = applyRevert(first.rows);
    expect(second.changed).toBe(0);
    expect(second.rows).toEqual(first.rows);
  });

  // ★ `da` is volume credit on the Team performance report, so the revert
  // MOVES REPORTED NUMBERS. That is a correction, not a regression, but it has
  // to be stated rather than discovered — so the expected new figures are
  // written down here, not asserted loosely.
  //
  // Measured on prod for the real revert (before -> after):
  //   Ainsley 46->25 · Ahmadi 42->22 · Marc 42->26 · Francesca 31->17 ·
  //   Fisk 39->27 · Trevor 27->15 · Nidhi 7->3 · Chad 4->2 · Nicky 25->23 ·
  //   Qisheng 20->18 · Alex 4->3 · Erick 8->7 · Cam 93->93 · Shire 4->4
  // Cam is unchanged, which is itself a check: fix-302 excluded Demolition and
  // Cam holds 85 of 93 Demolition permits.
  it('★ moves volume credit by exactly the reverted rows, and no further', () => {
    const credit = (rows: RevertRow[]): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const r of rows) {
        if (r.da === null || r.da.trim() === '') continue;
        out[r.da.trim()] = (out[r.da.trim()] ?? 0) + 1;
      }
      return out;
    };
    // Trevor holds the BP, both backfilled rows, the trigger-created one, the
    // drifted one, the two never-in-scope rows and the coincidental match.
    expect(credit(fixture)).toEqual({ Trevor: 8, Cam: 1, Ainsley: 1 });

    const { rows } = applyRevert(fixture);
    // Exactly 3 come off Trevor — ids 2, 3 and 6. Nobody else moves at all.
    expect(credit(rows)).toEqual({ Trevor: 5, Cam: 1, Ainsley: 1 });
  });

  it('touches `da` only — no other column is written', () => {
    const { rows } = applyRevert(fixture);
    const withoutDa = (r: RevertRow): Partial<RevertRow> => {
      const copy: Partial<RevertRow> = { ...r };
      delete copy.da;
      return copy;
    };
    for (const before of fixture) {
      const after = rows.find((r) => r.id === before.id)!;
      expect(withoutDa(after)).toEqual(withoutDa(before));
    }
  });
});
