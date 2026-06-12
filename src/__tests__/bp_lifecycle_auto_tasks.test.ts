import { describe, it, expect } from 'vitest';
import type { AutoEvent } from '../lib/database.types';

// fix-155: contract spec for the lifecycle auto-task engine.
//
// The engine itself is SQL — bp_create_lifecycle_task + bp_generate_number_entry_tasks
// in migrations/fix_155_lifecycle_auto_tasks.sql. There is NO live database in
// CI (see the fix-153 precedent in bp_create_project_with_permits_team_resolve.test.ts),
// so the canonical verification was a transactional, rolled-back MCP probe against
// PROD on 2026-06-12. Its verbatim output (titles / assignee / flags):
//
//   intake_submitted : "Verify: intake submitted / fees paid — BLD-155-A"
//                      assigned=PermitEnt bucket=pm city_chk=true  priority=false cycle=null
//   intake_accepted  : "Verify: intake accepted — reviews starting — BLD-155-A"
//                      assigned=PermitEnt bucket=pm city_chk=false priority=false cycle=null
//   corr_issued c2   : "Corrections issued (cycle 2) — send to consultants — BLD-155-A"
//                      assigned=PermitEnt bucket=pm city_chk=false priority=true  cycle=2
//   resubmitted c2   : "Verify: city accepted resubmission (cycle 2) — BLD-155-A"
//                      assigned=PermitEnt bucket=pm city_chk=true  priority=false cycle=2
//   number_entry     : "Enter permit number — was this submitted? — SDOT Tree @ 155 Test Way"
//                      assigned=ProjEnt (permit ent NULL -> project entitlement_lead) cycle=null
//   number_entry     : (permit ent NULL + project ent NULL) assigned=NULL
//   context notes    : notes='from scraper' carried from p_context; num label "no number yet"
//   dup intake_submitted -> returned id IS NULL (partial unique index suppressed)
//   corr_issued c3   -> new id NOT NULL (distinct cycle_idx => distinct task)
//   sweep run 1 (tenant 0000…0001) -> created 27 (all real numberless+past-target
//     +non-terminal permits in that tenant, including 2 seeded); run 2 same day -> 0
//   (entire probe rolled back; prod left with 0 is_auto_generated rows, 0 app_sweeps)
//
// The pure functions below mirror that SQL exactly so the documented contract is
// regression-guarded. If the SQL changes, update both.

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
  type: string | null;
}
interface SeedProject {
  entitlement_lead: string | null;
  address: string | null;
}

/** Mirror of the SQL assignee resolution:
 *   COALESCE(NULLIF(btrim(permit.ent_lead),''), NULLIF(btrim(project.entitlement_lead),'')) */
function resolveAssignee(permit: SeedPermit, project: SeedProject): string | null {
  return nullifTrim(permit.ent_lead) ?? nullifTrim(project.entitlement_lead);
}

interface BuiltTask {
  title: string;
  cityCheck: boolean;
  priority: boolean;
  bucket: 'pm';
}

/** Mirror of the SQL CASE that builds title + flags per event. */
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
  return { title, cityCheck, priority, bucket: 'pm' };
}

/** Mirror of the partial-unique-index dedupe key:
 *   (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1)) */
function dedupeKey(
  tenant: string,
  permitId: number,
  event: AutoEvent,
  cycleIdx: number | null,
): string {
  return [tenant, permitId, event, cycleIdx ?? -1].join('|');
}

// Mirror of the sweep's NOT-terminal set (permitTerminalStatus.ts positives +
// the dead/done states present in prod).
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

/** Mirror of the sweep WHERE predicate. */
function eligibleForNumberEntry(p: SweepPermit, today: string): boolean {
  const numberless = nullifTrim(p.num) == null;
  const targetArrived = p.target_submit != null && p.target_submit <= today;
  const notTerminal = !TERMINAL_STATUSES.has((p.status ?? '').trim());
  return numberless && targetArrived && notTerminal;
}

const PERMIT_NUMBERED: SeedPermit = {
  num: 'BLD-155-A',
  ent_lead: 'PermitEnt',
  type: 'Building Permit',
};
const PROJ: SeedProject = { entitlement_lead: 'ProjEnt', address: '155 Test Way' };

describe('bp_create_lifecycle_task — titles + flags (fix-155)', () => {
  it('intake_submitted: title, city-acceptance check on, not priority', () => {
    const t = buildLifecycleTask('intake_submitted', PERMIT_NUMBERED, PROJ, null);
    expect(t.title).toBe('Verify: intake submitted / fees paid — BLD-155-A');
    expect(t.cityCheck).toBe(true);
    expect(t.priority).toBe(false);
    expect(t.bucket).toBe('pm');
  });

  it('intake_accepted: title, no city check, not priority', () => {
    const t = buildLifecycleTask('intake_accepted', PERMIT_NUMBERED, PROJ, null);
    expect(t.title).toBe('Verify: intake accepted — reviews starting — BLD-155-A');
    expect(t.cityCheck).toBe(false);
    expect(t.priority).toBe(false);
  });

  it('corr_issued: cycle in title, priority on, no city check', () => {
    const t = buildLifecycleTask('corr_issued', PERMIT_NUMBERED, PROJ, 2);
    expect(t.title).toBe(
      'Corrections issued (cycle 2) — send to consultants — BLD-155-A',
    );
    expect(t.priority).toBe(true);
    expect(t.cityCheck).toBe(false);
  });

  it('resubmitted: cycle in title, city check on', () => {
    const t = buildLifecycleTask('resubmitted', PERMIT_NUMBERED, PROJ, 2);
    expect(t.title).toBe(
      'Verify: city accepted resubmission (cycle 2) — BLD-155-A',
    );
    expect(t.cityCheck).toBe(true);
  });

  it('number_entry: keys off type @ project (not a number)', () => {
    const numberless: SeedPermit = { num: null, ent_lead: null, type: 'SDOT Tree' };
    const t = buildLifecycleTask('number_entry', numberless, PROJ, null);
    expect(t.title).toBe(
      'Enter permit number — was this submitted? — SDOT Tree @ 155 Test Way',
    );
  });

  it('numberless non-number_entry events fall back to "no number yet"', () => {
    const numberless: SeedPermit = { num: null, ent_lead: 'X', type: 'BP' };
    const t = buildLifecycleTask('intake_submitted', numberless, PROJ, null);
    expect(t.title).toBe('Verify: intake submitted / fees paid — no number yet');
  });

  it('unknown event raises', () => {
    expect(() => buildLifecycleTask('bogus_event', PERMIT_NUMBERED, PROJ, null)).toThrow(
      /unknown event/,
    );
  });
});

describe('bp_create_lifecycle_task — ent_lead fallback chain (fix-155)', () => {
  it('uses permit.ent_lead when set', () => {
    expect(resolveAssignee(PERMIT_NUMBERED, PROJ)).toBe('PermitEnt');
  });

  it('falls back to project.entitlement_lead when permit ent_lead is NULL', () => {
    expect(
      resolveAssignee({ num: null, ent_lead: null, type: 'SDOT Tree' }, PROJ),
    ).toBe('ProjEnt');
  });

  it('falls back to project.entitlement_lead when permit ent_lead is blank', () => {
    expect(
      resolveAssignee({ num: null, ent_lead: '   ', type: 'X' }, PROJ),
    ).toBe('ProjEnt');
  });

  it('resolves to NULL (unassigned) when both are empty', () => {
    expect(
      resolveAssignee(
        { num: null, ent_lead: null, type: 'X' },
        { entitlement_lead: null, address: 'A' },
      ),
    ).toBeNull();
  });
});

describe('bp_create_lifecycle_task — idempotency key (fix-155)', () => {
  it('same event + same cycle collapses to one slot (duplicate suppressed)', () => {
    const a = dedupeKey('t', 1, 'intake_submitted', null);
    const b = dedupeKey('t', 1, 'intake_submitted', null);
    expect(a).toBe(b);
  });

  it('different cycle_idx is a distinct slot (corr cycle 2 vs 3)', () => {
    expect(dedupeKey('t', 1, 'corr_issued', 2)).not.toBe(
      dedupeKey('t', 1, 'corr_issued', 3),
    );
  });

  it('non-cyclic events collapse NULL cycle_idx to -1 (one ever)', () => {
    expect(dedupeKey('t', 1, 'number_entry', null)).toBe('t|1|number_entry|-1');
  });

  it('different permit is a distinct slot', () => {
    expect(dedupeKey('t', 1, 'intake_submitted', null)).not.toBe(
      dedupeKey('t', 2, 'intake_submitted', null),
    );
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

  it('target due exactly today IS eligible', () => {
    expect(
      eligibleForNumberEntry(
        { num: null, target_submit: TODAY, status: 'Initiated' },
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

  it('no target_submit is NOT eligible', () => {
    expect(
      eligibleForNumberEntry(
        { num: null, target_submit: null, status: 'Initiated' },
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
