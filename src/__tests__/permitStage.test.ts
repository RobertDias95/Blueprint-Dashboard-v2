import { describe, it, expect } from 'vitest';
import {
  computeStage,
  effectiveStage,
  classifyDeBucket,
} from '../lib/permitStage';
import type {
  Permit,
  PermitCycle,
  PermitCycleReviewer,
} from '../lib/database.types';

// Q2: stage-classification rules ported from v1. Lock them down with
// targeted unit tests so the matrix render can rely on the contract.

function makePermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'p',
    type: 'BP',
    stage: null,
    stage_override: null,
    status: null,
    num: null,
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
    ...over,
  };
}

function cycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: 'c-100',
    permit_id: 1,
    cycle_index: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('computeStage', () => {
  it('returns "de" for a fresh permit with no cycles', () => {
    expect(computeStage(makePermit(), [])).toBe('de');
  });

  it('returns "is" once actual_issue is set', () => {
    expect(computeStage(makePermit({ actual_issue: '2025-01-01' }), [])).toBe('is');
  });

  it('returns "co" when latest cycle has corr_issued and no resubmitted', () => {
    const cycles = [
      cycle({ cycle_index: 1, submitted: '2024-09-01', corr_issued: '2024-10-15', resubmitted: '2024-11-01' }),
      cycle({ cycle_index: 2, submitted: '2024-11-15', corr_issued: '2024-12-20', resubmitted: null }),
    ];
    expect(computeStage(makePermit(), cycles)).toBe('co');
  });

  it('returns "pm" when latest cycle has submitted but no open corrections', () => {
    const cycles = [cycle({ submitted: '2024-09-01', corr_issued: null })];
    expect(computeStage(makePermit(), cycles)).toBe('pm');
  });

  it('honors stage_override', () => {
    expect(
      computeStage(makePermit({ stage_override: 'ap' }), []),
    ).toBe('ap');
  });

  it('ignores unknown stage_override values', () => {
    expect(
      computeStage(makePermit({ stage_override: 'gibberish' }), []),
    ).toBe('de');
  });
});

describe('effectiveStage', () => {
  it('promotes approval_date to "ap"', () => {
    expect(
      effectiveStage(makePermit({ approval_date: '2025-01-15' }), []),
    ).toBe('ap');
  });

  it('actual_issue beats approval_date', () => {
    expect(
      effectiveStage(
        makePermit({ approval_date: '2025-01-15', actual_issue: '2025-02-15' }),
        [],
      ),
    ).toBe('is');
  });
});

describe('classifyDeBucket', () => {
  it('Scheduled status = early bucket', () => {
    expect(classifyDeBucket(makePermit(), 'Scheduled')).toBe('early');
  });

  it('Schematic status = early bucket', () => {
    expect(classifyDeBucket(makePermit(), 'Schematic')).toBe('early');
  });

  it('DD / Permit Set status = late bucket', () => {
    expect(classifyDeBucket(makePermit(), 'DD / Permit Set')).toBe('late');
  });

  it('Pending Consultants status = late bucket', () => {
    expect(classifyDeBucket(makePermit(), 'Pending Consultants')).toBe('late');
  });

  it('dd_start with empty draw status stays early — empty counts as early', () => {
    // Mirrors v1 line 2647-2650: late condition is dd_start AND status NOT
    // in ['Scheduled','Schematic','']. An empty/missing status keeps it early.
    expect(
      classifyDeBucket(makePermit({ dd_start: '2025-01-01' }), null),
    ).toBe('early');
  });

  it('dd_start with a non-early non-late status = late bucket', () => {
    expect(
      classifyDeBucket(makePermit({ dd_start: '2025-01-01' }), 'In Review'),
    ).toBe('late');
  });

  it('Schematic with dd_start = still early (status wins)', () => {
    expect(
      classifyDeBucket(
        makePermit({ dd_start: '2025-01-01' }),
        'Schematic',
      ),
    ).toBe('early');
  });
});

// ============================================================
// fix-31c → fix-31d (2026-05-19): terminal-positive permit.status
// routes effectiveStage past stale cycle data. fix-31d splits the
// route by sub-set: TERMINAL_ISSUED_STATUSES → 'is' (SDOTTRLA0002310
// scenario — "Conceptually Approved" with no separate issue doc),
// TERMINAL_APPROVED_STATUSES → 'ap' ("Ready for Issuance").
// ============================================================
describe('effectiveStage with terminal-positive permit.status (fix-31c/d)', () => {
  it('Conceptually Approved + stale cycle.corr_issued → "is" (SDOTTRLA0002310)', () => {
    // fix-31d: SDOT trees never issue a separate document; the city's
    // "Conceptually Approved" event IS the terminal state. Pre-fix-31d
    // we routed these to 'pm', conservatively assuming an actual_issue
    // would come later. That never happens for this permit type.
    const cycles = [
      cycle({
        cycle_index: 1,
        submitted: '2026-04-10',
        corr_issued: '2026-05-06',
      }),
    ];
    expect(
      effectiveStage(
        makePermit({ status: 'Conceptually Approved' }),
        cycles,
      ),
    ).toBe('is');
  });

  it('Conceptually Approved + approval_date → "ap" (approval_date short-circuits before the override)', () => {
    // The existing approval_date check at the top of effectiveStage
    // wins. Terminal-positive override only fires when neither
    // actual_issue nor approval_date is set.
    expect(
      effectiveStage(
        makePermit({
          status: 'Conceptually Approved',
          approval_date: '2026-05-07',
        }),
        [],
      ),
    ).toBe('ap');
  });

  it('Issued + actual_issue → "is" (actual_issue short-circuits first)', () => {
    expect(
      effectiveStage(
        makePermit({ status: 'Issued', actual_issue: '2026-05-10' }),
        [],
      ),
    ).toBe('is');
  });

  it('Closed status without any outcome date set + stale corr_issued → "is"', () => {
    const cycles = [
      cycle({ cycle_index: 1, submitted: '2026-04-10', corr_issued: '2026-05-06' }),
    ];
    expect(
      effectiveStage(makePermit({ status: 'Closed' }), cycles),
    ).toBe('is');
  });

  it('Ready for Issuance → "ap" (approved-pending-issuance)', () => {
    // fix-31d: Ready for Issuance is the one terminal-positive value
    // that signals "city approved but issuance is still outstanding."
    // 'ap' is the correct slot — 'is' would imply the permit is
    // physically issued, which it isn't yet.
    expect(
      effectiveStage(makePermit({ status: 'Ready for Issuance' }), []),
    ).toBe('ap');
  });

  it('every TERMINAL_ISSUED_STATUSES value routes to "is" when no outcome date set', () => {
    for (const status of [
      'Conceptually Approved',
      'Approved',
      'Issued',
      'Completed',
      'Closed',
    ]) {
      expect(
        effectiveStage(makePermit({ status }), []),
      ).toBe('is');
    }
  });

  it('every TERMINAL_APPROVED_STATUSES value routes to "ap"', () => {
    // Only "Ready for Issuance" today, but kept as a loop so adding
    // future values triggers the test naturally.
    for (const status of ['Ready for Issuance']) {
      expect(
        effectiveStage(makePermit({ status }), []),
      ).toBe('ap');
    }
  });

  it('non-terminal status (Reviews In Process) falls through to cycle-derived stage', () => {
    const cycles = [
      cycle({ cycle_index: 1, submitted: '2026-04-10', corr_issued: '2026-05-06' }),
    ];
    expect(
      effectiveStage(
        makePermit({ status: 'Reviews In Process' }),
        cycles,
      ),
    ).toBe('co');
  });

  it('null status falls through to cycle-derived stage (no regression)', () => {
    const cycles = [
      cycle({ cycle_index: 1, submitted: '2026-04-10' }),
    ];
    expect(
      effectiveStage(makePermit({ status: null }), cycles),
    ).toBe('pm');
  });
});

// fix-54 (2026-05-26): wholistic reviewer-rollup override for MPB
// (MyBuildingPermit: Bellevue / Edmonds / Kirkland). Status "Pending" or
// "Applied" + reviewer rows → use the wholistic verdict instead of the
// scraper's potentially-premature corr_issued.

function reviewer(
  over: Partial<PermitCycleReviewer> = {},
): PermitCycleReviewer {
  return {
    id: `r-${over.reviewer_name ?? 'X'}-${over.cycle_index ?? 1}`,
    tenant_id: 't',
    permit_id: 1,
    cycle_index: 1,
    reviewer_name: 'placeholder',
    discipline: null,
    current_status: 'in_review',
    last_event_date: null,
    created_at: '2026-05-25T12:00:00Z',
    updated_at: '2026-05-25T12:00:00Z',
    ...over,
  };
}

describe('effectiveStage — wholistic reviewer rollup (fix-54)', () => {
  it('MPB Pending + outstanding reviewer overrides scraper-stamped corr_issued → "pm"', () => {
    // Regression: 26 110231 BS (Bellevue BP). Cycle 1 has corr_issued
    // (scraper stamped after one discipline issued), but 2 disciplines
    // are still in_review. Wholistically the round isn't done → "pm"
    // (Under Review), NOT "co".
    const cycles = [
      cycle({
        cycle_index: 1,
        submitted: '2026-04-10',
        corr_issued: '2026-05-15',
      }),
    ];
    const reviewers = [
      reviewer({ reviewer_name: 'A1', current_status: 'approved' }),
      reviewer({ reviewer_name: 'A2', current_status: 'approved' }),
      reviewer({ reviewer_name: 'C1', current_status: 'corrections_required' }),
      reviewer({ reviewer_name: 'C2', current_status: 'corrections_required' }),
      reviewer({ reviewer_name: 'R1', current_status: 'in_review' }),
      reviewer({ reviewer_name: 'R2', current_status: 'in_review' }),
    ];
    expect(
      effectiveStage(makePermit({ status: 'Pending' }), cycles, reviewers),
    ).toBe('pm');
  });

  it('MPB Pending + every reviewer acted with ≥1 corrections → "co"', () => {
    // 26 108972 BS (Bellevue BP): 1 approved + 5 corrections, 0 outstanding.
    const cycles = [
      cycle({
        cycle_index: 1,
        submitted: '2026-04-10',
        corr_issued: '2026-05-15',
      }),
    ];
    const reviewers = [
      reviewer({ reviewer_name: 'A', current_status: 'approved' }),
      ...Array.from({ length: 5 }, (_, i) =>
        reviewer({
          reviewer_name: `C${i}`,
          current_status: 'corrections_required',
        }),
      ),
    ];
    expect(
      effectiveStage(makePermit({ status: 'Pending' }), cycles, reviewers),
    ).toBe('co');
  });

  it('MPB Pending + all reviewers approved → "ap"', () => {
    const reviewers = [
      reviewer({ reviewer_name: 'A', current_status: 'approved' }),
      reviewer({ reviewer_name: 'B', current_status: 'approved' }),
    ];
    expect(
      effectiveStage(
        makePermit({ status: 'Pending' }),
        [cycle({ cycle_index: 1, submitted: '2026-04-10' })],
        reviewers,
      ),
    ).toBe('ap');
  });

  it('MPB Applied (alternate coarse status) also triggers the override', () => {
    const reviewers = [
      reviewer({ reviewer_name: 'R', current_status: 'in_review' }),
    ];
    expect(
      effectiveStage(
        makePermit({ status: 'Applied' }),
        [
          cycle({
            cycle_index: 1,
            submitted: '2026-04-10',
            corr_issued: '2026-05-15',
          }),
        ],
        reviewers,
      ),
    ).toBe('pm');
  });

  it('MPB Pending + NO reviewer rows → existing cycle path wins (fallback preserved)', () => {
    const cycles = [
      cycle({
        cycle_index: 1,
        submitted: '2026-04-10',
        corr_issued: '2026-05-06',
      }),
    ];
    expect(
      effectiveStage(makePermit({ status: 'Pending' }), cycles, [])
    ).toBe('co');
  });

  it('Seattle Accela status ("Reviews In Process") is NOT affected by reviewers (unchanged)', () => {
    // Seattle's Accela status is already wholistic. The override is gated
    // on Pending/Applied — Reviews In Process never fires the new branch.
    const cycles = [
      cycle({
        cycle_index: 1,
        submitted: '2026-04-10',
        corr_issued: '2026-05-06',
      }),
    ];
    const reviewers = [
      reviewer({ reviewer_name: 'A', current_status: 'approved' }),
      reviewer({ reviewer_name: 'B', current_status: 'approved' }),
    ];
    expect(
      effectiveStage(
        makePermit({ status: 'Reviews In Process' }),
        cycles,
        reviewers,
      ),
    ).toBe('co'); // unchanged — driven by cycle corr_issued
  });

  it('approval_date short-circuits before the rollup override', () => {
    // Existing precedence: if approval_date is set, "ap" regardless.
    const reviewers = [
      reviewer({ reviewer_name: 'R', current_status: 'in_review' }),
    ];
    expect(
      effectiveStage(
        makePermit({ status: 'Pending', approval_date: '2026-05-20' }),
        [],
        reviewers,
      ),
    ).toBe('ap');
  });
});
