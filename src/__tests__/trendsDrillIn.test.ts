import { describe, it, expect } from 'vitest';
import {
  buildTrendsDrillIn,
  TRENDS_DRILLIN_KEYS,
  type TrendsDrillInKey,
} from '../lib/trendsDrillIn';
import {
  avgCyclesPerPermit,
  avgCityCourtTime,
  avgIntakeToApproval,
  avgResponseCourtTime,
  submissionToIntakeVariance,
  targetSubmitHitRate,
  totalPermitsInWindow,
  totalProjectsInWindow,
} from '../lib/perfTrends';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-201: the Trends KPI drill-in must reconcile with the tile:
//   - Total Projects / Total Permits: drill-in row count == the number.
//   - Avg * : row count == sample count AND mean(row values) == the tile value
//     (within the tile's Math.round). Hit Rate: hits + misses == denominator.

function mkCycle(
  over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>,
): PermitCycle {
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

function mkPermit(over: Partial<PermitWithCycles> & { id: number }): PermitWithCycles {
  const { id, ...rest } = over;
  return {
    id,
    project_id: 'p1',
    parent_permit_id: null,
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
    ...rest,
  };
}

function mkProject(id: string, over: Partial<Project> = {}): Project {
  return {
    id,
    address: `${id} Main St`,
    juris: 'Seattle',
    archived: false,
    notes: null,
    go_date: '2026-02-01',
    ...over,
  };
}

// Two projects: pA (2 permits) + pB (1 permit). Rich cycle data so every metric
// has contributors.
const PROJECTS = new Map<string, Project>([
  ['pA', mkProject('pA', { address: '100 A St' })],
  ['pB', mkProject('pB', { address: '200 B St' })],
]);

const COHORT: PermitWithCycles[] = [
  mkPermit({
    id: 1,
    project_id: 'pA',
    num: 'BP-1',
    type: 'Building Permit',
    approval_date: '2026-06-01',
    target_submit: '2026-02-10',
    permit_cycles: [
      mkCycle({ cycle_index: 0, submitted: '2026-02-05', intake_accepted: '2026-02-12' }), // submit→intake 7d
      mkCycle({ cycle_index: 1, submitted: '2026-02-12', corr_issued: '2026-03-14', resubmitted: '2026-03-24' }),
      mkCycle({ cycle_index: 2, submitted: '2026-03-24' }),
    ],
  }),
  mkPermit({
    id: 2,
    project_id: 'pA',
    num: 'DM-2',
    type: 'Demolition',
    approval_date: '2026-05-20',
    target_submit: '2026-02-20',
    permit_cycles: [
      mkCycle({ cycle_index: 0, submitted: '2026-02-10', intake_accepted: '2026-02-21' }), // 11d
      mkCycle({ cycle_index: 1, submitted: '2026-02-21', corr_issued: '2026-03-21', resubmitted: '2026-03-28' }),
      mkCycle({ cycle_index: 2, submitted: '2026-03-28' }),
    ],
  }),
  mkPermit({
    id: 3,
    project_id: 'pB',
    num: 'BP-3',
    type: 'Building Permit',
    approval_date: '2026-07-01',
    target_submit: '2026-03-01',
    permit_cycles: [
      mkCycle({ cycle_index: 0, submitted: '2026-03-05', intake_accepted: '2026-03-12' }), // 7d; submitted AFTER target → miss
    ],
  }),
];

const build = (key: TrendsDrillInKey) => buildTrendsDrillIn(key, COHORT, PROJECTS);

function mean(nums: number[]): number {
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

describe('buildTrendsDrillIn — count tiles reconcile', () => {
  it('Total Projects: row count == distinct projects (one row per project, with # permits)', () => {
    const d = build('totalProjects');
    expect(d.isCount).toBe(true);
    expect(d.n).toBe(totalProjectsInWindow(COHORT)); // 2
    expect(d.rows).toHaveLength(2);
    const pA = d.rows.find((r) => r.projectId === 'pA')!;
    expect(pA.secondary).toBe('2 permits');
    expect(pA.dates[0]).toEqual({ label: 'GO', date: '2026-02-01' });
    const pB = d.rows.find((r) => r.projectId === 'pB')!;
    expect(pB.secondary).toBe('1 permit');
  });

  it('Total Permits: one row per permit; count == the number', () => {
    const d = build('approvedInWindow');
    expect(d.isCount).toBe(true);
    expect(d.n).toBe(totalPermitsInWindow(COHORT)); // 3
    expect(d.rows.map((r) => r.permitId).sort()).toEqual([1, 2, 3]);
  });
});

describe('buildTrendsDrillIn — average tiles reconcile (count + mean)', () => {
  it('Avg Submit→Intake: row count + mean == the weighted-avg tile', () => {
    const d = build('avgSubmitToIntakeDelay');
    const vals = d.rows.map((r) => r.value!) ;
    expect(d.n).toBe(3); // all 3 have c0.submitted + intake_accepted
    // weighted avg over (juris×type) buckets == overall mean here.
    const variance = submissionToIntakeVariance(COHORT, PROJECTS);
    const tileN = variance.reduce((s, v) => s + v.n, 0);
    const tileAvg = Math.round(
      variance.reduce((s, v) => s + v.avgDaysFromSubmittedToIntakeAccepted * v.n, 0) / tileN,
    );
    expect(d.n).toBe(tileN);
    expect(mean(vals)).toBe(tileAvg);
  });

  it('Avg Permit Timeline: row count + mean == avgIntakeToApproval', () => {
    const d = build('avgCityClock');
    const vals = d.rows.map((r) => r.value!);
    expect(mean(vals)).toBe(avgIntakeToApproval(COHORT));
    expect(d.n).toBe(vals.length);
  });

  it('Avg City Review: row count + mean == avgCityCourtTime', () => {
    const d = build('avgCityReview');
    const vals = d.rows.map((r) => r.value!);
    expect(d.n).toBeGreaterThan(0);
    expect(mean(vals)).toBe(avgCityCourtTime(COHORT));
  });

  it('Avg Response Time: row count + mean == avgResponseCourtTime', () => {
    const d = build('avgResponseTime');
    const vals = d.rows.map((r) => r.value!);
    expect(d.n).toBeGreaterThan(0);
    expect(mean(vals)).toBe(avgResponseCourtTime(COHORT));
  });

  it('Avg Cycles per Permit: every permit contributes; mean (1-dec) == the tile', () => {
    const d = build('avgCyclesPerPermit');
    expect(d.n).toBe(3);
    const vals = d.rows.map((r) => r.value!);
    const tile = avgCyclesPerPermit(COHORT)!;
    expect(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10).toBe(tile);
  });

  it('Target Submit Hit Rate: denominator + hit/miss split reconcile', () => {
    const d = build('targetSubmitHitRate');
    const tile = targetSubmitHitRate(COHORT)!;
    expect(d.n).toBe(tile.total); // denominator
    const hits = d.rows.filter((r) => r.secondary === '✓ hit').length;
    const misses = d.rows.filter((r) => r.secondary === '✗ miss').length;
    expect(hits).toBe(tile.hit);
    expect(hits + misses).toBe(tile.total);
    // signed offsets mean == avgDaysOff.
    expect(mean(d.rows.map((r) => r.value!))).toBe(tile.avgDaysOff);
  });
});

describe('buildTrendsDrillIn — sub-permits excluded', () => {
  it('a sub-permit never appears in any drill-in', () => {
    const withChild = [
      ...COHORT,
      mkPermit({ id: 99, project_id: 'pA', parent_permit_id: 1, type: 'PPR' }),
    ];
    for (const key of TRENDS_DRILLIN_KEYS) {
      const d = buildTrendsDrillIn(key, withChild, PROJECTS);
      expect(d.rows.some((r) => r.permitId === 99)).toBe(false);
    }
  });
});
