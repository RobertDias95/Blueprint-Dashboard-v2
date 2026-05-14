import { describe, it, expect } from 'vitest';
import {
  computeLearnedSchedule,
  extractSample,
  listTypeJurisCombos,
  SCHEDULE_DEFAULTS,
} from '../lib/scheduleBenchmarks';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// Q7.2.a: tests for the learned-schedule benchmark engine. Sample
// extraction + 3-tier estimate building (recent → all-time → null).

function makeCycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: 'c',
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

// ============================================================
// extractSample
// ============================================================
describe('extractSample', () => {
  it('returns null for permits without approval', () => {
    expect(extractSample(makePermit({ approval_date: null, actual_issue: null }))).toBeNull();
  });

  it('returns null when cycle 1 has no submitted date', () => {
    const permit = makePermit({
      approval_date: '2026-05-01',
      permit_cycles: [makeCycle({ cycle_index: 1, submitted: null })],
    });
    expect(extractSample(permit)).toBeNull();
  });

  it('computes cityReview1Days from cycle 1 submitted → corr_issued', () => {
    const permit = makePermit({
      approval_date: '2026-06-01',
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-03-01', corr_issued: '2026-04-01' }),
      ],
    });
    const s = extractSample(permit);
    expect(s).not.toBeNull();
    expect(s?.cityReview1Days).toBe(31); // 31 days from Mar 1 to Apr 1
  });

  it('uses approval_date as cycle review-end when approval lands mid-cycle', () => {
    const permit = makePermit({
      approval_date: '2026-03-20',
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-03-01', corr_issued: null }),
        // No cycle 2; approval landed during cycle 1's review.
      ],
    });
    const s = extractSample(permit);
    // 2026-03-01 → 2026-03-20 = 19 days
    expect(s?.cityReview1Days).toBe(19);
  });

  it('corrResponse1Days = corr_issued → resubmitted', () => {
    const permit = makePermit({
      approval_date: '2026-06-01',
      permit_cycles: [
        makeCycle({
          cycle_index: 1,
          submitted: '2026-03-01',
          corr_issued: '2026-04-01',
          resubmitted: '2026-04-15',
        }),
      ],
    });
    expect(extractSample(permit)?.corrResponse1Days).toBe(14);
  });

  it('approvedInCycle reflects nCycles + 1 (clamped to [1, 4])', () => {
    const permit = makePermit({
      approval_date: '2026-08-01',
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-03-01', corr_issued: '2026-04-01', resubmitted: '2026-04-15' }),
        makeCycle({ cycle_index: 2, submitted: '2026-04-15', corr_issued: '2026-05-15', resubmitted: '2026-05-29' }),
      ],
    });
    // 2 cycles with corr/resub → approvedInCycle = 3.
    expect(extractSample(permit)?.approvedInCycle).toBe(3);
  });

  it('goToSubmitDays = project.go_date → cycle 1 submitted', () => {
    // fix-22 Mig 3: extractSample now takes the project's go_date as a
    // second arg.
    const permit = makePermit({
      approval_date: '2026-06-01',
      permit_cycles: [makeCycle({ cycle_index: 1, submitted: '2026-03-01' })],
    });
    // Jan 15 → Mar 1 = 45 days.
    expect(extractSample(permit, '2026-01-15')?.goToSubmitDays).toBe(45);
  });
});

// ============================================================
// computeLearnedSchedule (3-tier)
// ============================================================
describe('computeLearnedSchedule', () => {
  const projectsById = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
    ['p2', makeProject({ id: 'p2', juris: 'Seattle' })],
  ]);

  it('returns null when no approved permits match the (type, juris) combo', () => {
    const result = computeLearnedSchedule(
      [makePermit({ approval_date: null, actual_issue: null })],
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result).toBeNull();
  });

  it('tier 1: recent-window samples build a learned estimate (isAllTime=false)', () => {
    const permit = makePermit({
      approval_date: '2026-05-01',
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-03-01' }),
      ],
    });
    const result = computeLearnedSchedule(
      [permit],
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result).not.toBeNull();
    expect(result?.isAllTime).toBe(false);
    expect(result?.sampleCount).toBe(1);
    expect(result?.cityReview1).toBe(28); // Feb 1 → Mar 1
    expect(result?.source).toContain('Last 180d');
  });

  it('tier 2: all-time fallback when no permits in window (isAllTime=true)', () => {
    const oldPermit = makePermit({
      id: 1,
      approval_date: '2024-05-01', // > 180 days before today=2026-05-15
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2024-02-01', corr_issued: '2024-03-01' }),
      ],
    });
    const result = computeLearnedSchedule(
      [oldPermit],
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result?.isAllTime).toBe(true);
    expect(result?.source).toContain('All-time');
  });

  it('falls back to SCHEDULE_DEFAULTS for cycles with no learned samples', () => {
    // Only cycle 1 has data; cycles 2-4 should fall back to defaults.
    const permit = makePermit({
      approval_date: '2026-05-01',
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-03-01' }),
      ],
    });
    const result = computeLearnedSchedule(
      [permit],
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result?.cityReview2).toBe(SCHEDULE_DEFAULTS.cityReview2);
    expect(result?.corrResponse2).toBe(SCHEDULE_DEFAULTS.corrResponse2);
  });

  it('filters by (type, juris) — does NOT mix data across combos', () => {
    const seattleBP = makePermit({
      id: 1,
      project_id: 'p1',
      type: 'Building Permit',
      approval_date: '2026-05-01',
      permit_cycles: [makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-03-01' })],
    });
    const bellevueBP = makePermit({
      id: 2,
      project_id: 'p2',
      type: 'Building Permit',
      approval_date: '2026-05-01',
      permit_cycles: [makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-04-15' })],
    });
    const projectsBoth = new Map<string, Project>([
      ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
      ['p2', makeProject({ id: 'p2', juris: 'Bellevue' })],
    ]);
    const seattle = computeLearnedSchedule(
      [seattleBP, bellevueBP],
      'Building Permit',
      'Seattle',
      projectsBoth,
      new Date(2026, 4, 15),
    );
    // Only the Seattle permit contributed → cityReview1 = 28 days, not the
    // average of [28, 73] = 50 we'd see if filtering was broken.
    expect(seattle?.sampleCount).toBe(1);
    expect(seattle?.cityReview1).toBe(28);
  });

  it('mostLikelyCycle = bucket with highest count; tiebreak favors lower cycle', () => {
    function approved(nCycles: number, id: number): PermitWithCycles {
      const cycles: PermitCycle[] = [
        makeCycle({ cycle_index: 1, submitted: '2026-02-01' }),
      ];
      for (let i = 0; i < nCycles; i++) {
        cycles.push(
          makeCycle({
            cycle_index: 1 + i + 1,
            submitted: '2026-02-15',
            corr_issued: '2026-03-01',
            resubmitted: '2026-03-15',
          }),
        );
      }
      return makePermit({
        id,
        approval_date: '2026-05-01',
        permit_cycles: cycles,
      });
    }
    // 3 permits approved in cycle 1, 2 permits approved in cycle 2.
    const result = computeLearnedSchedule(
      [approved(0, 1), approved(0, 2), approved(0, 3), approved(1, 4), approved(1, 5)],
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result?.mostLikelyCycle).toBe(1);
    expect(result?.cycleDist[1]).toBe(3);
    expect(result?.cycleDist[2]).toBe(2);
  });
});

// ============================================================
// listTypeJurisCombos
// ============================================================
describe('listTypeJurisCombos', () => {
  const projectsById = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
    ['p2', makeProject({ id: 'p2', juris: 'Bellevue' })],
  ]);

  it('enumerates distinct (type, juris) combos with counts; sort = count desc, then type asc, then juris asc', () => {
    const out = listTypeJurisCombos(
      [
        makePermit({ id: 1, project_id: 'p1', type: 'Building Permit' }),
        makePermit({ id: 2, project_id: 'p1', type: 'Building Permit' }),
        makePermit({ id: 3, project_id: 'p1', type: 'Demolition' }),
        makePermit({ id: 4, project_id: 'p2', type: 'Building Permit' }),
      ],
      projectsById,
    );
    expect(out).toEqual([
      // BP Seattle wins on count (2).
      { type: 'Building Permit', juris: 'Seattle', count: 2 },
      // Tie on count=1: Building Permit < Demolition lexically.
      { type: 'Building Permit', juris: 'Bellevue', count: 1 },
      { type: 'Demolition', juris: 'Seattle', count: 1 },
    ]);
  });

  it('skips permits with no juris (e.g., project missing or no juris set)', () => {
    const permits = [
      makePermit({ id: 1, project_id: 'unknown', type: 'Building Permit' }),
      makePermit({ id: 2, project_id: 'p1', type: 'Building Permit' }),
    ];
    expect(listTypeJurisCombos(permits, projectsById)).toEqual([
      { type: 'Building Permit', juris: 'Seattle', count: 1 },
    ]);
  });
});
