import { describe, it, expect } from 'vitest';
import { computePerCycleBuckets } from '../lib/perCycleMetrics';
import {
  cityCourtTimeDays,
  computeMetrics,
  enrichPermits,
  responseCourtTimeDays,
} from '../lib/reportMetrics';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-142: per-cycle breakdown helper. The buckets slice the same
// sum-over-cycles math the Overview totals use (cityCourtTimeDays /
// responseCourtTimeDays) by review-cycle position, so they telescope back
// into the totals. Fixtures mirror reportMetrics.test.ts's fix-141 cases.

function makeCycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: `c-${Math.random()}`,
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

const projectsById = new Map<string, Project>([
  ['p1', makeProject({ id: 'p1', units: 1 })],
]);

// Case #2: 2-cycle round-trip → City=24 / Response=5 / Timeline=29.
function permit2Roundtrip(id = 2): PermitWithCycles {
  return makePermit({
    id,
    project_id: 'p1',
    approval_date: '2026-04-30',
    permit_cycles: [
      makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' }),
      makeCycle({ cycle_index: 1, submitted: '2026-04-01', corr_issued: '2026-04-15' }),
      makeCycle({ cycle_index: 2, submitted: '2026-04-20' }),
    ],
  });
}

// Case #3: 3-cycle → City=30 / Response=9 / Timeline=39.
function permit3ThreeCycles(id = 3): PermitWithCycles {
  return makePermit({
    id,
    project_id: 'p1',
    approval_date: '2026-05-10',
    permit_cycles: [
      makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' }),
      makeCycle({ cycle_index: 1, submitted: '2026-04-01', corr_issued: '2026-04-15' }),
      makeCycle({ cycle_index: 2, submitted: '2026-04-20', corr_issued: '2026-04-29' }),
      makeCycle({ cycle_index: 3, submitted: '2026-05-03' }),
    ],
  });
}

// Synthetic 5-cycle permit — every review cycle is 10d city, 5d response.
// 4+ bucket = cycles 4 + 5: city = 10 + 10 = 20, response = cycle-4→5 gap = 5.
function permit5Cycle(id = 5): PermitWithCycles {
  return makePermit({
    id,
    project_id: 'p1',
    approval_date: '2026-06-10',
    permit_cycles: [
      makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' }),
      makeCycle({ cycle_index: 1, submitted: '2026-04-01', corr_issued: '2026-04-11' }),
      makeCycle({ cycle_index: 2, submitted: '2026-04-16', corr_issued: '2026-04-26' }),
      makeCycle({ cycle_index: 3, submitted: '2026-05-01', corr_issued: '2026-05-11' }),
      makeCycle({ cycle_index: 4, submitted: '2026-05-16', corr_issued: '2026-05-26' }),
      makeCycle({ cycle_index: 5, submitted: '2026-05-31' }),
    ],
  });
}

function buckets(permits: PermitWithCycles[]) {
  const out = computePerCycleBuckets(enrichPermits(permits, projectsById));
  return {
    c1: out.find((b) => b.cycleBucket === 1)!,
    c2: out.find((b) => b.cycleBucket === 2)!,
    c3: out.find((b) => b.cycleBucket === 3)!,
    c4: out.find((b) => b.cycleBucket === 4)!,
    all: out,
  };
}

describe('computePerCycleBuckets', () => {
  it('always returns exactly 4 buckets in order', () => {
    const { all } = buckets([]);
    expect(all).toHaveLength(4);
    expect(all.map((b) => b.bucketLabel)).toEqual([
      'Cycle 1',
      'Cycle 2',
      'Cycle 3',
      'Cycle 4+',
    ]);
    // Empty cohort → all null averages, permitCount 0.
    for (const b of all) {
      expect(b.avgCityCourtTime).toBeNull();
      expect(b.avgResponseTime).toBeNull();
      expect(b.permitCount).toBe(0);
    }
  });

  it('case #2 (2-cycle round-trip)', () => {
    const { c1, c2, c3, c4 } = buckets([permit2Roundtrip()]);
    expect(c1).toMatchObject({ avgCityCourtTime: 14, avgResponseTime: 5, permitCount: 1 });
    expect(c2).toMatchObject({ avgCityCourtTime: 10, avgResponseTime: null, permitCount: 1 });
    expect(c3).toMatchObject({ avgCityCourtTime: null, avgResponseTime: null, permitCount: 0 });
    expect(c4).toMatchObject({ avgCityCourtTime: null, avgResponseTime: null, permitCount: 0 });
  });

  it('case #3 (3-cycle)', () => {
    const { c1, c2, c3, c4 } = buckets([permit3ThreeCycles()]);
    expect(c1).toMatchObject({ avgCityCourtTime: 14, avgResponseTime: 5, permitCount: 1 });
    expect(c2).toMatchObject({ avgCityCourtTime: 9, avgResponseTime: 4, permitCount: 1 });
    expect(c3).toMatchObject({ avgCityCourtTime: 7, avgResponseTime: null, permitCount: 1 });
    expect(c4).toMatchObject({ avgCityCourtTime: null, avgResponseTime: null, permitCount: 0 });
  });

  it('4+ bucket: 5-cycle permit sums cycles 4 onwards (city 20, response 5)', () => {
    const { c1, c2, c3, c4 } = buckets([permit5Cycle()]);
    expect(c1).toMatchObject({ avgCityCourtTime: 10, avgResponseTime: 5, permitCount: 1 });
    expect(c2).toMatchObject({ avgCityCourtTime: 10, avgResponseTime: 5, permitCount: 1 });
    expect(c3).toMatchObject({ avgCityCourtTime: 10, avgResponseTime: 5, permitCount: 1 });
    // cycles 4 + 5: city 10 + 10 = 20; response = cycle-4 corr → cycle-5
    // submitted = 5 (cycle 5 is final, no further response).
    expect(c4).toMatchObject({ avgCityCourtTime: 20, avgResponseTime: 5, permitCount: 1 });
  });

  it('cohort mix (#2 + #3): per-cycle averages reflect the two-permit cohort', () => {
    const { c1, c2, c3, c4 } = buckets([permit2Roundtrip(2), permit3ThreeCycles(3)]);
    // Cycle 1: both city=14 → 14; both response=5 → 5; both reached → n=2.
    expect(c1).toMatchObject({ avgCityCourtTime: 14, avgResponseTime: 5, permitCount: 2 });
    // Cycle 2: city avg (10 + 9)/2 = 9.5 → 10; response only #3 (4); n=2.
    expect(c2).toMatchObject({ avgCityCourtTime: 10, avgResponseTime: 4, permitCount: 2 });
    // Cycle 3: only #3 reached (city 7, no response); n=1.
    expect(c3).toMatchObject({ avgCityCourtTime: 7, avgResponseTime: null, permitCount: 1 });
    expect(c4).toMatchObject({ permitCount: 0 });
  });

  it('invariant: city buckets reconstruct totals.avgCityReview (within rounding)', () => {
    const permits = [permit2Roundtrip(2), permit3ThreeCycles(3)];
    const enriched = enrichPermits(permits, projectsById);
    const totals = computeMetrics(enriched);
    const out = computePerCycleBuckets(enriched);
    // Σ(avgCity_k · permitCount_k) / N_cityCohort ≈ totals.avgCityReview.
    // permitCount == non-null-city count for completed permits, so this
    // telescopes back into the per-permit cityCourtTimeDays sum.
    const nCity = permits.filter((p) => cityCourtTimeDays(p) !== null).length;
    const weighted = out.reduce(
      (s, b) => s + (b.avgCityCourtTime ?? 0) * b.permitCount,
      0,
    );
    const reconstructed = weighted / nCity;
    expect(totals.avgCityReview).not.toBeNull();
    expect(Math.abs(reconstructed - (totals.avgCityReview ?? 0))).toBeLessThanOrEqual(1);
  });

  it('invariant: totals.avgResponseTime equals the mean of per-permit responseCourtTime', () => {
    // Response can't reconstruct from a single permitCount (the last cycle
    // of every permit has no response, so reached-count ≠ contributor-count).
    // Verify totals consistency directly + rely on the per-case pins above
    // for the per-cycle response values.
    const permits = [permit2Roundtrip(2), permit3ThreeCycles(3)];
    const totals = computeMetrics(enrichPermits(permits, projectsById));
    const perPermit = permits
      .map((p) => responseCourtTimeDays(p))
      .filter((v): v is number => v !== null);
    const mean = Math.round(perPermit.reduce((a, b) => a + b, 0) / perPermit.length);
    expect(totals.avgResponseTime).toBe(mean); // (5 + 9)/2 = 7
  });
});

// fix-171 (effect B): per-cycle buckets subtract held days too.
import type { ProjectHold } from '../lib/database.types';
describe('fix-171 computePerCycleBuckets — held days subtracted', () => {
  function pcHold(start: string, end: string | null): ProjectHold {
    return {
      id: `h-${start}`, tenant_id: 't1', project_id: 'p1', reason: 'MHA', note: null,
      hold_start: start, hold_end: end, created_by: null, created_at: '', updated_at: '',
    };
  }
  it('Cycle 1 response time drops by the held days; no-hold unchanged', () => {
    const p = makePermit({
      project_id: 'p1',
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-04-01' }),
        makeCycle({ id: 'c2', cycle_index: 2, submitted: '2026-05-01' }),
      ],
    });
    const enriched = enrichPermits([p], new Map([['p1', makeProject({ id: 'p1' })]]));
    const without = computePerCycleBuckets(enriched);
    const withHold = computePerCycleBuckets(
      enriched,
      new Map([['p1', [pcHold('2026-04-10', '2026-04-20')]]]),
    );
    // Cycle 1 response = 2026-04-01 → 2026-05-01 = 30 raw; 10 held → 20.
    expect(without[0].avgResponseTime).toBe(30);
    expect(withHold[0].avgResponseTime).toBe(20);
  });
});
