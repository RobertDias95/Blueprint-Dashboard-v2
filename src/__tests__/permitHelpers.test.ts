import { describe, it, expect } from 'vitest';
import {
  getHighlightedMilestone,
  isMilestoneHighlighted,
  type HighlightTarget,
} from '../lib/permitHelpers';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// fix-24c-2: tests for the "events beat forecasts, walk cycles DESC" rule.
//   1. actual_issue → highlight
//   2. approval_date → highlight
//   3. Walk cycles DESC. For each cycle:
//      - any of {submitted, corr_issued, resubmitted, intake_accepted}? →
//        latest by date wins (chain priority tiebreak on same date).
//      - else city_target? → city_target wins for this cycle.
//      - else fall through to prior cycle.
//   4. target_submit fallback.
// The 621 Daley smoke and the test 678 snap-follows case are pinned below.

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

describe('getHighlightedMilestone — fix-24c-2 (events beat forecasts, walk DESC)', () => {
  it('empty permit (no cycles, no dates) → falls back to target_submit', () => {
    const target = getHighlightedMilestone(makePermit());
    expect(target).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('only target_submit set → still falls back to target_submit', () => {
    const target = getHighlightedMilestone(
      makePermit({ target_submit: '2026-06-01' }),
    );
    expect(target).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('single cycle with only submitted → submitted wins', () => {
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [cycle({ cycle_index: 1, submitted: '2026-06-10' })],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 1,
      key: 'submitted',
    });
  });

  it('actual_issue populated → highlights actual_issue regardless of cycle dates', () => {
    const target = getHighlightedMilestone(
      makePermit({
        actual_issue: '2026-09-01',
        approval_date: '2026-08-15',
        target_submit: '2026-06-01',
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-06-10',
            intake_accepted: '2026-06-15',
          }),
        ],
      }),
    );
    expect(target).toEqual({ kind: 'permit', key: 'actual_issue' });
  });

  it('approval_date populated, no actual_issue → highlights approval_date', () => {
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

  it('621 Daley smoke: events present → latest event wins; later city_target is ignored', () => {
    // The canonical motivator. cycle 1 has submitted=intake=2026-03-13 and
    // corr_issued=2026-04-16 (the latest event). city_target=2026-04-20 is a
    // forecast and loses to the event even though it's later by date.
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-03-13',
            intake_accepted: '2026-03-13',
            corr_issued: '2026-04-16',
            city_target: '2026-04-20',
          }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 1,
      key: 'corr_issued',
    });
  });

  it('city_target wins ONLY when cycle has no actual events', () => {
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            city_target: '2026-08-01',
          }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 1,
      key: 'city_target',
    });
  });

  it('test 678 snap-follows: cycle 1 events + cycle 2 submitted (from snap) → cycle 2 submitted wins', () => {
    // Post-backfill 2026-05-15 state of permit 10009. Walking DESC lands on
    // cycle 2 first; it has an event (submitted) so we return immediately
    // and never look at cycle 1.
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2025-11-15',
            intake_accepted: '2025-11-21',
          }),
          cycle({ cycle_index: 2, submitted: '2025-11-21' }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 2,
      key: 'submitted',
    });
  });

  it('higher cycle has city_target only, lower cycle has events → city_target on the higher cycle wins (walking stops there)', () => {
    // The walk-DESC rule: cycle 2 has a forecast (city_target), no events.
    // We return city_target for cycle 2 and never look at cycle 1's events.
    // Reflects "we've moved into cycle 2 and are waiting on the city."
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-06-10',
            corr_issued: '2026-07-01',
          }),
          cycle({ cycle_index: 2, city_target: '2026-08-15' }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 2,
      key: 'city_target',
    });
  });

  it('higher cycle is fully empty → falls through to lower cycle with events', () => {
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-06-10',
            corr_issued: '2026-07-01',
          }),
          cycle({ cycle_index: 2 }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 1,
      key: 'corr_issued',
    });
  });

  it('out-of-order dates within a cycle: latest event date wins regardless of chain position', () => {
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-06-10',
            corr_issued: '2026-05-01',
            resubmitted: '2026-04-01',
          }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 1,
      key: 'submitted',
    });
  });

  it('same-day tie within ONE cycle → event chain priority resolves (intake > resubmitted > corr > submitted)', () => {
    // All four events share a date. Chain priority picks intake_accepted.
    // city_target=2026-06-10 is ignored because events exist.
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-06-10',
            city_target: '2026-06-10',
            corr_issued: '2026-06-10',
            resubmitted: '2026-06-10',
            intake_accepted: '2026-06-10',
          }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 1,
      key: 'intake_accepted',
    });
  });

  it('only city_target across multiple empty cycles → highest cycle_index with city_target wins', () => {
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({ cycle_index: 1, city_target: '2026-06-01' }),
          cycle({ cycle_index: 2, city_target: '2026-07-01' }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 2,
      key: 'city_target',
    });
  });

  it('all cycles fully empty → falls back to target_submit', () => {
    const target = getHighlightedMilestone(
      makePermit({
        target_submit: '2026-06-01',
        permit_cycles: [
          cycle({ cycle_index: 0 }),
          cycle({ cycle_index: 1 }),
        ],
      }),
    );
    expect(target).toEqual({ kind: 'permit', key: 'target_submit' });
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
  const cellCycle1CityTarget: HighlightTarget = {
    kind: 'cycle',
    cycleIndex: 1,
    key: 'city_target',
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

  it('city_target identity matches via isMilestoneHighlighted', () => {
    expect(isMilestoneHighlighted(cellCycle1CityTarget, cellCycle1CityTarget)).toBe(true);
    expect(isMilestoneHighlighted(cellCycle1CityTarget, cellCycle1Submitted)).toBe(false);
  });
});
