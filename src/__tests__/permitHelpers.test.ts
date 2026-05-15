import { describe, it, expect } from 'vitest';
import {
  getHighlightedMilestone,
  isMilestoneHighlighted,
  type HighlightTarget,
} from '../lib/permitHelpers';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// fix-23c B → fix-24c: tests for the latest-populated highlight selector.
// fix-24c rewrites the rule from chain-position-latest to latest-BY-DATE
// (with tiebreakers: higher cycle_index wins, then chain priority). The
// 621 Daley smoke case (corr_issued 2026-04-16 beats intake_accepted
// 2026-03-13 even though intake ranks above corr in the chain) is the
// canonical motivator and is pinned below.

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

describe('getHighlightedMilestone — fix-24c (latest by date)', () => {
  it('empty permit (no cycles, no dates) → falls back to target_submit', () => {
    const target = getHighlightedMilestone(makePermit());
    expect(target).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('only target_submit set → still falls back to target_submit', () => {
    // target_submit is the empty-state anchor; it's not itself a
    // candidate in the date-latest set (otherwise an anticipated date
    // far in the future would steal the highlight from real history).
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

  it('621 Daley smoke case: cycle 1 submitted=intake_accepted=2026-03-13, corr_issued=2026-04-16 → corr_issued wins by date', () => {
    // The motivating bug. Old rule (chain position) returned
    // intake_accepted because it ranks above corr_issued in the chain.
    // New rule sorts by date first: 2026-04-16 (corr_issued) > 2026-03-13
    // (the other two), so corr_issued wins.
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-03-13',
            intake_accepted: '2026-03-13',
            corr_issued: '2026-04-16',
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

  it('city_target IS a candidate — when it is the latest by date, it wins', () => {
    // fix-24c reversal of fix-23c: city_target now joins the candidate
    // set. A cycle whose city_target is the most recent populated date
    // ends up highlighted.
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
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 1,
      key: 'city_target',
    });
  });

  it('cycle 1 fully filled + cycle 2 submitted same day as cycle 1 intake_accepted → cycle 2 wins (higher cycle_index tiebreak)', () => {
    // The intake→snap pattern: cycle 1 intake_accepted auto-creates
    // cycle 2 with submitted=that date. Both rows share that date — the
    // tiebreaker (higher cycle_index) hands the highlight to cycle 2.
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-06-10',
            corr_issued: '2026-07-01',
            resubmitted: '2026-07-15',
            intake_accepted: '2026-07-20',
          }),
          cycle({ cycle_index: 2, submitted: '2026-07-20' }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 2,
      key: 'submitted',
    });
  });

  it('out-of-order dates within a cycle: latest date wins regardless of chain position', () => {
    // Imagine bad data entry where submitted is later than corr_issued.
    // The new rule trusts the dates: whichever is actually latest gets
    // the highlight. (Old rule used chain position and would return
    // resubmitted/intake even when corr was later.)
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({
            cycle_index: 1,
            submitted: '2026-06-10',
            corr_issued: '2026-05-01', // earlier than submitted — odd
            resubmitted: '2026-04-01', // even earlier
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

  it('same-day tie between two cycles + same chain key → higher cycle_index wins', () => {
    const target = getHighlightedMilestone(
      makePermit({
        permit_cycles: [
          cycle({ cycle_index: 1, submitted: '2026-06-10' }),
          cycle({ cycle_index: 3, submitted: '2026-06-10' }),
          cycle({ cycle_index: 2, submitted: '2026-06-10' }),
        ],
      }),
    );
    expect(target).toEqual({
      kind: 'cycle',
      cycleIndex: 3,
      key: 'submitted',
    });
  });

  it('same-day tie within ONE cycle → chain priority resolves it (intake > resubmitted > corr > city > submitted)', () => {
    // All four populated with the same date — chain priority picks the
    // most-advanced one.
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

  it('permit-level dates win ties against cycle dates with the same value (cycle_index treated as +Inf)', () => {
    // approval_date and cycle 1 submitted share a date. The tiebreaker
    // treats permit-level as cycle_index=999 → wins over any real cycle.
    const target = getHighlightedMilestone(
      makePermit({
        approval_date: '2026-08-01',
        permit_cycles: [cycle({ cycle_index: 1, submitted: '2026-08-01' })],
      }),
    );
    expect(target).toEqual({ kind: 'permit', key: 'approval_date' });
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

  it('city_target identity matches via isMilestoneHighlighted (fix-24c: city_target is now a real candidate)', () => {
    expect(isMilestoneHighlighted(cellCycle1CityTarget, cellCycle1CityTarget)).toBe(true);
    expect(isMilestoneHighlighted(cellCycle1CityTarget, cellCycle1Submitted)).toBe(false);
  });
});
