import { describe, it, expect } from 'vitest';
import {
  computeStage,
  effectiveStage,
  classifyDeBucket,
  isPermitInCorrections,
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
  it('fix-214: corr_issued is authoritative — a lingering in_review reviewer no longer masks it → "co"', () => {
    // 224 2nd Ave N (Edmonds 0126/0131): cycle 1 has corr_issued (the city
    // closed the round by issuing corrections), but the Trees reviewer is
    // PERMANENTLY in_review (the city never assigned a tree reviewer) and the
    // others are mixed. Pre-fix-214 the wholistic rollup held it at "pm" forever;
    // Bobby's hybrid makes corr_issued win → "co" (Corrections). Matches the
    // weekly report, which always keyed on corr_issued.
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
      reviewer({ reviewer_name: 'Trees', current_status: 'in_review' }),
      reviewer({ reviewer_name: 'R2', current_status: 'in_review' }),
    ];
    expect(
      effectiveStage(makePermit({ status: 'Pending' }), cycles, reviewers),
    ).toBe('co');
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

  it('fix-214: MPB Applied + in_review reviewer + corr_issued → "co" (corr_issued wins)', () => {
    // Same hybrid as the 224 case, with the alternate coarse status 'Applied':
    // a dangling in_review reviewer is waived once corr_issued is set.
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
    ).toBe('co');
  });

  it('fix-214: MPB Applied + in_review reviewer + NO corr_issued → still "pm" (under review)', () => {
    // The waiver is specific to corr_issued. With no corr_issued on the cycle, an
    // in_review reviewer keeps the permit under review — unchanged from fix-54.
    const reviewers = [
      reviewer({ reviewer_name: 'R', current_status: 'in_review' }),
    ];
    expect(
      effectiveStage(
        makePermit({ status: 'Applied' }),
        [cycle({ cycle_index: 1, submitted: '2026-04-10' })],
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

// fix-185 (2026-06-22): status/bucket follows cycle progression. The reviewer
// rollup must consider ONLY the permit's current (latest) cycle. Stale rows on
// an already-resubmitted earlier cycle are historical and must not force "co".
describe('effectiveStage — reviewer rollup scoped to current cycle (fix-185)', () => {
  // 224 2nd Ave N (Edmonds) BLD2026-0126: cycle 1 is closed (corr_issued +
  // resubmitted), cycle 2 is the live under-review cycle with NO reviewer rows;
  // the only reviewer rows sit on cycle 1 and were never pruned.
  const edmondsCycles = [
    cycle({ cycle_index: 0, submitted: '2026-02-02', intake_accepted: '2026-03-04' }),
    cycle({
      cycle_index: 1,
      submitted: '2026-02-03',
      city_target: '2026-05-10',
      corr_issued: '2026-04-13',
      resubmitted: '2026-05-19',
    }),
    cycle({ cycle_index: 2, submitted: '2026-05-19', city_target: '2026-06-22' }),
  ];
  const staleCycle1Reviewers = [
    reviewer({ reviewer_name: 'engineering', cycle_index: 1, current_status: 'corrections_required' }),
    reviewer({ reviewer_name: 'planning', cycle_index: 1, current_status: 'corrections_required' }),
    reviewer({ reviewer_name: 'stormwater', cycle_index: 1, current_status: 'corrections_required' }),
    reviewer({ reviewer_name: 'building', cycle_index: 1, current_status: 'approved' }),
    reviewer({ reviewer_name: 'fire', cycle_index: 1, current_status: 'approved' }),
    reviewer({ reviewer_name: 'trees', cycle_index: 1, current_status: 'in_review' }),
  ];

  it('latest cycle resubmitted-in-review + stale earlier-cycle corrections reviewers → "pm"', () => {
    expect(
      effectiveStage(makePermit({ status: 'Applied' }), edmondsCycles, staleCycle1Reviewers),
    ).toBe('pm');
  });

  it('stays "pm" even if every stale cycle-1 reviewer reads corrections_required', () => {
    // The transient state of cycle-1 reviewers must not matter at all — they
    // are on a resubmitted (historical) cycle.
    const allCorrections = staleCycle1Reviewers.map((r) => ({
      ...r,
      current_status: 'corrections_required' as const,
    }));
    expect(
      effectiveStage(makePermit({ status: 'Applied' }), edmondsCycles, allCorrections),
    ).toBe('pm');
  });

  it('latest cycle genuinely in corrections (corr_issued, not resubmitted, reviewers on it) → "co"', () => {
    const cycles = [
      cycle({ cycle_index: 0, submitted: '2026-02-02', intake_accepted: '2026-03-04' }),
      cycle({
        cycle_index: 1,
        submitted: '2026-02-03',
        corr_issued: '2026-04-13',
        resubmitted: '2026-05-19',
      }),
      cycle({
        cycle_index: 2,
        submitted: '2026-05-19',
        corr_issued: '2026-06-10',
      }),
    ];
    const reviewers = [
      reviewer({ reviewer_name: 'engineering', cycle_index: 2, current_status: 'corrections_required' }),
      reviewer({ reviewer_name: 'building', cycle_index: 2, current_status: 'approved' }),
    ];
    expect(effectiveStage(makePermit({ status: 'Applied' }), cycles, reviewers)).toBe('co');
  });

  it('current cycle has no reviewer rows → falls back to cycle-date state ("pm")', () => {
    // Same as the Edmonds case but with NO reviewers at all → computeStage path.
    expect(
      effectiveStage(makePermit({ status: 'Applied' }), edmondsCycles, []),
    ).toBe('pm');
  });

  it('stage_override still wins over the (now cycle-scoped) reviewer rollup', () => {
    expect(
      effectiveStage(
        makePermit({ status: 'Applied', stage_override: 'co' }),
        edmondsCycles,
        staleCycle1Reviewers,
      ),
    ).toBe('co');
  });
});

// fix-214 (2026-06-29): the unified hybrid "in corrections" test, shared by the
// dashboard bucket (effectiveStage), the status pill (derivePermitStatus), the
// Reports Overview (reportMetrics), and the weekly report's SQL mirror
// (bp_permit_in_corrections). These cases mirror the rolled-back prod probe on
// bp_permit_in_corrections so the TS + SQL layers are proven to agree.
describe('isPermitInCorrections (fix-214 hybrid — TS ⇄ SQL parity)', () => {
  it('A. 224-like: corr_issued + a perpetual in_review reviewer + others mixed → CORRECTIONS', () => {
    const cycles = [cycle({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-06-18' })];
    const reviewers = [
      reviewer({ reviewer_name: 'Trees', current_status: 'in_review' }),
      reviewer({ reviewer_name: 'Bldg', current_status: 'approved' }),
      reviewer({ reviewer_name: 'Eng', current_status: 'corrections_required' }),
    ];
    expect(isPermitInCorrections(makePermit({ status: 'Applied' }), cycles, reviewers)).toBe(true);
  });

  it('B. reviewer-corrections only (no corr_issued, all responded, ≥1 corrections) → CORRECTIONS', () => {
    const cycles = [cycle({ cycle_index: 1, submitted: '2026-06-01' })];
    const reviewers = [
      reviewer({ reviewer_name: 'Eng', current_status: 'corrections_required' }),
      reviewer({ reviewer_name: 'Bldg', current_status: 'approved' }),
    ];
    expect(isPermitInCorrections(makePermit({ status: 'Applied' }), cycles, reviewers)).toBe(true);
  });

  it('C. resubmitted (corr_issued answered) → NOT corrections', () => {
    const cycles = [
      cycle({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-06-18', resubmitted: '2026-06-25' }),
    ];
    expect(isPermitInCorrections(makePermit({ status: 'Applied' }), cycles, [])).toBe(false);
  });

  it('D. approved (approval_date set, even with corr_issued) → NOT corrections', () => {
    const cycles = [cycle({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-06-18' })];
    expect(
      isPermitInCorrections(makePermit({ status: 'Applied', approval_date: '2026-06-20' }), cycles, []),
    ).toBe(false);
  });

  it('E. under review (no corr_issued, a reviewer still in_review) → NOT corrections', () => {
    const cycles = [cycle({ cycle_index: 1, submitted: '2026-06-01' })];
    const reviewers = [reviewer({ reviewer_name: 'Eng', current_status: 'in_review' })];
    expect(isPermitInCorrections(makePermit({ status: 'Applied' }), cycles, reviewers)).toBe(false);
  });

  it('F. reviewer-corrections but a NON-rollup-driven status (no corr_issued) → NOT corrections (gated)', () => {
    const cycles = [cycle({ cycle_index: 1, submitted: '2026-06-01' })];
    const reviewers = [reviewer({ reviewer_name: 'Eng', current_status: 'corrections_required' })];
    expect(
      isPermitInCorrections(makePermit({ status: 'Reviews In Process' }), cycles, reviewers),
    ).toBe(false);
  });

  it('G. stage_override="co" alone → CORRECTIONS (manual escape hatch)', () => {
    expect(isPermitInCorrections(makePermit({ status: 'Applied', stage_override: 'co' }), [], [])).toBe(true);
  });

  it('H. stage_override="pm" + corr_issued → NOT corrections (override authoritative)', () => {
    const cycles = [cycle({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-06-18' })];
    expect(
      isPermitInCorrections(makePermit({ status: 'Applied', stage_override: 'pm' }), cycles, []),
    ).toBe(false);
  });

  it('terminal-positive status (Ready for Issuance) + corr_issued → NOT corrections', () => {
    const cycles = [cycle({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-06-18' })];
    expect(
      isPermitInCorrections(makePermit({ status: 'Ready for Issuance' }), cycles, []),
    ).toBe(false);
  });

  it('corr_issued on a non-rollup (Seattle Accela) status with no reviewers → CORRECTIONS (universal half)', () => {
    const cycles = [cycle({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-06-18' })];
    expect(
      isPermitInCorrections(makePermit({ status: 'Reviews In Process' }), cycles, []),
    ).toBe(true);
  });
});
