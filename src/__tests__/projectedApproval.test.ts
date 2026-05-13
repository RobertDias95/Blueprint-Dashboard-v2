import { describe, it, expect } from 'vitest';
import { computeProjectedApproval } from '../lib/projectedApproval';
import { SCHEDULE_DEFAULTS, type LearnedEstimate } from '../lib/scheduleBenchmarks';
import type { Permit, PermitCycle } from '../lib/database.types';

// Q9.5.f-fix-10: walk-forward projection tests. Each case pins the math
// to a hand-computed expected value so a future refactor can't silently
// shift the formula.

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

describe('computeProjectedApproval', () => {
  it('actual_issue short-circuits with isActual=true', () => {
    const r = computeProjectedApproval({
      permit: permit({ actual_issue: '2026-06-15' }),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r).toEqual({
      projection: '2026-06-15',
      isActual: true,
      isProjected: false,
    });
  });

  it('approval_date short-circuits when no actual_issue', () => {
    const r = computeProjectedApproval({
      permit: permit({ approval_date: '2026-06-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r).toEqual({
      projection: '2026-06-01',
      isActual: true,
      isProjected: false,
    });
  });

  it('null projection when no anchor (no cycle1.submitted, no target, no GO)', () => {
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [],
      learnedEstimate: null,
    });
    expect(r).toEqual({ projection: null, isActual: false, isProjected: false });
  });

  it('cycle 1 submitted only, no learned → walks with defaults (2 cycles)', () => {
    // anchor = 2026-01-01
    // cr1End = anchor + cityReview1 (21) = 2026-01-22
    // cursor = cr1End + corrResponse1 (10) = 2026-02-01
    // cr2End = cursor + cityReview2 (21) = 2026-02-22
    // cursor = cr2End + corrResponse2 (10) = 2026-03-04
    // projection = cursor + 7 = 2026-03-11
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-01-01' })],
      learnedEstimate: null,
    });
    expect(r.projection).toBe('2026-03-11');
    expect(r.isActual).toBe(false);
    expect(r.isProjected).toBe(true);
    // Defensive: confirms SCHEDULE_DEFAULTS still ship the values this test
    // pinned against. Catches a silent change to the fallback table.
    expect(SCHEDULE_DEFAULTS.cityReview1).toBe(21);
  });

  it('cycle 1 submitted + corr_issued → walks forward from real corr_issued', () => {
    // anchor = 2026-01-01 (used only if no corr_issued)
    // cr1End = 2026-02-10 (real corr_issued)
    // cursor = cr1End + corrResponse1 (10) = 2026-02-20
    // cr2End = cursor + cityReview2 (21) = 2026-03-13
    // cursor = cr2End + corrResponse2 (10) = 2026-03-23
    // projection = cursor + 7 = 2026-03-30
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
    expect(r.projection).toBe('2026-03-30');
  });

  it('cycle 2 in progress with corr_issued uses real cy2.corr_issued as anchor', () => {
    // cycle 1: submitted + corr_issued + resubmitted (all real)
    // cycle 2: corr_issued real (still waiting on resubmittal)
    // cy1 cursor = 2026-02-20 (real resubmitted)
    // cy2 cr2End = 2026-04-01 (real corr_issued)
    // cursor = cr2End + co2 (10) = 2026-04-11
    // projection = cursor + 7 = 2026-04-18
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [
        cyc({
          cycle_index: 1,
          submitted: '2026-01-01',
          corr_issued: '2026-02-10',
          resubmitted: '2026-02-20',
        }),
        cyc({ cycle_index: 2, submitted: '2026-02-20', corr_issued: '2026-04-01' }),
      ],
      learnedEstimate: null,
    });
    expect(r.projection).toBe('2026-04-18');
  });

  it('learned estimate overrides defaults', () => {
    const learned: LearnedEstimate = {
      source: 'test',
      sampleCount: 10,
      dateRange: '',
      goToSubmit: null,
      avgSubmitToIssue: null,
      cityReview1: 30, // longer than default 21
      corrResponse1: 14,
      cityReview2: 30,
      corrResponse2: 14,
      cityReview3: 30,
      corrResponse3: 14,
      cityReview4: 30,
      corrResponse4: 14,
      cr1Count: 10,
      cr2Count: 10,
      cr3Count: 0,
      cr4Count: 0,
      co1Count: 10,
      co2Count: 10,
      co3Count: 0,
      co4Count: 0,
      avgCycles: 2,
      mostLikelyCycle: 2,
      cycleDist: { 1: 0, 2: 10, 3: 0, 4: 0 },
      isAllTime: false,
    };
    // anchor=2026-01-01
    // cr1End = +30 = 2026-01-31
    // cursor = +14 = 2026-02-14
    // cr2End = +30 = 2026-03-16
    // cursor = +14 = 2026-03-30
    // projection = +7 = 2026-04-06
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [cyc({ cycle_index: 1, submitted: '2026-01-01' })],
      learnedEstimate: learned,
    });
    expect(r.projection).toBe('2026-04-06');
  });

  it('target_submit serves as anchor when cycle1.submitted is missing', () => {
    const r = computeProjectedApproval({
      permit: permit({ target_submit: '2026-05-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    // 2026-05-01 + 21 + 10 + 21 + 10 + 7 = +69 days = 2026-07-09
    expect(r.projection).toBe('2026-07-09');
    expect(r.isProjected).toBe(true);
  });

  it('go_date serves as anchor when no submitted and no target_submit', () => {
    const r = computeProjectedApproval({
      permit: permit({ go_date: '2026-01-01' }),
      cycles: [],
      learnedEstimate: null,
    });
    // 2026-01-01 + 21 + 10 + 21 + 10 + 7 = 2026-03-11
    expect(r.projection).toBe('2026-03-11');
  });
});
