import { describe, it, expect } from 'vitest';
import {
  buildForecast,
  historicSuppressedKinds,
  isMilestoneAcked,
  milestoneApplies,
  milestonePredatesRecord,
  permitMilestones,
  type BoardInput,
  type BoardViewer,
  type PermitMilestoneAck,
} from '../lib/myBoard';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-378 — the milestone list is 80% backfilled history.
//
// Measured on prod 2026-08-21: 312 active permits, 224 with a target_submit
// more than 30 days past — and 180 of those dates were ALREADY past when the
// permit row was CREATED. Backfilling a project loads its real historical
// dates, and every date-anchored milestone fired at once, as though the team
// missed 180 deadlines the moment the data arrived.
//
// ★★★ THE DISCRIMINATOR: date < created_at::date → history, never raised.
// Date passed while the record was live → a MISSED DEADLINE, still raised.
// The 44 real ones are the entire reason the milestone exists, so the test
// that matters most here is the one proving they SURVIVE.
//
// ★★★ Suppression happens in the deriver. No permit_milestone_acks row is
// written, read differently, or deleted — an auto-ack would put words in a
// person's mouth (fix-363: provenance answers WHO did this).

const TODAY = '2026-08-21';

let pid = 0;
function mkPermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    num: null,
    stage: null,
    stage_override: null,
    da: null,
    dm: null,
    ent_lead: 'Miles',
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    parent_permit_id: null,
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
    updated_at: '2026-08-20T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

function mkCycle(over: Partial<PermitCycle>): PermitCycle {
  return {
    id: 'c1',
    permit_id: pid,
    cycle_index: 1,
    submitted: null,
    intake_accepted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as PermitCycle;
}

const mkProject = (id: string, address: string): Project =>
  ({ id, address, juris: 'Seattle', archived: false, notes: null }) as Project;

const MILES: BoardViewer = { name: 'Miles', isOversight: false };

function input(over: Partial<BoardInput>): BoardInput {
  return {
    viewer: MILES,
    permits: [],
    projects: [mkProject('p1', '3626 164th Pl SE')],
    tasks: [],
    today: TODAY,
    ...over,
  };
}

/** The 180 shape: created 2026-06-01 with a target that was already history. */
const backfilled = () =>
  mkPermit({
    created_at: '2026-06-01T10:00:00+00:00',
    target_submit: '2025-11-20',
  });

/** The 44 shape: created 2026-06-01, the target passed while it was LIVE. */
const missedWhileLive = () =>
  mkPermit({
    created_at: '2026-06-01T10:00:00+00:00',
    target_submit: '2026-07-15',
  });

// ---------------------------------------------------------------------------
describe('fix-378 ★★★ the discriminator: history vs missed deadline', () => {
  it('a target_submit already past at row creation raises NO milestone', () => {
    const kinds = permitMilestones(backfilled(), TODAY).map((m) => m.kind);
    expect(kinds).not.toContain('target_submit');
    expect(milestoneApplies('target_submit', backfilled())).toBe(false);
  });

  it('★★★ a target_submit that passed while the record was LIVE still raises — the 44', () => {
    const kinds = permitMilestones(missedWhileLive(), TODAY).map((m) => m.kind);
    expect(kinds).toContain('target_submit');
    expect(milestoneApplies('target_submit', missedWhileLive())).toBe(true);
  });

  it('a target ahead of both creation and today raises exactly as before', () => {
    const p = mkPermit({
      created_at: '2026-08-01T10:00:00+00:00',
      target_submit: '2026-09-15',
    });
    expect(permitMilestones(p, TODAY).map((m) => m.kind)).toContain('target_submit');
  });

  it('★ the boundary is strict: a target ON the creation day is live, not history', () => {
    const p = mkPermit({
      created_at: '2026-06-01T23:00:00+00:00',
      target_submit: '2026-06-01',
    });
    expect(milestonePredatesRecord('target_submit', p)).toBe(false);
    expect(permitMilestones(p, TODAY).map((m) => m.kind)).toContain('target_submit');
  });
});

// ---------------------------------------------------------------------------
describe('fix-378 ★ null handling — suppression requires evidence', () => {
  it('a permit with NO created_at raises exactly as before (fail open)', () => {
    const p = mkPermit({ created_at: null, target_submit: '2025-11-20' });
    expect(milestonePredatesRecord('target_submit', p)).toBe(false);
    expect(permitMilestones(p, TODAY).map((m) => m.kind)).toContain('target_submit');
  });

  it('an empty-string created_at (the test-fixture shape) also fails open', () => {
    const p = mkPermit({ created_at: '', target_submit: '2025-11-20' });
    expect(milestonePredatesRecord('target_submit', p)).toBe(false);
  });

  it('a null anchor date is nothing to suppress and nothing to raise', () => {
    const p = mkPermit({ created_at: '2026-06-01T10:00:00+00:00', target_submit: null });
    expect(milestonePredatesRecord('target_submit', p)).toBe(false);
    expect(historicSuppressedKinds(p)).toEqual([]);
    expect(permitMilestones(p, TODAY).map((m) => m.kind)).not.toContain(
      'target_submit',
    );
  });
});

// ---------------------------------------------------------------------------
describe('fix-378 ★★ the other date-anchored kinds, each decided deliberately', () => {
  it('draw: a dd_end already past at creation is suppressed; one that passed live raises', () => {
    const da = { da: 'Fisk', ent_lead: null };
    const historic = mkPermit({
      ...da,
      created_at: '2026-06-01T10:00:00+00:00',
      dd_end: '2026-01-10',
    });
    const live = mkPermit({
      ...da,
      created_at: '2026-06-01T10:00:00+00:00',
      dd_end: '2026-07-10',
    });
    expect(permitMilestones(historic, TODAY).map((m) => m.kind)).not.toContain('draw');
    expect(permitMilestones(live, TODAY).map((m) => m.kind)).toContain('draw');
  });

  it('intake: an appointment date already past at creation is suppressed; one that passed live raises', () => {
    const historic = mkPermit({
      created_at: '2026-06-01T10:00:00+00:00',
      intake_date: '2026-02-03',
    });
    const live = mkPermit({
      created_at: '2026-06-01T10:00:00+00:00',
      intake_date: '2026-07-03',
    });
    expect(permitMilestones(historic, TODAY).map((m) => m.kind)).not.toContain(
      'intake',
    );
    expect(permitMilestones(live, TODAY).map((m) => m.kind)).toContain('intake');
  });

  it('★ fees is LEFT ALONE: approved-not-issued is a current portal state, not a plan date', () => {
    // Approval long before the row existed — the fees are still genuinely
    // unpaid today, so this is live work, not history.
    const p = mkPermit({
      created_at: '2026-06-01T10:00:00+00:00',
      approval_date: '2025-12-01',
    });
    expect(permitMilestones(p, TODAY).map((m) => m.kind)).toContain('fees');
    expect(milestonePredatesRecord('fees', p)).toBe(false);
  });

  it('★ corrections is LEFT ALONE: a state read from the current cycle, not a stored date', () => {
    const p = mkPermit({
      created_at: '2026-06-01T10:00:00+00:00',
      permit_cycles: [
        mkCycle({
          submitted: '2026-01-05',
          intake_accepted: '2026-01-10',
          corr_issued: '2026-02-01',
          resubmitted: null,
        }),
      ],
    });
    expect(permitMilestones(p, TODAY).map((m) => m.kind)).toContain('corrections');
    expect(milestonePredatesRecord('corrections', p)).toBe(false);
  });

  it('★★ reviewer_silent behaves exactly as before — it is on the movement path', () => {
    // Old updated_at + recently created row: silence is measured from the last
    // MOVEMENT (updated_at), never from a stored plan date, so the historic
    // rule never touches it.
    const p = mkPermit({
      created_at: '2026-08-01T10:00:00+00:00',
      updated_at: '2026-07-01T12:00:00Z',
      permit_cycles: [
        mkCycle({ submitted: '2026-06-20', intake_accepted: '2026-06-25' }),
      ],
    });
    expect(milestonePredatesRecord('reviewer_silent', p)).toBe(false);
    expect(permitMilestones(p, TODAY).map((m) => m.kind)).toContain(
      'reviewer_silent',
    );
  });

  it('issuance is never derived by permitMilestones at all — nothing to suppress', () => {
    // The kind exists as relay vocabulary; expected_issue being past (111 on
    // prod) raises nothing from this function, before or after fix-378.
    const p = mkPermit({
      created_at: '2026-06-01T10:00:00+00:00',
      expected_issue: '2025-10-01',
    });
    expect(permitMilestones(p, TODAY).map((m) => m.kind)).not.toContain('issuance');
    expect(milestonePredatesRecord('issuance', p)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('fix-378 ★★ the suppressed count — shown, never silently dropped', () => {
  it('buildForecast reports how many milestones the historic rule kept off the board', () => {
    const f = buildForecast(input({ permits: [backfilled(), missedWhileLive()] }));
    expect(f.suppressedHistoric).toBe(1);
    // …and the live one is still IN the buckets — suppression is not a mute.
    const keys = f.past_due.all.map((i) => i.key);
    expect(keys.some((k) => k.includes('target_submit'))).toBe(true);
  });

  it('a board with nothing backfilled reports zero', () => {
    const f = buildForecast(input({ permits: [missedWhileLive()] }));
    expect(f.suppressedHistoric).toBe(0);
  });

  it('an already-acked historic milestone is not double-reported', () => {
    const p = backfilled();
    const acks: PermitMilestoneAck[] = [
      {
        id: 'a1',
        permit_id: p.id,
        milestone: 'target_submit',
        anchor: p.target_submit ?? null,
        acked_by_name: 'Miles',
        acked_at: '2026-08-13T12:00:00Z',
      },
    ];
    const f = buildForecast(input({ permits: [p], acks }));
    expect(f.suppressedHistoric).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('fix-378 ★★★ no ack is written, and the ack contract survives', () => {
  it('suppression is pure derivation: the acks array is never touched', () => {
    const acks: PermitMilestoneAck[] = [];
    buildForecast(input({ permits: [backfilled(), missedWhileLive()], acks }));
    expect(acks).toEqual([]);
  });

  it('a suppressed milestone is NOT acked — nobody is put on record', () => {
    expect(isMilestoneAcked('target_submit', backfilled(), [])).toBe(false);
  });

  it('★★ an ack on a LIVE missed target still releases when the anchor moves', () => {
    const p = missedWhileLive();
    const acks: PermitMilestoneAck[] = [
      {
        id: 'a1',
        permit_id: p.id,
        milestone: 'target_submit',
        anchor: '2026-07-15',
        acked_by_name: 'Miles',
        acked_at: '2026-08-13T12:00:00Z',
      },
    ];
    // Acked at the current anchor: quiet.
    expect(permitMilestones(p, TODAY, undefined, acks).map((m) => m.kind)).not.toContain(
      'target_submit',
    );
    // The date moves (still after creation): the prompt comes back.
    const moved = { ...p, target_submit: '2026-08-01' };
    expect(
      permitMilestones(moved, TODAY, undefined, acks).map((m) => m.kind),
    ).toContain('target_submit');
  });
});
