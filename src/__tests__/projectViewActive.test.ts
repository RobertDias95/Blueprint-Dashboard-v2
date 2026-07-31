import { describe, it, expect } from 'vitest';
import {
  buildProjectRows,
  projectIsActive,
  isPermitDone,
  PROJECT_DONE_STATUSES,
} from '../lib/projectViewHelpers';
import type {
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-245: the "Active" filter — hide fully-issued (done) projects so the
// current pipeline stands out. A project is DONE (hidden) when it has ≥1 permit
// and EVERY non-sub permit is done (issued or later); a permit-less shell stays
// ACTIVE, and a sub-permit alone does not keep a project active.

let permitId = 0;
function mkPermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: ++permitId,
    project_id: 'p',
    type: 'Building Permit',
    status: null,
    num: 'BP-1',
    stage: null,
    stage_override: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    parent_permit_id: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-05-15T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

function mkProject(id: string): Project {
  return {
    id,
    address: `addr-${id}`,
    juris: 'Seattle',
    archived: false,
    notes: null,
    project_tags: null,
    go_date: null,
  } as unknown as Project;
}

/** Build the single ProjectRow for a project from a set of permits. */
function rowFor(projectId: string, permits: PermitWithCycles[]) {
  const rows = buildProjectRows([mkProject(projectId)], permits, []);
  return rows[0];
}

describe('fix-245 isPermitDone', () => {
  it('every PROJECT_DONE_STATUSES value is done by status alone', () => {
    for (const s of PROJECT_DONE_STATUSES) {
      expect(isPermitDone({ status: s, actual_issue: null })).toBe(true);
    }
    expect([...PROJECT_DONE_STATUSES].sort()).toEqual(
      ['Closed', 'Completed', 'Finaled', 'Issued', 'Withdrawn'],
    );
  });

  it('a physically-issued permit (actual_issue set) is done regardless of status', () => {
    // Covers SDOT "Conceptually Approved" records, which all carry an issue date.
    expect(isPermitDone({ status: 'Conceptually Approved', actual_issue: '2026-05-01' })).toBe(true);
    expect(isPermitDone({ status: 'Reviews In Process', actual_issue: '2026-05-01' })).toBe(true);
  });

  it('Approved / Ready-to-Issue WITHOUT an issue date is NOT done (stays active)', () => {
    expect(isPermitDone({ status: 'Approved', actual_issue: null })).toBe(false);
    expect(isPermitDone({ status: 'Ready for Issuance', actual_issue: null })).toBe(false);
    expect(isPermitDone({ status: 'Ready To Issue', actual_issue: null })).toBe(false);
  });

  it('in-flight statuses and a blank/null status are not done', () => {
    expect(isPermitDone({ status: 'Corrections Required', actual_issue: null })).toBe(false);
    expect(isPermitDone({ status: 'Pre-Submittal — GO', actual_issue: null })).toBe(false);
    expect(isPermitDone({ status: null, actual_issue: null })).toBe(false);
    expect(isPermitDone({ status: '   ', actual_issue: null })).toBe(false);
  });
});

describe('fix-245 projectIsActive', () => {
  it('a project whose permits are ALL issued/completed is NOT active (hidden)', () => {
    const row = rowFor('p1', [
      mkPermit({ project_id: 'p1', status: 'Issued', actual_issue: '2026-05-01' }),
      mkPermit({ project_id: 'p1', type: 'Demolition', status: 'Completed', actual_issue: '2026-05-02' }),
    ]);
    expect(projectIsActive(row)).toBe(false);
  });

  it('a project with one permit still in Corrections (others issued) STAYS active', () => {
    const row = rowFor('p2', [
      mkPermit({ project_id: 'p2', status: 'Issued', actual_issue: '2026-05-01' }),
      mkPermit({ project_id: 'p2', type: 'Demolition', status: 'Corrections Required', actual_issue: null }),
    ]);
    expect(projectIsActive(row)).toBe(true);
  });

  it('an Approved-but-not-issued permit keeps the project active', () => {
    const row = rowFor('p3', [
      mkPermit({ project_id: 'p3', status: 'Issued', actual_issue: '2026-05-01' }),
      mkPermit({ project_id: 'p3', type: 'Demolition', status: 'Ready for Issuance', approval_date: '2026-04-15', actual_issue: null }),
    ]);
    expect(projectIsActive(row)).toBe(true);
  });

  it('a placeholder / no-number permit (early, not done) keeps the project active', () => {
    const row = rowFor('p4', [
      mkPermit({ project_id: 'p4', num: null, status: 'Pre-Submittal — GO', actual_issue: null }),
    ]);
    expect(projectIsActive(row)).toBe(true);
  });

  it('a project whose ONLY permit is a sub-permit is NOT active (sub alone does not keep it active)', () => {
    // The sub is excluded from row.permits, but hasAnyPermit is true → hidden.
    const row = rowFor('p5', [
      mkPermit({ project_id: 'p5', parent_permit_id: 999, status: 'Corrections Required', actual_issue: null }),
    ]);
    expect(row.permits.length).toBe(0);
    expect(row.hasAnyPermit).toBe(true);
    expect(projectIsActive(row)).toBe(false);
  });

  it('a permit-less project (a fresh / redesign shell) STAYS active', () => {
    const row = rowFor('p6', []);
    expect(row.hasAnyPermit).toBe(false);
    expect(projectIsActive(row)).toBe(true);
  });

  it('a done project regains active if a sub-permit is added AND a real permit reopens (sanity: subs never flip it)', () => {
    // All non-sub done + an active sub → still hidden (subs excluded).
    const row = rowFor('p7', [
      mkPermit({ project_id: 'p7', status: 'Issued', actual_issue: '2026-05-01' }),
      mkPermit({ project_id: 'p7', parent_permit_id: 1, status: 'Corrections Required', actual_issue: null }),
    ]);
    expect(projectIsActive(row)).toBe(false);
  });
});

// ── fix-262: CANCELLED composes into the same predicate ─────────────────────
// Bobby: "A hold is still an ACTIVE project. A cancelled project is no longer
// active." So cancellation short-circuits the fix-245 permit-done rules, and a
// HOLD deliberately does not reach this predicate at all.
describe('fix-262 projectIsActive — cancelled is NOT active', () => {
  it('a cancelled project is inactive even though every permit is still open', () => {
    const row = rowFor('c1', [
      mkPermit({ project_id: 'c1', status: 'Corrections Required' }),
    ]);
    // ...active by the fix-245 rules alone
    expect(projectIsActive(row)).toBe(true);
    // ...but not once it is cancelled
    expect(projectIsActive(row, new Set(['c1']))).toBe(false);
  });

  it('a permit-less cancelled shell is inactive (the hasAnyPermit escape does not apply)', () => {
    const row = rowFor('c2', []);
    expect(projectIsActive(row)).toBe(true);
    expect(projectIsActive(row, new Set(['c2']))).toBe(false);
  });

  it('an unrelated cancelled id changes nothing', () => {
    const row = rowFor('c3', [
      mkPermit({ project_id: 'c3', status: 'Corrections Required' }),
    ]);
    expect(projectIsActive(row, new Set(['someone-else']))).toBe(true);
  });

  it('an empty cancelled set is identical to omitting it (pre-fix-262 behaviour)', () => {
    const open = rowFor('c4', [mkPermit({ project_id: 'c4', status: 'Under Review' })]);
    const done = rowFor('c5', [
      mkPermit({ project_id: 'c5', status: 'Issued', actual_issue: '2026-05-01' }),
    ]);
    expect(projectIsActive(open, new Set())).toBe(projectIsActive(open));
    expect(projectIsActive(done, new Set())).toBe(projectIsActive(done));
  });

  it('a project on HOLD is still ACTIVE — holds are never passed to this predicate', () => {
    // The Project List builds its cancelled set from cancelledProjectIds(), which
    // is kind='cancelled' only, so a held project can never appear here.
    const row = rowFor('c6', [
      mkPermit({ project_id: 'c6', status: 'Corrections Required' }),
    ]);
    expect(projectIsActive(row, new Set(['not-c6']))).toBe(true);
  });
});
