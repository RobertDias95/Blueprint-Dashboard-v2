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
  // ★★ fix-364 §2: the fields the SQL now reads to tell siblings apart, and
  // `siblings` — how many permits share this one's project AND type, which the
  // function counts for itself. The mirror takes it as an input because a
  // mirror models the function, not the table.
  id?: number;
  nickname?: string | null;
  struct_address?: string | null;
  siblings?: number;
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
  /** fix-292: current_date at creation. */
  startDate: string;
  /** fix-292: startDate + LIFECYCLE_TARGET_DAYS. */
  targetDate: string;
  /** fix-292: permit_tasks carries BOTH target_date and due_date. The engine
   *  writes target_date — the column My Tasks orders on — and never due_date. */
  dueDate: null;
}

/** fix-292: how long a bot task gets, for EVERY event. See the migration header
 *  for the measured resolve times this deliberately does not follow — they are
 *  history from a queue that had no dates at all, so they measure the problem
 *  rather than the work. */
const LIFECYCLE_TARGET_DAYS = 1;

/** date + n days, on the YYYY-MM-DD strings the column stores. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
  /** fix-292: current_date inside the function, injected so the mirror is
   *  deterministic. */
  today = '2026-08-12',
): BuiltTask {
  if (!(EVENTS as string[]).includes(event)) {
    throw new Error(`bp_create_lifecycle_task: unknown event ${event}`);
  }
  // ★★★ fix-364 §2 — THE DISCRIMINATOR, mirrored exactly.
  //
  // Four Building Permits at 11231 NE 67th St produced four identical
  // "Enter permit number …" rows. NULL unless the permit actually has a
  // same-type sibling: 484 of 542 permits are the only one of their type, and
  // a suffix on those is noise on hundreds of rows to serve the 58 that need
  // it. Ordered stored-field-first, id last — nothing is derived from position
  // or count, because "the 2nd of 4" renumbers when a sibling is deleted.
  const discriminator =
    (permit.siblings ?? 1) > 1
      ? (nullifTrim(permit.nickname ?? null) ??
        nullifTrim(permit.struct_address ?? null) ??
        nullifTrim(permit.num) ??
        (permit.id != null ? `Permit #${permit.id}` : null))
      : null;
  // ★ AND IT FIXES EVERY EVENT, not only number_entry: `no number yet` named
  // four numberless siblings equally too.
  const numLabel =
    nullifTrim(permit.num) ??
    (discriminator ? `no number yet — ${discriminator}` : 'no number yet');
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
      } @ ${nullifTrim(project.address) ?? 'project'}${
        discriminator ? ` — ${discriminator}` : ''
      }`;
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
  return {
    title, cityCheck, priority, bucket, assignedTo: null,
    // fix-292: set on the INSERT, for all seven events alike.
    startDate: today,
    targetDate: addDays(today, LIFECYCLE_TARGET_DAYS),
    dueDate: null,
  };
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

// ---------------------------------------------------------------- fix-292 --

// fix-292: every bot task is created with start_date = creation date and
// target_date = start_date + 1.
//
// ★ WHY THE EXISTING TRIGGER DID NOT ALREADY DO THIS. bp_trg_task_start_date
// fires BEFORE INSERT on permit_tasks but only stamps a date when
// completion_status is 'In Progress' or 'Resolved'. Lifecycle tasks are
// inserted as 'Open', so it correctly did nothing — and all 146 open bot tasks
// in production had BOTH dates NULL, so My Tasks had nothing to order them by.
// The engine now sets them explicitly, which the trigger then leaves alone by
// its own first clause ("never argue with a date already there").
//
// Canonical verification = a rolled-back MCP probe against PROD (2026-08-12,
// entire probe rolled back). Verbatim, permit=10440, today=2026-08-12:
//
//   intake_submitted  start=2026-08-12 target=2026-08-13 delta=1 status=Open due=NULL
//   intake_accepted   start=2026-08-12 target=2026-08-13 delta=1 status=Open due=NULL
//   corr_issued       start=2026-08-12 target=2026-08-13 delta=1 status=Open due=NULL
//   resubmitted       start=2026-08-12 target=2026-08-13 delta=1 status=Open due=NULL
//   number_entry      start=2026-08-12 target=2026-08-13 delta=1 status=Open due=NULL
//   scrape_reconcile  start=2026-08-12 target=2026-08-13 delta=1 status=Open due=NULL
//   results_ready     start=2026-08-12 target=2026-08-13 delta=1 status=Open due=NULL
//
//   Backfill: 146 rows updated; 0 open bot tasks left without a start or target;
//   all 146 got start_date = created_at::date (only 2 of them today), all have
//   target = start + 1; 246 resolved bot rows still NULL (untouched); 222 manual
//   open rows still NULL (untouched); 0 bot rows have a due_date.

/** Mirror of the fix-292 backfill: created_at, never today, NULLs only,
 *  and completed tasks left alone. */
interface BackfillRow {
  isAuto: boolean;
  status: string;
  done: boolean;
  createdAt: string;          // YYYY-MM-DD (created_at::date, UTC)
  startDate: string | null;
  targetDate: string | null;
}
function backfillRow(r: BackfillRow): BackfillRow {
  const eligible =
    r.isAuto && r.status !== 'Resolved' && !r.done
    && (r.startDate == null || r.targetDate == null);
  if (!eligible) return r;
  return {
    ...r,
    startDate: r.startDate ?? r.createdAt,
    targetDate: r.targetDate ?? addDays(r.createdAt, LIFECYCLE_TARGET_DAYS),
  };
}

const OPEN_BOT: BackfillRow = {
  isAuto: true, status: 'Open', done: false,
  createdAt: '2026-06-12', startDate: null, targetDate: null,
};

describe('fix-292 the engine dates every task it creates', () => {
  it.each(EVENTS)('%s gets a start date and a target one day later', (event) => {
    const t = buildLifecycleTask(event, NUMBERED, PROJ, 1, {}, '2026-08-12');
    expect(t.startDate).toBe('2026-08-12');
    expect(t.targetDate).toBe('2026-08-13');
  });

  // ★ Applied UNIFORMLY. No event is special-cased, so this asserts the whole
  // set has one answer rather than seven that happen to agree today.
  it('gives all seven events the same window', () => {
    const windows = new Set(
      EVENTS.map((e) => {
        const t = buildLifecycleTask(e, NUMBERED, PROJ, 1);
        return `${t.startDate}->${t.targetDate}`;
      }),
    );
    expect(windows.size).toBe(1);
  });

  it('never writes due_date — permit_tasks has both and target_date is the one', () => {
    for (const e of EVENTS) {
      expect(buildLifecycleTask(e, NUMBERED, PROJ, 1).dueDate).toBeNull();
    }
  });

  it('dates a task created on a month boundary correctly', () => {
    const t = buildLifecycleTask('corr_issued', NUMBERED, PROJ, 1, {}, '2026-01-31');
    expect(t.targetDate).toBe('2026-02-01');
  });

  it('dates a task created on a leap day correctly', () => {
    const t = buildLifecycleTask('corr_issued', NUMBERED, PROJ, 1, {}, '2028-02-29');
    expect(t.targetDate).toBe('2028-03-01');
  });

  it('leaves every other field of the contract alone', () => {
    // The dates are additive: fix-155/156/159/181 behaviour is untouched.
    const t = buildLifecycleTask('number_entry', NUMBERED, PROJ, null);
    expect(t.bucket).toBe('de');
    expect(t.assignedTo).toBeNull();
    expect(t.priority).toBe(false);
  });
});

describe('fix-292 the backfill', () => {
  it('dates an open bot task from created_at, NOT today', () => {
    const out = backfillRow(OPEN_BOT);
    expect(out.startDate).toBe('2026-06-12');
    expect(out.targetDate).toBe('2026-06-13');
  });

  // ★ The reason created_at matters: 68 of the 146 were more than 30 days old.
  // Stamping them with today would make a two-month-old reconcile task look as
  // fresh as one raised this morning — the opposite of an orderable queue.
  it('keeps an old task old', () => {
    const out = backfillRow({ ...OPEN_BOT, createdAt: '2026-06-12' });
    expect(out.startDate).not.toBe('2026-08-12');
  });

  it('covers In Progress as well as Open — both are unfinished', () => {
    const out = backfillRow({ ...OPEN_BOT, status: 'In Progress' });
    expect(out.startDate).toBe('2026-06-12');
  });

  it('leaves completed bot tasks alone', () => {
    const resolved = { ...OPEN_BOT, status: 'Resolved', done: true };
    expect(backfillRow(resolved)).toEqual(resolved);
  });

  it('leaves a done-flagged row alone even if its status disagrees', () => {
    const desynced = { ...OPEN_BOT, done: true };
    expect(backfillRow(desynced)).toEqual(desynced);
  });

  it('leaves MANUAL tasks alone — a human\'s dates are a human\'s to set', () => {
    const manual = { ...OPEN_BOT, isAuto: false };
    expect(backfillRow(manual)).toEqual(manual);
  });

  // ★ Re-runnable, and it can never argue with a date somebody entered.
  it('never overwrites a date that is already there', () => {
    const partly = { ...OPEN_BOT, startDate: '2026-07-01' };
    const out = backfillRow(partly);
    expect(out.startDate).toBe('2026-07-01');       // kept
    expect(out.targetDate).toBe('2026-06-13');      // the missing one filled
  });

  it('is idempotent', () => {
    const once = backfillRow(OPEN_BOT);
    expect(backfillRow(once)).toEqual(once);
  });
});
