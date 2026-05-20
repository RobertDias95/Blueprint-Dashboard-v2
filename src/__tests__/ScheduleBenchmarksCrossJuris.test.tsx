import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScheduleBenchmarks, {
  BenchmarkCard,
} from '../components/Reports/ScheduleBenchmarks';
import { SCHEDULE_DEFAULTS, type LearnedEstimate } from '../lib/scheduleBenchmarks';
import type { PermitCycle, PermitWithCycles, Project } from '../lib/database.types';

// fix-35 added a CROSS-JURIS badge on BenchmarkCard when an estimate came
// from the (type, *) cross-juris fallback. fix-37 removes that fallback, so
// no live cascade ever sets isCrossJuris=true anymore — Bellevue/Phoenix with
// no own data now fall to the per-type default and show no badge.
//
// We keep two things:
//  1. The component contract — the badge still renders WHEN isCrossJuris=true
//     (so a future re-introduction of cross-juris keeps working).
//  2. A fix-37 regression — a real Bellevue cohort with no own data yields no
//     CROSS-JURIS badge.

function mkEstimate(over: Partial<LearnedEstimate> = {}): LearnedEstimate {
  return {
    source: 'test',
    sampleCount: 3,
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
    recencyTier: 'last_180d',
    ...over,
  };
}

describe('BenchmarkCard — CROSS-JURIS badge component contract', () => {
  it('renders the badge when isCrossJuris=true', () => {
    render(
      <BenchmarkCard
        type="Building Permit"
        juris="Bellevue"
        count={3}
        estimate={mkEstimate({ isCrossJuris: true })}
        onSelect={() => {}}
      />,
    );
    const badge = screen.getByTestId(
      'benchmark-card-crossjuris-Building Permit-Bellevue',
    );
    expect(badge.textContent).toBe('CROSS-JURIS');
    expect(badge.getAttribute('title')).toContain('all jurisdictions');
  });

  it('does not render the badge when isCrossJuris=false', () => {
    render(
      <BenchmarkCard
        type="Building Permit"
        juris="Seattle"
        count={3}
        estimate={mkEstimate({ isCrossJuris: false })}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.queryByTestId('benchmark-card-crossjuris-Building Permit-Seattle'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fix-37 regression — real cohorts never produce the badge anymore
// ---------------------------------------------------------------------------

function makeCycle(
  over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>,
): PermitCycle {
  return {
    id: `c-${over.cycle_index}`,
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

function makeProject(over: Partial<Project> & Pick<Project, 'id'>): Project {
  return {
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...over,
  };
}

function approvedBP(args: {
  id: number;
  projectId: string;
  intake: string;
  submitted: string;
  corrIssued: string;
  approval: string;
}): PermitWithCycles {
  return makePermit({
    id: args.id,
    project_id: args.projectId,
    approval_date: args.approval,
    permit_cycles: [
      makeCycle({ cycle_index: 0, intake_accepted: args.intake }),
      makeCycle({
        cycle_index: 1,
        submitted: args.submitted,
        corr_issued: args.corrIssued,
      }),
    ],
  });
}

describe('ScheduleBenchmarks — fix-37 no cross-juris fallback', () => {
  // 3 approved Seattle BPs + one Bellevue BP. Pre-fix-37 the Bellevue card
  // borrowed Seattle's numbers and showed CROSS-JURIS. Now Bellevue has no
  // own data → no learned estimate → no badge anywhere.
  const permits: PermitWithCycles[] = [
    approvedBP({ id: 1, projectId: 'p1', intake: '2026-02-01', submitted: '2026-02-01', corrIssued: '2026-03-01', approval: '2026-05-01' }),
    approvedBP({ id: 2, projectId: 'p2', intake: '2026-02-05', submitted: '2026-02-05', corrIssued: '2026-03-05', approval: '2026-05-05' }),
    approvedBP({ id: 3, projectId: 'p3', intake: '2026-02-10', submitted: '2026-02-10', corrIssued: '2026-03-10', approval: '2026-05-10' }),
    makePermit({ id: 4, project_id: 'pBV', approval_date: null, actual_issue: null }),
  ];
  const projects: Project[] = [
    makeProject({ id: 'p1', juris: 'Seattle' }),
    makeProject({ id: 'p2', juris: 'Seattle' }),
    makeProject({ id: 'p3', juris: 'Seattle' }),
    makeProject({ id: 'pBV', juris: 'Bellevue' }),
  ];

  it('Bellevue (no own data) shows no CROSS-JURIS badge', () => {
    render(<ScheduleBenchmarks permits={permits} projects={projects} />);
    expect(
      screen.getByTestId('benchmark-card-Building Permit-Bellevue'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('benchmark-card-crossjuris-Building Permit-Bellevue'),
    ).toBeNull();
  });

  it('Seattle (own data) still renders its card with no cross-juris badge', () => {
    render(<ScheduleBenchmarks permits={permits} projects={projects} />);
    expect(
      screen.getByTestId('benchmark-card-Building Permit-Seattle'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('benchmark-card-crossjuris-Building Permit-Seattle'),
    ).toBeNull();
  });
});
