import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  computeTimelineComposition,
  decomposePermitTimeline,
  enrichPermits,
} from '../lib/reportMetrics';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  ProjectHold,
} from '../lib/database.types';

// fix-184b: Avg Permit Timeline composition. The per-permit decomposition
// splits intake → approval into city-court + our-court + residual such that the
// three ALWAYS sum to the timeline; the cohort aggregate rolls up the same
// cohort the tile averages, so avg(parts) sum to avgPermitTimeline.

function makeCycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: `c-${over.cycle_index ?? 0}-${over.submitted ?? 'x'}`,
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

function hold(start: string, end: string | null): ProjectHold {
  return {
    id: `h-${start}`, tenant_id: 't1', project_id: 'p1', reason: 'MHA', note: null,
    hold_start: start, hold_end: end, created_by: null, created_at: '', updated_at: '',
  };
}

// Case #2 (mirrors perCycleMetrics / reportMetrics fixtures): intake == c1
// submitted, so residual telescopes to 0. City=24 / Our=5 / Timeline=29.
function permit2Roundtrip(id = 2): PermitWithCycles {
  return makePermit({
    id,
    approval_date: '2026-04-30',
    permit_cycles: [
      makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' }),
      makeCycle({ cycle_index: 1, submitted: '2026-04-01', corr_issued: '2026-04-15' }),
      makeCycle({ cycle_index: 2, submitted: '2026-04-20' }),
    ],
  });
}

// Case #3: 3-cycle. City=30 / Our=9 / Timeline=39 / residual=0.
function permit3ThreeCycles(id = 3): PermitWithCycles {
  return makePermit({
    id,
    approval_date: '2026-05-10',
    permit_cycles: [
      makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' }),
      makeCycle({ cycle_index: 1, submitted: '2026-04-01', corr_issued: '2026-04-15' }),
      makeCycle({ cycle_index: 2, submitted: '2026-04-20', corr_issued: '2026-04-29' }),
      makeCycle({ cycle_index: 3, submitted: '2026-05-03' }),
    ],
  });
}

// intake (04-01) precedes the first review submittal (04-05) by 4d → residual=4.
function permitWithResidual(id = 4): PermitWithCycles {
  return makePermit({
    id,
    approval_date: '2026-04-30',
    permit_cycles: [
      makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' }),
      makeCycle({ cycle_index: 1, submitted: '2026-04-05', corr_issued: '2026-04-15' }),
      makeCycle({ cycle_index: 2, submitted: '2026-04-20' }),
    ],
  });
}

describe('decomposePermitTimeline — per-permit (a)+(b)+(c) == timeline', () => {
  it('case #2 (intake == first submittal): city 24 / our 5 / residual 0 / timeline 29', () => {
    const parts = decomposePermitTimeline(permit2Roundtrip())!;
    expect(parts).toEqual({ timeline: 29, cityCourt: 24, ourCourt: 5, residual: 0 });
    expect(parts.cityCourt + parts.ourCourt + parts.residual).toBe(parts.timeline);
  });

  it('case #3 (multi-cycle): city 30 / our 9 / residual 0 / timeline 39', () => {
    const parts = decomposePermitTimeline(permit3ThreeCycles())!;
    expect(parts).toEqual({ timeline: 39, cityCourt: 30, ourCourt: 9, residual: 0 });
    expect(parts.cityCourt + parts.ourCourt + parts.residual).toBe(parts.timeline);
  });

  it('residual captures the intake → first-submittal gap (4d)', () => {
    const parts = decomposePermitTimeline(permitWithResidual())!;
    // timeline = 04-30 − 04-01 = 29; city = (04-15−04-05)+(04-30−04-20)=10+10=20;
    // our = 04-20−04-15 = 5; residual = 29−20−5 = 4 = (04-05 − 04-01).
    expect(parts).toEqual({ timeline: 29, cityCourt: 20, ourCourt: 5, residual: 4 });
    expect(parts.cityCourt + parts.ourCourt + parts.residual).toBe(parts.timeline);
  });

  it('approved-not-issued (approval set, actual_issue null) decomposes normally', () => {
    const p = permit2Roundtrip();
    expect(p.actual_issue).toBeNull();
    const parts = decomposePermitTimeline(p)!;
    expect(parts.timeline).toBe(29);
    expect(parts.cityCourt + parts.ourCourt + parts.residual).toBe(parts.timeline);
  });

  it('issued-without-approval-date anchors the timeline + city tail to actual_issue', () => {
    const p = makePermit({
      approval_date: null,
      actual_issue: '2026-04-30',
      permit_cycles: [
        makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' }),
        makeCycle({ cycle_index: 1, submitted: '2026-04-01', corr_issued: '2026-04-15' }),
        makeCycle({ cycle_index: 2, submitted: '2026-04-20' }),
      ],
    });
    const parts = decomposePermitTimeline(p)!;
    expect(parts).toEqual({ timeline: 29, cityCourt: 24, ourCourt: 5, residual: 0 });
  });

  it('a permit with zero review cycles dumps its whole timeline into residual', () => {
    const p = makePermit({
      approval_date: '2026-04-30',
      permit_cycles: [makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' })],
    });
    const parts = decomposePermitTimeline(p)!;
    expect(parts).toEqual({ timeline: 29, cityCourt: 0, ourCourt: 0, residual: 29 });
  });

  it('held days are subtracted, and the parts still sum to the (reduced) timeline', () => {
    const p = permit2Roundtrip();
    // Hold 04-21..04-26 (5 held days, 26−21) sits in the final city-court arc
    // (submitted 04-20 → approval 04-30) and inside the total window.
    const holds = [hold('2026-04-21', '2026-04-26')];
    const raw = decomposePermitTimeline(p)!;
    const held = decomposePermitTimeline(p, holds)!;
    // Timeline + final city arc each drop by the 5 held days.
    expect(held.timeline).toBe(raw.timeline - 5);
    expect(held.cityCourt).toBe(raw.cityCourt - 5);
    expect(held.ourCourt).toBe(raw.ourCourt);
    expect(held.cityCourt + held.ourCourt + held.residual).toBe(held.timeline);
  });

  it('returns null for a permit not in the timeline cohort (no intake → approval)', () => {
    expect(decomposePermitTimeline(makePermit())).toBeNull();
    // approval but no c0 intake_accepted → not in cohort.
    expect(
      decomposePermitTimeline(
        makePermit({
          approval_date: '2026-04-30',
          permit_cycles: [makeCycle({ cycle_index: 1, submitted: '2026-04-01' })],
        }),
      ),
    ).toBeNull();
  });
});

describe('computeTimelineComposition — cohort parts sum to avgPermitTimeline', () => {
  it('empty cohort → all null, n=0', () => {
    const c = computeTimelineComposition([]);
    expect(c).toEqual({ n: 0, timeline: null, cityCourt: null, ourCourt: null, residual: null });
  });

  it('single permit composition matches its decomposition', () => {
    const enriched = enrichPermits([permit2Roundtrip()], projectsById);
    const c = computeTimelineComposition(enriched);
    expect(c).toEqual({ n: 1, timeline: 29, cityCourt: 24, ourCourt: 5, residual: 0 });
  });

  it('cohort: timeline === computeMetrics.avgPermitTimeline AND parts add to it', () => {
    const permits = [permit2Roundtrip(2), permit3ThreeCycles(3), permitWithResidual(4)];
    const enriched = enrichPermits(permits, projectsById);
    const c = computeTimelineComposition(enriched);
    const m = computeMetrics(enriched);
    expect(c.n).toBe(3);
    expect(c.timeline).toBe(m.avgPermitTimeline);
    // Displayed parts reconcile exactly to the displayed total.
    expect((c.cityCourt ?? 0) + (c.ourCourt ?? 0) + (c.residual ?? 0)).toBe(c.timeline);
  });

  it('a no-review-cycle permit inflates residual honestly (cohort still sums)', () => {
    const noReview = makePermit({
      id: 9,
      approval_date: '2026-04-30',
      permit_cycles: [makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' })],
    });
    const enriched = enrichPermits([permit2Roundtrip(2), noReview], projectsById);
    const c = computeTimelineComposition(enriched);
    // Both timelines = 29 → avg 29. City = (24+0)/2 = 12; our = (5+0)/2 = 2.5 → 3
    // (banker-free Math.round); residual derived to balance.
    expect(c.timeline).toBe(29);
    expect((c.cityCourt ?? 0) + (c.ourCourt ?? 0) + (c.residual ?? 0)).toBe(29);
    expect(c.residual).toBeGreaterThan(0);
  });

  it('held days flow through the cohort aggregate', () => {
    const enriched = enrichPermits([permit2Roundtrip()], projectsById);
    const holds = new Map([['p1', [hold('2026-04-21', '2026-04-26')]]]);
    const c = computeTimelineComposition(enriched, holds);
    expect(c.timeline).toBe(24); // 29 − 5 held
    expect(c.cityCourt).toBe(19); // 24 − 5
    expect((c.cityCourt ?? 0) + (c.ourCourt ?? 0) + (c.residual ?? 0)).toBe(c.timeline);
  });
});

describe('City Review / Response Time tiles are unaffected by fix-184b', () => {
  it('computeMetrics city/response/timeline values unchanged on the standard cohort', () => {
    const permits = [permit2Roundtrip(2), permit3ThreeCycles(3)];
    const m = computeMetrics(enrichPermits(permits, projectsById));
    // Pins from the fix-141/142 suites: City Review (24+30)/2=27,
    // Response (5+9)/2=7, Permit Timeline (29+39)/2=34.
    expect(m.avgCityReview).toBe(27);
    expect(m.avgResponseTime).toBe(7);
    expect(m.avgPermitTimeline).toBe(34);
  });
});
