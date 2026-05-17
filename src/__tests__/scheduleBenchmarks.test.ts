import { describe, it, expect } from 'vitest';
import {
  computeLearnedSchedule,
  defaultDaysForType,
  effectiveCityReview,
  effectiveCorrResponse,
  extractSample,
  filteredMean,
  IQR_MIN_SAMPLES,
  listTypeJurisCombos,
  MIN_SAMPLES_FOR_LEARNER,
  OUTLIER_HARD_CAP_DAYS,
  PER_TYPE_DEFAULT_DAYS,
  PER_TYPE_FALLBACK_DAYS,
  RECENCY_HALF_LIFE_MONTHS,
  recencyWeight,
  SCHEDULE_DEFAULTS,
  WINDOW_TIERS_DAYS,
  type LearnedEstimate,
} from '../lib/scheduleBenchmarks';
import {
  anchorFor,
  computeLearnedTargetSubmit,
  extractTargetSubmitSample,
  HARDCODED_TARGET_SUBMIT_OFFSETS,
} from '../lib/targetSubmitLearner';
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
    // fix-25-feat-AA: cascade walks 90d → 180d → 365d → all-time. A
    // sample within 90 days lands in the freshest tier.
    expect(result?.source).toContain('Last 90d');
    expect(result?.recencyTier).toBe('last_90d');
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
    // fix-25-feat-AA: approval dates 2026-05-01..10 vs today 2026-05-15
    // → all three land in the 90d tier.
    expect(result?.source).toContain('Last 90d');
    expect(result?.recencyTier).toBe('last_90d');
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

  // fix-25-feat-Z: tenant-scoped overrides take precedence over the
  // hardcoded constants, and Map / Record forms are both accepted.
  it('honors tenant overrides over the hardcoded table', () => {
    const overridesMap = new Map<string, number>([
      ['Building Permit', 365],
      ['ULS', 14],
    ]);
    expect(defaultDaysForType('Building Permit', overridesMap)).toBe(365);
    expect(defaultDaysForType('ULS', overridesMap)).toBe(14);

    const overridesRecord = { 'Building Permit': 90, ULS: 30 };
    expect(defaultDaysForType('Building Permit', overridesRecord)).toBe(90);
    expect(defaultDaysForType('ULS', overridesRecord)).toBe(30);
  });

  it('falls through to the hardcoded table when override is missing for the type', () => {
    const overrides = new Map<string, number>([['Building Permit', 365]]);
    // Demolition not in override — hardcoded 60 stands.
    expect(defaultDaysForType('Demolition', overrides)).toBe(60);
  });

  it('ignores invalid override values (non-positive, non-number)', () => {
    const overrides = new Map<string, number>([
      ['Building Permit', 0],
      ['ULS', -7],
    ]);
    expect(defaultDaysForType('Building Permit', overrides)).toBe(
      PER_TYPE_DEFAULT_DAYS['Building Permit'],
    );
    expect(defaultDaysForType('ULS', overrides)).toBe(90);
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

// ============================================================
// fix-25-feat-W: outlier filter
// ============================================================
describe('filteredMean (fix-25-feat-W)', () => {
  it('returns null on empty input', () => {
    expect(filteredMean([])).toBeNull();
  });

  it('returns null when every value is dropped by hard caps', () => {
    expect(filteredMean([-1, 0, 731, 9999])).toBeNull();
  });

  it('treats null and undefined as drops (matches prior avg() contract)', () => {
    const r = filteredMean([null, undefined, 10, 20]);
    expect(r).not.toBeNull();
    expect(r!.mean).toBe(15);
    expect(r!.n).toBe(2);
    // null/undefined are filtered at the numeric coercion step before
    // hard caps, so they don't count toward filteredCount (which is
    // measured against the numeric input set).
    expect(r!.filteredCount).toBe(0);
  });

  it('hard-caps negative + zero-day values (lower bound)', () => {
    const r = filteredMean([-5, 0, 0.5, 10, 20])!;
    // -5, 0, 0.5 all dropped; 10, 20 kept.
    expect(r.n).toBe(2);
    expect(r.mean).toBe(15);
    expect(r.filteredCount).toBe(3);
  });

  it('hard-caps multi-year values at OUTLIER_HARD_CAP_DAYS', () => {
    const r = filteredMean([100, 200, 731, 1000])!;
    expect(OUTLIER_HARD_CAP_DAYS).toBe(730);
    expect(r.n).toBe(2);
    expect(r.mean).toBe(150);
    expect(r.filteredCount).toBe(2);
  });

  it('keeps values at the boundary (1d and 730d both pass hard caps)', () => {
    const r = filteredMean([1, 730])!;
    expect(r.n).toBe(2);
    expect(r.mean).toBe(366); // (1+730)/2 = 365.5 → 366
    expect(r.filteredCount).toBe(0);
  });

  it('IQR upper-fence drops a single far-upper outlier when N >= IQR_MIN_SAMPLES', () => {
    expect(IQR_MIN_SAMPLES).toBe(8);
    // 8 samples: 7 around the mid-100s + 1 far upper at 600.
    const samples = [100, 110, 120, 130, 140, 150, 160, 600];
    const r = filteredMean(samples)!;
    expect(r.n).toBe(7);
    expect(r.filteredCount).toBe(1);
    // Mean of the 7 kept = (100+110+120+130+140+150+160)/7 = 130
    expect(r.mean).toBe(130);
  });

  it('skips IQR when N < IQR_MIN_SAMPLES — hard caps still apply', () => {
    // 7 samples, with one far-upper value. IQR would drop it on N>=8;
    // at N=7, IQR is skipped, only hard caps run. 600 passes hard cap
    // (< 730) so it stays.
    const samples = [100, 110, 120, 130, 140, 150, 600];
    const r = filteredMean(samples)!;
    expect(r.n).toBe(7);
    expect(r.filteredCount).toBe(0);
    expect(r.mean).toBe(Math.round((100 + 110 + 120 + 130 + 140 + 150 + 600) / 7));
  });

  it('does NOT drop the LOW end — fast approvals are preserved', () => {
    // 8 samples skewed high with a single very low one. Low value
    // would fall outside a hypothetical lower fence, but we don't
    // apply a lower fence. Should be kept.
    const samples = [3, 200, 210, 220, 230, 240, 250, 260];
    const r = filteredMean(samples)!;
    expect(r.n).toBe(8);
    expect(r.filteredCount).toBe(0);
  });

  it('keeps everything when IQR=0 (tight / flat distribution)', () => {
    // All 8 samples equal — IQR collapses to 0. Upper fence would
    // equal Q3 itself and any equal value would technically pass.
    // The explicit IQR=0 guard avoids edge-case drops.
    const samples = [100, 100, 100, 100, 100, 100, 100, 100];
    const r = filteredMean(samples)!;
    expect(r.n).toBe(8);
    expect(r.mean).toBe(100);
    expect(r.filteredCount).toBe(0);
  });

  it('real-world Seattle BP-style cohort: 10 samples with 1 outlier', () => {
    // Approximate Bobby's prod cohort shape: clocks clustered ~180d
    // with one outlier ~500d. The outlier should fall above the
    // upper fence and drop.
    const samples = [150, 160, 170, 180, 190, 200, 210, 220, 230, 500];
    const r = filteredMean(samples)!;
    expect(r.filteredCount).toBe(1);
    expect(r.n).toBe(9);
    expect(r.mean).toBe(190); // (150+...+230)/9 = 190
  });
});

// ============================================================
// fix-25-feat-X: cycle extrapolation helpers
// ============================================================

/** Build a LearnedEstimate fixture with the cycle clocks + counts the
 *  test cares about. All other fields are inert. */
function mkEstimate(
  over: Partial<LearnedEstimate> = {},
): LearnedEstimate {
  return {
    source: 'test',
    sampleCount: 0,
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
    avgCycles: null,
    mostLikelyCycle: 1,
    cycleDist: { 1: 0, 2: 0, 3: 0, 4: 0 },
    isAllTime: false,
    isCrossJuris: false,
    recencyTier: 'last_180d' as const,
    ...over,
  };
}

describe('effectiveCityReview (fix-25-feat-X)', () => {
  it('null estimate → SCHEDULE_DEFAULTS.cityReview1', () => {
    expect(effectiveCityReview(null, 1)).toBe(SCHEDULE_DEFAULTS.cityReview1);
    expect(effectiveCityReview(null, 3)).toBe(SCHEDULE_DEFAULTS.cityReview1);
    expect(effectiveCityReview(null, 99)).toBe(SCHEDULE_DEFAULTS.cityReview1);
  });

  it('cohort with only cycle 1 data → returns cycle 1 value for any cycleIdx', () => {
    const e = mkEstimate({ cityReview1: 14, cr1Count: 5 });
    expect(effectiveCityReview(e, 1)).toBe(14);
    expect(effectiveCityReview(e, 2)).toBe(14); // walks down 2→1
    expect(effectiveCityReview(e, 3)).toBe(14);
    expect(effectiveCityReview(e, 4)).toBe(14);
    expect(effectiveCityReview(e, 5)).toBe(14); // caps to 4 then walks
  });

  it('cohort with cycle 1 + cycle 2 → cycle 3 request extrapolates from cycle 2', () => {
    const e = mkEstimate({
      cityReview1: 10,
      cr1Count: 5,
      cityReview2: 28,
      cr2Count: 4,
    });
    expect(effectiveCityReview(e, 1)).toBe(10);
    expect(effectiveCityReview(e, 2)).toBe(28);
    expect(effectiveCityReview(e, 3)).toBe(28); // walks down 3→2
    expect(effectiveCityReview(e, 4)).toBe(28); // walks down 4→3→2
  });

  it('cohort with all 4 cycles populated → cycle 5 caps to cycle 4', () => {
    const e = mkEstimate({
      cityReview1: 10,
      cr1Count: 5,
      cityReview2: 20,
      cr2Count: 4,
      cityReview3: 30,
      cr3Count: 3,
      cityReview4: 40,
      cr4Count: 2,
    });
    expect(effectiveCityReview(e, 5)).toBe(40);
    expect(effectiveCityReview(e, 99)).toBe(40);
  });

  it('cohort with all 4 cycles populated → each cycle returns its own value', () => {
    const e = mkEstimate({
      cityReview1: 10,
      cr1Count: 1,
      cityReview2: 20,
      cr2Count: 1,
      cityReview3: 30,
      cr3Count: 1,
      cityReview4: 40,
      cr4Count: 1,
    });
    expect(effectiveCityReview(e, 1)).toBe(10);
    expect(effectiveCityReview(e, 2)).toBe(20);
    expect(effectiveCityReview(e, 3)).toBe(30);
    expect(effectiveCityReview(e, 4)).toBe(40);
  });

  it('cycleIdx 0 / negative / NaN coerce to 1', () => {
    const e = mkEstimate({ cityReview1: 14, cr1Count: 5 });
    expect(effectiveCityReview(e, 0)).toBe(14);
    expect(effectiveCityReview(e, -3)).toBe(14);
  });

  it('no cycle has samples (all counts 0) → SCHEDULE_DEFAULTS.cityReview1', () => {
    // cityReview values present (default-filled by buildEstimate) but no
    // count means we shouldn't trust them as learned signal.
    const e = mkEstimate({
      cityReview1: 999,
      cityReview2: 888,
      cr1Count: 0,
      cr2Count: 0,
    });
    expect(effectiveCityReview(e, 1)).toBe(SCHEDULE_DEFAULTS.cityReview1);
    expect(effectiveCityReview(e, 4)).toBe(SCHEDULE_DEFAULTS.cityReview1);
  });

  it('cohort with cycle 2 but NOT cycle 1 → cycle 1 request still finds cycle 2 NOT used (walks down only)', () => {
    // Edge case: walk-down direction is strict — we don't walk UP from
    // cycle 1 to find cycle 2. cycle 1 request with no cycle 1 data
    // falls to default.
    const e = mkEstimate({ cityReview2: 28, cr2Count: 4 });
    expect(effectiveCityReview(e, 1)).toBe(SCHEDULE_DEFAULTS.cityReview1);
    expect(effectiveCityReview(e, 2)).toBe(28);
    expect(effectiveCityReview(e, 3)).toBe(28); // walks 3→2
  });
});

describe('effectiveCorrResponse (fix-25-feat-X)', () => {
  it('null estimate → SCHEDULE_DEFAULTS.corrResponse1', () => {
    expect(effectiveCorrResponse(null, 1)).toBe(
      SCHEDULE_DEFAULTS.corrResponse1,
    );
    expect(effectiveCorrResponse(null, 7)).toBe(
      SCHEDULE_DEFAULTS.corrResponse1,
    );
  });

  it('walks down from min(cycleIdx, 4) → 1 same as effectiveCityReview', () => {
    const e = mkEstimate({
      corrResponse1: 5,
      co1Count: 3,
      corrResponse3: 12,
      co3Count: 2,
    });
    expect(effectiveCorrResponse(e, 1)).toBe(5);
    expect(effectiveCorrResponse(e, 2)).toBe(5); // walks 2→1
    expect(effectiveCorrResponse(e, 3)).toBe(12);
    expect(effectiveCorrResponse(e, 4)).toBe(12); // walks 4→3
    expect(effectiveCorrResponse(e, 5)).toBe(12); // caps to 4 then walks
  });

  it('no cohort signal → SCHEDULE_DEFAULTS.corrResponse1', () => {
    const e = mkEstimate(); // all counts 0
    expect(effectiveCorrResponse(e, 2)).toBe(SCHEDULE_DEFAULTS.corrResponse1);
  });
});

// ============================================================
// fix-25-feat-Y: recency weighting
// ============================================================

describe('recencyWeight (fix-25-feat-Y)', () => {
  const NOW = new Date('2026-05-17T12:00:00Z');

  it('null / undefined approval → weight 1', () => {
    expect(recencyWeight(null, NOW)).toBe(1);
    expect(recencyWeight(undefined, NOW)).toBe(1);
  });

  it('today → weight 1', () => {
    expect(recencyWeight('2026-05-17', NOW)).toBeCloseTo(1, 2);
  });

  it('future-dated approval → weight 1 (no clock-skew penalty)', () => {
    expect(recencyWeight('2027-01-01', NOW)).toBe(1);
  });

  it('18 months old → weight 0.5', () => {
    // 18 months back from 2026-05-17 ≈ 2024-11-17. 30.44 d/mo × 18 mo
    // = 547.92 days. Compute exact ISO date for the test to land
    // close to 0.5 without floating-point fuzz.
    const months18Ago = new Date(NOW);
    months18Ago.setUTCDate(
      months18Ago.getUTCDate() - Math.round(30.44 * RECENCY_HALF_LIFE_MONTHS),
    );
    const w = recencyWeight(months18Ago, NOW);
    expect(w).toBeGreaterThan(0.49);
    expect(w).toBeLessThan(0.51);
  });

  it('36 months old → weight 0.25', () => {
    const months36Ago = new Date(NOW);
    months36Ago.setUTCDate(
      months36Ago.getUTCDate() - Math.round(30.44 * 36),
    );
    const w = recencyWeight(months36Ago, NOW);
    expect(w).toBeGreaterThan(0.24);
    expect(w).toBeLessThan(0.26);
  });

  it('ancient sample (10+ years) → clamps at floor 0.05', () => {
    const veryOld = new Date(NOW);
    veryOld.setUTCFullYear(veryOld.getUTCFullYear() - 20);
    expect(recencyWeight(veryOld, NOW)).toBe(0.05);
  });

  it('invalid string → weight 1 (graceful)', () => {
    expect(recencyWeight('not-a-date', NOW)).toBe(1);
  });
});

describe('filteredMean with weights (fix-25-feat-Y)', () => {
  it('no weights → behavior identical to unweighted filteredMean (regression)', () => {
    const unweighted = filteredMean([10, 20, 30]);
    const weightedNoArg = filteredMean([10, 20, 30]);
    expect(unweighted).toEqual(weightedNoArg);
    expect(unweighted!.mean).toBe(20);
  });

  it('all weights equal → weighted mean equals unweighted mean', () => {
    const r = filteredMean([10, 20, 30], [0.5, 0.5, 0.5])!;
    expect(r.mean).toBe(20);
    expect(r.n).toBe(3);
  });

  it('higher weight on a sample pulls the mean toward it', () => {
    // [recent=10 with weight 1.0, old=100 with weight 0.1].
    // SUM(value*weight) = 10 + 10 = 20
    // SUM(weight) = 1.1
    // mean = 20 / 1.1 ≈ 18.18 → rounds to 18.
    const r = filteredMean([10, 100], [1.0, 0.1])!;
    expect(r.mean).toBe(18);
    expect(r.n).toBe(2);
  });

  it('hard caps drop value AND its weight in lockstep', () => {
    // Two samples capped (negative + 9999), two kept. Weights for
    // the two kept don't include the dropped weights.
    const r = filteredMean(
      [-1, 50, 100, 9999],
      [10, 1, 1, 10],
    )!;
    // Kept: value 50 with weight 1, value 100 with weight 1.
    // mean = (50*1 + 100*1) / 2 = 75.
    expect(r.mean).toBe(75);
    expect(r.n).toBe(2);
    expect(r.filteredCount).toBe(2);
  });

  it('IQR upper-fence drops outlier WITH its weight (N≥8 cohort)', () => {
    // 7 around 100s + 1 far upper at 600. With equal weights,
    // expected behavior matches the unweighted IQR test from
    // fix-25-feat-W.
    const samples = [100, 110, 120, 130, 140, 150, 160, 600];
    const weights = samples.map(() => 1);
    const r = filteredMean(samples, weights)!;
    expect(r.n).toBe(7);
    expect(r.filteredCount).toBe(1);
    expect(r.mean).toBe(130);
  });

  it('shorter weights array → missing positions default to weight 1', () => {
    // Defensive: 3 samples, 2 weights. The 3rd sample gets weight 1.
    const r = filteredMean([10, 20, 30], [2, 2])!;
    // weights = [2, 2, 1].
    // SUM(weight) = 5. SUM(value*weight) = 20 + 40 + 30 = 90.
    // mean = 90 / 5 = 18.
    expect(r.mean).toBe(18);
    expect(r.n).toBe(3);
  });

  it('zero / negative weight → defaults to 1 (defensive guard)', () => {
    // Avoid divide-by-zero or signed weight math.
    const r = filteredMean([10, 20], [-5, 0])!;
    // Both weights coerced to 1. Plain mean of [10, 20] = 15.
    expect(r.mean).toBe(15);
  });

  it('real-world recent-vs-old cohort skews toward recent', () => {
    // 5 recent samples around 120 days + 5 old samples around 200 days.
    // Unweighted mean = (5*120 + 5*200) / 10 = 160.
    // Weighted with recent=1.0 and old=0.3:
    //   SUM(value*weight) = 5*120*1.0 + 5*200*0.3 = 600 + 300 = 900
    //   SUM(weight)       = 5*1.0 + 5*0.3 = 6.5
    //   weighted mean     = 900 / 6.5 ≈ 138.5 → rounds to 138
    const samples = [120, 120, 120, 120, 120, 200, 200, 200, 200, 200];
    const weights = [1, 1, 1, 1, 1, 0.3, 0.3, 0.3, 0.3, 0.3];
    const r = filteredMean(samples, weights)!;
    // Note: with 10 samples, IQR will run. Values 120 and 200 give
    // IQR=80, upperFence=200+1.5*80=320. All values stay.
    expect(r.n).toBe(10);
    expect(r.filteredCount).toBe(0);
    expect(r.mean).toBe(138);
  });
});

// ============================================================
// fix-25-feat-AA: recency cascade — existing learner
// ============================================================
describe('computeLearnedSchedule recency cascade (fix-25-feat-AA)', () => {
  // Today pin: 2026-05-15. Each tier cutoff:
  //   last_90d  → on/after 2026-02-14
  //   last_180d → on/after 2025-11-16
  //   last_365d → on/after 2025-05-15
  //   all_time  → no cutoff
  const TODAY = new Date(2026, 4, 15);

  function approvedAt(
    id: number,
    projectId: string,
    approval: string,
  ): PermitWithCycles {
    return makePermit({
      id,
      project_id: projectId,
      approval_date: approval,
      permit_cycles: [
        makeCycle({ permit_id: id, cycle_index: 0, intake_accepted: approval }),
        makeCycle({ permit_id: id, cycle_index: 1, submitted: approval }),
      ],
    });
  }

  const projects = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
    ['p2', makeProject({ id: 'p2', juris: 'Seattle' })],
    ['p3', makeProject({ id: 'p3', juris: 'Seattle' })],
    ['p4', makeProject({ id: 'p4', juris: 'Seattle' })],
  ]);

  it('exports WINDOW_TIERS_DAYS in fresh→stale order', () => {
    expect(Array.from(WINDOW_TIERS_DAYS)).toEqual([90, 180, 365]);
  });

  it('tier 90d wins when any sample is within 90 days', () => {
    const permits = [approvedAt(1, 'p1', '2026-04-01')]; // ~44d ago
    const r = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projects,
      TODAY,
    );
    expect(r?.recencyTier).toBe('last_90d');
    expect(r?.source).toContain('Last 90d');
  });

  it('tier 180d wins when nothing inside 90d but something inside 180d', () => {
    // 2026-01-15 → 120 days ago (outside 90, inside 180)
    const permits = [approvedAt(1, 'p1', '2026-01-15')];
    const r = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projects,
      TODAY,
    );
    expect(r?.recencyTier).toBe('last_180d');
  });

  it('tier 365d wins when nothing inside 180d but something inside 365d', () => {
    // 2025-09-01 → ~256 days ago (outside 180, inside 365)
    const permits = [approvedAt(1, 'p1', '2025-09-01')];
    const r = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projects,
      TODAY,
    );
    expect(r?.recencyTier).toBe('last_365d');
  });

  it('all_time wins when every sample is older than 365 days', () => {
    const permits = [
      approvedAt(1, 'p1', '2024-01-01'),
      approvedAt(2, 'p2', '2024-02-01'),
    ];
    const r = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projects,
      TODAY,
    );
    expect(r?.recencyTier).toBe('all_time');
    expect(r?.isAllTime).toBe(true);
  });

  it('returns null when every tier is below MIN_SAMPLES_FOR_LEARNER (cohort empty)', () => {
    const r = computeLearnedSchedule(
      [],
      'Building Permit',
      'Seattle',
      projects,
      TODAY,
    );
    expect(r).toBeNull();
  });

  it('prefers the freshest tier even if older tiers have more samples', () => {
    // 1 sample inside 90d (single) + 5 samples inside 365d. Cascade
    // still picks the 90d tier because it has N ≥ MIN_SAMPLES_FOR_LEARNER (1).
    const permits = [
      approvedAt(1, 'p1', '2026-04-01'),          // 90d tier
      approvedAt(2, 'p2', '2025-09-01'),          // 365d tier
      approvedAt(3, 'p3', '2025-08-01'),          // 365d tier
      approvedAt(4, 'p4', '2025-07-01'),          // 365d tier
    ];
    const r = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projects,
      TODAY,
    );
    expect(r?.recencyTier).toBe('last_90d');
    expect(r?.sampleCount).toBe(1);
  });

  it('cross-juris fallback walks the cascade in its own scope', () => {
    // 0 Seattle BPs but 1 Bellevue BP inside 90d → cross-juris last_90d.
    const projectsX = new Map<string, Project>([
      ['pBV1', makeProject({ id: 'pBV1', juris: 'Bellevue' })],
    ]);
    const permits = [approvedAt(1, 'pBV1', '2026-04-01')];
    const r = computeLearnedSchedule(
      permits,
      'Building Permit',
      'Seattle',
      projectsX,
      TODAY,
    );
    expect(r?.isCrossJuris).toBe(true);
    expect(r?.recencyTier).toBe('last_90d');
  });
});

// ============================================================
// fix-25-feat-AA: target_submit learner
// ============================================================
describe('target_submit learner anchorFor (fix-25-feat-AA)', () => {
  it('maps each permit type to the correct anchor', () => {
    expect(anchorFor('Building Permit')).toBe('dd_end');
    expect(anchorFor('Demolition')).toBe('bp_c0_intake');
    expect(anchorFor('IPR')).toBe('bp_c1_resub');
    expect(anchorFor('ULS')).toBe('bp_c1_resub');
    expect(anchorFor('Condo')).toBe('bp_actual_issue');
    expect(anchorFor('ECA Waiver')).toBe('go_date');
    expect(anchorFor('PAR/Pre-Sub')).toBe('go_date');
    expect(anchorFor('SDOT Tree')).toBe('go_date');
    expect(anchorFor('TRAO')).toBe('go_date');
    expect(anchorFor('LBA')).toBe('go_date');
    expect(anchorFor('Short Plat')).toBe('go_date');
    expect(anchorFor('SIP')).toBe('go_date');
    expect(anchorFor('Grading / Clearing')).toBe('mirror_bp');
    expect(anchorFor('LSM')).toBe('mirror_bp');
    expect(anchorFor(null)).toBe('mirror_bp');
    expect(anchorFor('Unknown Type')).toBe('mirror_bp');
  });
});

describe('extractTargetSubmitSample (fix-25-feat-AA)', () => {
  it('returns null when permit type has no anchor (mirror_bp)', () => {
    const permit = makePermit({
      type: 'Grading / Clearing',
      permit_cycles: [makeCycle({ cycle_index: 0, submitted: '2026-04-01' })],
    });
    expect(
      extractTargetSubmitSample(permit, makeProject(), undefined),
    ).toBeNull();
  });

  it('returns null when c0.submitted is missing', () => {
    const permit = makePermit({
      type: 'Building Permit',
      dd_end: '2026-03-15',
      permit_cycles: [makeCycle({ cycle_index: 0, submitted: null })],
    });
    expect(
      extractTargetSubmitSample(permit, makeProject(), undefined),
    ).toBeNull();
  });

  it('returns null when anchor date is missing (BP without dd_end)', () => {
    const permit = makePermit({
      type: 'Building Permit',
      dd_end: null,
      permit_cycles: [makeCycle({ cycle_index: 0, submitted: '2026-04-01' })],
    });
    expect(
      extractTargetSubmitSample(permit, makeProject(), undefined),
    ).toBeNull();
  });

  it('BP: returns days between dd_end and c0.submitted', () => {
    const permit = makePermit({
      type: 'Building Permit',
      dd_end: '2026-03-15',
      permit_cycles: [makeCycle({ cycle_index: 0, submitted: '2026-04-05' })],
    });
    const s = extractTargetSubmitSample(permit, makeProject(), undefined);
    expect(s).not.toBeNull();
    expect(s?.anchor).toBe('dd_end');
    expect(s?.daysAnchorToSubmit).toBe(21);
    expect(s?.recencyDate).toBe('2026-04-05');
  });

  it('go-anchored: PAR/Pre-Sub uses project.go_date and accepts negative values', () => {
    const permit = makePermit({
      id: 7,
      type: 'PAR/Pre-Sub',
      permit_cycles: [makeCycle({ cycle_index: 0, submitted: '2026-02-01' })],
    });
    const project = makeProject({ go_date: '2026-03-01' });
    const s = extractTargetSubmitSample(permit, project, undefined);
    expect(s?.anchor).toBe('go_date');
    expect(s?.daysAnchorToSubmit).toBe(-28); // submitted before go-date
  });

  it('Demo: anchors to sibling BP c0.intake_accepted', () => {
    const demo = makePermit({
      id: 2,
      type: 'Demolition',
      permit_cycles: [makeCycle({ cycle_index: 0, submitted: '2026-04-15' })],
    });
    const bp = makePermit({
      id: 1,
      type: 'Building Permit',
      permit_cycles: [
        makeCycle({ cycle_index: 0, intake_accepted: '2026-03-09' }),
      ],
    });
    const s = extractTargetSubmitSample(demo, makeProject(), bp);
    expect(s?.anchor).toBe('bp_c0_intake');
    expect(s?.daysAnchorToSubmit).toBe(37);
  });

  it('drops samples beyond the symmetric outlier cap', () => {
    const permit = makePermit({
      type: 'Building Permit',
      dd_end: '2020-01-01',
      permit_cycles: [makeCycle({ cycle_index: 0, submitted: '2026-04-01' })],
    });
    // ~6 years between → exceeds OUTLIER_HARD_CAP_DAYS (730).
    expect(
      extractTargetSubmitSample(permit, makeProject(), undefined),
    ).toBeNull();
  });
});

describe('computeLearnedTargetSubmit (fix-25-feat-AA)', () => {
  const TODAY = new Date(2026, 4, 15);

  function bpSample(
    id: number,
    projectId: string,
    submitted: string,
    ddEnd: string,
  ): PermitWithCycles {
    return makePermit({
      id,
      project_id: projectId,
      type: 'Building Permit',
      dd_end: ddEnd,
      permit_cycles: [makeCycle({ permit_id: id, cycle_index: 0, submitted })],
    });
  }

  it('cohort empty → returns hardcoded fallback with source=default', () => {
    const result = computeLearnedTargetSubmit(
      [],
      new Map<string, Project>(),
      { type: 'Building Permit', juris: 'Seattle' },
      TODAY,
    );
    expect(result.source).toBe('default');
    expect(result.value).toBe(HARDCODED_TARGET_SUBMIT_OFFSETS['Building Permit']);
    expect(result.sampleCount).toBe(0);
  });

  it('one BP sample within 90d → tier last_90d with learned value', () => {
    const permits = [bpSample(1, 'p1', '2026-04-01', '2026-03-10')]; // +22d
    const projects = new Map([['p1', makeProject({ id: 'p1', juris: 'Seattle' })]]);
    const result = computeLearnedTargetSubmit(
      permits,
      projects,
      { type: 'Building Permit', juris: 'Seattle' },
      TODAY,
    );
    expect(result.source).toBe('last_90d');
    expect(result.value).toBe(22);
    expect(result.sampleCount).toBe(1);
    expect(result.isCrossJuris).toBe(false);
  });

  it('cross-juris fallback when scoped (type, juris) has no sample', () => {
    // 0 Seattle samples, 1 Bellevue sample.
    const permits = [bpSample(1, 'pBV1', '2026-04-01', '2026-03-10')];
    const projects = new Map([['pBV1', makeProject({ id: 'pBV1', juris: 'Bellevue' })]]);
    const result = computeLearnedTargetSubmit(
      permits,
      projects,
      { type: 'Building Permit', juris: 'Seattle' },
      TODAY,
    );
    expect(result.isCrossJuris).toBe(true);
    expect(result.value).toBe(22);
  });

  it('mirror_bp types short-circuit to default with null value', () => {
    const result = computeLearnedTargetSubmit(
      [],
      new Map(),
      { type: 'Grading / Clearing', juris: 'Seattle' },
      TODAY,
    );
    expect(result.value).toBeNull();
    expect(result.source).toBe('default');
  });

  it('walks cascade past empty 90d tier when older samples exist', () => {
    const permits = [
      bpSample(1, 'p1', '2025-09-01', '2025-08-05'), // 365d tier (27d)
      bpSample(2, 'p2', '2025-09-15', '2025-08-20'), // 365d tier (26d)
    ];
    const projects = new Map([
      ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
      ['p2', makeProject({ id: 'p2', juris: 'Seattle' })],
    ]);
    const result = computeLearnedTargetSubmit(
      permits,
      projects,
      { type: 'Building Permit', juris: 'Seattle' },
      TODAY,
    );
    expect(result.source).toBe('last_365d');
    expect(result.value).toBeGreaterThan(20);
    expect(result.value).toBeLessThan(30);
  });
});
