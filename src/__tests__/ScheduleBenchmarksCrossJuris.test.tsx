import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScheduleBenchmarks from '../components/Reports/ScheduleBenchmarks';
import type { PermitCycle, PermitWithCycles, Project } from '../lib/database.types';

// fix-37 removed the (type, *) cross-juris fallback from the learner;
// computeLearnedSchedule no longer borrows another juris's data when a
// jurisdiction has none of its own. fix-113-c then ripped the now-dead
// CROSS-JURIS badge branch out of BenchmarkCard.
//
// This file is the regression test for that combined behavior: a real
// cohort with a single juris having no own samples should produce no
// CROSS-JURIS badge anywhere in the rendered Schedule Benchmarks.
//
// The prior "component contract" assertions (badge renders when
// isCrossJuris=true) tested a branch that no longer exists in JSX. They
// were testing dead code and have been removed.

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

describe('ScheduleBenchmarks — no CROSS-JURIS badge ever (fix-37 + fix-113-c)', () => {
  // 3 approved Seattle BPs + one Bellevue BP. Pre-fix-37 the Bellevue card
  // borrowed Seattle's numbers and showed CROSS-JURIS. Post-fix-37 Bellevue
  // gets the per-type default with no badge. Post-fix-113-c the badge
  // element has been removed from BenchmarkCard entirely, so even if a
  // future regression set isCrossJuris=true it could not render.
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

  it('Seattle (own data) renders its card with no cross-juris badge', () => {
    render(<ScheduleBenchmarks permits={permits} projects={projects} />);
    expect(
      screen.getByTestId('benchmark-card-Building Permit-Seattle'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('benchmark-card-crossjuris-Building Permit-Seattle'),
    ).toBeNull();
  });

  it('the entire rendered surface contains no "CROSS-JURIS" string', () => {
    // fix-113-c structural guarantee: the badge element is gone. This is a
    // belt-and-suspenders check against a future regression that re-adds the
    // branch but skips updating the per-card testid above.
    const { container } = render(
      <ScheduleBenchmarks permits={permits} projects={projects} />,
    );
    expect(container.textContent).not.toMatch(/CROSS-JURIS/);
  });
});
