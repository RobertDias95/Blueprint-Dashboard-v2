import { describe, it, expect } from 'vitest';
import {
  avgCyclesPerPermit,
  avgIntakeToApproval,
  breakdownByTypeAndJuris,
  defaultDateRange,
  filterPermits,
  intakeToApprovalByMonth,
  SPARSE_GATE,
  submissionToIntakeVariance,
  targetSubmitHitRate,
  totalApprovedInWindow,
  type PerfTrendsFilters,
} from '../lib/perfTrends';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-25-feat-T: helpers for the new Trends operational view.
// Pure-function aggregations over the permits cache.

function mkProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...over,
  };
}

function mkCycle(over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>): PermitCycle {
  return {
    id: `c-${over.cycle_index}-${Math.random()}`,
    permit_id: 1,
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

function mkPermit(over: Partial<PermitWithCycles> & { id?: number } = {}): PermitWithCycles {
  return {
    id: over.id ?? 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: 'is',
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
    updated_at: '2026-01-01T00:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

const FULL_WINDOW: PerfTrendsFilters = {
  dateRange: { from: '2020-01-01', to: '2030-12-31' },
};

describe('filterPermits', () => {
  const projectsById = new Map<string, Project>([
    ['p1', mkProject({ id: 'p1', juris: 'Seattle' })],
    ['p2', mkProject({ id: 'p2', juris: 'Bellevue' })],
  ]);

  it('excludes permits without an approval_date / actual_issue', () => {
    const out = filterPermits(
      [mkPermit({ approval_date: null, actual_issue: null })],
      projectsById,
      FULL_WINDOW,
    );
    expect(out).toHaveLength(0);
  });

  it('inclusive on both date-range bounds', () => {
    const permits = [
      mkPermit({ id: 1, approval_date: '2026-05-01' }),
      mkPermit({ id: 2, approval_date: '2026-06-01' }),
      mkPermit({ id: 3, approval_date: '2026-04-30' }),
      mkPermit({ id: 4, approval_date: '2026-06-02' }),
    ];
    const out = filterPermits(permits, projectsById, {
      dateRange: { from: '2026-05-01', to: '2026-06-01' },
    });
    expect(out.map((p) => p.id).sort()).toEqual([1, 2]);
  });

  it('juris filter scopes to that juris only', () => {
    const permits = [
      mkPermit({ id: 1, project_id: 'p1', approval_date: '2026-05-01' }),
      mkPermit({ id: 2, project_id: 'p2', approval_date: '2026-05-02' }),
    ];
    const out = filterPermits(permits, projectsById, {
      ...FULL_WINDOW,
      juris: 'Seattle',
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  it('permitType filter scopes to that type only', () => {
    const permits = [
      mkPermit({ id: 1, type: 'Building Permit', approval_date: '2026-05-01' }),
      mkPermit({ id: 2, type: 'Demolition', approval_date: '2026-05-02' }),
    ];
    const out = filterPermits(permits, projectsById, {
      ...FULL_WINDOW,
      permitType: 'Demolition',
    });
    expect(out.map((p) => p.id)).toEqual([2]);
  });
});

describe('totalApprovedInWindow', () => {
  it('returns 0 on empty input', () => {
    expect(totalApprovedInWindow([])).toBe(0);
  });
  it('returns count of permits already filtered', () => {
    expect(totalApprovedInWindow([mkPermit(), mkPermit()])).toBe(2);
  });
});

describe('avgIntakeToApproval', () => {
  it('returns null when no permits have both intake_accepted + approval_date', () => {
    expect(
      avgIntakeToApproval([
        mkPermit({
          approval_date: '2026-05-01',
          permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: null })],
        }),
      ]),
    ).toBeNull();
  });

  it('averages c0.intake_accepted → approval_date in whole days', () => {
    const a = mkPermit({
      approval_date: '2026-05-31',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-05-01' })],
    });
    const b = mkPermit({
      approval_date: '2026-06-10',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-05-01' })],
    });
    // 30 days + 40 days = avg 35
    expect(avgIntakeToApproval([a, b])).toBe(35);
  });

  it('skips negative deltas (bad data)', () => {
    const bad = mkPermit({
      approval_date: '2026-04-01',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-05-01' })],
    });
    expect(avgIntakeToApproval([bad])).toBeNull();
  });
});

describe('avgCyclesPerPermit', () => {
  it('returns null on empty input', () => {
    expect(avgCyclesPerPermit([])).toBeNull();
  });
  it('counts only cycles with at least one populated date', () => {
    const p = mkPermit({
      permit_cycles: [
        mkCycle({ cycle_index: 0, submitted: '2026-05-01' }),
        mkCycle({ cycle_index: 1 }), // empty — does not count
        mkCycle({ cycle_index: 2, corr_issued: '2026-06-01' }),
      ],
    });
    expect(avgCyclesPerPermit([p])).toBe(2.0);
  });
});

describe('targetSubmitHitRate', () => {
  it('returns null when no permits have both target_submit + c0.submitted', () => {
    expect(
      targetSubmitHitRate([
        mkPermit({
          target_submit: '2026-05-01',
          permit_cycles: [mkCycle({ cycle_index: 0 })],
        }),
      ]),
    ).toBeNull();
  });

  it('counts hits (submitted on or before target) and avg offset (signed)', () => {
    const onTime = mkPermit({
      target_submit: '2026-05-15',
      permit_cycles: [mkCycle({ cycle_index: 0, submitted: '2026-05-10' })],
    });
    const late = mkPermit({
      target_submit: '2026-05-15',
      permit_cycles: [mkCycle({ cycle_index: 0, submitted: '2026-05-25' })],
    });
    const hit = targetSubmitHitRate([onTime, late]);
    expect(hit).toEqual({
      hit: 1,
      total: 2,
      // (-5 + 10) / 2 = 2.5 → rounds to 3 (late on net)
      avgDaysOff: 3,
    });
  });
});

describe('intakeToApprovalByMonth', () => {
  it('bins by approval_date month, computes avg + n', () => {
    const may1 = mkPermit({
      approval_date: '2026-05-10',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-05-01' })],
    });
    const may2 = mkPermit({
      approval_date: '2026-05-20',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-05-01' })],
    });
    const jun1 = mkPermit({
      approval_date: '2026-06-15',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-05-01' })],
    });
    const out = intakeToApprovalByMonth([may1, may2, jun1]);
    expect(out).toEqual([
      { month: '2026-05', avgDays: 14, n: 2 }, // (9+19)/2 = 14
      { month: '2026-06', avgDays: 45, n: 1 },
    ]);
  });

  it('returns empty array when no permits have both anchors', () => {
    expect(
      intakeToApprovalByMonth([mkPermit({ approval_date: '2026-05-01' })]),
    ).toEqual([]);
  });

  it('handles permit on month boundary (last day vs first day)', () => {
    const lastDay = mkPermit({
      approval_date: '2026-05-31',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-05-01' })],
    });
    const firstDay = mkPermit({
      approval_date: '2026-06-01',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-05-01' })],
    });
    const out = intakeToApprovalByMonth([lastDay, firstDay]);
    expect(out.map((r) => r.month)).toEqual(['2026-05', '2026-06']);
  });
});

describe('breakdownByTypeAndJuris', () => {
  const projectsById = new Map<string, Project>([
    ['p1', mkProject({ id: 'p1', juris: 'Seattle' })],
    ['p2', mkProject({ id: 'p2', juris: 'Seattle' })],
    ['p3', mkProject({ id: 'p3', juris: 'Bellevue' })],
  ]);

  it('groups by (juris × type) and computes all 5 derived columns', () => {
    const p1 = mkPermit({
      id: 1,
      project_id: 'p1',
      type: 'Building Permit',
      approval_date: '2026-08-01',
      target_submit: '2026-04-01',
      permit_cycles: [
        mkCycle({
          cycle_index: 0,
          submitted: '2026-04-01', // hit target exactly
          intake_accepted: '2026-04-15',
        }),
        mkCycle({
          cycle_index: 1,
          submitted: '2026-04-15',
          corr_issued: '2026-05-15', // 30 day city review
          resubmitted: '2026-05-25', // 10 day team turnaround
        }),
      ],
    });
    const out = breakdownByTypeAndJuris([p1], projectsById);
    expect(out).toHaveLength(1);
    const r = out[0];
    expect(r.juris).toBe('Seattle');
    expect(r.type).toBe('Building Permit');
    expect(r.n).toBe(1);
    expect(r.avgCityReviewPerCycle).toBe(30);
    expect(r.avgTeamTurnaroundPerCycle).toBe(10);
    // 1 sample < SPARSE_GATE → hit rate null
    expect(r.targetHitRate).toBeNull();
  });

  it('hit rate gates at SPARSE_GATE samples with both anchors', () => {
    const permits = Array.from({ length: SPARSE_GATE }, (_, i) =>
      mkPermit({
        id: i + 1,
        project_id: 'p1',
        type: 'Building Permit',
        approval_date: '2026-08-01',
        target_submit: '2026-05-15',
        permit_cycles: [
          mkCycle({
            cycle_index: 0,
            submitted: i < 2 ? '2026-05-10' : '2026-05-20',
          }),
        ],
      }),
    );
    const out = breakdownByTypeAndJuris(permits, projectsById);
    // 2 hits, 1 late, gate clears
    expect(out[0].targetHitRate).toBeCloseTo(2 / SPARSE_GATE, 3);
  });

  it('sorts buckets by n desc', () => {
    const a = (id: number, juris: string, type: string) =>
      mkPermit({
        id,
        project_id: juris === 'Seattle' ? 'p1' : 'p3',
        type,
        approval_date: '2026-08-01',
      });
    const out = breakdownByTypeAndJuris(
      [a(1, 'Seattle', 'BP'), a(2, 'Seattle', 'BP'), a(3, 'Bellevue', 'Demo')],
      projectsById,
    );
    expect(out[0].n).toBe(2);
    expect(out[1].n).toBe(1);
  });
});

describe('submissionToIntakeVariance', () => {
  const projectsById = new Map<string, Project>([
    ['p1', mkProject({ id: 'p1', juris: 'Seattle' })],
  ]);

  it('measures c0.submitted → c0.intake_accepted in days, grouped', () => {
    const a = mkPermit({
      id: 1,
      project_id: 'p1',
      type: 'Building Permit',
      approval_date: '2026-07-01',
      permit_cycles: [
        mkCycle({
          cycle_index: 0,
          submitted: '2026-05-01',
          intake_accepted: '2026-05-15', // 14 day intake lag
        }),
      ],
    });
    const b = mkPermit({
      id: 2,
      project_id: 'p1',
      type: 'Building Permit',
      approval_date: '2026-07-15',
      permit_cycles: [
        mkCycle({
          cycle_index: 0,
          submitted: '2026-06-01',
          intake_accepted: '2026-06-08', // 7 day intake lag
        }),
      ],
    });
    const out = submissionToIntakeVariance([a, b], projectsById);
    expect(out).toHaveLength(1);
    expect(out[0].avgDaysFromSubmittedToIntakeAccepted).toBe(11); // (14+7)/2 = 10.5 -> 11
    expect(out[0].n).toBe(2);
  });

  it('skips negative deltas (intake before submitted is bad data)', () => {
    const bad = mkPermit({
      id: 1,
      approval_date: '2026-07-01',
      permit_cycles: [
        mkCycle({
          cycle_index: 0,
          submitted: '2026-05-15',
          intake_accepted: '2026-05-01', // negative — bad
        }),
      ],
    });
    expect(submissionToIntakeVariance([bad], projectsById)).toEqual([]);
  });
});

describe('defaultDateRange', () => {
  it('returns a 12-month window ending today', () => {
    const fixedNow = new Date('2026-05-17T12:00:00Z');
    const r = defaultDateRange(fixedNow);
    expect(r.to).toBe('2026-05-17');
    expect(r.from).toBe('2025-05-17');
  });
});
