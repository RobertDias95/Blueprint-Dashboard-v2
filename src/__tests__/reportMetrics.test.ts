import { describe, it, expect } from 'vitest';
import {
  aggregateByProject,
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
  permitStatus: 'all',
  search: '',
  comparisonRange: null,
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

  it('goToSubmit = days from project.go_date to first cycle submitted', () => {
    // fix-22 Mig 3: go_date moved to projects.
    const cycle = makeCycle({ submitted: '2026-04-01' });
    const localById = new Map([
      ['p1', makeProject({ id: 'p1', go_date: '2026-01-01' })],
    ]);
    const enriched = enrichPermits(
      [makePermit({ project_id: 'p1', permit_cycles: [cycle] })],
      localById,
    );
    // 2026-01-01 → 2026-04-01 = 90 days.
    expect(enriched[0].goToSubmit).toBe(90);
  });

  it('fix-112-b/fix-141: permitTimelineDays = (approval_date ?? actual_issue) − c0.intake_accepted', () => {
    // fix-141 renamed the field cityReviewDays → permitTimelineDays (the
    // intake → approval clock split off from the redefined City Review).
    // Formula is byte-for-byte the fix-112-b canonical — strict intake →
    // approval point, no fallback chain. Matches the Trends KPI city clock.
    const c0 = makeCycle({
      cycle_index: 0,
      submitted: '2026-02-01',
      intake_accepted: '2026-02-05',
    });
    const enriched = enrichPermits(
      [
        makePermit({
          approval_date: '2026-05-05',
          permit_cycles: [c0],
        }),
      ],
      projectsById,
    );
    // 2026-02-05 → 2026-05-05 = 89 days.
    expect(enriched[0].permitTimelineDays).toBe(89);
  });

  it('fix-112-b/fix-141: permitTimelineDays = null when c0.intake_accepted is missing (no submitted fallback)', () => {
    // Pre-fix the formula fell back to firstSubmitted, silently mixing the
    // submit→approval arc into the city-review average. Strict canonical
    // drops the fallback — permits without intake_accepted are excluded.
    const c0 = makeCycle({
      cycle_index: 0,
      submitted: '2026-02-01',
      intake_accepted: null,
    });
    const enriched = enrichPermits(
      [
        makePermit({
          approval_date: '2026-05-05',
          permit_cycles: [c0],
        }),
      ],
      projectsById,
    );
    expect(enriched[0].permitTimelineDays).toBeNull();
  });

  it('fix-112-b/fix-141: permitTimelineDays coalesces to actual_issue when approval_date missing', () => {
    // Endpoint = approval_date ?? actual_issue (mirrors the Trends KPI). A
    // permit that was issued without a separate approval_date stamp still
    // contributes to the avg.
    const c0 = makeCycle({
      cycle_index: 0,
      intake_accepted: '2026-02-05',
    });
    const enriched = enrichPermits(
      [
        makePermit({
          actual_issue: '2026-04-05',
          permit_cycles: [c0],
        }),
      ],
      projectsById,
    );
    // 2026-02-05 → 2026-04-05 = 59 days.
    expect(enriched[0].permitTimelineDays).toBe(59);
  });

  it('fix-112-b/fix-141: permitTimelineDays = null when intake on c1 only (canonical anchor is c0)', () => {
    // Pre-fix the formula keyed off pickFirstSubmittedCycle which would
    // happily use cycle 1's intake_accepted. The strict canonical only
    // considers c0.intake_accepted — a v1-era fixture with everything on
    // cycle_index=1 no longer contributes.
    const c1 = makeCycle({
      cycle_index: 1,
      submitted: '2026-02-01',
      intake_accepted: '2026-02-05',
      corr_issued: '2026-03-05',
    });
    const enriched = enrichPermits(
      [
        makePermit({
          approval_date: '2026-05-05',
          permit_cycles: [c1],
        }),
      ],
      projectsById,
    );
    expect(enriched[0].permitTimelineDays).toBeNull();
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
    expect(enriched[0].permitTimelineDays).toBeNull();
    expect(enriched[0].variance).toBeNull();
    expect(enriched[0].ddDuration).toBeNull();
  });
});

// ============================================================
// filterEnrichedPermits
// ============================================================
describe('filterEnrichedPermits', () => {
  // fix-22 Mig 3: go_date / product_types / project_tags live on projects.
  const projectsById = new Map<string, Project>([
    [
      'p1',
      makeProject({
        id: 'p1',
        address: '500 Pike St',
        juris: 'Seattle',
        go_date: '2026-04-01',
        product_types: ['SFR'],
        project_tags: ['ECA'],
      }),
    ],
    [
      'p2',
      makeProject({
        id: 'p2',
        address: '750 Oak Way',
        juris: 'Bellevue',
        go_date: '2025-12-01',
        product_types: ['Attached Units'],
        project_tags: ['SIP'],
      }),
    ],
  ]);
  const enriched = enrichPermits(
    [
      makePermit({
        id: 1,
        project_id: 'p1',
        type: 'Building Permit',
        ent_lead: 'Bobby',
        actual_issue: '2026-05-01',
      }),
      makePermit({
        id: 2,
        project_id: 'p2',
        type: 'Demolition',
        ent_lead: 'Miles',
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

  // ── fix-113-a: permit-level status filter (independent of project rollup) ──
  it("fix-113-a: permitStatus='all' is a no-op (default)", () => {
    const out = filterEnrichedPermits(enriched, baseFilters);
    expect(out.map((e) => e.permit.id)).toEqual([1, 2]);
  });

  it("fix-113-a: permitStatus exact-match gate keeps the matching permits regardless of project rollup", () => {
    // Re-enrich with status strings on the permits since the shared fixture
    // doesn't carry status. This proves the filter operates on permit.status
    // directly (no project-side coupling).
    const withStatuses = enrichPermits(
      [
        makePermit({
          id: 1,
          project_id: 'p1',
          type: 'Building Permit',
          status: 'Issued',
          actual_issue: '2026-05-01',
        }),
        makePermit({
          id: 2,
          project_id: 'p2',
          type: 'Demolition',
          status: 'Reviews In Process',
          actual_issue: null,
        }),
      ],
      projectsById,
    );
    expect(
      filterEnrichedPermits(withStatuses, {
        ...baseFilters,
        permitStatus: 'Issued',
      }).map((e) => e.permit.id),
    ).toEqual([1]);
    expect(
      filterEnrichedPermits(withStatuses, {
        ...baseFilters,
        permitStatus: 'Reviews In Process',
      }).map((e) => e.permit.id),
    ).toEqual([2]);
  });

  it("fix-113-a: project + permit filters compose — Active project AND Issued permit", () => {
    // Project p1 is "fully issued" (only permit has actual_issue set);
    // project p2 is "active". Setting Project='active' AND Permit='Reviews
    // In Process' yields p2's Demo. Both gates apply independently.
    const withStatuses = enrichPermits(
      [
        makePermit({
          id: 1,
          project_id: 'p1',
          status: 'Issued',
          actual_issue: '2026-05-01',
        }),
        makePermit({
          id: 2,
          project_id: 'p2',
          status: 'Reviews In Process',
          actual_issue: null,
        }),
      ],
      projectsById,
    );
    expect(
      filterEnrichedPermits(withStatuses, {
        ...baseFilters,
        status: 'active',
        permitStatus: 'Reviews In Process',
      }).map((e) => e.permit.id),
    ).toEqual([2]);
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

  // ── fix-203: null-go_date leak fix ──────────────────────────────────
  // Pre-fix the date gate was `if (from && e.goDate)`, so a permit whose
  // project has NO go_date was never excluded — it leaked into EVERY window
  // (and thus into both the current and comparison Overview cohorts). The fix
  // excludes null-go_date permits whenever a date window is active, matching
  // Trends' filterPermits.
  describe('fix-203: null-go_date exclusion under a window', () => {
    const nullGoProjects = new Map<string, Project>([
      ['p1', makeProject({ id: 'p1', juris: 'Seattle', go_date: '2026-04-01' })],
      // p3 has NO go_date — the leaky straggler.
      ['p3', makeProject({ id: 'p3', juris: 'Seattle', go_date: null })],
    ]);
    const withNullGo = enrichPermits(
      [
        makePermit({ id: 1, project_id: 'p1', type: 'Building Permit' }),
        makePermit({ id: 3, project_id: 'p3', type: 'Building Permit' }),
      ],
      nullGoProjects,
    );

    it('excludes the null-go_date permit when a custom window is active', () => {
      const out = filterEnrichedPermits(withNullGo, {
        ...baseFilters,
        range: 'custom',
        dateFrom: '2026-03-01',
        dateTo: '2026-06-30',
      });
      expect(out.map((e) => e.permit.id)).toEqual([1]);
    });

    it('excludes the null-go_date permit from a NON-overlapping window too (no leak across periods)', () => {
      // p1.go=2026-04-01 is OUT of this comparison window; p3 (null go) must
      // also be OUT — pre-fix it would have leaked in.
      const out = filterEnrichedPermits(withNullGo, {
        ...baseFilters,
        range: 'custom',
        dateFrom: '2025-09-30',
        dateTo: '2025-12-31',
      });
      expect(out.map((e) => e.permit.id)).toEqual([]);
    });

    it("range='all' (no window) keeps the null-go_date permit", () => {
      const out = filterEnrichedPermits(withNullGo, { ...baseFilters, range: 'all' });
      expect(out.map((e) => e.permit.id)).toEqual([1, 3]);
    });
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
  // fix-22 Mig 3: units lives on projects (canonical per-address value).
  const projectsById = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', address: 'Addr 1', juris: 'Seattle', units: 4 })],
    ['p2', makeProject({ id: 'p2', address: 'Addr 2', juris: 'Seattle', units: 3 })],
  ]);

  it('totalPermits + totalUnits across DISTINCT projects (deduped by project_id)', () => {
    const enriched = enrichPermits(
      [
        // Two permits at the same project — units counted once.
        makePermit({ id: 1, project_id: 'p1' }),
        makePermit({ id: 2, project_id: 'p1' }),
        // Different project.
        makePermit({ id: 3, project_id: 'p2' }),
      ],
      projectsById,
    );
    const m = computeMetrics(enriched);
    expect(m.totalPermits).toBe(3);
    expect(m.totalUnits).toBe(7);
  });

  it("fix-113-c: totalUnits dedups by project_id — two projects sharing an address don't collapse", () => {
    // Pre-fix dedup key was the address STRING. Two distinct projects at
    // the same address (e.g., a developer with separate BP and BPMP
    // structures, or a typo like "1500 Pike St" vs "1500 Pike St."),
    // collapsed into one unit count and silently dropped the second
    // project's units. Switched to project_id which is guaranteed unique.
    const sameAddrProjects = new Map<string, Project>([
      ['pA', makeProject({ id: 'pA', address: '1500 Pike St', units: 5 })],
      // Same address string, different project record (test the dedup
      // collision the fix specifically protects against).
      ['pB', makeProject({ id: 'pB', address: '1500 Pike St', units: 3 })],
    ]);
    const enriched = enrichPermits(
      [
        makePermit({ id: 1, project_id: 'pA' }),
        makePermit({ id: 2, project_id: 'pB' }),
      ],
      sameAddrProjects,
    );
    // Both projects contribute their unit counts (5 + 3 = 8).
    expect(computeMetrics(enriched).totalUnits).toBe(8);
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

  // fix-203: sampleSizes — per-metric n, the SAME denominator each average
  // used. The n= label on each Overview card reads from this.
  it('fix-203: empty input → every sampleSize is 0', () => {
    const s = computeMetrics([]).sampleSizes;
    expect(s.totalPermits).toBe(0);
    expect(s.avgPermitTimeline).toBe(0);
    expect(s.avgApprovalToIssue).toBe(0);
    expect(s.avgCityReview).toBe(0);
  });

  it('fix-203: a completion metric n = the count of permits that reached its end date (not the cohort size)', () => {
    // 3 BP permits in the cohort; only ONE has a full intake→approval arc, so
    // Avg Permit Timeline's n must be 1 even though totalPermits is 3 — the
    // maturity bias the n= label is meant to surface.
    const enriched = enrichPermits(
      [
        makePermit({
          id: 1,
          project_id: 'p1',
          approval_date: '2026-05-01',
          permit_cycles: [
            makeCycle({ cycle_index: 0, intake_accepted: '2026-03-01' }),
          ],
        }),
        // No intake_accepted → drops out of the timeline average.
        makePermit({ id: 2, project_id: 'p2', approval_date: '2026-05-01' }),
        // No approval → drops out too.
        makePermit({
          id: 3,
          project_id: 'p1',
          permit_cycles: [
            makeCycle({ cycle_index: 0, intake_accepted: '2026-03-01' }),
          ],
        }),
      ],
      projectsById,
    );
    const m = computeMetrics(enriched);
    expect(m.sampleSizes.totalPermits).toBe(3);
    expect(m.sampleSizes.avgPermitTimeline).toBe(1);
    // n is exactly the average's denominator: avg is non-null iff n > 0.
    expect(m.avgPermitTimeline).not.toBeNull();
  });

  it('fix-203: count-metric sampleSizes equal the counts themselves', () => {
    const enriched = enrichPermits(
      [
        makePermit({ id: 1, project_id: 'p1', actual_issue: '2026-05-01' }),
        makePermit({ id: 2, project_id: 'p2', actual_issue: null }),
      ],
      projectsById,
    );
    const m = computeMetrics(enriched);
    expect(m.sampleSizes.totalPermits).toBe(m.totalPermits);
    expect(m.sampleSizes.issuedCount).toBe(m.issuedCount);
    expect(m.sampleSizes.inCorrections).toBe(m.inCorrections);
  });

  // fix-140-a: NaN regression guard. Bobby reported "Avg Schedule Var = NaN d"
  // when a prod row carried a six-digit-year typo (expected_issue =
  // '202025-11-30'). new Date(...) returns Invalid Date → getTime() = NaN.
  // Pre-fix, daysBetween's NaN slipped through `avg`'s `!== null` filter and
  // poisoned the metric. These tests pin BOTH layers of the fix.
  it('fix-140-a: empty cohort → avgScheduleVariance === null (NaN guard 1/2)', () => {
    const m = computeMetrics([]);
    expect(m.avgScheduleVariance).toBeNull();
    expect(m.avgScheduleVariance).not.toBeNaN();
  });

  it('fix-140-a: mixed cohort (3 permits, 1 with malformed expected_issue) → avg over the 2 valid ones', () => {
    const projectsById = new Map<string, Project>([
      [
        'p1',
        {
          id: 'p1',
          address: '1 Main',
          juris: 'Seattle',
          archived: false,
          notes: null,
        } as Project,
      ],
    ]);
    const permits: PermitWithCycles[] = [
      // Valid: expected 2026-04-01 → approval 2026-04-11 → variance +10d.
      makePermit({
        id: 1,
        project_id: 'p1',
        expected_issue: '2026-04-01',
        approval_date: '2026-04-11',
      }),
      // Valid: expected 2026-04-01 → approval 2026-04-05 → variance +4d.
      makePermit({
        id: 2,
        project_id: 'p1',
        expected_issue: '2026-04-01',
        approval_date: '2026-04-05',
      }),
      // Malformed: 6-digit year typo on expected_issue → daysBetween
      // sees NaN. Pre-fix: this poisoned the avg with NaN. Post-fix:
      // dropped from the cohort silently. Variance avg = (10+4)/2 = 7.
      makePermit({
        id: 3,
        project_id: 'p1',
        expected_issue: '202025-11-30',
        approval_date: '2026-04-05',
      }),
    ];
    const enriched = enrichPermits(permits, projectsById);
    const m = computeMetrics(enriched);
    expect(m.avgScheduleVariance).toBe(7);
    expect(m.avgScheduleVariance).not.toBeNaN();
  });

  it('fix-140-a: all-malformed cohort → variance is null, not NaN (NaN guard 2/2)', () => {
    const projectsById = new Map<string, Project>([
      [
        'p1',
        {
          id: 'p1',
          address: '1 Main',
          juris: 'Seattle',
          archived: false,
          notes: null,
        } as Project,
      ],
    ]);
    const permits: PermitWithCycles[] = [
      makePermit({
        id: 1,
        project_id: 'p1',
        expected_issue: '202025-11-30', // 6-digit year typo
        approval_date: '2026-04-11',
      }),
    ];
    const enriched = enrichPermits(permits, projectsById);
    const m = computeMetrics(enriched);
    expect(m.avgScheduleVariance).toBeNull();
    expect(m.avgScheduleVariance).not.toBeNaN();
  });

  // fix-141: Avg Permit Timeline now reads its OWN field (avgPermitTimeline),
  // split off from avgCityReview. A permit with only a design cycle (c0
  // intake + approval, no review cycles) contributes to the timeline but
  // has zero city-court rounds to sum → avgCityReview is null, avgResponseTime
  // is null. This pins the divergence at the helper level (pre-fix-141 this
  // same fixture produced avgCityReview === 29).
  it('fix-141: c0-only permit → avgPermitTimeline=29, avgCityReview=null, avgResponseTime=null', () => {
    const projectsById = new Map<string, Project>([
      [
        'p1',
        {
          id: 'p1',
          address: '1 Main',
          juris: 'Seattle',
          archived: false,
          notes: null,
        } as Project,
      ],
    ]);
    const permits: PermitWithCycles[] = [
      makePermit({
        id: 1,
        project_id: 'p1',
        approval_date: '2026-04-30',
        permit_cycles: [makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' })],
      }),
    ];
    const enriched = enrichPermits(permits, projectsById);
    const m = computeMetrics(enriched);
    // 29 days between intake (2026-04-01) and approval (2026-04-30).
    expect(m.avgPermitTimeline).toBe(29);
    // No review cycles → no city-court time to measure, no round-trip.
    expect(m.avgCityReview).toBeNull();
    expect(m.avgResponseTime).toBeNull();
  });
});

// ============================================================
// Q9.5.f-fix-4: aggregateByProject — groups EnrichedPermits by project_id
// and rolls up day metrics + key dates + ent/da/dm into ProjectRow.
// ============================================================
describe('aggregateByProject', () => {
  const projectsById = new Map([
    [
      'p1',
      { id: 'p1', address: '500 Pike', juris: 'Seattle', archived: false, notes: null } as Project,
    ],
    [
      'p2',
      { id: 'p2', address: '750 Oak', juris: 'Bellevue', archived: false, notes: null } as Project,
    ],
  ]);

  it('aggregates two permits at same project into one row', () => {
    // fix-22 Mig 3: go_date + units live on the project — single canonical
    // value shared across permits. avgGoToSubmit averages each permit's own
    // first-submitted relative to the SAME project go_date.
    //   Project go_date = 2025-01-01, units = 4.
    //   Permit A first submitted 2025-02-01 → 31 days
    //   Permit B first submitted 2025-04-15 → 104 days
    //   avg = (31 + 104) / 2 = 68 (rounded)
    const localById = new Map<string, Project>([
      [
        'p1',
        makeProject({
          id: 'p1',
          address: '500 Pike',
          juris: 'Seattle',
          go_date: '2025-01-01',
          units: 4,
        }),
      ],
    ]);
    const a = makePermit({
      id: 1,
      project_id: 'p1',
      ent_lead: 'Bobby',
      da: 'Ada',
      dm: 'Dave',
      stage: 'pm',
      permit_cycles: [makeCycle({ submitted: '2025-02-01' })],
    });
    const b = makePermit({
      id: 2,
      project_id: 'p1',
      ent_lead: null,
      da: null,
      dm: null,
      stage: 'co',
      permit_cycles: [makeCycle({ id: 'c2', submitted: '2025-04-15', corr_issued: '2025-05-30' })],
    });
    const enriched = enrichPermits([a, b], localById);
    const rows = aggregateByProject(enriched);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.projectId).toBe('p1');
    expect(row.permitCount).toBe(2);
    expect(row.avgGoToSubmit).toBe(68);
    expect(row.earliestGoDate).toBe('2025-01-01');
    // First non-null person fields — permit A has them; B has nulls.
    expect(row.ent).toBe('Bobby');
    expect(row.da).toBe('Ada');
    expect(row.dm).toBe('Dave');
    // fix-22 Mig 3: units is the project's canonical value.
    expect(row.units).toBe(4);
    expect(row.dominantStage).toBe('co');
    expect(row.maxCorrRounds).toBe(1);
  });

  it('aggregates two permits in different projects into two rows', () => {
    // fix-22 Mig 3: go_date on the project.
    const localById = new Map<string, Project>([
      ['p1', makeProject({ id: 'p1', go_date: '2025-01-01' })],
      ['p2', makeProject({ id: 'p2', go_date: '2025-02-01' })],
    ]);
    const a = makePermit({ id: 1, project_id: 'p1' });
    const b = makePermit({ id: 2, project_id: 'p2' });
    const enriched = enrichPermits([a, b], localById);
    const rows = aggregateByProject(enriched);
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.projectId).sort();
    expect(ids).toEqual(['p1', 'p2']);
  });

  it('activeCount excludes permits with approval_date or actual_issue', () => {
    const active = makePermit({ id: 1, project_id: 'p1' });
    const approved = makePermit({ id: 2, project_id: 'p1', approval_date: '2025-06-01' });
    const issued = makePermit({ id: 3, project_id: 'p1', actual_issue: '2025-07-01' });
    const enriched = enrichPermits([active, approved, issued], projectsById);
    const rows = aggregateByProject(enriched);
    expect(rows[0].permitCount).toBe(3);
    expect(rows[0].activeCount).toBe(1);
    expect(rows[0].earliestApproval).toBe('2025-06-01');
    expect(rows[0].earliestActualIssue).toBe('2025-07-01');
  });

  it('null metrics across all permits → null aggregates, not NaN', () => {
    // fix-22 Mig 3: go_date on project; default null.
    const a = makePermit({ id: 1, project_id: 'p1' });
    const enriched = enrichPermits([a], projectsById);
    const rows = aggregateByProject(enriched);
    expect(rows[0].avgGoToSubmit).toBeNull();
    expect(rows[0].avgDDDuration).toBeNull();
    expect(rows[0].avgCityReview).toBeNull();
    expect(rows[0].earliestGoDate).toBeNull();
    expect(rows[0].units).toBeNull();
  });

  it('dominantStage follows the Building Permit even when a sibling is more advanced', () => {
    // Q9.5.f-fix-14: a project with BP at 'de' but a PAR/Pre-Sub at 'is'
    // should still surface as 'D&E' — the BP is what gates everything,
    // an early sibling reaching issuance doesn't make the project issued.
    const bp = makePermit({
      id: 1,
      project_id: 'p1',
      type: 'Building Permit',
      stage: 'de',
    });
    const par = makePermit({
      id: 2,
      project_id: 'p1',
      type: 'PAR',
      stage: 'is',
      actual_issue: '2025-09-01',
    });
    const enriched = enrichPermits([bp, par], projectsById);
    const rows = aggregateByProject(enriched);
    expect(rows[0].dominantStage).toBe('de');
  });

  it('dominantStage falls back to most-advanced when no BP exists', () => {
    // PAR-only project — BP filter empty → falls back to pool of all permits.
    const par = makePermit({ id: 1, project_id: 'p1', type: 'PAR', stage: 'co' });
    const enriched = enrichPermits([par], projectsById);
    const rows = aggregateByProject(enriched);
    expect(rows[0].dominantStage).toBe('co');
  });

  it('latestAcqTarget takes the max expected_issue across permits', () => {
    const a = makePermit({ id: 1, project_id: 'p1', expected_issue: '2025-05-01' });
    const b = makePermit({ id: 2, project_id: 'p1', expected_issue: '2025-08-15' });
    const c = makePermit({ id: 3, project_id: 'p1', expected_issue: null });
    const enriched = enrichPermits([a, b, c], projectsById);
    const rows = aggregateByProject(enriched);
    expect(rows[0].latestAcqTarget).toBe('2025-08-15');
  });
});

// ============================================================
// fix-141: City Review redefinition (sum-over-cycles city-court time) +
// Avg Response Time (sum-over-cycles our-court time). Per the auto-derivation
// rule c1.submitted = c0.intake_accepted, so every fixture stamps c0 with the
// intake date matching c1.submitted. City + Response telescopes into the
// Permit Timeline (intake → approval) whenever both are non-null.
// ============================================================
describe('fix-141 City Review redefinition + Response Time', () => {
  const projectsById = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', juris: 'Seattle', units: 1 })],
  ]);

  // Case #1: 1 review cycle, no corrections, approved cleanly.
  //   c0 intake = c1 submitted = 2026-04-01; approval 2026-04-30.
  function permit1Clean(id = 1): PermitWithCycles {
    return makePermit({
      id,
      project_id: 'p1',
      approval_date: '2026-04-30',
      permit_cycles: [
        makeCycle({ id: `${id}-c0`, cycle_index: 0, intake_accepted: '2026-04-01' }),
        makeCycle({ id: `${id}-c1`, cycle_index: 1, submitted: '2026-04-01' }),
      ],
    });
  }

  // Case #2: 2 cycles, full round-trip, approved on cycle 2.
  //   c1 2026-04-01 → corr 2026-04-15; c2 2026-04-20 → approval 2026-04-30.
  function permit2Roundtrip(id = 2): PermitWithCycles {
    return makePermit({
      id,
      project_id: 'p1',
      approval_date: '2026-04-30',
      permit_cycles: [
        makeCycle({ id: `${id}-c0`, cycle_index: 0, intake_accepted: '2026-04-01' }),
        makeCycle({
          id: `${id}-c1`,
          cycle_index: 1,
          submitted: '2026-04-01',
          corr_issued: '2026-04-15',
        }),
        makeCycle({ id: `${id}-c2`, cycle_index: 2, submitted: '2026-04-20' }),
      ],
    });
  }

  // Case #3: 3 cycles.
  //   c1 4/1 → corr 4/15; c2 4/20 → corr 4/29; c3 5/3 → approval 5/10.
  function permit3ThreeCycles(id = 3): PermitWithCycles {
    return makePermit({
      id,
      project_id: 'p1',
      approval_date: '2026-05-10',
      permit_cycles: [
        makeCycle({ id: `${id}-c0`, cycle_index: 0, intake_accepted: '2026-04-01' }),
        makeCycle({
          id: `${id}-c1`,
          cycle_index: 1,
          submitted: '2026-04-01',
          corr_issued: '2026-04-15',
        }),
        makeCycle({
          id: `${id}-c2`,
          cycle_index: 2,
          submitted: '2026-04-20',
          corr_issued: '2026-04-29',
        }),
        makeCycle({ id: `${id}-c3`, cycle_index: 3, submitted: '2026-05-03' }),
      ],
    });
  }

  // Case #4: 2 cycles, ongoing — no corr_issued anywhere, no approval.
  function permit4Ongoing(id = 4): PermitWithCycles {
    return makePermit({
      id,
      project_id: 'p1',
      approval_date: null,
      permit_cycles: [
        makeCycle({ id: `${id}-c0`, cycle_index: 0, intake_accepted: '2026-04-01' }),
        makeCycle({ id: `${id}-c1`, cycle_index: 1, submitted: '2026-04-01' }),
        makeCycle({ id: `${id}-c2`, cycle_index: 2, submitted: '2026-04-20' }),
      ],
    });
  }

  function metricsFor(permit: PermitWithCycles) {
    return computeMetrics(enrichPermits([permit], projectsById));
  }

  it('case 1: clean single cycle → City=29, Response=null, Timeline=29', () => {
    const m = metricsFor(permit1Clean());
    expect(m.avgCityReview).toBe(29); // cycle 1 anchors to approval_date
    expect(m.avgResponseTime).toBeNull(); // no round-trip
    expect(m.avgPermitTimeline).toBe(29);
  });

  it('case 2: full round-trip over 2 cycles → City=24, Response=5, Timeline=29', () => {
    const m = metricsFor(permit2Roundtrip());
    expect(m.avgCityReview).toBe(24); // 14 (c1) + 10 (c2 → approval)
    expect(m.avgResponseTime).toBe(5); // c1.corr_issued → c2.submitted
    expect(m.avgPermitTimeline).toBe(29);
  });

  it('case 3: three cycles → City=30, Response=9, Timeline=39', () => {
    const m = metricsFor(permit3ThreeCycles());
    expect(m.avgCityReview).toBe(30); // 14 + 9 + 7
    expect(m.avgResponseTime).toBe(9); // 5 + 4
    expect(m.avgPermitTimeline).toBe(39);
  });

  it('case 4: ongoing (no corr, no approval) → all three null', () => {
    const m = metricsFor(permit4Ongoing());
    expect(m.avgCityReview).toBeNull();
    expect(m.avgResponseTime).toBeNull();
    expect(m.avgPermitTimeline).toBeNull();
  });

  it('case 5: cohort of #1/#2/#3 → City=28, Response=7 (#1 excluded), Timeline=32', () => {
    const enriched = enrichPermits(
      [permit1Clean(1), permit2Roundtrip(2), permit3ThreeCycles(3)],
      projectsById,
    );
    const m = computeMetrics(enriched);
    // (29 + 24 + 30) / 3 = 27.67 → 28
    expect(m.avgCityReview).toBe(28);
    // (5 + 9) / 2 = 7 — permit #1 has no round-trip, excluded from cohort.
    expect(m.avgResponseTime).toBe(7);
    // (29 + 29 + 39) / 3 = 32.33 → 32
    expect(m.avgPermitTimeline).toBe(32);
  });

  it('case 6: convergence invariant — cityReview + responseTime = permitTimeline', () => {
    // Pin on case #2 (a representative permit where both are non-null).
    const m = metricsFor(permit2Roundtrip());
    expect(m.avgCityReview).not.toBeNull();
    expect(m.avgResponseTime).not.toBeNull();
    expect(m.avgPermitTimeline).not.toBeNull();
    expect((m.avgCityReview ?? 0) + (m.avgResponseTime ?? 0)).toBe(
      m.avgPermitTimeline,
    );
  });
});

// fix-171 (On-Hold Phase 2, effect B): turnaround tiles subtract held days.
import {
  cityCourtTimeDays,
  responseCourtTimeDays,
} from '../lib/reportMetrics';
import type { ProjectHold } from '../lib/database.types';

function hold(start: string, end: string | null): ProjectHold {
  return {
    id: `h-${start}`,
    tenant_id: 't1',
    project_id: 'p1',
    reason: 'MHA',
    note: null,
    hold_start: start,
    hold_end: end,
    created_by: null,
    created_at: '',
    updated_at: '',
  };
}

describe('fix-171 effect B — held days subtracted from turnaround tiles', () => {
  it('cityCourtTimeDays: a hold inside the review window reduces the city-court time', () => {
    const p = makePermit({
      permit_cycles: [makeCycle({ cycle_index: 1, submitted: '2026-03-01', corr_issued: '2026-04-01' })],
    });
    expect(cityCourtTimeDays(p)).toBe(31); // raw
    // hold 2026-03-10..2026-03-20 = 10 held days inside the window
    expect(cityCourtTimeDays(p, [hold('2026-03-10', '2026-03-20')])).toBe(21);
  });

  it('responseCourtTimeDays: a hold during our response window reduces our time', () => {
    const p = makePermit({
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-04-01' }),
        makeCycle({ id: 'c2', cycle_index: 2, submitted: '2026-05-01' }),
      ],
    });
    expect(responseCourtTimeDays(p)).toBe(30); // 2026-04-01 → 2026-05-01
    // held 2026-04-10..2026-04-20 = 10 days
    expect(responseCourtTimeDays(p, [hold('2026-04-10', '2026-04-20')])).toBe(20);
  });

  it('no holds → byte-identical (the common case)', () => {
    const p = makePermit({
      permit_cycles: [makeCycle({ cycle_index: 1, submitted: '2026-03-01', corr_issued: '2026-04-01' })],
    });
    expect(cityCourtTimeDays(p, [])).toBe(cityCourtTimeDays(p));
    expect(cityCourtTimeDays(p, undefined)).toBe(31);
  });

  it('computeMetrics threads holdsByProjectId into the City Review / Response tiles', () => {
    const p = makePermit({
      permit_cycles: [
        makeCycle({ cycle_index: 1, submitted: '2026-02-01', corr_issued: '2026-04-01' }),
        makeCycle({ id: 'c2', cycle_index: 2, submitted: '2026-05-01' }),
      ],
    });
    const projectsById = new Map([['p1', makeProject({ id: 'p1' })]]);
    const enriched = enrichPermits([p], projectsById);
    const holdsMap = new Map([['p1', [hold('2026-04-10', '2026-04-20')]]]);
    const without = computeMetrics(enriched);
    const withHold = computeMetrics(enriched, holdsMap);
    // Response time (our court) drops by the 10 held days; no-hold reference holds.
    expect(without.avgResponseTime).toBe(30);
    expect(withHold.avgResponseTime).toBe(20);
  });
});

// fix-173: Avg Approval → Issue (approval_date → actual_issue), hold-aware.
describe('fix-173 avgApprovalToIssue', () => {
  const projectsById = new Map([['p1', makeProject({ id: 'p1' })]]);

  it('averages actual_issue − approval_date across the cohort', () => {
    const permits = [
      makePermit({ id: 1, project_id: 'p1', approval_date: '2026-06-01', actual_issue: '2026-06-15' }), // 14
      makePermit({ id: 2, project_id: 'p1', approval_date: '2026-06-01', actual_issue: '2026-06-11' }), // 10
    ];
    const m = computeMetrics(enrichPermits(permits, projectsById));
    expect(m.avgApprovalToIssue).toBe(12); // (14 + 10) / 2
  });

  it("a held permit's value drops by the held days; no-hold unchanged", () => {
    const permits = [
      makePermit({ id: 1, project_id: 'p1', approval_date: '2026-06-01', actual_issue: '2026-06-15' }), // 14 raw
    ];
    const enriched = enrichPermits(permits, projectsById);
    expect(computeMetrics(enriched).avgApprovalToIssue).toBe(14);
    // hold 2026-06-03..2026-06-08 = 5 held days inside the window → 9
    const holdsMap = new Map([['p1', [hold('2026-06-03', '2026-06-08')]]]);
    expect(
      computeMetrics(enrichPermits(permits, projectsById, holdsMap), holdsMap).avgApprovalToIssue,
    ).toBe(9);
    // empty map → identical
    expect(computeMetrics(enrichPermits(permits, projectsById, new Map()), new Map()).avgApprovalToIssue).toBe(14);
  });

  it('excludes permits missing approval_date or actual_issue', () => {
    const permits = [
      makePermit({ id: 1, project_id: 'p1', approval_date: '2026-06-01', actual_issue: null }), // excluded
      makePermit({ id: 2, project_id: 'p1', approval_date: null, actual_issue: '2026-06-15' }), // excluded
    ];
    expect(computeMetrics(enrichPermits(permits, projectsById)).avgApprovalToIssue).toBeNull();
  });
});
