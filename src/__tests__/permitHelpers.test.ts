import { describe, it, expect } from 'vitest';
import {
  getHighlightedMilestone,
  isMilestoneHighlighted,
  type HighlightTarget,
} from '../lib/permitHelpers';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// fix-24c-3: tests for the chain-position rule.
//   - The cycle with the lowest cycle_index is DESIGN. Its chain (reversed,
//     most-advanced first) is: intake_accepted → submitted.
//   - All other cycles are REVIEW. Chain (reversed): resubmitted →
//     corr_issued → city_target → submitted.
//   - Walk cycles DESC. In each, walk the appropriate reverse chain. First
//     populated cell wins. No date sorting anywhere.

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
    updated_at: '2026-05-15T12:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

function cycle(
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
    created_at: '2026-05-15T12:00:00Z',
    updated_at: '2026-05-15T12:00:00Z',
    ...over,
  };
}

describe('getHighlightedMilestone — fix-24c-3 (chain-position)', () => {
  it('no cycles, no dates → target_submit', () => {
    expect(getHighlightedMilestone(makePermit())).toEqual({
      kind: 'permit',
      key: 'target_submit',
    });
  });

  it('only target_submit set → still target_submit (it is the anchor, not a candidate)', () => {
    expect(
      getHighlightedMilestone(makePermit({ target_submit: '2026-06-01' })),
    ).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('actual_issue populated → short-circuits to actual_issue regardless of cycle state', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          actual_issue: '2026-09-01',
          approval_date: '2026-08-15',
          permit_cycles: [
            cycle({ cycle_index: 0, submitted: '2026-06-10', intake_accepted: '2026-06-15' }),
            cycle({ cycle_index: 1, submitted: '2026-06-15', resubmitted: '2026-07-20' }),
          ],
        }),
      ),
    ).toEqual({ kind: 'permit', key: 'actual_issue' });
  });

  it('approval_date populated, no actual_issue → approval_date', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          approval_date: '2026-08-15',
          permit_cycles: [cycle({ cycle_index: 0, submitted: '2026-06-10' })],
        }),
      ),
    ).toEqual({ kind: 'permit', key: 'approval_date' });
  });

  it('design cycle only, submitted set → submitted', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [cycle({ cycle_index: 0, submitted: '2026-06-10' })],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 0, key: 'submitted' });
  });

  it('design cycle, intake_accepted + submitted both set → intake_accepted wins (DESIGN_REVERSE)', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({
              cycle_index: 0,
              submitted: '2026-06-10',
              intake_accepted: '2026-06-15',
            }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 0, key: 'intake_accepted' });
  });

  it('design cycle, city_target set but no chain fields → falls through (city_target is review-only); ends at target_submit', () => {
    // city_target on the design cycle is NOT in DESIGN_REVERSE. The design
    // cycle has no chain matches; with only one cycle, walking ends and
    // falls back to target_submit.
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [cycle({ cycle_index: 0, city_target: '2026-08-01' })],
        }),
      ),
    ).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('design cycle, resubmitted set is IGNORED (not in DESIGN_REVERSE)', () => {
    // Design's chain is submitted → intake_accepted. resubmitted is data
    // noise on the design cycle and never wins.
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({
              cycle_index: 0,
              submitted: '2026-06-10',
              resubmitted: '2026-07-20',
            }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 0, key: 'submitted' });
  });

  it('621 Daley post-repair: cycle 0 empty + cycle 1 with submitted/city_target/corr_issued → corr_issued wins (REVIEW_REVERSE position)', () => {
    // The canonical motivator. corr_issued is further along REVIEW_REVERSE
    // than city_target — even though city_target's date (2026-04-20) is
    // later than corr_issued's (2026-04-16). Chain-position, not date.
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({ cycle_index: 0 }),
            cycle({
              cycle_index: 1,
              submitted: '2026-03-13',
              city_target: '2026-04-20',
              corr_issued: '2026-04-16',
            }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'corr_issued' });
  });

  it('review cycle, resubmitted set → resubmitted wins over corr_issued/city_target/submitted', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({ cycle_index: 0 }),
            cycle({
              cycle_index: 1,
              submitted: '2026-03-13',
              city_target: '2026-04-20',
              corr_issued: '2026-04-16',
              resubmitted: '2026-04-25',
            }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'resubmitted' });
  });

  it('review cycle, intake_accepted set is IGNORED (not in REVIEW_REVERSE)', () => {
    // On review cycles, intake_accepted is data noise (it lives on the
    // design cycle). REVIEW_REVERSE is resubmitted → corr_issued →
    // city_target → submitted. Old V1-migration intake_accepted=submitted
    // rows were cleared in fix-24c-3, but if it sneaks in, it should not
    // win.
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({ cycle_index: 0 }),
            cycle({
              cycle_index: 1,
              submitted: '2026-03-13',
              intake_accepted: '2026-03-13',
            }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'submitted' });
  });

  it('test 678 post-repair: design (cycle 0) populated + review (cycle 1) with submitted (from snap) → cycle 1 submitted wins', () => {
    // After fix-24c-3 data repair, permit 10009 cycle 0 holds the design
    // data and cycle 1 holds the snap-derived submitted. Walking DESC lands
    // on cycle 1 first (review chain), finds submitted, returns. We never
    // look at cycle 0's intake_accepted.
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({
              cycle_index: 0,
              submitted: '2025-11-15',
              intake_accepted: '2025-11-21',
            }),
            cycle({ cycle_index: 1, submitted: '2025-11-21' }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'submitted' });
  });

  it('resubmitted-snap pattern: cycle 1 review with resubmitted + cycle 2 review with submitted (from snap) → cycle 2 submitted wins', () => {
    // Setting resubmitted on cycle 1 auto-fills cycle 2.submitted via the
    // new fix-24c-3 RPC branch. Walk DESC: cycle 2 (review chain) →
    // submitted populated → return cycle 2 submitted.
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({ cycle_index: 0 }),
            cycle({
              cycle_index: 1,
              submitted: '2026-03-13',
              resubmitted: '2026-04-25',
            }),
            cycle({ cycle_index: 2, submitted: '2026-04-25' }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 2, key: 'submitted' });
  });

  it('higher review cycle has only city_target → city_target on the higher cycle wins (walk stops there)', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({ cycle_index: 0 }),
            cycle({
              cycle_index: 1,
              submitted: '2026-03-13',
              corr_issued: '2026-04-16',
            }),
            cycle({ cycle_index: 2, city_target: '2026-05-30' }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 2, key: 'city_target' });
  });

  it('higher review cycle fully empty → falls through to prior review cycle', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({ cycle_index: 0 }),
            cycle({
              cycle_index: 1,
              submitted: '2026-03-13',
              corr_issued: '2026-04-16',
            }),
            cycle({ cycle_index: 2 }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'corr_issued' });
  });

  it('all review cycles empty + design has intake_accepted → falls back to design intake_accepted', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({
              cycle_index: 0,
              submitted: '2025-11-15',
              intake_accepted: '2025-11-21',
            }),
            cycle({ cycle_index: 1 }),
            cycle({ cycle_index: 2 }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 0, key: 'intake_accepted' });
  });

  it('all cycles fully empty → target_submit fallback', () => {
    expect(
      getHighlightedMilestone(
        makePermit({
          target_submit: '2026-06-01',
          permit_cycles: [
            cycle({ cycle_index: 0 }),
            cycle({ cycle_index: 1 }),
          ],
        }),
      ),
    ).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('fix-24f fresh-permit shape: only cycle 0 exists with no dates → target_submit fallback (no Cycle 1 placeholder in the way)', () => {
    // Post fix-24f, brand-new permits land with exactly one row at
    // cycle_index = 0 (and no cycle 1 placeholder). The highlight rule
    // must fall through cleanly to target_submit. Prior to fix-24f the
    // RPC pre-created an empty cycle 1 row; the new shape removes it.
    expect(
      getHighlightedMilestone(
        makePermit({
          target_submit: '2026-06-01',
          permit_cycles: [cycle({ cycle_index: 0 })],
        }),
      ),
    ).toEqual({ kind: 'permit', key: 'target_submit' });
  });

  it('fix-24f post-snap shape: cycle 0 with intake_accepted + cycle 1 created lazily with submitted (from snap) → cycle 1 submitted wins', () => {
    // First intake_accepted on the design cycle fires the snap, which
    // CREATES (not UPDATEs — no placeholder exists) cycle 1 with
    // submitted = intake_accepted. Walk DESC lands on cycle 1 first
    // and returns its submitted via REVIEW_REVERSE.
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({
              cycle_index: 0,
              submitted: '2026-06-01',
              intake_accepted: '2026-06-05',
            }),
            cycle({ cycle_index: 1, submitted: '2026-06-05' }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'submitted' });
  });

  it('legacy permit with cycles starting at 1 (no cycle 0) → cycle 1 is treated as design (firstIdx logic)', () => {
    // Edge case: a permit that has no cycle 0 (legacy or oddly-created).
    // The cycle with the lowest index becomes the design cycle, so cycle 1
    // here uses DESIGN_REVERSE (intake_accepted → submitted), ignoring its
    // city_target and corr_issued.
    expect(
      getHighlightedMilestone(
        makePermit({
          permit_cycles: [
            cycle({
              cycle_index: 1,
              submitted: '2025-11-15',
              intake_accepted: '2025-11-21',
              corr_issued: '2025-12-15',
            }),
          ],
        }),
      ),
    ).toEqual({ kind: 'cycle', cycleIndex: 1, key: 'intake_accepted' });
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
