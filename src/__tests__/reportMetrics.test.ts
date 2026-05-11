import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  enrichPermits,
  filterEnrichedPermits,
  pickFirstSubmittedCycle,
  resolveDateRange,
  type ReportFilters,
} from '../lib/reportMetrics';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// Q7.2.a: helper tests for the Reports data layer. Every metric formula
// is pinned with a hand-computed expected value so a future refactor
// can't silently shift the math.

function makeCycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: 'c1',
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

function makePermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: 'de',
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
    lot_width: null,
    lot_depth: null,
    alley: null,
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

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...over,
  };
}

const baseFilters: ReportFilters = {
  types: new Set(),
  jurisdictions: new Set(),
  ents: new Set(),
  productTypes: new Set(),
  tags: new Set(),
  range: 'all',
  dateFrom: null,
  dateTo: null,
  status: 'all',
  search: '',
};

// ============================================================
// pickFirstSubmittedCycle
// ============================================================
describe('pickFirstSubmittedCycle', () => {
  it('returns the lowest-index cycle with a non-null submitted', () => {
    const cycles = [
      makeCycle({ id: 'c1', cycle_index: 1, submitted: null }),
      makeCycle({ id: 'c2', cycle_index: 2, submitted: '2026-03-01' }),
      makeCycle({ id: 'c3', cycle_index: 3, submitted: '2026-04-01' }),
    ];
    expect(pickFirstSubmittedCycle(cycles)?.id).toBe('c2');
  });

  it('returns null when no cycle has submitted', () => {
    const cycles = [makeCycle({ submitted: null })];
    expect(pickFirstSubmittedCycle(cycles)).toBeNull();
  });

  it('handles unsorted input', () => {
    const cycles = [
      makeCycle({ id: 'c2', cycle_index: 2, submitted: '2026-03-01' }),
      makeCycle({ id: 'c1', cycle_index: 1, submitted: '2026-02-01' }),
    ];
    expect(pickFirstSubmittedCycle(cycles)?.id).toBe('c1');
  });
});

// ============================================================
// enrichPermits
// ============================================================
describe('enrichPermits', () => {
  const projectsById = new Map([['p1', makeProject({ id: 'p1' })]]);

  it('joins juris from the project record', () => {
    const enriched = enrichPermits([makePermit({ id: 1, project_id: 'p1' })], projectsById);
    expect(enriched[0].juris).toBe('Seattle');
    expect(enriched[0].address).toBe('500 Pike St');
  });

  it('goToSubmit = days from go_date to first cycle submitted', () => {
    const cycle = makeCycle({ submitted: '2026-04-01' });
    const enriched = enrichPermits(
      [makePermit({ go_date: '2026-01-01', permit_cycles: [cycle] })],
      projectsById,
    );
    // 2026-01-01 → 2026-04-01 = 90 days.
    expect(enriched[0].goToSubmit).toBe(90);
  });

  it('cityReviewDays uses intake_accepted as review-start (preferred over submitted)', () => {
    const cycle = makeCycle({
      submitted: '2026-02-01',
      intake_accepted: '2026-02-05',
      corr_issued: '2026-03-05',
    });
    const enriched = enrichPermits(
      [makePermit({ permit_cycles: [cycle] })],
      projectsById,
    );
    // 2026-02-05 → 2026-03-05 = 28 days.
    expect(enriched[0].cityReviewDays).toBe(28);
  });

  it('cityReviewDays falls back to submitted when intake_accepted missing', () => {
    const cycle = makeCycle({
      submitted: '2026-02-01',
      intake_accepted: null,
      corr_issued: '2026-03-04',
    });
    const enriched = enrichPermits(
      [makePermit({ permit_cycles: [cycle] })],
      projectsById,
    );
    // 2026-02-01 → 2026-03-04 = 31 days.
    expect(enriched[0].cityReviewDays).toBe(31);
  });

  it('cityReviewDays falls back to actual_issue when no corrections exist', () => {
    const cycle = makeCycle({
      submitted: '2026-02-01',
      intake_accepted: '2026-02-05',
      corr_issued: null,
    });
    const enriched = enrichPermits(
      [
        makePermit({
          actual_issue: '2026-04-05',
          permit_cycles: [cycle],
        }),
      ],
      projectsById,
    );
    // 2026-02-05 → 2026-04-05 = 59 days.
    expect(enriched[0].cityReviewDays).toBe(59);
  });

  it('variance = (approval_date ?? actual_issue) - expected_issue', () => {
    const enriched = enrichPermits(
      [
        makePermit({
          expected_issue: '2026-04-01',
          approval_date: '2026-04-15',
        }),
      ],
      projectsById,
    );
    expect(enriched[0].variance).toBe(14); // positive = late
  });

  it('variance prefers approval_date over actual_issue when both present', () => {
    const enriched = enrichPermits(
      [
        makePermit({
          expected_issue: '2026-04-01',
          approval_date: '2026-03-25',
          actual_issue: '2026-05-01', // ignored
        }),
      ],
      projectsById,
    );
    expect(enriched[0].variance).toBe(-7); // negative = early
  });

  it('submitToIntake = first cycle submitted → intake_accepted', () => {
    const cycle = makeCycle({
      submitted: '2026-02-01',
      intake_accepted: '2026-02-08',
    });
    const enriched = enrichPermits(
      [makePermit({ permit_cycles: [cycle] })],
      projectsById,
    );
    expect(enriched[0].submitToIntake).toBe(7);
  });

  it('corrResponseDays = first cycle with BOTH corr_issued + resubmitted', () => {
    const cycles = [
      makeCycle({ cycle_index: 1, corr_issued: '2026-03-01', resubmitted: null }),
      makeCycle({ cycle_index: 2, corr_issued: '2026-04-01', resubmitted: '2026-04-15' }),
    ];
    const enriched = enrichPermits(
      [makePermit({ permit_cycles: cycles })],
      projectsById,
    );
    expect(enriched[0].corrResponseDays).toBe(14);
  });

  it('returns null for all derived metrics when source dates missing', () => {
    const enriched = enrichPermits([makePermit()], projectsById);
    expect(enriched[0].goToSubmit).toBeNull();
    expect(enriched[0].cityReviewDays).toBeNull();
    expect(enriched[0].variance).toBeNull();
    expect(enriched[0].ddDuration).toBeNull();
  });
});

// ============================================================
// filterEnrichedPermits
// ============================================================
describe('filterEnrichedPermits', () => {
  const projectsById = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', address: '500 Pike St', juris: 'Seattle' })],
    ['p2', makeProject({ id: 'p2', address: '750 Oak Way', juris: 'Bellevue' })],
  ]);
  const enriched = enrichPermits(
    [
      makePermit({
        id: 1,
        project_id: 'p1',
        type: 'Building Permit',
        ent_lead: 'Bobby',
        go_date: '2026-04-01',
        product_type: 'SFR',
        project_tags: ['ECA'],
        actual_issue: '2026-05-01',
      }),
      makePermit({
        id: 2,
        project_id: 'p2',
        type: 'Demolition',
        ent_lead: 'Miles',
        go_date: '2025-12-01',
        product_type: 'Attached Units',
        project_tags: ['SIP'],
        actual_issue: null,
      }),
    ],
    projectsById,
  );

  it('no filters → returns everything', () => {
    expect(filterEnrichedPermits(enriched, baseFilters).map((e) => e.permit.id)).toEqual([1, 2]);
  });

  it('types filter narrows by permit.type', () => {
    const out = filterEnrichedPermits(enriched, {
      ...baseFilters,
      types: new Set(['Demolition']),
    });
    expect(out.map((e) => e.permit.id)).toEqual([2]);
  });

  it('jurisdictions filter joins through project.juris', () => {
    const out = filterEnrichedPermits(enriched, {
      ...baseFilters,
      jurisdictions: new Set(['Bellevue']),
    });
    expect(out.map((e) => e.permit.id)).toEqual([2]);
  });

  it("status='issued' returns only projects whose every permit has actual_issue", () => {
    const out = filterEnrichedPermits(enriched, {
      ...baseFilters,
      status: 'issued',
    });
    expect(out.map((e) => e.permit.id)).toEqual([1]);
  });

  it("status='active' returns the inverse", () => {
    const out = filterEnrichedPermits(enriched, {
      ...baseFilters,
      status: 'active',
    });
    expect(out.map((e) => e.permit.id)).toEqual([2]);
  });

  it('tags filter matches any tag in the OR set', () => {
    const out = filterEnrichedPermits(enriched, {
      ...baseFilters,
      tags: new Set(['SIP']),
    });
    expect(out.map((e) => e.permit.id)).toEqual([2]);
  });

  it('search joins task-style across address + juris + permit fields', () => {
    const out = filterEnrichedPermits(enriched, {
      ...baseFilters,
      search: 'pike',
    });
    expect(out.map((e) => e.permit.id)).toEqual([1]);
  });

  it('range=3mo filters by go_date >= today - 90 days', () => {
    // today=2026-05-15. cutoff = 2026-02-14. p1.go=2026-04-01 (in), p2.go=2025-12-01 (out).
    const out = filterEnrichedPermits(
      enriched,
      { ...baseFilters, range: '3mo' },
      new Date(2026, 4, 15),
    );
    expect(out.map((e) => e.permit.id)).toEqual([1]);
  });

  it('range=custom honors dateFrom and dateTo', () => {
    const out = filterEnrichedPermits(enriched, {
      ...baseFilters,
      range: 'custom',
      dateFrom: '2026-03-01',
      dateTo: '2026-05-01',
    });
    expect(out.map((e) => e.permit.id)).toEqual([1]);
  });
});

// ============================================================
// resolveDateRange
// ============================================================
describe('resolveDateRange', () => {
  const today = new Date(2026, 4, 15);

  it("range='all' → both null", () => {
    expect(resolveDateRange({ ...baseFilters, range: 'all' }, today)).toEqual({
      from: null,
      to: null,
    });
  });

  it("range='3mo' → from = today - 90 days, to = null", () => {
    const { from, to } = resolveDateRange({ ...baseFilters, range: '3mo' }, today);
    expect(to).toBeNull();
    const ms = from?.getTime() ?? 0;
    const expected = today.getTime() - 90 * 86400000;
    // Allow 1-second slack for clock truncation.
    expect(Math.abs(ms - expected)).toBeLessThan(1000);
  });

  it("range='custom' picks dateFrom and dateTo", () => {
    const { from, to } = resolveDateRange(
      { ...baseFilters, range: 'custom', dateFrom: '2026-01-01', dateTo: '2026-06-30' },
      today,
    );
    // Compare in local-time slots — toISOString shifts by TZ offset for
    // '23:59:59' end-of-day timestamps and would flip the date forward.
    expect(from?.getFullYear()).toBe(2026);
    expect(from?.getMonth()).toBe(0); // January
    expect(from?.getDate()).toBe(1);
    expect(to?.getFullYear()).toBe(2026);
    expect(to?.getMonth()).toBe(5); // June
    expect(to?.getDate()).toBe(30);
  });
});

// ============================================================
// computeMetrics
// ============================================================
describe('computeMetrics', () => {
  const projectsById = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', address: 'Addr 1', juris: 'Seattle' })],
    ['p2', makeProject({ id: 'p2', address: 'Addr 2', juris: 'Seattle' })],
  ]);

  it('totalPermits + totalUnits across DISTINCT addresses', () => {
    const enriched = enrichPermits(
      [
        // Two permits at the same address — units counted once.
        makePermit({ id: 1, project_id: 'p1', units: 4 }),
        makePermit({ id: 2, project_id: 'p1', units: 4 }),
        // Different address.
        makePermit({ id: 3, project_id: 'p2', units: 3 }),
      ],
      projectsById,
    );
    const m = computeMetrics(enriched);
    expect(m.totalPermits).toBe(3);
    expect(m.totalUnits).toBe(7);
  });

  it('submit variance: avg + on-time vs late breakdown', () => {
    const enriched = enrichPermits(
      [
        // On-time: submitted 2026-04-01, target 2026-04-15 → -14d (on time).
        makePermit({
          id: 1,
          project_id: 'p1',
          target_submit: '2026-04-15',
          permit_cycles: [makeCycle({ submitted: '2026-04-01' })],
        }),
        // Late: submitted 2026-04-20, target 2026-04-15 → +5d (late).
        makePermit({
          id: 2,
          project_id: 'p2',
          target_submit: '2026-04-15',
          permit_cycles: [makeCycle({ submitted: '2026-04-20' })],
        }),
      ],
      projectsById,
    );
    const m = computeMetrics(enriched);
    expect(m.onTimeSubmits).toBe(1);
    expect(m.lateSubmits).toBe(1);
    // Avg of [-14, +5] = -4.5 → rounds to -4.
    expect(m.avgSubmitVariance).toBe(-4);
  });

  it('avg correction cycles only counts permits where corr_rounds > 0', () => {
    const enriched = enrichPermits(
      [
        makePermit({ id: 1, project_id: 'p1', corr_rounds: 2 }),
        makePermit({ id: 2, project_id: 'p2', corr_rounds: 4 }),
        makePermit({ id: 3, project_id: 'p1', corr_rounds: 0 }), // excluded
      ],
      projectsById,
    );
    const m = computeMetrics(enriched);
    expect(m.permitsWithCorrections).toBe(2);
    expect(m.avgCorrectionCycles).toBe(3); // (2+4)/2 = 3
  });

  it('issuedCount counts permits with actual_issue set', () => {
    const enriched = enrichPermits(
      [
        makePermit({ id: 1, project_id: 'p1', actual_issue: '2026-05-01' }),
        makePermit({ id: 2, project_id: 'p2', actual_issue: null }),
      ],
      projectsById,
    );
    expect(computeMetrics(enriched).issuedCount).toBe(1);
  });

  it('empty input → all averages null, counts 0', () => {
    const m = computeMetrics([]);
    expect(m.totalPermits).toBe(0);
    expect(m.totalUnits).toBe(0);
    expect(m.avgGoToSubmit).toBeNull();
    expect(m.onTimeSubmits).toBe(0);
  });
});
