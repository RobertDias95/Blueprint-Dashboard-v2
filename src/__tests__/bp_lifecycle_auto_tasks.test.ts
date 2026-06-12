import { describe, it, expect } from 'vitest';
import type { AutoEvent } from '../lib/database.types';

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
function buildLifecycleTask(
  event: string,
  permit: SeedPermit,
  project: SeedProject,
  cycleIdx: number | null,
): BuiltTask {
  if (!(EVENTS as string[]).includes(event)) {
    throw new Error(`bp_create_lifecycle_task: unknown event ${event}`);
  }
  const numLabel = nullifTrim(permit.num) ?? 'no number yet';
  const cyc = cycleIdx == null ? '?' : String(cycleIdx);
  const bucket: 'de' | 'pm' = event === 'number_entry' ? 'de' : 'pm';
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
  }
  return { title, cityCheck, priority, bucket, assignedTo: null };
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
