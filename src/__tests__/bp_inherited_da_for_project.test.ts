import { describe, it, expect } from 'vitest';

// fix-302: contract spec for the SQL side of "a secondary permit inherits the
// Building Permit's DA" (migrations/fix_302_permits_inherit_bp_da.sql:
// bp_inherited_da_for_project + the BEFORE INSERT trigger + the backfill).
//
// No live DB in CI (fix-153 / fix-220 / fix-244 precedent), so this is a
// pure-TS mirror of the SQL rule plus a documented read-only PROD probe.
// If the SQL and this mirror ever disagree, one of them is wrong — they are
// written to be read side by side.
//
// ---------------------------------------------------------------------------
// PROD PROBE (2026-08-13, project eibnmwthkcuumyclyxoe, READ-ONLY, pre-fix)
//
//   Every function that writes permits.da is a reassignment or a rename:
//     bp_move_draw_schedule_da      WHERE da IS NOT NULL AND da = v_old_da
//     bp_undo_project_da_reassign   WHERE p.da = v_h.to_da
//     bp_rename_da                  WHERE da = p_old
//     bp_reassign_project_da        fills NULLs, but only on an explicit handoff
//     bp_update_project_with_permits writes whatever the client sent
//   None can fill a blank on create. The DA cascade was never written; the
//   ent_lead one (bp_cascade_ent_lead_for_project) is the pattern, and its
//   second branch exists specifically to feed permits whose da IS NULL.
//
//   Active permits 244; active with no DA 107 (43.9%); of those:
//     Demolition 5 · non-Demo with exactly ONE BP DA 102 · ambiguous 0 ·
//     no BP DA 0 · themselves a Building Permit 0 · missing ent_lead 0.
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

/** Mirror of the BEFORE INSERT trigger bp_trg_permits_inherit_da(). Returns the
 *  `da` the row is stored with. */
function onInsert(existing: Row[], incoming: Row): string | null {
  if (incoming.da !== null && incoming.da.trim() !== '') return incoming.da;
  if (incoming.type === 'Demolition') return incoming.da;
  const inherited = bpInheritedDaForProject(existing, incoming.project_id);
  // Only ever writes a value — never nulls, never trims, never overwrites.
  return inherited !== null ? inherited : incoming.da;
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

describe('fix-302 the cascade on INSERT', () => {
  const project = [BP('p1', 'Trevor')];

  it('a new secondary permit inherits the BP DA', () => {
    for (const type of ['ULS', 'IPR', 'SIP', 'LSM', 'Condo', 'Grading / Clearing']) {
      expect(onInsert(project, { project_id: 'p1', type, da: null })).toBe('Trevor');
    }
  });

  it('an explicitly-set DA is NEVER overwritten', () => {
    expect(onInsert(project, { project_id: 'p1', type: 'ULS', da: 'Ainsley' })).toBe(
      'Ainsley',
    );
  });

  it('a permit created where the BP has NO DA gets none, and does not error', () => {
    expect(onInsert([BP('p1', null)], { project_id: 'p1', type: 'ULS', da: null })).toBeNull();
  });

  it('a permit on a project with no Building Permit at all gets none', () => {
    expect(onInsert([], { project_id: 'p1', type: 'ULS', da: null })).toBeNull();
  });

  it('★ Demolition does NOT auto-inherit — left for a person (brief section 2)', () => {
    expect(onInsert(project, { project_id: 'p1', type: 'Demolition', da: null })).toBeNull();
  });

  it('Demolition with an explicit DA keeps it (the refusal only blocks guessing)', () => {
    expect(onInsert(project, { project_id: 'p1', type: 'Demolition', da: 'Cam' })).toBe(
      'Cam',
    );
  });

  it('an ambiguous BP DA is not guessed at', () => {
    const rows = [BP('p1', 'Trevor'), BP('p1', 'Ainsley')];
    expect(onInsert(rows, { project_id: 'p1', type: 'ULS', da: null })).toBeNull();
  });

  it('a blank-string DA is treated as unset and filled', () => {
    expect(onInsert(project, { project_id: 'p1', type: 'ULS', da: '  ' })).toBe('Trevor');
  });

  it('a second Building Permit with no DA also inherits (fill-blanks applies to BPs too)', () => {
    expect(
      onInsert(project, { project_id: 'p1', type: 'Building Permit', da: null }),
    ).toBe('Trevor');
  });
});

// ---------------------------------------------------------------------------
// Mirror of the backfill's WHERE clause. "Active" is the codebase's canonical
// rule, not an ad-hoc one — isPermitDone + isSubPermit + isCancelledProject.
// ---------------------------------------------------------------------------
const DONE_STATUSES = ['Issued', 'Completed', 'Finaled', 'Closed', 'Withdrawn'];

interface BackfillRow extends Row {
  id: number;
  actual_issue?: string | null;
  status?: string | null;
  project_cancelled?: boolean;
}

function backfillTargets(rows: BackfillRow[]): BackfillRow[] {
  return rows.filter((r) => {
    if (!(r.da === null || r.da.trim() === '')) return false;
    if (r.type === 'Demolition') return false;
    if ((r.parent_permit_id ?? null) !== null) return false;
    if ((r.actual_issue ?? null) !== null) return false;
    if (DONE_STATUSES.includes((r.status ?? '').trim())) return false;
    if (r.project_cancelled) return false;
    return bpInheritedDaForProject(rows, r.project_id) !== null;
  });
}

/** Apply the backfill, returning the new rows — so idempotency is testable. */
function applyBackfill(rows: BackfillRow[]): { rows: BackfillRow[]; changed: number } {
  const targets = new Set(backfillTargets(rows).map((r) => r.id));
  const next = rows.map((r) =>
    targets.has(r.id) ? { ...r, da: bpInheritedDaForProject(rows, r.project_id) } : r,
  );
  return { rows: next, changed: targets.size };
}

describe('fix-302 the backfill', () => {
  const fixture: BackfillRow[] = [
    { id: 1, ...BP('p1', 'Trevor') },
    { id: 2, project_id: 'p1', type: 'ULS', da: null, parent_permit_id: null },
    { id: 3, project_id: 'p1', type: 'Demolition', da: null, parent_permit_id: null },
    // issued → outside the active set, left alone
    { id: 4, project_id: 'p1', type: 'IPR', da: null, parent_permit_id: null, status: 'Issued' },
    { id: 5, project_id: 'p1', type: 'SIP', da: null, parent_permit_id: null, actual_issue: '2026-01-01' },
    // sub-permit → excluded
    { id: 6, project_id: 'p1', type: 'ULS', da: null, parent_permit_id: 1 },
    // cancelled project → excluded
    { id: 7, ...BP('p2', 'Cam') },
    { id: 8, project_id: 'p2', type: 'ULS', da: null, parent_permit_id: null, project_cancelled: true },
    // explicit DA → untouched
    { id: 9, project_id: 'p1', type: 'Condo', da: 'Ainsley', parent_permit_id: null },
  ];

  it('selects exactly the active, non-Demolition, inheritable blanks', () => {
    expect(backfillTargets(fixture).map((r) => r.id)).toEqual([2]);
  });

  it('fills the target with the BP DA', () => {
    const { rows } = applyBackfill(fixture);
    expect(rows.find((r) => r.id === 2)!.da).toBe('Trevor');
  });

  it('★ is idempotent — the second run changes nothing', () => {
    const first = applyBackfill(fixture);
    expect(first.changed).toBe(1);
    const second = applyBackfill(first.rows);
    expect(second.changed).toBe(0);
    expect(second.rows).toEqual(first.rows);
  });

  it('never touches Demolition, subs, issued rows, cancelled projects or explicit DAs', () => {
    const { rows } = applyBackfill(fixture);
    for (const id of [3, 4, 5, 6, 8]) {
      expect(rows.find((r) => r.id === id)!.da, `row ${id} must stay blank`).toBeNull();
    }
    expect(rows.find((r) => r.id === 9)!.da).toBe('Ainsley');
  });

  it('touches `da` only — no other column is written', () => {
    const { rows } = applyBackfill(fixture);
    for (const before of fixture) {
      const after = rows.find((r) => r.id === before.id)!;
      const { da: _daA, ...restAfter } = after;
      const { da: _daB, ...restBefore } = before;
      expect(restAfter).toEqual(restBefore);
    }
  });
});
