import { describe, it, expect } from 'vitest';
import {
  computeLearnedSchedule,
  defaultDaysForType,
  extractSample,
  listTypeJurisCombos,
  MIN_SAMPLES_FOR_LEARNER,
  PER_TYPE_DEFAULT_DAYS,
  PER_TYPE_FALLBACK_DAYS,
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

  it('fix-25-feat-g: returns null only when BOTH c0.intake_accepted AND c0.submitted are missing', () => {
    // c0 exists but both anchor fields are null. Per fix-25-feat-g the
    // fallback ladder runs out and the sample drops.
    const permit = makePermit({
      approval_date: '2026-05-01',
      permit_cycles: [
        makeCycle({ cycle_index: 0, intake_accepted: null, submitted: null }),
        makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-03-01' }),
      ],
    });
    expect(extractSample(permit)).toBeNull();
  });

  it('fix-25-feat-g: anchors at c0.submitted when c0.intake_accepted is null', () => {
    // Mirrors the scraper-set + pre-fix-26 reality where c0.submitted is
    // populated but intake_accepted is not. Learner uses submitted as the
    // anchor with a small upward bias on intake→approval (acceptable per
    // Bobby's "use the data we have" call).
    const permit = makePermit({
      approval_date: '2026-05-01',
      permit_cycles: [
        makeCycle({
          cycle_index: 0,
          intake_accepted: null,
          submitted: '2026-02-15',
        }),
        makeCycle({ cycle_index: 1, submitted: '2026-02-15' }),
      ],
    });
    const s = extractSample(permit);
    expect(s).not.toBeNull();
    expect(s?.intakeAnchor).toBe('2026-02-15');
    // 2026-02-15 → 2026-05-01 = 75 days
    expect(s?.intakeToApprovalDays).toBe(75);
  });

  it('fix-24i: returns null when cycle 0 row is missing entirely', () => {
    const permit = makePermit({
      approval_date: '2026-05-01',
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-03-01' }),
      ],
    });
    expect(extractSample(permit)).toBeNull();
  });

  it('fix-24i: intakeToApprovalDays anchors at c0.intake_accepted, not c1.submitted', () => {
    const permit = makePermit({
      approval_date: '2026-02-01',
      permit_cycles: [
        makeCycle({ cycle_index: 0, intake_accepted: '2025-08-01' }),
        makeCycle({ cycle_index: 1, submitted: '2025-09-15' }), // ignored
      ],
    });
    const s = extractSample(permit);
    // 2025-08-01 → 2026-02-01 = 184 days. c1.submitted is irrelevant.
    expect(s?.intakeToApprovalDays).toBe(184);
    expect(s?.intakeAnchor).toBe('2025-08-01');
  });

  it('computes cityReview1Days from cycle 1 submitted → corr_issued (per-round still c1.submitted)', () => {
    const permit = makePermit({
      approval_date: '2026-06-01',
      permit_cycles: [
        makeCycle({ cycle_index: 0, intake_accepted: '2026-02-15' }),
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
        makeCycle({ cycle_index: 0, intake_accepted: '2026-02-15' }),
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
        makeCycle({ cycle_index: 0, intake_accepted: '2026-02-15' }),
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
        makeCycle({ cycle_index: 0, intake_accepted: '2026-02-15' }),
        makeCycle({ cycle_index: 1, submitted: '2026-03-01', corr_issued: '2026-04-01', resubmitted: '2026-04-15' }),
        makeCycle({ cycle_index: 2, submitted: '2026-04-15', corr_issued: '2026-05-15', resubmitted: '2026-05-29' }),
      ],
    });
    // 2 cycles with corr/resub → approvedInCycle = 3.
    expect(extractSample(permit)?.approvedInCycle).toBe(3);
  });

  it('goToSubmitDays = project.go_date → cycle 1 submitted (unchanged in fix-24i)', () => {
    // fix-22 Mig 3: extractSample takes the project's go_date as a second
    // arg. fix-24i: anchor switched to intake for the holistic clock, but
    // goToSubmit still measures go_date → c1.submitted (team-side ramp).
    const permit = makePermit({
      approval_date: '2026-06-01',
      permit_cycles: [
        makeCycle({ cycle_index: 0, intake_accepted: '2026-02-15' }),
        makeCycle({ cycle_index: 1, submitted: '2026-03-01' }),
      ],
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
    ['p3', makeProject({ id: 'p3', juris: 'Seattle' })],
    ['p4', makeProject({ id: 'p4', juris: 'Seattle' })],
    ['p5', makeProject({ id: 'p5', juris: 'Seattle' })],
  ]);

  /** Build an approved BP fixture with c0 intake + c1 review. */
  function approvedBP(args: {
    id: number;
    projectId: string;
    intake: string;
    submitted: string;
    corrIssued?: string;
    resubmitted?: string;
    approval: string;
    type?: string;
  }): PermitWithCycles {
    return makePermit({
      id: args.id,
      project_id: args.projectId,
      type: args.type ?? 'Building Permit',
      approval_date: args.approval,
      permit_cycles: [
        makeCycle({ cycle_index: 0, intake_accepted: args.intake }),
        makeCycle({
          cycle_index: 1,
          submitted: args.submitted,
          corr_issued: args.corrIssued ?? null,
          resubmitted: args.resubmitted ?? null,
        }),
      ],
    });
  }

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

  it('fix-25-feat-g: MIN_SAMPLES_FOR_LEARNER is 1 — gate flipped from fix-24i (3) so the learner uses every available sample', () => {
    expect(MIN_SAMPLES_FOR_LEARNER).toBe(1);
  });

  it('fix-25-feat-g: returns null when there are zero matching approved permits in scope AND zero cross-juris samples', () => {
    // No approved BPs anywhere → both scoped and cross-juris tiers
    // return null; caller falls back to defaultDaysForType.
    const result = computeLearnedSchedule(
      [makePermit({ approval_date: null, actual_issue: null })],
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result).toBeNull();
  });

  it('fix-25-feat-g: a single in-scope sample produces a learned estimate (no min-gate)', () => {
    // 1 Seattle BP, recent window. Pre-fix-25-feat-g this would have been
    // null (below the 3-sample gate). Now it fires the scoped tier.
    const permits = [
      approvedBP({ id: 1, projectId: 'p1', intake: '2026-02-15', submitted: '2026-02-15', corrIssued: '2026-03-15', approval: '2026-05-01' }),
    ];
    const result = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result).not.toBeNull();
    expect(result?.sampleCount).toBe(1);
    expect(result?.isCrossJuris).toBe(false);
    expect(result?.source).toContain('Last 180d');
  });

  it('tier 1: 3+ recent-window samples build a learned estimate (isAllTime=false)', () => {
    const permits = [
      approvedBP({ id: 1, projectId: 'p1', intake: '2026-02-01', submitted: '2026-02-01', corrIssued: '2026-03-01', approval: '2026-05-01' }),
      approvedBP({ id: 2, projectId: 'p2', intake: '2026-02-05', submitted: '2026-02-05', corrIssued: '2026-03-05', approval: '2026-05-05' }),
      approvedBP({ id: 3, projectId: 'p3', intake: '2026-02-10', submitted: '2026-02-10', corrIssued: '2026-03-10', approval: '2026-05-10' }),
    ];
    const result = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result).not.toBeNull();
    expect(result?.isAllTime).toBe(false);
    expect(result?.isCrossJuris).toBe(false);
    expect(result?.sampleCount).toBe(3);
    expect(result?.cityReview1).toBe(28); // ~Feb → ~Mar = 28d each
    expect(result?.source).toContain('Last 180d');
  });

  it('tier 2: 3+ all-time samples (outside 180d window) → isAllTime=true', () => {
    const oldPermits = [
      approvedBP({ id: 1, projectId: 'p1', intake: '2024-02-01', submitted: '2024-02-01', corrIssued: '2024-03-01', approval: '2024-05-01' }),
      approvedBP({ id: 2, projectId: 'p2', intake: '2024-02-05', submitted: '2024-02-05', corrIssued: '2024-03-05', approval: '2024-05-05' }),
      approvedBP({ id: 3, projectId: 'p3', intake: '2024-02-10', submitted: '2024-02-10', corrIssued: '2024-03-10', approval: '2024-05-10' }),
    ];
    const result = computeLearnedSchedule(
      oldPermits,
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result?.isAllTime).toBe(true);
    expect(result?.source).toContain('All-time');
  });

  it('falls back to SCHEDULE_DEFAULTS for cycles with no learned samples (cycles 2-4)', () => {
    // 3 Seattle BPs, all with only cycle 1 review data. cycles 2-4 use defaults.
    const permits = [
      approvedBP({ id: 1, projectId: 'p1', intake: '2026-02-01', submitted: '2026-02-01', corrIssued: '2026-03-01', approval: '2026-05-01' }),
      approvedBP({ id: 2, projectId: 'p2', intake: '2026-02-05', submitted: '2026-02-05', corrIssued: '2026-03-05', approval: '2026-05-05' }),
      approvedBP({ id: 3, projectId: 'p3', intake: '2026-02-10', submitted: '2026-02-10', corrIssued: '2026-03-10', approval: '2026-05-10' }),
    ];
    const result = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projectsById,
      new Date(2026, 4, 15),
    );
    expect(result?.cityReview2).toBe(SCHEDULE_DEFAULTS.cityReview2);
    expect(result?.corrResponse2).toBe(SCHEDULE_DEFAULTS.corrResponse2);
  });

  it('filters by (type, juris) — does NOT mix data across combos when both sides have enough samples', () => {
    // 3 Seattle BPs (cityReview1 ≈ 28) + 3 Bellevue BPs (cityReview1 ≈ 73).
    // Seattle scope should ONLY learn from Seattle samples.
    const permits = [
      approvedBP({ id: 1, projectId: 'p1', intake: '2026-02-01', submitted: '2026-02-01', corrIssued: '2026-03-01', approval: '2026-05-01' }),
      approvedBP({ id: 2, projectId: 'p2', intake: '2026-02-05', submitted: '2026-02-05', corrIssued: '2026-03-05', approval: '2026-05-05' }),
      approvedBP({ id: 3, projectId: 'p3', intake: '2026-02-10', submitted: '2026-02-10', corrIssued: '2026-03-10', approval: '2026-05-10' }),
      approvedBP({ id: 4, projectId: 'pBV1', intake: '2026-02-01', submitted: '2026-02-01', corrIssued: '2026-04-15', approval: '2026-05-01' }),
      approvedBP({ id: 5, projectId: 'pBV2', intake: '2026-02-05', submitted: '2026-02-05', corrIssued: '2026-04-20', approval: '2026-05-05' }),
      approvedBP({ id: 6, projectId: 'pBV3', intake: '2026-02-10', submitted: '2026-02-10', corrIssued: '2026-04-25', approval: '2026-05-10' }),
    ];
    const projectsBoth = new Map<string, Project>([
      ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
      ['p2', makeProject({ id: 'p2', juris: 'Seattle' })],
      ['p3', makeProject({ id: 'p3', juris: 'Seattle' })],
      ['pBV1', makeProject({ id: 'pBV1', juris: 'Bellevue' })],
      ['pBV2', makeProject({ id: 'pBV2', juris: 'Bellevue' })],
      ['pBV3', makeProject({ id: 'pBV3', juris: 'Bellevue' })],
    ]);
    const seattle = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projectsBoth,
      new Date(2026, 4, 15),
    );
    expect(seattle?.sampleCount).toBe(3);
    expect(seattle?.isCrossJuris).toBe(false);
    expect(seattle?.cityReview1).toBe(28); // Seattle's 28d, NOT mixed with Bellevue's ~73d
  });

  it('fix-24i: (type, juris) has 0 samples but (type, *) has 3+ → cross-juris fallback fires with isCrossJuris=true', () => {
    // Request: Bothell BP. No Bothell BPs exist. Cross-juris pool: 3 Seattle BPs.
    const permits = [
      approvedBP({ id: 1, projectId: 'p1', intake: '2026-02-01', submitted: '2026-02-01', corrIssued: '2026-03-01', approval: '2026-05-01' }),
      approvedBP({ id: 2, projectId: 'p2', intake: '2026-02-05', submitted: '2026-02-05', corrIssued: '2026-03-05', approval: '2026-05-05' }),
      approvedBP({ id: 3, projectId: 'p3', intake: '2026-02-10', submitted: '2026-02-10', corrIssued: '2026-03-10', approval: '2026-05-10' }),
    ];
    const result = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Bothell',
      projectsById, // all p1/p2/p3 → Seattle
      new Date(2026, 4, 15),
    );
    expect(result).not.toBeNull();
    expect(result?.isCrossJuris).toBe(true);
    expect(result?.sampleCount).toBe(3);
    expect(result?.source).toContain('*'); // "Last 180d · Building Permit · *"
  });

  it('fix-25-feat-g: (type, juris) has 2 samples → scoped tier fires (no cross-juris) because the gate is now 1', () => {
    // 2 Seattle BPs + 2 Bellevue BPs. Pre-fix-25-feat-g the 2 Seattle
    // samples were below the 3-gate and cross-juris (4 combined) fired
    // instead. Now Seattle's 2 are enough on their own.
    const permits = [
      approvedBP({ id: 1, projectId: 'p1', intake: '2026-02-01', submitted: '2026-02-01', corrIssued: '2026-03-01', approval: '2026-05-01' }),
      approvedBP({ id: 2, projectId: 'p2', intake: '2026-02-05', submitted: '2026-02-05', corrIssued: '2026-03-05', approval: '2026-05-05' }),
      approvedBP({ id: 3, projectId: 'pBV1', intake: '2026-02-10', submitted: '2026-02-10', corrIssued: '2026-03-10', approval: '2026-05-10' }),
      approvedBP({ id: 4, projectId: 'pBV2', intake: '2026-02-15', submitted: '2026-02-15', corrIssued: '2026-03-15', approval: '2026-05-15' }),
    ];
    const projectsBoth = new Map<string, Project>([
      ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
      ['p2', makeProject({ id: 'p2', juris: 'Seattle' })],
      ['pBV1', makeProject({ id: 'pBV1', juris: 'Bellevue' })],
      ['pBV2', makeProject({ id: 'pBV2', juris: 'Bellevue' })],
    ]);
    const result = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projectsBoth,
      new Date(2026, 4, 15),
    );
    expect(result).not.toBeNull();
    expect(result?.isCrossJuris).toBe(false);
    expect(result?.sampleCount).toBe(2);
  });

  it('mostLikelyCycle = bucket with highest count; tiebreak favors lower cycle', () => {
    function approved(nCycles: number, id: number): PermitWithCycles {
      const cycles: PermitCycle[] = [
        makeCycle({ cycle_index: 0, intake_accepted: '2026-02-01' }),
        makeCycle({ cycle_index: 1, submitted: '2026-02-15' }),
      ];
      for (let i = 0; i < nCycles; i++) {
        cycles.push(
          makeCycle({
            cycle_index: 2 + i,
            submitted: '2026-02-15',
            corr_issued: '2026-03-01',
            resubmitted: '2026-03-15',
          }),
        );
      }
      return makePermit({
        id,
        project_id: `p${id}`,
        approval_date: '2026-05-01',
        permit_cycles: cycles,
      });
    }
    // 3 permits approved in cycle 1 (no corrections), 2 in cycle 2 (1 correction).
    const projects5 = new Map<string, Project>([
      ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
      ['p2', makeProject({ id: 'p2', juris: 'Seattle' })],
      ['p3', makeProject({ id: 'p3', juris: 'Seattle' })],
      ['p4', makeProject({ id: 'p4', juris: 'Seattle' })],
      ['p5', makeProject({ id: 'p5', juris: 'Seattle' })],
    ]);
    const result = computeLearnedSchedule(
      [approved(0, 1), approved(0, 2), approved(0, 3), approved(1, 4), approved(1, 5)],
      'Building Permit',
      'Seattle',
      projects5,
      new Date(2026, 4, 15),
    );
    expect(result?.mostLikelyCycle).toBe(1);
    expect(result?.cycleDist[1]).toBe(3);
    expect(result?.cycleDist[2]).toBe(2);
  });
});

// ============================================================
// fix-24i: per-type default lookup
// ============================================================
describe('defaultDaysForType', () => {
  it('returns the per-type default for known types', () => {
    expect(defaultDaysForType('Building Permit')).toBe(PER_TYPE_DEFAULT_DAYS['Building Permit']);
    expect(defaultDaysForType('Demolition')).toBe(60);
    expect(defaultDaysForType('ULS')).toBe(90);
    expect(defaultDaysForType('SDOT')).toBe(45);
  });

  it('falls back to PER_TYPE_FALLBACK_DAYS for unknown types', () => {
    expect(defaultDaysForType('Bizarre Custom Type')).toBe(PER_TYPE_FALLBACK_DAYS);
    expect(defaultDaysForType('')).toBe(PER_TYPE_FALLBACK_DAYS);
    expect(defaultDaysForType(null)).toBe(PER_TYPE_FALLBACK_DAYS);
    expect(defaultDaysForType(undefined)).toBe(PER_TYPE_FALLBACK_DAYS);
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
