import { describe, it, expect } from 'vitest';
import type { AutoEvent } from '../lib/database.types';
import { NO_ISSUANCE_PERMIT_TYPES } from '../lib/permitTypeTaxonomy';

// fix-155/fix-156: contract spec for the lifecycle auto-task engine.
//
// The engine is SQL — bp_create_lifecycle_task + bp_generate_number_entry_tasks
// (migrations/fix_155_*.sql, fix_156_*.sql). No live DB in CI (the fix-153
// precedent), so the canonical verification is a rolled-back MCP probe against
// PROD. fix-156 re-probed (2026-06-12); verbatim output:
//
//   CREATE shape (permit ent_lead='PermitEnt', da='PermitDA'):
//     number_entry  -> bucket=de stage=de assigned_to=NULL priority=false city_chk=false derived_primary=PermitEnt
//     corr_issued c1-> bucket=pm stage=pm assigned_to=NULL priority=true  city_chk=false derived_primary=PermitEnt
//   (fix-156: assigned_to is no longer written; assignment is DERIVED at read
//    time, discipline='ent' -> permits.ent_lead, identical to human tasks.)
//   number_entry is bucket='de' (pre-submission D&E); the other four events
//   are bucket='pm' (post-submission Permitting).
//   Backfill: 25 number_entry rows pm->de; 26 auto-tasks assigned_to->NULL;
//   51 audit_log rows (25 + 26). Post-state: 0 auto-tasks still have assigned_to.
//   Bidirectional: UPDATE permits.ent_lead 'OldEnt'->'NewEnt' re-points the
//   derived primary with NO write to permit_tasks (read-time derivation).
//   (entire probe rolled back.)
//
// The pure functions below mirror the SQL so the contract is regression-guarded.

const EVENTS: AutoEvent[] = [
  'intake_submitted',
  'intake_accepted',
  'corr_issued',
  'resubmitted',
  'number_entry',
  'scrape_reconcile',
  'results_ready',
];

function nullifTrim(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

interface SeedPermit {
  num: string | null;
  ent_lead: string | null;
  da: string | null;
  type: string | null;
}
interface SeedProject {
  address: string | null;
}

interface BuiltTask {
  title: string;
  cityCheck: boolean;
  priority: boolean;
  bucket: 'de' | 'pm';
  /** fix-156: the creator no longer writes an assignee. */
  assignedTo: null;
}

/** Mirror of bp_create_lifecycle_task: title + flags + bucket per event.
 *  fix-156: bucket = lifecycle phase (number_entry => 'de' pre-submission, the
 *  rest => 'pm' post-submission); assigned_to is never written. */
/** fix-159: extra inputs only scrape_reconcile uses. fix-181: `basis` for the
 *  results_ready title branch. */
interface ReconcileOpts {
  observedStatus?: string;
  dbStatus?: string;
  /** cycle-0 intake_accepted set? Drives bucket pm vs de. */
  c0IntakeAccepted?: boolean;
  /** fix-181: 'issued' (issuance types) vs 'approved' (no-issuance types). */
  basis?: 'issued' | 'approved';
}

/** left(btrim(v), 60) — matches the SQL title cap. */
function cap60(v: string | undefined): string {
  return (v ?? '').trim().slice(0, 60);
}

function buildLifecycleTask(
  event: string,
  permit: SeedPermit,
  project: SeedProject,
  cycleIdx: number | null,
  opts: ReconcileOpts = {},
): BuiltTask {
  if (!(EVENTS as string[]).includes(event)) {
    throw new Error(`bp_create_lifecycle_task: unknown event ${event}`);
  }
  const numLabel = nullifTrim(permit.num) ?? 'no number yet';
  const cyc = cycleIdx == null ? '?' : String(cycleIdx);
  const bucket: 'de' | 'pm' =
    event === 'number_entry'
      ? 'de'
      : event === 'scrape_reconcile'
        ? opts.c0IntakeAccepted
          ? 'pm'
          : 'de'
        : 'pm';
  let title = '';
  let cityCheck = false;
  let priority = false;
  switch (event as AutoEvent) {
    case 'intake_submitted':
      title = `Verify: intake submitted / fees paid — ${numLabel}`;
      cityCheck = true;
      break;
    case 'intake_accepted':
      title = `Verify: intake accepted — reviews starting — ${numLabel}`;
      break;
    case 'corr_issued':
      title = `Corrections issued (cycle ${cyc}) — send to consultants — ${numLabel}`;
      priority = true;
      break;
    case 'resubmitted':
      title = `Verify: city accepted resubmission (cycle ${cyc}) — ${numLabel}`;
      cityCheck = true;
      break;
    case 'number_entry':
      title = `Enter permit number — was this submitted? — ${
        nullifTrim(permit.type) ?? 'permit'
      } @ ${nullifTrim(project.address) ?? 'project'}`;
      break;
    case 'scrape_reconcile':
      title = `Reconcile: portal shows ${cap60(opts.observedStatus) || '?'} — dashboard shows ${
        cap60(opts.dbStatus) || '?'
      } — ${numLabel}`;
      priority = true;
      break;
    case 'results_ready':
      // fix-181: type-aware title; basis comes from the trigger context.
      title =
        opts.basis === 'approved'
          ? `Permit approved — send out results — ${numLabel}`
          : `Permit issued — send out approved plans / results — ${numLabel}`;
      priority = true;
      break;
  }
  return { title, cityCheck, priority, bucket, assignedTo: null };
}

// fix-181: mirror of the bp_permit_results_ready_autotask trigger's fire rule.
// Issuance types fire on actual_issue NULL->non-null; no-issuance types fire on
// approval_date NULL->non-null. AFTER UPDATE only (an INSERT has no OLD row and
// the trigger isn't attached to INSERT) — so a fresh row never fires here.
interface ResultsPermitRow {
  type: string | null;
  actual_issue: string | null;
  approval_date: string | null;
}
function resultsReadyFire(
  oldRow: ResultsPermitRow,
  newRow: ResultsPermitRow,
): { fire: boolean; basis?: 'issued' | 'approved' } {
  const noIssuance = NO_ISSUANCE_PERMIT_TYPES.has((newRow.type ?? '').trim());
  if (noIssuance) {
    if (oldRow.approval_date == null && newRow.approval_date != null) {
      return { fire: true, basis: 'approved' };
    }
    return { fire: false };
  }
  if (oldRow.actual_issue == null && newRow.actual_issue != null) {
    return { fire: true, basis: 'issued' };
  }
  return { fire: false };
}

/** Mirror of the fix-159 re-fire rule: a new scrape_reconcile is SUPPRESSED iff
 *  an OPEN (completion_status <> 'Resolved') reconcile already exists for the
 *  permit. Once the prior one is Resolved it drops out → a fresh one is allowed. */
function reconcileSuppressed(
  existingReconciles: { completion_status: string }[],
): boolean {
  return existingReconciles.some((t) => t.completion_status !== 'Resolved');
}

/** Mirror of the READ-time assignee derivation in bp_list_tasks /
 *  bp_list_permit_tasks: discipline='arch' -> permit.da, else permit.ent_lead.
 *  Pure function of the permit — so changing permits.ent_lead re-points the
 *  task with no task-row write (bidirectional). NO project-ent fallback (that's
 *  how every human task resolves too). */
function derivePrimaryAssignee(
  discipline: 'arch' | 'ent',
  permit: { da: string | null; ent_lead: string | null },
): string | null {
  return discipline === 'arch' ? permit.da : permit.ent_lead;
}

/** Mirror of the partial-unique-index dedupe key. */
function dedupeKey(
  tenant: string,
  permitId: number,
  event: AutoEvent,
  cycleIdx: number | null,
): string {
  return [tenant, permitId, event, cycleIdx ?? -1].join('|');
}

const TERMINAL_STATUSES = new Set([
  'Conceptually Approved',
  'Approved',
  'Issued',
  'Completed',
  'Closed',
  'Ready for Issuance',
  'Ready To Issue',
  'Finaled',
  'Withdrawn',
]);

interface SweepPermit {
  num: string | null;
  target_submit: string | null;
  status: string | null;
}
function eligibleForNumberEntry(p: SweepPermit, today: string): boolean {
  const numberless = nullifTrim(p.num) == null;
  const targetArrived = p.target_submit != null && p.target_submit <= today;
  const notTerminal = !TERMINAL_STATUSES.has((p.status ?? '').trim());
  return numberless && targetArrived && notTerminal;
}

const NUMBERED: SeedPermit = {
  num: 'BLD-155-A',
  ent_lead: 'PermitEnt',
  da: 'PermitDA',
  type: 'Building Permit',
};
const PROJ: SeedProject = { address: '155 Test Way' };

describe('bp_create_lifecycle_task — titles + flags (fix-155)', () => {
  it('intake_submitted: title, city check on, not priority, bucket pm', () => {
    const t = buildLifecycleTask('intake_submitted', NUMBERED, PROJ, null);
    expect(t.title).toBe('Verify: intake submitted / fees paid — BLD-155-A');
    expect(t.cityCheck).toBe(true);
    expect(t.priority).toBe(false);
    expect(t.bucket).toBe('pm');
  });

  it('intake_accepted: title, no city check, bucket pm', () => {
    const t = buildLifecycleTask('intake_accepted', NUMBERED, PROJ, null);
    expect(t.title).toBe('Verify: intake accepted — reviews starting — BLD-155-A');
    expect(t.cityCheck).toBe(false);
    expect(t.bucket).toBe('pm');
  });

  it('corr_issued: cycle in title, priority on, bucket pm', () => {
    const t = buildLifecycleTask('corr_issued', NUMBERED, PROJ, 2);
    expect(t.title).toBe(
      'Corrections issued (cycle 2) — send to consultants — BLD-155-A',
    );
    expect(t.priority).toBe(true);
    expect(t.bucket).toBe('pm');
  });

  it('resubmitted: cycle in title, city check on, bucket pm', () => {
    const t = buildLifecycleTask('resubmitted', NUMBERED, PROJ, 2);
    expect(t.title).toBe(
      'Verify: city accepted resubmission (cycle 2) — BLD-155-A',
    );
    expect(t.cityCheck).toBe(true);
    expect(t.bucket).toBe('pm');
  });

  it('number_entry: keys off type @ project, bucket DE (fix-156: pre-submission)', () => {
    const numberless: SeedPermit = { num: null, ent_lead: null, da: null, type: 'SDOT Tree' };
    const t = buildLifecycleTask('number_entry', numberless, PROJ, null);
    expect(t.title).toBe(
      'Enter permit number — was this submitted? — SDOT Tree @ 155 Test Way',
    );
    expect(t.bucket).toBe('de');
  });

  it('numberless non-number_entry events fall back to "no number yet"', () => {
    const numberless: SeedPermit = { num: null, ent_lead: 'X', da: null, type: 'BP' };
    const t = buildLifecycleTask('intake_submitted', numberless, PROJ, null);
    expect(t.title).toBe('Verify: intake submitted / fees paid — no number yet');
  });

  it('unknown event raises', () => {
    expect(() => buildLifecycleTask('bogus_event', NUMBERED, PROJ, null)).toThrow(
      /unknown event/,
    );
  });

  it('fix-156: the creator never writes assigned_to', () => {
    for (const e of EVENTS) {
      expect(buildLifecycleTask(e, NUMBERED, PROJ, 1).assignedTo).toBeNull();
    }
  });
});

describe('derived assignment — bidirectional (fix-156)', () => {
  it('ent task derives to permits.ent_lead', () => {
    expect(derivePrimaryAssignee('ent', { da: 'D', ent_lead: 'E' })).toBe('E');
  });

  it('changing ent_lead re-points the derived assignee (no task-row state involved)', () => {
    const before = derivePrimaryAssignee('ent', { da: 'D', ent_lead: 'OldEnt' });
    const after = derivePrimaryAssignee('ent', { da: 'D', ent_lead: 'NewEnt' });
    expect(before).toBe('OldEnt');
    expect(after).toBe('NewEnt');
  });

  it('null ent_lead leaves the ent task unassigned (no project-ent fallback — parity with human tasks)', () => {
    expect(derivePrimaryAssignee('ent', { da: 'D', ent_lead: null })).toBeNull();
  });
});

describe('bp_create_lifecycle_task — idempotency key (fix-155)', () => {
  it('same event + same cycle collapses to one slot', () => {
    expect(dedupeKey('t', 1, 'intake_submitted', null)).toBe(
      dedupeKey('t', 1, 'intake_submitted', null),
    );
  });

  it('different cycle_idx is a distinct slot', () => {
    expect(dedupeKey('t', 1, 'corr_issued', 2)).not.toBe(
      dedupeKey('t', 1, 'corr_issued', 3),
    );
  });

  it('non-cyclic events collapse NULL cycle_idx to -1', () => {
    expect(dedupeKey('t', 1, 'number_entry', null)).toBe('t|1|number_entry|-1');
  });
});

describe('scrape_reconcile event (fix-159)', () => {
  // The functions below mirror the SQL (no live DB in CI — the fix-153 pattern).
  // Canonical verification = a rolled-back MCP probe against PROD on permit 10222
  // (003169-26PA). VERBATIM output (2026-06-12, entire probe rolled back):
  //   create reconcile           -> id
  //   title                      = "Reconcile: portal shows In Process — dashboard shows Pre-Submittal — GO — 003169-26PA"
  //   bucket/priority/city/event = pm / true / false / scrape_reconcile
  //     (pm because permit 10222 HAS cycle-0 intake_accepted; a permit without it
  //      gets de — both branches asserted in the bucket test below)
  //   re-fire while OPEN          -> NULL    (suppressed by permit_tasks_scrape_reconcile_open_uniq;
  //                                           confirms the partial-index ON CONFLICT inference works)
  //   re-fire after RESOLVED      -> NEW-ID  (re-fireable)
  //   intake_submitted dup        -> id / NULL (the original five events keep one-ever)

  it('title: portal X — dashboard Y — num; priority on, city-check off', () => {
    const t = buildLifecycleTask('scrape_reconcile', NUMBERED, PROJ, null, {
      observedStatus: 'In Process',
      dbStatus: 'Pre-Submittal — GO',
    });
    expect(t.title).toBe(
      'Reconcile: portal shows In Process — dashboard shows Pre-Submittal — GO — BLD-155-A',
    );
    expect(t.priority).toBe(true);
    expect(t.cityCheck).toBe(false);
  });

  it('caps long statuses at 60 chars and falls back to "?" when missing', () => {
    const longStatus = 'X'.repeat(80);
    const t = buildLifecycleTask('scrape_reconcile', NUMBERED, PROJ, null, {
      observedStatus: longStatus,
    });
    expect(t.title).toBe(
      `Reconcile: portal shows ${'X'.repeat(60)} — dashboard shows ? — BLD-155-A`,
    );
  });

  it('bucket follows the permit phase: pm when cycle-0 intake accepted, else de', () => {
    expect(
      buildLifecycleTask('scrape_reconcile', NUMBERED, PROJ, null, {
        observedStatus: 'In Process',
        c0IntakeAccepted: true,
      }).bucket,
    ).toBe('pm');
    expect(
      buildLifecycleTask('scrape_reconcile', NUMBERED, PROJ, null, {
        observedStatus: 'In Process',
        c0IntakeAccepted: false,
      }).bucket,
    ).toBe('de');
  });

  it('re-fire: an OPEN reconcile suppresses a new one; a Resolved one does not', () => {
    expect(reconcileSuppressed([])).toBe(false); // none yet → create
    expect(reconcileSuppressed([{ completion_status: 'Open' }])).toBe(true);
    expect(reconcileSuppressed([{ completion_status: 'In Progress' }])).toBe(true);
    expect(reconcileSuppressed([{ completion_status: 'Resolved' }])).toBe(false); // re-fire
    // a resolved one + (impossible-but-defensive) no open one → allowed
    expect(
      reconcileSuppressed([
        { completion_status: 'Resolved' },
        { completion_status: 'Resolved' },
      ]),
    ).toBe(false);
  });

  it('is a known event (does not raise)', () => {
    expect(() =>
      buildLifecycleTask('scrape_reconcile', NUMBERED, PROJ, null, {
        observedStatus: 'X',
      }),
    ).not.toThrow();
  });
});

describe('bp_generate_number_entry_tasks — eligibility predicate (fix-155)', () => {
  const TODAY = '2026-06-12';

  it('numberless + past target + non-terminal IS eligible', () => {
    expect(
      eligibleForNumberEntry(
        { num: null, target_submit: '2026-06-01', status: 'Initiated' },
        TODAY,
      ),
    ).toBe(true);
  });

  it('already has a number is NOT eligible', () => {
    expect(
      eligibleForNumberEntry(
        { num: 'BLD-1', target_submit: '2026-06-01', status: 'Initiated' },
        TODAY,
      ),
    ).toBe(false);
  });

  it('future target is NOT eligible', () => {
    expect(
      eligibleForNumberEntry(
        { num: null, target_submit: '2026-12-31', status: 'Initiated' },
        TODAY,
      ),
    ).toBe(false);
  });

  it('terminal statuses are NOT eligible', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(
        eligibleForNumberEntry(
          { num: null, target_submit: '2026-06-01', status },
          TODAY,
        ),
      ).toBe(false);
    }
  });
});

describe('results_ready event + trigger (fix-181)', () => {
  // The trigger (bp_permit_results_ready_autotask) + event live in SQL; no live
  // DB in CI, so these pure mirrors guard the contract. Canonical verification =
  // a rolled-back MCP probe against PROD (2026-06-17, entire probe rolled back):
  //   service_role (scraper) path:
  //     BP 164 actual_issue NULL->set -> 1 task, "Permit issued — send out
  //       approved plans / results — 7133442-CN", discipline=ent bucket=pm
  //       priority=true is_auto_generated=true; second actual_issue update -> still 1 (dedupe)
  //     ULS 173 approval_date NULL->set -> 1 task, "Permit approved — send out
  //       results — 3043725-LU"; later actual_issue set -> still 1 (no-issuance
  //       branch ignores actual_issue + dedupe)
  //     BP 168 status-only update -> 0 tasks (trigger AFTER UPDATE OF
  //       actual_issue,approval_date doesn't fire)
  //   authenticated-member (manual) path: BP 164 actual_issue NULL->set -> 1 task
  //     (tenant gate passes: tenant in auth_tenant_ids()).

  it('issued title (issuance type), priority on, bucket pm, no assignee written', () => {
    const t = buildLifecycleTask('results_ready', NUMBERED, PROJ, null, { basis: 'issued' });
    expect(t.title).toBe('Permit issued — send out approved plans / results — BLD-155-A');
    expect(t.priority).toBe(true);
    expect(t.bucket).toBe('pm');
    expect(t.assignedTo).toBeNull(); // discipline='ent' -> derives to permit.ent_lead at read time
  });

  it('approved title (no-issuance type)', () => {
    const t = buildLifecycleTask('results_ready', NUMBERED, PROJ, null, { basis: 'approved' });
    expect(t.title).toBe('Permit approved — send out results — BLD-155-A');
    expect(t.priority).toBe(true);
  });

  it('defaults to the issued title when no basis given', () => {
    const t = buildLifecycleTask('results_ready', NUMBERED, PROJ, null);
    expect(t.title).toBe('Permit issued — send out approved plans / results — BLD-155-A');
  });

  it('is a known event (does not raise)', () => {
    expect(() => buildLifecycleTask('results_ready', NUMBERED, PROJ, null)).not.toThrow();
  });

  it('dedupes one-per-permit (cycle_idx NULL -> -1 slot)', () => {
    expect(dedupeKey('t', 1, 'results_ready', null)).toBe('t|1|results_ready|-1');
    expect(dedupeKey('t', 1, 'results_ready', null)).toBe(
      dedupeKey('t', 1, 'results_ready', null),
    );
  });

  // ---- trigger fire rule (resultsReadyFire mirror) ----
  const BP = (over: Partial<ResultsPermitRow> = {}): ResultsPermitRow => ({
    type: 'Building Permit', actual_issue: null, approval_date: null, ...over,
  });
  const ULS = (over: Partial<ResultsPermitRow> = {}): ResultsPermitRow => ({
    type: 'ULS', actual_issue: null, approval_date: null, ...over,
  });

  it('issuance type: actual_issue NULL -> set fires (basis issued)', () => {
    expect(resultsReadyFire(BP(), BP({ actual_issue: '2026-06-17' }))).toEqual({
      fire: true, basis: 'issued',
    });
  });

  it('issuance type: approval_date alone does NOT fire (waits for actual_issue)', () => {
    expect(resultsReadyFire(BP(), BP({ approval_date: '2026-06-17' })).fire).toBe(false);
  });

  it('issuance type: re-setting an already-set actual_issue does NOT fire again', () => {
    expect(
      resultsReadyFire(
        BP({ actual_issue: '2026-06-17' }),
        BP({ actual_issue: '2026-06-18' }),
      ).fire,
    ).toBe(false);
  });

  it('no-issuance type: approval_date NULL -> set fires (basis approved)', () => {
    expect(resultsReadyFire(ULS(), ULS({ approval_date: '2026-06-17' }))).toEqual({
      fire: true, basis: 'approved',
    });
  });

  it('no-issuance type: an actual_issue change does NOT fire (only approval_date matters)', () => {
    expect(
      resultsReadyFire(
        ULS({ approval_date: '2026-06-17' }),
        ULS({ approval_date: '2026-06-17', actual_issue: '2026-06-20' }),
      ).fire,
    ).toBe(false);
  });

  it('no transition (status churn / unrelated update) does NOT fire', () => {
    expect(resultsReadyFire(BP(), BP()).fire).toBe(false);
    expect(resultsReadyFire(ULS(), ULS()).fire).toBe(false);
  });

  it('parity guard: the canonical NO_ISSUANCE set the trigger hardcodes is exactly these 4', () => {
    // The SQL trigger hardcodes ('SDOT Tree','PAR/Pre-Sub','ECA Waiver','ULS').
    // If this set changes, update the trigger (and the scraper) to match.
    expect([...NO_ISSUANCE_PERMIT_TYPES].sort()).toEqual(
      ['ECA Waiver', 'PAR/Pre-Sub', 'SDOT Tree', 'ULS'],
    );
  });
});
