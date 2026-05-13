import { describe, it, expect } from 'vitest';
import { computeProjectedApproval } from '../lib/projectedApproval';
import {
  SCHEDULE_DEFAULTS,
  type LearnedEstimate,
} from '../lib/scheduleBenchmarks';
import type { Permit, PermitCycle } from '../lib/database.types';

// Q9.5.f-fix-11: rewritten for the v1-parity algorithm. Each branch (real-
// short-circuit, ULS BP-anchor, holistic shortcut, target-cycle walk,
// last-real-date floor) has at least one pinned test.

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: null,
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    go_date: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    units: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    zone: null,
    product_type: null,
    project_tags: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    ...over,
  };
}

function cyc(over: Partial<PermitCycle> & { cycle_index: number }): PermitCycle {
  return {
    id: `c-${over.cycle_index}`,
    permit_id: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...over,
  };
}

function learned(over: Partial<LearnedEstimate> = {}): LearnedEstimate {
  return {
    source: 'test',
    sampleCount: 5,
    dateRange: '',
    goToSubmit: null,
    avgSubmitToIssue: null,
    cityReview1: SCHEDULE_DEFAULTS.cityReview1,
    corrResponse1: SCHEDULE_DEFAULTS.corrResponse1,
    cityReview2: SCHEDULE_DEFAULTS.cityReview2,
    corrResponse2: SCHEDULE_DEFAULTS.corrResponse2,
    cityReview3: SCHEDULE_DEFAULTS.cityReview3,
    corrResponse3: SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: SCHEDULE_DEFAULTS.cityReview4,
    corrResponse4: SCHEDULE_DEFAULTS.corrResponse4,
    cr1Count: 0,
    cr2Count: 0,
    cr3Count: 0,
    cr4Count: 0,
    co1Count: 0,
    co2Count: 0,
    co3Count: 0,
    co4Count: 0,
    avgCycles: 2,
    mostLikelyCycle: 1,
    cycleDist: { 1: 0, 2: 0, 3: 0, 4: 0 },
    isAllTime: false,
    ...over,
  };
}

describe('computeProjectedApproval', () => {
  it('actual_issue short-circuits with isActual=true', () => {
    const r = computeProjectedApproval({
      permit: permit({ actual_issue: '2026-06-15' }),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r.projection).toBe('2026-06-15');
    expect(r.isActual).toBe(true);
  });

  it('approval_date short-circuits when no actual_issue', () => {
    const r = computeProjectedApproval({
      permit: permit({ approval_date: '2026-06-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r.projection).toBe('2026-06-01');
    expect(r.isActual).toBe(true);
  });

  it('null projection when no anchor available', () => {
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r.projection).toBeNull();
  });

  it('cycle 1 submitted only, no learned → cityReview1 + 7d (target cycle 1)', () => {
    // No mostLikelyCycle → currentReviewCycle = 1 → targetCycle = 1.
    // No avgSubmitToIssue → cursor = base + cityReview1 (21) + 7 = 2026-01-29.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-01-01' })],
      learnedEstimate: null,
    });
    expect(r.projection).toBe('2026-01-29');
    expect(r.targetCycle).toBe(1);
    expect(r.isProjected).toBe(true);
  });

  it('holistic shortcut: targetCycle=1 + no corrections + avgSubmitToIssue → base + avgSubmitToIssue', () => {
    // Bobby's 3-day drift fix: when learner knows the BP usually approves
    // in cycle 1 in N days, trust that average instead of cityReview1 + 7.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-01-01' })],
      learnedEstimate: learned({ avgSubmitToIssue: 80, mostLikelyCycle: 1 }),
    });
    // 2026-01-01 + 80 days = 2026-03-22
    expect(r.projection).toBe('2026-03-22');
    expect(r.targetCycle).toBe(1);
  });

  it('targetCycle bumps when learned.mostLikelyCycle > currentReviewCycle', () => {
    // learner says "most permits approve in cycle 2" but this permit has
    // no corrections yet → walk 1 correction round before final approval.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-01-01' })],
      learnedEstimate: learned({ mostLikelyCycle: 2 }),
    });
    // cy1 cr = 21, cy1 co = 10 (cursor now at 2026-02-01), +7 final = 2026-02-08
    expect(r.projection).toBe('2026-02-08');
    expect(r.targetCycle).toBe(2);
    expect(r.rounds?.corrIssued1).toBe('2026-01-22');
    expect(r.rounds?.resubmitted1).toBe('2026-02-01');
  });

  it('actual corr_issued overrides learned cityReview', () => {
    // Permit has real corr_issued on cy1 → that date IS the cr1 end.
    // Permit has corrections → currentReviewCycle=2 → targetCycle=2.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2026-01-01',
          corr_issued: '2026-02-10',
        }),
      ],
      learnedEstimate: null,
    });
    // crEnd=2026-02-10 (real), resub = +corrResponse1(10) = 2026-02-20
    // cursor = 2026-02-20, +7 final = 2026-02-27
    expect(r.projection).toBe('2026-02-27');
    expect(r.targetCycle).toBe(2);
    expect(r.rounds?.corrIssued1).toBe('2026-02-10');
    expect(r.rounds?.resubmitted1).toBe('2026-02-20');
  });

  it('target_submit serves as anchor when no cy1.submitted', () => {
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2026-05-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    // targetCycle=1, cityReview1=21 + 7 = 28 days. 2026-05-01 + 28 = 2026-05-29
    expect(r.projection).toBe('2026-05-29');
  });

  it('ULS uses BP LIVE projection (not stored expected_issue) as anchor — Q9.5.f-fix-18', () => {
    // BP has stored expected_issue=2026-08-01 but no actual outcome.
    // fix-18: anchor should use the BP's LIVE projection, not the stored
    // snapshot. That way an override or cycle update on the BP propagates
    // to its ULS sibling in real time.
    const bp = permit({ id: 100, type: 'Building Permit', expected_issue: '2026-08-01' });
    const uls = permit({ id: 200, type: 'ULS' });
    const r = computeProjectedApproval({
      permit: uls,
      cycles: [],
      learnedEstimate: null,
      siblingPermits: [bp, uls],
      siblingCyclesByPermitId: new Map([
        [100, [cyc({ cycle_index: 1, submitted: '2026-01-01' })]],
      ]),
      siblingLearnedByPermitId: new Map([[100, null]]),
    });
    // BP live projection: targetCycle=1, base=2026-01-01, cr1=21+7 buffer = 28d
    // → 2026-01-29. ULS = 2026-01-29 + 120 = 2026-05-29.
    // Sanity walk (2 default ULS cycles): 2026-02-15 + 62d = 2026-04-18.
    // 2026-05-29 > 2026-04-18 → keep 2026-05-29.
    expect(r.projection).toBe('2026-05-29');
    expect(r.targetCycle).toBe(0);
    expect(r.ulsAnchors).toBeDefined();
    expect(r.ulsAnchors?.bpIssueAnchor).toBe('2026-01-29');
  });

  it('BP scheduleCycleOverride propagates to ULS anchor — Q9.5.f-fix-18', () => {
    // The BP has a manual cycle-count override (extras.scheduleCycleOverride=3).
    // That override should affect the BP's live projection AND therefore the
    // ULS anchor — bidirectional propagation across siblings.
    const bp = permit({
      id: 100,
      type: 'Building Permit',
      extras: { scheduleCycleOverride: 3 },
    });
    const uls = permit({ id: 200, type: 'ULS' });
    const r = computeProjectedApproval({
      permit: uls,
      cycles: [],
      learnedEstimate: null,
      siblingPermits: [bp, uls],
      siblingCyclesByPermitId: new Map([
        [100, [cyc({ cycle_index: 1, submitted: '2026-01-01' })]],
      ]),
      siblingLearnedByPermitId: new Map([[100, null]]),
    });
    // BP live projection: targetCycle=3 (override), walk 2 corr rounds:
    //   i=0: cr=21 +co=10 → 2026-02-01
    //   i=1: cr=21 +co=10 → 2026-03-04
    //   final +7 = 2026-03-11
    // ULS = 2026-03-11 + 120 = 2026-07-09 (well past the sanity-walk cap).
    expect(r.ulsAnchors?.bpIssueAnchor).toBe('2026-03-11');
    expect(r.projection).toBe('2026-07-09');
  });

  it('cityTarget shortcut: cycle 1 city_target acts as crEnd when no corr_issued — Q9.5.f-fix-18', () => {
    // v1 :4530 parity. When targeting cycle ≥ 2 and cycle 1 has a
    // city_target date but no actual corr_issued, use city_target as the
    // round-1 corrections-issued projection. Tightens the walk-forward
    // estimate when the city has supplied a corrections deadline.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2026-01-01',
          city_target: '2026-04-15', // earlier than 2026-01-01 + 21 = 2026-01-22? No, much later
        }),
      ],
      learnedEstimate: learned({ mostLikelyCycle: 2 }),
    });
    // targetCycle=2 (learner pick), walk one cycle:
    //   i=0: rd.corr_issued=null → cityTarget=2026-04-15 used as crEnd
    //        resub = 2026-04-15 + co(10) = 2026-04-25
    //   cursor = 2026-04-25, +7 final = 2026-05-02
    expect(r.rounds?.corrIssued1).toBe('2026-04-15');
    expect(r.projection).toBe('2026-05-02');
  });

  it('ULS falls through to default walk when no sibling BP exists', () => {
    const uls = permit({ id: 200, type: 'ULS', target_submit: '2026-05-01' });
    const r = computeProjectedApproval({
      permit: uls,
      cycles: [],
      learnedEstimate: null,
      siblingPermits: [uls],
      siblingCyclesByPermitId: new Map(),
      siblingLearnedByPermitId: new Map(),
    });
    // No BP → ULS branch returns no anchors → falls to non-ULS walk.
    // targetCycle=1, base=2026-05-01, +21+7=28 days → 2026-05-29
    expect(r.projection).toBe('2026-05-29');
    expect(r.ulsAnchors).toBeUndefined();
  });

  it('last-real-date floor prevents projection earlier than known events', () => {
    // Hand-craft a case where the walk would land BEFORE the last real
    // resubmit (data anomaly). Floor pushes projection to lastReal + 7.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2026-01-01',
          corr_issued: '2026-02-10',
          resubmitted: '2027-12-31', // far-future real date
        }),
      ],
      learnedEstimate: null,
    });
    // walk lands at 2026-02-27 but lastRealDate=2027-12-31 → floor to
    // 2027-12-31 + 7 = 2028-01-07
    expect(r.projection).toBe('2028-01-07');
  });
});
