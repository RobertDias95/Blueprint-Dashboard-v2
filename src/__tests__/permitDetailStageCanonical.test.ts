import { describe, it, expect } from 'vitest';
import { effectiveStage } from '../lib/permitStage';
import { derivePermitStatus } from '../lib/permitStatus';
import type {
  Permit,
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
} from '../lib/database.types';

// fix-188: the permit DETAIL pane (PermitDetailV2) must compute its stage with
// the SAME canonical inputs the Permits sidebar (fix-104) + Schedule Health use
// — the permit's FULL cycles AND its reviewer rows. Pre-fix it called
// effectiveStage(permit, cyclesWithoutCycle0) with NO reviewers, so for an MPB
// (Pending/Applied) permit it fell through to computeStage and could read
// "Corrections" off a cycle's corr_issued while an in-progress reviewer should
// keep it under review — disagreeing with every other surface.

function cyc(o: Partial<PermitCycle> & { cycle_index: number }): PermitCycle {
  return {
    id: `c-${o.cycle_index}`,
    permit_id: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '',
    updated_at: '',
    ...o,
  };
}
function rev(
  discipline: string,
  current_status: PermitCycleReviewer['current_status'],
  cycle_index = 1,
): PermitCycleReviewer {
  return {
    id: `r-${discipline}-${cycle_index}`,
    tenant_id: 't',
    permit_id: 1,
    cycle_index,
    reviewer_name: discipline,
    discipline,
    current_status,
    last_event_date: null,
    created_at: '',
    updated_at: '',
  };
}
function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1, project_id: 'p', type: 'Demolition', stage: 'de', stage_override: null,
    status: 'Applied', num: 'BLD2026-0536', da: null, dm: null, ent_lead: null,
    dual_da: null, target_submit: null, dd_start: null, dd_end: null,
    expected_issue: null, actual_issue: null, approval_date: null, intake_date: null,
    notes: null, cycle_model: null, view_cycle: null, kickoff_date: null,
    corr_rounds: 0, permit_owner: null, architect: null, nickname: null,
    struct_address: null, portal_url: null,
    ...over,
  } as Permit;
}

// Exactly BLD2026-0536: only review cycle (1) has NO corr_issued; Trees in_review.
const demoCycles: PermitCycle[] = [
  cyc({ cycle_index: 0, submitted: '2026-04-30', intake_accepted: '2026-05-01' }),
  cyc({ cycle_index: 1, submitted: '2026-04-30', city_target: '2026-06-22' }),
];
const demoReviewers: PermitCycleReviewer[] = [
  rev('engineering', 'corrections_required'),
  rev('planning', 'corrections_required'),
  rev('trees', 'in_review'),
];

describe('fix-188 BLD2026-0536 — canonical stage is under review', () => {
  it('effectiveStage with reviewers → pm (the sidebar + Schedule Health path)', () => {
    expect(effectiveStage(permit(), demoCycles, demoReviewers)).toBe('pm');
  });

  it('derivePermitStatus → City Target (Cycle 1), NOT a corrections label', () => {
    const p = { ...permit(), permit_cycles: demoCycles } as PermitWithCycles;
    const r = derivePermitStatus(p, demoReviewers);
    expect(r.label).toBe('City Target (Cycle 1)');
    expect(r.label).not.toMatch(/Corr/i);
  });

  it('demo has no corr_issued, so it reads pm even WITHOUT reviewers (no flip here)', () => {
    // The demo doesn't trigger the divergence (no corr_issued); both paths agree.
    expect(effectiveStage(permit(), demoCycles)).toBe('pm');
  });
});

describe('fix-188 divergence — why the detail pane must pass reviewers', () => {
  // A permit whose latest cycle HAS corr_issued (computeStage → co) but an
  // in-progress reviewer on the current cycle (canonical verdict → in_review).
  const cycles: PermitCycle[] = [
    cyc({ cycle_index: 0, submitted: '2026-04-30', intake_accepted: '2026-05-01' }),
    cyc({ cycle_index: 1, submitted: '2026-04-30', corr_issued: '2026-05-20' }),
  ];
  const reviewers: PermitCycleReviewer[] = [
    rev('engineering', 'corrections_required'),
    rev('trees', 'in_review'),
  ];

  it('WITHOUT reviewers (pre-fix detail pane) → co (corrections)', () => {
    expect(effectiveStage(permit(), cycles)).toBe('co');
  });

  it('WITH reviewers (canonical, post-fix detail pane) → pm (under review)', () => {
    // Trees still in_review → round not complete → under review, matching the
    // sidebar + Schedule Health. This is the inconsistency fix-188 removes.
    expect(effectiveStage(permit(), cycles, reviewers)).toBe('pm');
  });

  it('genuinely in corrections (corr_issued + all reviewers acted) → co on BOTH paths', () => {
    const acted: PermitCycleReviewer[] = [
      rev('engineering', 'corrections_required'),
      rev('trees', 'corrections_required'),
    ];
    expect(effectiveStage(permit(), cycles)).toBe('co');
    expect(effectiveStage(permit(), cycles, acted)).toBe('co');
  });
});
