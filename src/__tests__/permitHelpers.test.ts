import { describe, it, expect } from 'vitest';
import {
  getHighlightedMilestone,
  isMilestoneHighlighted,
  type HighlightTarget,
} from '../lib/permitHelpers';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// fix-23c B: tests for the latest-populated highlight selector. Every
// case from Bobby's spec is pinned plus a few sanity checks for the
// equality helper.

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
    updated_at: '2026-05-14T12:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

function cycle(over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>): PermitCycle {
  return {
    id: `c-${over.cycle_index}`,
    permit_id: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-05-14T12:00:00Z',
    updated_at: '2026-05-14T12:00:00Z',
    ...over,
  };
}

describe('getHighlightedMilestone', () => {
  it('empty permit (no cycles, no dates) → falls back to target_submit', () => {
    const target = getHighlightedMilestone(makePermit());
    expect(target).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('only target_submit set → target_submit (it is the anticipated next milestone)', () => {
    const target = getHighlightedMilestone(
      makePermit({ target_submit: '2026-06-01' }),
    );
    expect(target).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('cycle 0 submitted only → that cycle 0 submitted is the latest populated', () => {
    const target = getHighlightedMilestone(
      makePermit({
        target_submit: '2026-06-01',
        permit_cycles: [
          cycle({ cycle_index: 0, submitted: '2026-06-10' }),
        ],
      }),
    );
    expect(target).toEqual({ kind: 'cycle', cycleIndex: 0, key: 'submitted' });
  });

  it('cycle 0 fully filled, no cycle 1 → cycle 0 intake_accepted (latest within cycle)', () => {
    const target = getHighlightedMilestone(
      makePermit({
        target_submit: '2026-06-01',
        permit_cycles: [
          cycle({
            cycle_index: 0,
            submitted: '2026-06-10',
            corr_issued: '2026-07-01',
            resubmitted: '2026-07-15',
            intake_accepted: '2026-07-20',
          }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 0,
      key: 'intake_accepted',
    });
  });

  it('cycle 0 fully filled + cycle 1 submitted → cycle 1 submitted wins (snap target)', () => {
    // This is the exact case Bobby calls out in the spec: after the
    // intake_accepted snap on cycle 0 auto-creates cycle 1 with
    // submitted=intake_accepted, the highlight lands on cycle 1's
    // submitted because cycle 1 has a higher index AND a populated date.
    const target = getHighlightedMilestone(
      makePermit({
        target_submit: '2026-06-01',
        permit_cycles: [
          cycle({
            cycle_index: 0,
            submitted: '2026-06-10',
            corr_issued: '2026-07-01',
            resubmitted: '2026-07-15',
            intake_accepted: '2026-07-20',
          }),
          // Snap auto-created this row.
          cycle({ cycle_index: 1, submitted: '2026-07-20' }),
        ],
      }),
    );
    expect(target).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'submitted' });
  });

  it('actual_issue populated → highlights actual_issue regardless of cycles', () => {
    const target = getHighlightedMilestone(
      makePermit({
        actual_issue: '2026-09-01',
        approval_date: '2026-08-15',
        target_submit: '2026-06-01',
        permit_cycles: [
          cycle({ cycle_index: 1, submitted: '2026-06-10', intake_accepted: '2026-06-15' }),
        ],
      }),
    );
    expect(target).toEqual({ kind: 'permit', key: 'actual_issue' });
  });

  it('approval_date populated without actual_issue → highlights approval_date', () => {
    const target = getHighlightedMilestone(
      makePermit({
        approval_date: '2026-08-15',
        permit_cycles: [
          cycle({ cycle_index: 1, submitted: '2026-06-10' }),
        ],
      }),
    );
    expect(target).toEqual({ kind: 'permit', key: 'approval_date' });
  });

  it('within a cycle: intake_accepted beats resubmitted beats corr_issued beats submitted', () => {
    // submit + corr_issued, no resub yet → corr_issued
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({
              cycle_index: 1,
              submitted: '2026-06-10',
              corr_issued: '2026-07-01',
            }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'corr_issued' });
    // resubmitted but no intake yet → resubmitted
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({
              cycle_index: 1,
              submitted: '2026-06-10',
              corr_issued: '2026-07-01',
              resubmitted: '2026-07-10',
            }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'resubmitted' });
  });

  it('city_target does NOT contribute to the highlight chain', () => {
    // Bobby's rule (decided 2026-05-14): city_target tracks a city-
    // scheduled review date but does not advance the permit's milestone.
    // A cycle with submitted + city_target only should still highlight
    // on submitted.
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-06-10',
            city_target: '2026-08-01',
          }),
        ],
      }),
    );
    expect(target).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'submitted' });
  });
});

describe('isMilestoneHighlighted', () => {
  const cellCycle1Submitted: HighlightTarget = {
    kind: 'cycle',
    cycleIndex: 1,
    key: 'submitted',
  };
  const cellCycle1Intake: HighlightTarget = {
    kind: 'cycle',
    cycleIndex: 1,
    key: 'intake_accepted',
  };
  const cellCycle2Submitted: HighlightTarget = {
    kind: 'cycle',
    cycleIndex: 2,
    key: 'submitted',
  };
  const cellTargetSubmit: HighlightTarget = {
    kind: 'permit',
    key: 'target_submit',
  };

  it('returns true only for the exact identity match', () => {
    expect(isMilestoneHighlighted(cellCycle1Submitted, cellCycle1Submitted)).toBe(true);
    expect(isMilestoneHighlighted(cellCycle1Submitted, cellCycle1Intake)).toBe(false);
    expect(isMilestoneHighlighted(cellCycle1Submitted, cellCycle2Submitted)).toBe(false);
    expect(isMilestoneHighlighted(cellCycle1Submitted, cellTargetSubmit)).toBe(false);
  });

  it('handles permit-kind vs cycle-kind disjointness', () => {
    const aPermit: HighlightTarget = { kind: 'permit', key: 'actual_issue' };
    const aCycle: HighlightTarget = { kind: 'cycle', cycleIndex: 0, key: 'submitted' };
    expect(isMilestoneHighlighted(aPermit, aCycle)).toBe(false);
    expect(isMilestoneHighlighted(aCycle, aPermit)).toBe(false);
  });
});
