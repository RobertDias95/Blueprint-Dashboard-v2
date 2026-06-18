import { describe, it, expect } from 'vitest';
import { enrichPermits } from '../lib/reportMetrics';
import { buildDrillIn, hasMetricDrillIn } from '../lib/metricDrillIn';
import type { PermitCycle, PermitWithCycles, Project } from '../lib/database.types';

// fix-184a: the metric drill-in descriptors + buildDrillIn. Pure tests over
// real enriched permits (built via enrichPermits) so the per-permit values
// match exactly what the cards averaged.

function cycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: 'c', permit_id: 1, cycle_index: 1, submitted: null, city_target: null,
    corr_issued: null, resubmitted: null, intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1, project_id: 'p1', type: 'Building Permit', stage: 'de', stage_override: null,
    status: null, num: null, da: null, dm: null, ent_lead: null, dual_da: null,
    target_submit: null, dd_start: null, dd_end: null, expected_issue: null,
    actual_issue: null, approval_date: null, intake_date: null, notes: null,
    cycle_model: null, view_cycle: null, kickoff_date: null, corr_rounds: null,
    permit_owner: null, architect: null, nickname: null, struct_address: null,
    portal_url: null, updated_at: '2026-01-01T00:00:00Z', permit_cycles: [], ...over,
  };
}
function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1', address: '500 Pike St', juris: 'Seattle', go_date: '2026-01-01',
    units: 4, product_types: [], project_tags: [], ...over,
  } as Project;
}

// A: full lifecycle (Seattle BP). B: empty (Bellevue Demo). C: in corrections.
const A = permit({
  id: 1, project_id: 'p1', num: 'BP-1', type: 'Building Permit',
  ent_lead: 'Miles', da: 'Trevor', status: 'Reviews In Process',
  target_submit: '2026-03-01', dd_start: '2026-02-01', dd_end: '2026-02-15',
  expected_issue: '2026-04-25', approval_date: '2026-05-01', actual_issue: '2026-05-10',
  corr_rounds: 2,
  permit_cycles: [cycle({ cycle_index: 0, submitted: '2026-03-10', intake_accepted: '2026-03-20' })],
});
const B = permit({ id: 2, project_id: 'p2', type: 'Demolition', corr_rounds: 0 });
const C = permit({
  id: 3, project_id: 'p1', type: 'Building Permit', corr_rounds: 1,
  permit_cycles: [cycle({ cycle_index: 1, submitted: '2026-03-01', corr_issued: '2026-04-01', resubmitted: null })],
});

const projectsById = new Map<string, Project>([
  ['p1', project()],
  ['p2', project({ id: 'p2', address: '750 Oak Way', juris: 'Bellevue', go_date: null, units: 3 })],
]);
const enriched = enrichPermits([A, B, C], projectsById);

describe('hasMetricDrillIn — Phase A coverage', () => {
  it('covers the 11 Phase A cards', () => {
    for (const k of [
      'totalPermits', 'inCorrections', 'submitVariance', 'avgGoToSubmit',
      'avgGoToDDStart', 'avgDDDuration', 'avgDDEndToSubmit', 'avgSubmitToIntake',
      'avgApprovalToIssue', 'avgScheduleVariance', 'avgCorrectionCycles',
    ]) {
      expect(hasMetricDrillIn(k)).toBe(true);
    }
  });
  it('excludes the 3 timeline tiles (Phase B) and unknown keys', () => {
    expect(hasMetricDrillIn('avgCityReview')).toBe(false);
    expect(hasMetricDrillIn('avgResponseTime')).toBe(false);
    expect(hasMetricDrillIn('avgPermitTimeline')).toBe(false);
    expect(buildDrillIn('avgCityReview', enriched)).toBeNull();
    expect(buildDrillIn('nope', enriched)).toBeNull();
  });
});

describe('buildDrillIn — value metrics', () => {
  it('avgSubmitToIntake: only A qualifies (10d); dates + n + stats', () => {
    const d = buildDrillIn('avgSubmitToIntake', enriched)!;
    expect(d.isCount).toBe(false);
    expect(d.unit).toBe('d');
    expect(d.n).toBe(1);
    expect(d.rows.map((r) => r.value)).toEqual([10]);
    expect(d.rows[0]).toMatchObject({ permitId: 1, num: 'BP-1', juris: 'Seattle', type: 'Building Permit', lead: 'Miles' });
    expect(d.rows[0].dates).toEqual([
      { label: 'Submitted', date: '2026-03-10' },
      { label: 'Intake', date: '2026-03-20' },
    ]);
    expect(d.stats).toEqual({ min: 10, median: 10, max: 10 });
  });

  it('avgGoToSubmit: A(68) + C(59); n=2, min/median/max', () => {
    const d = buildDrillIn('avgGoToSubmit', enriched)!;
    expect(d.n).toBe(2);
    expect(new Set(d.rows.map((r) => r.value))).toEqual(new Set([68, 59]));
    expect(d.stats).toEqual({ min: 59, median: 64, max: 68 });
  });

  it('submitVariance: A = firstSubmitted − target_submit = +9; C excluded (no target)', () => {
    const d = buildDrillIn('submitVariance', enriched)!;
    expect(d.n).toBe(1);
    expect(d.rows[0].value).toBe(9);
  });

  it('avgScheduleVariance: A = approval − expected = +6', () => {
    const d = buildDrillIn('avgScheduleVariance', enriched)!;
    expect(d.rows.map((r) => r.value)).toEqual([6]);
  });

  it('avgApprovalToIssue: A = 9d', () => {
    expect(buildDrillIn('avgApprovalToIssue', enriched)!.rows.map((r) => r.value)).toEqual([9]);
  });

  it('avgDDDuration: A = 14d; avgDDEndToSubmit: A = 23d', () => {
    expect(buildDrillIn('avgDDDuration', enriched)!.rows.map((r) => r.value)).toEqual([14]);
    expect(buildDrillIn('avgDDEndToSubmit', enriched)!.rows.map((r) => r.value)).toEqual([23]);
  });

  it('avgCorrectionCycles: rounds unit, cohort corr_rounds>0 (A=2, C=1, B excluded)', () => {
    const d = buildDrillIn('avgCorrectionCycles', enriched)!;
    expect(d.unit).toBe('rounds');
    expect(d.n).toBe(2);
    expect(new Set(d.rows.map((r) => r.value))).toEqual(new Set([2, 1]));
  });

  it('filter inheritance: a narrowed population narrows the drill (Bellevue only → 0 submit→intake rows)', () => {
    const bellevue = enriched.filter((e) => e.juris === 'Bellevue');
    expect(buildDrillIn('avgSubmitToIntake', bellevue)!.n).toBe(0);
    expect(buildDrillIn('totalPermits', bellevue)!.n).toBe(1);
  });
});

describe('buildDrillIn — count-only metrics', () => {
  it('totalPermits: includes ALL permits, value null, secondary = status/stage, no stats', () => {
    const d = buildDrillIn('totalPermits', enriched)!;
    expect(d.isCount).toBe(true);
    expect(d.n).toBe(3);
    expect(d.stats).toBeNull();
    expect(d.rows.every((r) => r.value === null)).toBe(true);
    const a = d.rows.find((r) => r.permitId === 1)!;
    expect(a.secondary).toBe('Reviews In Process'); // status wins
    const b = d.rows.find((r) => r.permitId === 2)!;
    expect(b.secondary).toBe('de'); // no status -> effectiveStage
  });

  it('inCorrections: only the co-stage permit (C), secondary = open corr date', () => {
    const d = buildDrillIn('inCorrections', enriched)!;
    expect(d.isCount).toBe(true);
    expect(d.n).toBe(1);
    expect(d.rows[0].permitId).toBe(3);
    expect(d.rows[0].secondary).toBe('corr issued 2026-04-01');
  });
});
