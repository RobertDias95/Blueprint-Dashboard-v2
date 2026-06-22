import { describe, it, expect } from 'vitest';
import { buildProjectRows } from '../lib/projectViewHelpers';
import type {
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-186: the Project View reviewer cell follows the permit's CURRENT cycle
// (from permit_cycles), not the latest reviewer-ROW cycle. When the current
// cycle has no reviewer rows yet but an earlier cycle does, the helper flags
// awaitingCurrentCycle so the cell reads "Cycle N — not yet assigned".

function cyc(cycle_index: number): PermitCycle {
  return {
    id: `c-${cycle_index}`,
    permit_id: 1,
    cycle_index,
    submitted: '2026-04-01',
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function permit(cycles: PermitCycle[]): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: 'Applied',
    num: 'BP-1',
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
    permit_cycles: cycles,
  } as PermitWithCycles;
}

const project: Project = {
  id: 'p1',
  address: '224 2nd Ave N',
  juris: 'Edmonds',
  archived: false,
  notes: null,
} as Project;

function reviewer(
  current_status: PermitCycleReviewer['current_status'],
  cycle_index: number,
  name: string = current_status,
): PermitCycleReviewer {
  return {
    id: `r-${name}-${cycle_index}`,
    tenant_id: 't',
    permit_id: 1,
    cycle_index,
    reviewer_name: name,
    discipline: null,
    current_status,
    last_event_date: null,
    created_at: '',
    updated_at: '',
  };
}

function reviewerCell(reviewers: PermitCycleReviewer[], cycles: PermitCycle[]) {
  const rows = buildProjectRows([project], [permit(cycles)], reviewers);
  return rows[0].permits[0].reviewer;
}

describe('buildProjectRows — reviewer cell follows the current cycle (fix-186)', () => {
  it('current cycle has reviewers → counts from the current cycle', () => {
    const r = reviewerCell(
      [reviewer('corrections_required', 1), reviewer('approved', 2)],
      [cyc(0), cyc(1), cyc(2)],
    );
    expect(r.cycleIndex).toBe(2);
    expect(r.total).toBe(1);
    expect(r.approved).toBe(1);
    expect(r.correctionsRequired).toBe(0);
    expect(r.awaitingCurrentCycle).toBe(false);
  });

  it('current cycle has NO reviewer rows but an earlier cycle does → awaitingCurrentCycle', () => {
    const r = reviewerCell(
      [reviewer('corrections_required', 1), reviewer('approved', 1, 'a2')],
      [cyc(0), cyc(1), cyc(2)],
    );
    expect(r.total).toBe(0);
    expect(r.cycleIndex).toBe(2);
    expect(r.awaitingCurrentCycle).toBe(true);
  });

  it('no reviewer rows at all → not awaiting (plain "no reviewers")', () => {
    const r = reviewerCell([], [cyc(0), cyc(1)]);
    expect(r.total).toBe(0);
    expect(r.awaitingCurrentCycle).toBe(false);
  });
});
