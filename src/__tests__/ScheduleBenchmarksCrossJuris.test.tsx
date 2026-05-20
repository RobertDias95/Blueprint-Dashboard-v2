import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScheduleBenchmarks from '../components/Reports/ScheduleBenchmarks';
import type { PermitCycle, PermitWithCycles, Project } from '../lib/database.types';

// fix-35 Bug 4: the schedule learner falls back to (type, *) cross-juris
// samples when a jurisdiction has no own-type approved permits. Before
// fix-35 the UI showed those numbers with no indication. BenchmarkCard now
// renders a CROSS-JURIS badge when estimate.isCrossJuris === true. The flag
// logic itself is covered in scheduleBenchmarks.test.ts; these tests assert
// the badge surfaces (and only surfaces) for cross-juris cards.

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

/** Approved BP with c0 intake + c1 review — a valid learner sample. */
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

describe('ScheduleBenchmarks — fix-35 Bug 4 cross-juris badge', () => {
  // 3 approved Seattle BPs form the cross-juris pool. One UNAPPROVED Bellevue
  // BP makes (BP, Bellevue) a combo with zero own samples → the learner falls
  // back to the Seattle pool and flags isCrossJuris.
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

  it('renders CROSS-JURIS on the Bellevue card (no own-type samples)', () => {
    render(<ScheduleBenchmarks permits={permits} projects={projects} />);
    const badge = screen.getByTestId(
      'benchmark-card-crossjuris-Building Permit-Bellevue',
    );
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('CROSS-JURIS');
    expect(badge.getAttribute('title')).toContain('all jurisdictions');
  });

  it('does NOT render CROSS-JURIS on the Seattle card (juris-specific samples)', () => {
    render(<ScheduleBenchmarks permits={permits} projects={projects} />);
    // The Seattle card itself renders …
    expect(
      screen.getByTestId('benchmark-card-Building Permit-Seattle'),
    ).toBeInTheDocument();
    // … but without the cross-juris badge.
    expect(
      screen.queryByTestId('benchmark-card-crossjuris-Building Permit-Seattle'),
    ).toBeNull();
  });
});
