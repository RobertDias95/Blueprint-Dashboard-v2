import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeProjectedApproval } from '../lib/projectedApproval';
import {
  SCHEDULE_DEFAULTS,
  type LearnedEstimate,
} from '../lib/scheduleBenchmarks';
import type {
  Permit,
  PermitCycle,
  PermitCycleReviewer,
  ReviewerStatus,
} from '../lib/database.types';

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
    avgIntakeToApproval: null,
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
    isCrossJuris: false,
    recencyTier: 'last_180d' as const,
    ...over,
  };
}

// fix-24e: pin "today" before the test anchors (all 2026+). All existing
// tests then operate as if their anchors are future, so the today-floor is
// a no-op for them. The fix-24e suite at the bottom moves the clock past
// each anchor to exercise the floor.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-12-01T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

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

  it('holistic shortcut: targetCycle=1 + no corrections + avgIntakeToApproval → base + avgIntakeToApproval', () => {
    // Bobby's 3-day drift fix: when learner knows the BP usually approves
    // in cycle 1 in N days, trust that average instead of cityReview1 + 7.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-01-01' })],
      learnedEstimate: learned({ avgIntakeToApproval: 80, mostLikelyCycle: 1 }),
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
    // cy1 cr = 21, cy1 co = 10 (cursor now at 2026-02-01).
    // fix-25-HH-redux: cycle 2 (the approval review) now gets its own
    // city review projected — cr2 default = 21 → 2026-02-22, +7 = 2026-03-01.
    expect(r.projection).toBe('2026-03-01');
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
    // crEnd=2026-02-10 (real), resub = +corrResponse1(10) = 2026-02-20.
    // fix-25-HH-redux: cycle 2 city review projected — cr2 walks back to
    // this permit's actual cycle-1 review span (40d) → 2026-04-01, +7 = 2026-04-08.
    expect(r.projection).toBe('2026-04-08');
    expect(r.targetCycle).toBe(2);
    expect(r.rounds?.corrIssued1).toBe('2026-02-10');
    expect(r.rounds?.resubmitted1).toBe('2026-02-20');
  });

  it('target_submit serves as anchor when no cy1.submitted (fix-24h: 210d default fires)', () => {
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2026-05-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    // No cycle activity + no learner avgIntakeToApproval → fix-24h/24i
    // holistic fallback fires with defaultDaysForType('Building Permit')=210.
    // base is future (today pinned to 2025-12-01 in beforeEach), so anchor
    // used as-is. 2026-05-01 + 210d = 2026-11-27.
    expect(r.projection).toBe('2026-11-27');
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
    expect(r.ulsAnchors?.bpApprovalAnchor).toBe('2026-01-29');
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
    // fix-25-HH-redux: cycle 3 (approval review) city review cr3=21 →
    //   2026-03-25, +7 = 2026-04-01.
    // ULS = 2026-04-01 + 120 = 2026-07-30 (well past the sanity-walk cap).
    expect(r.ulsAnchors?.bpApprovalAnchor).toBe('2026-04-01');
    expect(r.projection).toBe('2026-07-30');
  });

  it('fix-39 Track A: ULS anchors to BP.approval_date (not actual_issue) + 120, floored', () => {
    // Mirrors 3039 63rd: BP approved 2026-04-30, issued 2026-05-04. The ULS
    // must anchor to the APPROVAL milestone, not issuance. Both are in the
    // past relative to today (2026-05-20), so the anchor floors to today:
    // 2026-05-20 + 120 = 2026-09-17.
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));
    const bp = permit({
      id: 100,
      type: 'Building Permit',
      approval_date: '2026-04-30',
      actual_issue: '2026-05-04',
    });
    const uls = permit({ id: 200, type: 'ULS' });
    const r = computeProjectedApproval({
      permit: uls,
      cycles: [cyc({ cycle_index: 1, submitted: '2026-05-04' })],
      learnedEstimate: null,
      siblingPermits: [bp, uls],
      siblingCyclesByPermitId: new Map([
        [100, [cyc({ cycle_index: 1, submitted: '2025-12-29' })]],
      ]),
      siblingLearnedByPermitId: new Map([[100, null]]),
    });
    expect(r.targetCycle).toBe(0);
    expect(r.ulsAnchors?.bpApprovalAnchor).toBe('2026-04-30');
    expect(r.projection).toBe('2026-09-17');
  });

  it('fix-39 Track A: BP approved in the FUTURE → ULS = approval + 120 (not issue-based)', () => {
    // Distinguishes approval-anchoring from issue-anchoring: a BP whose
    // approval is set to a FUTURE date and has no actual_issue. ULS must read
    // approval(2026-08-01) + 120 = 2026-11-29, proving it tracks approval.
    const bp = permit({
      id: 100,
      type: 'Building Permit',
      approval_date: '2026-08-01',
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
    expect(r.ulsAnchors?.bpApprovalAnchor).toBe('2026-08-01');
    expect(r.projection).toBe('2026-11-29');
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
    // fix-25-HH-redux: cycle 2 city review cr2 default=21 → 2026-05-16,
    //   +7 final = 2026-05-23.
    expect(r.rounds?.corrIssued1).toBe('2026-04-15');
    expect(r.projection).toBe('2026-05-23');
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
    // No BP → ULS branch returns no anchors → falls to non-ULS walk. Then
    // fix-24h/24i: no cycle activity + no learner → defaultDaysForType('ULS')=90.
    // 2026-05-01 + 90d = 2026-07-30.
    expect(r.projection).toBe('2026-07-30');
    expect(r.ulsAnchors).toBeUndefined();
  });

  it('last-real-date floor prevents projection earlier than known events', () => {
    // Hand-craft a case where the walk lands BEFORE a far-future real
    // date (data anomaly). The anomaly lives on cycle 2's resubmitted —
    // OFF the targetCycle=2 cursor path (the walk only processes cycle 1
    // + projects cycle 2's review), so fix-25-HH-redux's added city
    // review can't push the projection past it. Floor lifts it to
    // lastReal + 7.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2026-01-01',
          corr_issued: '2026-02-10',
          resubmitted: '2026-02-20',
        }),
        cyc({
          cycle_index: 2,
          resubmitted: '2027-12-31', // far-future real date (anomaly)
        }),
      ],
      learnedEstimate: null,
    });
    // walk + cycle-2 city review lands ~2026-04 but lastRealDate=2027-12-31
    // → floor to 2027-12-31 + 7 = 2028-01-07
    expect(r.projection).toBe('2028-01-07');
  });
});

describe('computeProjectedApproval — fix-24e today-floor on projection anchors', () => {
  it('past target_submit: projection chains from today, not the past anchor (fix-24h: 210d default + floor)', () => {
    // Permit only has target_submit. With today=2026-05-15 and an anchor
    // of 2025-08-01 (~9 months back), the projection should anchor on
    // today, not on the stale target_submit.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2025-08-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    // No cycle activity + no learner → 210d default. base floored to today.
    // 2026-05-15 + 210d = 2026-12-11.
    expect(r.projection).toBe('2026-12-11');
    expect(r.isProjected).toBe(true);
  });

  it('future target_submit: projection chains from the anchor (no floor applied, fix-24h: +210d)', () => {
    // Today is 2026-05-15 and target_submit is 2026-08-01 (future).
    // The anchor is used as-is, floor is a no-op. fix-24h holistic still
    // fires (no cycle activity, no learner) → anchor + 210d.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2026-08-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    // base=2026-08-01, +210d = 2027-02-27.
    expect(r.projection).toBe('2027-02-27');
  });

  it('today exactly: anchor returned as-is (boundary, not floored, fix-24h: +210d)', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2026-05-15' }),
      cycles: [],
      learnedEstimate: null,
    });
    // base=today exactly → flooredAnchor returns today as-is.
    // today + 210d = 2026-12-11.
    expect(r.projection).toBe('2026-12-11');
  });

  it('past cycle 1 submitted: forecast chains from today, but the SUBMITTED CELL still shows the actual past date', () => {
    // The actual cycle 1 submitted is 2025-11-15. Today is 2026-05-15.
    // Forecast for projected approval anchors at today. Returned
    // rounds.corrIssued1 (forecast) reflects the today anchor, not the
    // stale submitted, but cycle 1 submitted itself is the caller's
    // responsibility to display from rd?.submitted — the estimator never
    // hands back a "modified submitted" value.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2025-11-15' })],
      learnedEstimate: learned({ mostLikelyCycle: 2 }),
    });
    // targetCycle=2, base=2025-11-15 → floored to 2026-05-15.
    // i=0: rd has no corr_issued, no city_target.
    //   crEnd = addDays(today=2026-05-15, cr1=21) = 2026-06-05
    //   resubEnd = addDays(2026-06-05, co1=10) = 2026-06-15
    // After loop, cursor = 2026-06-15.
    // fix-25-HH-redux: cycle 2 city review cr2 default=21 → 2026-07-06,
    //   +7 buffer = 2026-07-13.
    expect(r.rounds?.corrIssued1).toBe('2026-06-05');
    expect(r.rounds?.resubmitted1).toBe('2026-06-15');
    expect(r.projection).toBe('2026-07-13');
  });

  it('past actual corr_issued: displayed as-is, but downstream resubmitted forecast floors at today', () => {
    // Bobby's "past corr_issued" smoke. corr_issued=2025-11-01 (real, past).
    // The Cy1 Corr Issued cell shows 2025-11-01. Cy1 Resubmitted has no
    // actual, so it's a forecast — anchored to today, not 2025-11-01.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2025-10-01',
          corr_issued: '2025-11-01',
        }),
      ],
      learnedEstimate: learned({ mostLikelyCycle: 2 }),
    });
    // Actual corrIssued1 displays as-is.
    expect(r.rounds?.corrIssued1).toBe('2025-11-01');
    // Resub forecast: addDays(flooredAnchor('2025-11-01')=today, co1=10) =
    // 2026-05-15 + 10 = 2026-05-25.
    expect(r.rounds?.resubmitted1).toBe('2026-05-25');
    // fix-25-HH-redux: cycle 2 city review cr2 walks back to this permit's
    // actual cycle-1 review span (31d) → 2026-06-25, +7 = 2026-07-02.
    expect(r.projection).toBe('2026-07-02');
  });

  it("past city_target (Bobby's example): forecast crEnd lifted to today instead of using the stale forecast", () => {
    // city_target=2025-12-15, today=2025-12-16. v1 would use 2025-12-15 as
    // crEnd directly — that's a past-dated forecast. fix-24e: floor to
    // today. Then resub forecast chains from today.
    vi.setSystemTime(new Date('2025-12-16T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2025-09-01',
          city_target: '2025-12-15',
        }),
      ],
      learnedEstimate: learned({ mostLikelyCycle: 2 }),
    });
    // crEnd = flooredAnchor(city_target=2025-12-15) = today=2025-12-16
    // resubEnd = addDays(2025-12-16, co1=10) = 2025-12-26
    // fix-25-HH-redux: cycle 2 city review cr2 default=21 → 2026-01-16,
    //   +7 = 2026-01-23.
    expect(r.rounds?.corrIssued1).toBe('2025-12-16');
    expect(r.rounds?.resubmitted1).toBe('2025-12-26');
    expect(r.projection).toBe('2026-01-23');
  });

  it('est_approval is never in the past when at least one downstream duration is positive', () => {
    // Stress case: everything in the past, all anchors stale. With the
    // floor, the projection should still land at or after today.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2024-01-01' }),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2024-02-01',
          corr_issued: '2024-04-01',
          resubmitted: '2024-05-01',
        }),
      ],
      learnedEstimate: learned({ mostLikelyCycle: 3 }),
    });
    expect(r.projection).not.toBeNull();
    // ISO date lex compare is fine because both are YYYY-MM-DD.
    expect(r.projection! >= '2026-05-15').toBe(true);
  });

  it('null anchors → null projection (no floor side-effect)', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r.projection).toBeNull();
  });

  it('actual_issue / approval_date still short-circuit even when they are in the past', () => {
    // Past actual_issue is a HISTORICAL fact, not a forecast — display
    // as-is, never floor.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r1 = computeProjectedApproval({
      permit: permit({ actual_issue: '2025-09-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r1.projection).toBe('2025-09-01');
    expect(r1.isActual).toBe(true);

    const r2 = computeProjectedApproval({
      permit: permit({ approval_date: '2025-08-15' }),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r2.projection).toBe('2025-08-15');
    expect(r2.isActual).toBe(true);
  });
});

describe('computeProjectedApproval — fix-24h/24i defaultDaysForType fallback', () => {
  it('no actuals + no learner + no cycle dates → defaults to today + 210d (test bobby case)', () => {
    // The canonical fix-24h motivator. test bobby permit: past target_submit,
    // no learner samples for Bothell BPs, single empty cycle 0 row.
    // Pre-fix-24h would have returned today + 28d (optimistic cycle 1 walk).
    // Post-fix-24h returns today + 210d.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2025-10-06' }),
      cycles: [cyc({ cycle_index: 0 })],
      learnedEstimate: null,
    });
    // today (2026-05-15) + 210d = 2026-12-11.
    expect(r.projection).toBe('2026-12-11');
    expect(r.targetCycle).toBe(1);
  });

  it('future target_submit + no learner + no cycle dates → target_submit + 210d (no floor needed)', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2027-01-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    // 2027-01-01 + 210d = 2027-07-30.
    expect(r.projection).toBe('2027-07-30');
  });

  it('learner avgIntakeToApproval present → uses learner avg, NOT the 210d default', () => {
    // Even with no cycle activity, the learner takes precedence over the
    // hardcoded 210d. Real data wins over the magic number.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2025-10-06' }),
      cycles: [],
      learnedEstimate: learned({ avgIntakeToApproval: 90 }),
    });
    // base floored to today + 90 = 2026-08-13.
    expect(r.projection).toBe('2026-08-13');
  });

  it('cycle activity present → falls into cycle walk, NOT the 210d default', () => {
    // Cycle 1 has submitted set → hasAnyCycleActivity=true → the 210d
    // branch is skipped and the cycle walk takes over. Real user data
    // always overrides the magic default.
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2025-10-06' }),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-04-01' })],
      learnedEstimate: null,
    });
    // Cycle walk fires, NOT today + 210d. Exact value depends on the
    // cycle walk math, but it must NOT equal the 210d default output.
    expect(r.projection).not.toBe('2026-12-11');
  });

  it('fix-24i: Demolition permit + no learner + no cycle activity → uses 60d per-type default, NOT 210d', () => {
    // Bothell Demolition. Per-type default = 60d (much faster than BP).
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ type: 'Demolition', target_submit: '2025-10-06' }),
      cycles: [],
      learnedEstimate: null,
    });
    // today (floored) + 60d = 2026-07-14.
    expect(r.projection).toBe('2026-07-14');
  });

  it('fix-24i: ULS permit + no learner + no cycle activity → uses 90d per-type default', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      // Use a target_submit so we reach the non-ULS fallback path (no
      // sibling BP supplied → ULS branch returns no anchors, falls through).
      permit: permit({ type: 'ULS', target_submit: '2025-10-06' }),
      cycles: [],
      learnedEstimate: null,
      siblingPermits: [],
      siblingCyclesByPermitId: new Map(),
    });
    // today (floored) + 90d = 2026-08-13.
    expect(r.projection).toBe('2026-08-13');
  });

  it('fix-24i: unknown permit type falls back to PER_TYPE_FALLBACK_DAYS (210)', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const r = computeProjectedApproval({
      permit: permit({ type: 'Bizarre Custom Type', target_submit: '2025-10-06' }),
      cycles: [],
      learnedEstimate: null,
    });
    // today + 210d = 2026-12-11 (same as the BP default).
    expect(r.projection).toBe('2026-12-11');
  });
});

// ============================================================
// fix-32 (2026-05-19): reviewer-corrections cycle prediction
// ============================================================
// When a reviewer on the permit's latest cycle is in
// current_status='corrections_required' AND no newer cycle row exists,
// the projection bumps targetCycle by 1 to account for the upcoming
// correction round the reviewer is signaling. Guard: if a newer cycle
// already exists, the correction is already represented in the cycle
// walk — don't double-count.

function reviewer(
  over: Partial<PermitCycleReviewer> & {
    cycle_index: number;
    reviewer_name: string;
    current_status: ReviewerStatus;
  },
): PermitCycleReviewer {
  return {
    id: `rv-${over.reviewer_name}-${over.cycle_index}`,
    tenant_id: 't0',
    permit_id: 1,
    discipline: null,
    last_event_date: null,
    created_at: '2026-05-19T00:00:00Z',
    updated_at: '2026-05-19T00:00:00Z',
    ...over,
  };
}

describe('computeProjectedApproval — fix-32 reviewer-corrections cycle prediction', () => {
  it('(a) latest cycle flagged corrections + no next cycle → targetCycle bumped, projection pushed out', () => {
    // Permit in cycle 1 with submitted set but no corr_issued yet.
    // A reviewer on cycle 1 flagged corrections_required — the city is
    // signaling another correction round is coming. Without the flag,
    // the learner's avgIntakeToApproval would route through the holistic
    // shortcut (targetCycle=1, approve-in-first-review). With the flag,
    // the shortcut is bypassed and the walk targets cycle 2.
    const cycles = [cyc({ cycle_index: 1, submitted: '2026-01-15' })];
    const flagged: PermitCycleReviewer[] = [
      reviewer({
        cycle_index: 1,
        reviewer_name: 'Aaron Blunt',
        current_status: 'corrections_required',
      }),
    ];
    const baseline = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned({ avgIntakeToApproval: 210 }),
    });
    const withFlag = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned({ avgIntakeToApproval: 210 }),
      permitReviewers: flagged,
    });
    expect(baseline.targetCycle).toBe(1);
    expect(withFlag.targetCycle).toBe(2);
    // Date must move forward — a real additional cycle's worth of duration.
    expect(withFlag.projection).not.toBe(null);
    expect(baseline.projection).not.toBe(null);
    expect(
      withFlag.projection! > baseline.projection!,
    ).toBe(true);
  });

  it('(b) corrections flagged but next cycle already exists → no bump (no double-count)', () => {
    // Cycle 1 had a correction round and resubmitted; cycle 2 now exists.
    // The reviewer's corrections_required state on cycle 1 is stale —
    // the city already issued corrections on that cycle and the team
    // resubmitted. Rule must NOT add another cycle on top.
    const cycles = [
      cyc({
        cycle_index: 1,
        submitted: '2026-01-15',
        corr_issued: '2026-02-10',
        resubmitted: '2026-03-01',
      }),
      cyc({ cycle_index: 2, submitted: '2026-03-01' }),
    ];
    const staleFlag: PermitCycleReviewer[] = [
      reviewer({
        cycle_index: 1,
        reviewer_name: 'Aaron Blunt',
        current_status: 'corrections_required',
      }),
    ];
    const withFlag = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned(),
      permitReviewers: staleFlag,
    });
    const withoutFlag = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned(),
    });
    expect(withFlag.targetCycle).toBe(withoutFlag.targetCycle);
    expect(withFlag.projection).toBe(withoutFlag.projection);
  });

  it('(c) no corrections_required on any cycle → unchanged baseline', () => {
    const cycles = [cyc({ cycle_index: 1, submitted: '2026-01-15' })];
    const benignReviewers: PermitCycleReviewer[] = [
      reviewer({
        cycle_index: 1,
        reviewer_name: 'Aaron Blunt',
        current_status: 'approved',
      }),
      reviewer({
        cycle_index: 1,
        reviewer_name: 'Bea Carlson',
        current_status: 'in_process',
      }),
    ];
    const withReviewers = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned({ avgIntakeToApproval: 210 }),
      permitReviewers: benignReviewers,
    });
    const baseline = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned({ avgIntakeToApproval: 210 }),
    });
    expect(withReviewers.targetCycle).toBe(baseline.targetCycle);
    expect(withReviewers.projection).toBe(baseline.projection);
  });

  it('(d) corrections flagged on cycle 2 AND cycle 1 already had corrections → +1 on top of existing walk', () => {
    // Multi-cycle scenario: cycle 1 went through corrections and got
    // resubmitted to cycle 2; cycle 2 is now active and a reviewer
    // flagged corrections_required on cycle 2. Without the flag the
    // walk would target cycle 2 (currentReviewCycle = actualCorrCycles
    // + 1 = 2). With the flag, targetCycle bumps to 3.
    const cycles = [
      cyc({
        cycle_index: 1,
        submitted: '2026-01-15',
        corr_issued: '2026-02-10',
        resubmitted: '2026-03-01',
      }),
      cyc({ cycle_index: 2, submitted: '2026-03-01' }),
    ];
    const flagged: PermitCycleReviewer[] = [
      reviewer({
        cycle_index: 2,
        reviewer_name: 'Shimika Dowlen',
        current_status: 'corrections_required',
      }),
    ];
    const baseline = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned(),
    });
    const withFlag = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned(),
      permitReviewers: flagged,
    });
    expect(baseline.targetCycle).toBe(2);
    expect(withFlag.targetCycle).toBe(3);
    expect(withFlag.projection).not.toBe(null);
    expect(baseline.projection).not.toBe(null);
    expect(withFlag.projection! > baseline.projection!).toBe(true);
  });

  it('(f) latestCycleIdx is order-independent — cycles passed descending still bump correctly', () => {
    // fix-32a: callers sort cycles ascending today, but the rule must
    // not depend on it. A descending-order array with corrections
    // flagged on the highest cycle (no cycle 3 row) must still bump
    // targetCycle to 3, same as case (d).
    const cyclesDesc = [
      cyc({ cycle_index: 2, submitted: '2026-03-01' }),
      cyc({
        cycle_index: 1,
        submitted: '2026-01-15',
        corr_issued: '2026-02-10',
        resubmitted: '2026-03-01',
      }),
    ];
    const flagged: PermitCycleReviewer[] = [
      reviewer({
        cycle_index: 2,
        reviewer_name: 'Shimika Dowlen',
        current_status: 'corrections_required',
      }),
    ];
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: cyclesDesc,
      learnedEstimate: learned(),
      permitReviewers: flagged,
    });
    expect(r.targetCycle).toBe(3);
  });

  it('(e) reviewer on cycle 0 (design) is ignored — fix-32 anchors on review cycles only', () => {
    // The projection's `cycles` input is already filtered to
    // cycle_index !== 0 by callers, so a cycle-0 reviewer never matches
    // any cycle in the projection's view. Sanity test the guard.
    const cycles = [cyc({ cycle_index: 1, submitted: '2026-01-15' })];
    const designReviewer: PermitCycleReviewer[] = [
      reviewer({
        cycle_index: 0,
        reviewer_name: 'Design Reviewer',
        current_status: 'corrections_required',
      }),
    ];
    const baseline = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned({ avgIntakeToApproval: 210 }),
    });
    const withDesignFlag = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: learned({ avgIntakeToApproval: 210 }),
      permitReviewers: designReviewer,
    });
    expect(withDesignFlag.targetCycle).toBe(baseline.targetCycle);
    expect(withDesignFlag.projection).toBe(baseline.projection);
  });
});

// ============================================================
// fix-25-HH-redux: in-flight final-cycle city-review projection
// ============================================================
// Pre-redux, a targetCycle>=2 walk jumped from the last resubmit
// straight to + FINAL_APPROVAL_BUFFER, never projecting the FINAL
// review cycle's city review. An in-flight cycle (submitted, no
// corr yet) collapsed to "submitted + 7". This also had to compose
// with fix-32's reviewer-corrections targetCycle bump.

describe('computeProjectedApproval — fix-25-HH-redux final-cycle city review', () => {
  it('in-flight cycle (submitted, no corr) projects a city review, not submitted + 7', () => {
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));
    // cycle 1 fully done; cycle 2 just submitted (in-flight), no corr.
    // No reviewer flag → targetCycle = currentReviewCycle = 2.
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2026-01-15',
          corr_issued: '2026-02-10',
          resubmitted: '2026-03-01',
        }),
        cyc({ cycle_index: 2, submitted: '2026-03-01' }),
      ],
      learnedEstimate: null,
    });
    expect(r.targetCycle).toBe(2);
    // Pre-redux would have been the cycle-1 resubmit (2026-03-01) floored
    // to today + 7 ≈ 2026-05-27. Redux adds cycle 2's city review first,
    // so the projection must be materially later than that.
    expect(r.projection).not.toBeNull();
    expect(r.projection! > '2026-06-01').toBe(true);
  });

  it('3056-style: cycle 3 in-flight + reviewer corrections → targetCycle 4, lands ~July 2026', () => {
    // Permit 355 (7105904-CN) post fix-34 cleanup: cycles 1+2 complete,
    // cycle 3 submitted (in-flight), two reviewers corrections_required
    // on cycle 3. fix-32 bumps targetCycle to 4; fix-25-HH-redux projects
    // cycle 4's city review on top so the est_approval is realistic.
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));
    const cycles = [
      cyc({
        cycle_index: 1,
        submitted: '2025-12-17',
        corr_issued: '2026-02-27',
        resubmitted: '2026-04-21',
      }),
      cyc({
        cycle_index: 2,
        submitted: '2026-04-21',
        corr_issued: '2026-05-13',
        resubmitted: '2026-05-19',
      }),
      cyc({ cycle_index: 3, submitted: '2026-05-19' }),
    ];
    const reviewers = [
      reviewer({ cycle_index: 3, reviewer_name: 'Colum Lang', current_status: 'corrections_required' }),
      reviewer({ cycle_index: 3, reviewer_name: 'Mike Peli', current_status: 'corrections_required' }),
      reviewer({ cycle_index: 3, reviewer_name: 'Cici Sun', current_status: 'approved' }),
    ];
    const r = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: null,
      permitReviewers: reviewers,
    });
    expect(r.targetCycle).toBe(4); // fix-32 bump (cycle 3 corrections flagged)
    expect(r.projection).not.toBeNull();
    // Realistic ~July 2026 — NOT the +7 collapse (~late May) it was before.
    expect(r.projection! >= '2026-07-01').toBe(true);
    expect(r.projection! < '2026-08-15').toBe(true);
  });

  it('without the reviewer flag the same permit targets cycle 3 and still projects a final review (no +7 collapse)', () => {
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));
    const cycles = [
      cyc({ cycle_index: 1, submitted: '2025-12-17', corr_issued: '2026-02-27', resubmitted: '2026-04-21' }),
      cyc({ cycle_index: 2, submitted: '2026-04-21', corr_issued: '2026-05-13', resubmitted: '2026-05-19' }),
      cyc({ cycle_index: 3, submitted: '2026-05-19' }),
    ];
    const r = computeProjectedApproval({
      permit: permit(),
      cycles,
      learnedEstimate: null,
    });
    expect(r.targetCycle).toBe(3); // currentReviewCycle, no bump
    // Cycle 3's city review is projected → past mid-June, not 05-19 + 7.
    expect(r.projection! > '2026-06-01').toBe(true);
  });
});

describe('computeProjectedApproval — fix-53 cycle-1 intake anchor', () => {
  it('decomposition-only: projection UNCHANGED by cycle0IntakeAccepted when cycle 1 has actual corrections', () => {
    // cycle 1 has an actual corr_issued → its review endpoint is the actual
    // date regardless of anchor, so threading intake_accepted must not move the
    // projection. cr2Count>0 keeps cycle-2's projection on the learned avg
    // (no durFor walk-back to cycle-1's self cr).
    const cycles = [
      cyc({ cycle_index: 1, submitted: '2026-01-01', corr_issued: '2026-02-01', resubmitted: '2026-02-15' }),
      cyc({ cycle_index: 2, submitted: '2026-02-15' }),
    ];
    const est = learned({ cityReview2: 20, cr2Count: 3, corrResponse2: 10, co2Count: 3, mostLikelyCycle: 2 });
    const without = computeProjectedApproval({ permit: permit(), cycles, learnedEstimate: est });
    const withEarlier = computeProjectedApproval({
      permit: permit(), cycles, learnedEstimate: est, cycle0IntakeAccepted: '2025-12-15',
    });
    const withLater = computeProjectedApproval({
      permit: permit(), cycles, learnedEstimate: est, cycle0IntakeAccepted: '2026-01-10',
    });
    expect(withEarlier.projection).toBe(without.projection);
    expect(withLater.projection).toBe(without.projection);
    expect(without.rounds?.corrIssued1).toBe('2026-02-01'); // actual, preserved
  });

  it('omitting cycle0IntakeAccepted is backward-compatible (anchors at c1.submitted)', () => {
    // A PROJECTED cycle-1 (no actual corr) + forced 2-cycle walk. Without an
    // intake date the cycle-1 review anchors at c1.submitted, exactly as before.
    const cycles = [cyc({ cycle_index: 1, submitted: '2026-01-01' })];
    const est = learned({ cityReview1: 30, cr1Count: 3, corrResponse1: 10, co1Count: 3, cityReview2: 20, cr2Count: 3 });
    const r = computeProjectedApproval({
      permit: permit(), cycles, learnedEstimate: est, targetCycleOverride: 2,
    });
    expect(r.rounds?.corrIssued1).toBe('2026-01-31'); // 2026-01-01 + 30d
  });

  it('a PROJECTED cycle-1 review anchors at intake_accepted (the fix-53 behavior)', () => {
    const cycles = [cyc({ cycle_index: 1, submitted: '2026-01-01' })];
    const est = learned({ cityReview1: 30, cr1Count: 3, corrResponse1: 10, co1Count: 3, cityReview2: 20, cr2Count: 3 });
    const r = computeProjectedApproval({
      permit: permit(), cycles, learnedEstimate: est, targetCycleOverride: 2,
      cycle0IntakeAccepted: '2026-01-15',
    });
    // Now anchored at intake 2026-01-15 + 30d, not submitted 2026-01-01.
    expect(r.rounds?.corrIssued1).toBe('2026-02-14');
  });
});
