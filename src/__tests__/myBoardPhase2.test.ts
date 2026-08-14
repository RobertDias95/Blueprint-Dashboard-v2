import { describe, it, expect } from 'vitest';
import {
  buildForecast,
  canConfirmHandoff,
  handoffAffordance,
  isMilestoneAcked,
  milestoneAnchor,
  permitMilestones,
  systemHealth,
  type BoardInput,
  type BoardTask,
  type BoardViewer,
  type PermitMilestoneAck,
} from '../lib/myBoard';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-298 PHASE 2 — the write path.
//
// PROD RE-MEASURE (2026-08-14, eibnmwthkcuumyclyxoe, READ-ONLY). The brief's
// figures are from 13 August; the brief says to use mine if they have moved,
// and they have:
//   permits in corrections .................. 37   (brief 32)
//   of those with ZERO tasks at all .......... 5   (brief 4)   <- the trap
//   of those with ZERO DESIGN tasks ......... 25               <- see below
//   every task resolved (ALL tasks) .......... 6   (brief 6)
//   every DESIGN task resolved ............... 4   <- the real "ready" count
//   one-leg (da IS NULL) ..................... 6, all Demolition (brief 13/9)
//
// ★ The design leg is discipline='arch', and the data says that is right:
// discipline is 100% populated on these permits, arch tasks read like redline
// work ("Adjust plan to reduce primary closet by 3' and shift the house out of
// the east setback") and ent tasks read like tracking ("Brents list", "Check
// in", "Correction 2"). Counting a resolved "Brents list" as evidence the
// redlines are drawn would be the vacuous-truth trap wearing a different hat —
// an ENTITLEMENT fact vouching for the DESIGN leg. So the brief's "6 ready" is
// 4 by the correct denominator, and 25 of 37 corrections permits get the
// manual button rather than an automatic prompt.

const TODAY = '2026-08-14';

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
    da: 'Fisk',
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
    updated_at: '2026-08-01T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

let tid = 0;
function mkTask(over: Partial<BoardTask>): BoardTask {
  return {
    id: `t${++tid}`,
    permit_id: 1,
    parent_task_id: null,
    project_id: 'p1',
    project_address: '3626 164th Pl SE',
    permit_type: 'Building Permit',
    bucket: 'de',
    text: 'Do the thing',
    start_date: null,
    target_date: null,
    due_date: null,
    done_at: null,
    sort_order: 0,
    assigned_to: null,
    discipline: 'arch',
    status: 'Open',
    primary_assignee: null,
    co_assignees: [],
    ...over,
  } as BoardTask;
}

const mkProject = (id: string, address: string): Project =>
  ({ id, address, juris: 'Seattle', archived: false, notes: null }) as Project;

function mkCycle(over: Partial<PermitCycle>): PermitCycle {
  return {
    id: 'c1',
    permit_id: 1,
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

const MILES: BoardViewer = { name: 'Miles', isOversight: false };
const FISK: BoardViewer = { name: 'Fisk', isOversight: false };

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

const ACK = (over: Partial<PermitMilestoneAck>): PermitMilestoneAck => ({
  id: 'a1',
  permit_id: 1,
  milestone: 'fees',
  anchor: null,
  acked_by_name: 'Miles',
  acked_at: '2026-08-13T12:00:00Z',
  ...over,
});

// ---------------------------------------------------------------------------
describe('fix-298 P2: an acked milestone does not come back tomorrow', () => {
  const approved = () =>
    mkPermit({ da: null, ent_lead: 'Miles', approval_date: '2026-08-01' });

  it('the fees prompt is raised while unacked', () => {
    expect(permitMilestones(approved(), TODAY).some((m) => m.kind === 'fees')).toBe(true);
  });

  it('★ and is gone once ticked, at the same anchor', () => {
    const p = approved();
    const acks = [ACK({ permit_id: p.id, milestone: 'fees', anchor: '2026-08-01' })];
    expect(
      permitMilestones(p, TODAY, undefined, acks).some((m) => m.kind === 'fees'),
    ).toBe(false);
  });

  it('★ but comes BACK when the underlying fact changes', () => {
    // Re-approved: a new approval_date is a new anchor, so the old ack no
    // longer covers it. This is exactly why the ack stores an anchor and not
    // just a timestamp — "done" is done for a REASON, and the reason expires.
    const p = approved();
    const stale = [ACK({ permit_id: p.id, milestone: 'fees', anchor: '2026-05-05' })];
    expect(
      permitMilestones(p, TODAY, undefined, stale).some((m) => m.kind === 'fees'),
    ).toBe(true);
  });

  it('an ack on a different permit does not silence this one', () => {
    const p = approved();
    const acks = [ACK({ permit_id: p.id + 999, milestone: 'fees', anchor: '2026-08-01' })];
    expect(
      permitMilestones(p, TODAY, undefined, acks).some((m) => m.kind === 'fees'),
    ).toBe(true);
  });

  it('anchors are null-safe', () => {
    const p = approved();
    expect(milestoneAnchor('fees', p)).toBe('2026-08-01');
    expect(milestoneAnchor('reviewer_silent', p)).toBeNull();
    expect(
      isMilestoneAcked('fees', p, [ACK({ permit_id: p.id, anchor: '2026-08-01' })]),
    ).toBe(true);
  });

  it('★ a reviewer chase buys another window, then asks again', () => {
    // reviewer_silent has no anchor that could ever change — the entire point
    // is that nothing is changing — so the ack counts as a MOVEMENT and
    // silence is re-measured from it.
    const p = mkPermit({
      da: null,
      ent_lead: 'Miles',
      updated_at: '2026-06-01T12:00:00Z',
      permit_cycles: [mkCycle({ submitted: '2026-01-01', intake_accepted: '2026-01-02' })],
    });
    const quiet = (acks: PermitMilestoneAck[]) =>
      permitMilestones(p, TODAY, undefined, acks).some(
        (m) => m.kind === 'reviewer_silent',
      );

    expect(quiet([])).toBe(true);
    expect(
      quiet([
        ACK({
          permit_id: p.id,
          milestone: 'reviewer_silent',
          acked_at: '2026-08-13T09:00:00Z',
        }),
      ]),
    ).toBe(false);
    expect(
      quiet([
        ACK({
          permit_id: p.id,
          milestone: 'reviewer_silent',
          acked_at: '2026-06-10T09:00:00Z',
        }),
      ]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('fix-298 P2: the handoff affordance', () => {
  const cyc = [mkCycle({ cycle_index: 2, submitted: '2026-05-01', corr_issued: '2026-06-01' })];
  const permit = () => mkPermit({ da: 'Fisk', ent_lead: 'Miles', permit_cycles: cyc });

  it('★ ZERO tasks never auto-prompts — it offers the manual button', () => {
    expect(handoffAffordance(permit(), [], [])).toBe('manual');
  });

  it('★ ONE RESOLVED design task DOES prompt', () => {
    expect(
      handoffAffordance(
        permit(),
        [mkTask({ discipline: 'arch', status: 'Resolved' })],
        [],
      ),
    ).toBe('prompt');
  });

  it('a live design task means there is nothing to hand off yet', () => {
    expect(
      handoffAffordance(
        permit(),
        [
          mkTask({ discipline: 'arch', status: 'Resolved' }),
          mkTask({ discipline: 'arch', status: 'Open' }),
        ],
        [],
      ),
    ).toBe('none');
  });

  it('★ resolved ENTITLEMENT tasks do not vouch for the design leg', () => {
    // A ticked "Brents list" says nothing about whether the redlines are
    // drawn. It falls back to manual: a person still has to say so.
    expect(
      handoffAffordance(
        permit(),
        [mkTask({ discipline: 'ent', status: 'Resolved' })],
        [],
      ),
    ).toBe('manual');
  });

  it('★ a ONE-LEG permit shows no handoff affordance at all', () => {
    const oneLeg = mkPermit({ da: null, ent_lead: 'Miles', permit_cycles: cyc });
    expect(handoffAffordance(oneLeg, [], [])).toBe('none');
    expect(
      handoffAffordance(
        oneLeg,
        [mkTask({ discipline: 'arch', status: 'Resolved' })],
        [],
      ),
    ).toBe('none');
  });

  it('once handed off it stops offering — and returns on a NEW cycle', () => {
    const p = permit();
    const tasks = [mkTask({ discipline: 'arch', status: 'Resolved' })];
    expect(
      handoffAffordance(p, tasks, [
        ACK({ permit_id: p.id, milestone: 'design_complete', anchor: '2' }),
      ]),
    ).toBe('none');
    expect(
      handoffAffordance(p, tasks, [
        ACK({ permit_id: p.id, milestone: 'design_complete', anchor: '1' }),
      ]),
    ).toBe('prompt');
  });

  it('★ the design-complete ack flips the relay so the lead can act', () => {
    // This is "moves the permit to the lead's Ready to file": Miles's row goes
    // from greyed-and-waiting to his, with a checkbox.
    const p = mkPermit({
      da: 'Fisk',
      ent_lead: 'Miles',
      target_submit: '2026-03-01',
      permit_cycles: [mkCycle({ cycle_index: 2 })],
    });
    const before = buildForecast(input({ viewer: MILES, permits: [p] }));
    expect(before.past_due.items.some((i) => !i.actionable)).toBe(true);

    const after = buildForecast(
      input({
        viewer: MILES,
        permits: [p],
        acks: [ACK({ permit_id: p.id, milestone: 'design_complete', anchor: '2' })],
      }),
    );
    expect(after.past_due.items.every((i) => i.actionable)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('fix-298 P2: who may confirm the handoff', () => {
  const p = mkPermit({ da: 'Fisk', dual_da: 'Marc', dm: 'Gena', ent_lead: 'Miles' });

  it('the DA, the co-DA or the DM — one confirmation on the permit', () => {
    for (const n of ['Fisk', 'Marc', 'Gena']) {
      expect(canConfirmHandoff(p, { name: n, isOversight: false })).toBe(true);
    }
  });

  it('not an unrelated person', () => {
    expect(canConfirmHandoff(p, { name: 'Ainsley', isOversight: false })).toBe(false);
  });

  it('oversight can, as the escalation path', () => {
    expect(canConfirmHandoff(p, { name: 'Bobby', isOversight: true })).toBe(true);
  });

  it('an unmapped login cannot', () => {
    expect(canConfirmHandoff(p, { name: null, isOversight: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('fix-298 P2: what ticking a row is wired to do', () => {
  it('a task row resolves the task', () => {
    const t = mkTask({ assigned_to: 'Miles', due_date: TODAY, discipline: 'ent' });
    const f = buildForecast(input({ tasks: [t] }));
    expect(f.today.items[0]!.action).toBe('resolve-task');
    expect(f.today.items[0]!.task?.id).toBe(t.id);
  });

  it('an entitlement-only milestone records an ack, carrying its anchor', () => {
    const p = mkPermit({ da: null, ent_lead: 'Miles', approval_date: '2026-08-01' });
    const f = buildForecast(input({ permits: [p] }));
    const fees = [...f.past_due.items, ...f.today.items].find(
      (i) => i.milestoneKind === 'fees',
    );
    expect(fees?.action).toBe('ack');
    expect(fees?.anchor).toBe('2026-08-01');
  });

  it('★ the design half of a two-leg milestone is a HANDOFF, not a bulk resolve', () => {
    // Ticking "finish the set" must not silently resolve 12 redline tasks —
    // that would destroy the record of what was actually done. It states the
    // true thing instead: the design half is finished.
    const p = mkPermit({ da: 'Fisk', ent_lead: 'Miles', target_submit: '2026-03-01' });
    const f = buildForecast(input({ viewer: FISK, permits: [p] }));
    expect(f.past_due.items[0]!.action).toBe('handoff');
    expect(f.past_due.items[0]!.entLead).toBe('Miles');
  });
});

// ---------------------------------------------------------------------------
describe('fix-298 P2: system health (oversight only)', () => {
  it('counts unowned permits, staleness at two horizons, and portal failures', () => {
    const permits = [
      mkPermit({ da: null, ent_lead: null, updated_at: '2026-08-13T12:00:00Z' }),
      mkPermit({ da: 'Fisk', ent_lead: 'Miles', updated_at: '2026-07-20T12:00:00Z' }),
      mkPermit({ da: 'Fisk', ent_lead: 'Miles', updated_at: '2026-05-01T12:00:00Z' }),
    ];
    const h = systemHealth(
      permits,
      [{ action: 'scrape_workflow_fetch_failed' }, { action: 'scrape_change_applied' }],
      TODAY,
    );
    expect(h.unowned).toBe(1);
    expect(h.staleMedium).toBe(2); // 14d+
    expect(h.staleLong).toBe(1); // 30d+
    expect(h.portalFailures).toBe(1);
  });

  it('ignores sub-permits and cancelled projects, like every other surface', () => {
    const permits = [
      mkPermit({ parent_permit_id: 5, da: null, ent_lead: null }),
      mkPermit({ project_id: 'gone', da: null, ent_lead: null }),
    ];
    const h = systemHealth(permits, [], TODAY, undefined, new Set(['gone']));
    expect(h.unowned).toBe(0);
  });
});

describe('fix-298 P2: the handoff section is gated and capped', () => {
  const resolvedDesign = [mkTask({ discipline: 'arch', status: 'Resolved' })];

  it('★ a two-leg permit NOT in corrections offers nothing', () => {
    // Measured: offering the standing prompt on every two-leg permit with a
    // cycle puts 190 "Mark design complete" buttons on the board; even
    // "in corrections OR pre-submittal with a date" gives 98. A permit three
    // months from its target has no design tasks yet and nobody is waiting on
    // a handoff. Corrections-only gives 4 prompts and 25 manual.
    const preSubmittal = mkPermit({
      da: 'Fisk',
      ent_lead: 'Miles',
      target_submit: '2026-12-01',
      permit_cycles: [mkCycle({ cycle_index: 1 })],
    });
    expect(handoffAffordance(preSubmittal, [], [])).toBe('none');
    expect(handoffAffordance(preSubmittal, resolvedDesign, [])).toBe('none');
  });

  it('a permit whose corrections were resubmitted is no longer offered', () => {
    const answered = mkPermit({
      da: 'Fisk',
      ent_lead: 'Miles',
      permit_cycles: [
        mkCycle({ cycle_index: 2, corr_issued: '2026-06-01', resubmitted: '2026-07-01' }),
      ],
    });
    expect(handoffAffordance(answered, resolvedDesign, [])).toBe('none');
  });

  it('but ticking "finish the set" on a pre-submittal permit still hands over', () => {
    // Different question: whether this permit deserves a STANDING row in the
    // section, vs what ticking its forecast row does.
    const p = mkPermit({ da: 'Fisk', ent_lead: 'Miles', target_submit: '2026-03-01' });
    const f = buildForecast(input({ viewer: FISK, permits: [p] }));
    expect(f.past_due.items[0]!.action).toBe('handoff');
  });
});
