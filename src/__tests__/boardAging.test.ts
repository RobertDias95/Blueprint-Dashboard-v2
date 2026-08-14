import { describe, it, expect } from 'vitest';
import {
  AGING_LADDER,
  agingLevel,
  buildAging,
  cityTargetChaseable,
  cityTargetLevel,
  nextBusinessDay,
  permitState,
} from '../lib/boardAging';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// fix-305 (register #24) — did the thing actually happen?
//
// ★ PROD MEASUREMENT (2026-08-14, eibnmwthkcuumyclyxoe, READ-ONLY):
//   ready for intake ..... 11 permits, 9 at priority, worst 157d
//   approved not issued ... 48,        37 at priority, worst 227d
//   corrections ........... 36,        24 at priority, worst 177d
//   additional info ....... 37, ★ 35 of them with NO anchor date at all
//   TOTAL tracked ......... 133, of which 36 cannot be aged, 72 at priority
//   city_target ........... 139 carry one · 8 due today · 106 past · 63 by 30d+
//
// The brief's figures were 51 / 32 / 11 and 79 at priority; mine are 48 / 36 /
// 11 and 72. Same shape, a day's drift.
//
// ★★ A FINDING THE BRIEF DOES NOT MENTION: permit_cycles.intake_accepted is
// populated on ZERO active permits. The model's "Intake accepted -> reviews
// start" row therefore cannot fire on today's data. The state is implemented
// because it is part of the model, but it is inert until the scraper starts
// recording that date — and it is why ready_for_intake reads the STATUS rather
// than "submitted and not yet accepted", which would have classified 86
// permits as awaiting intake when the portal says 11.

const TODAY = '2026-08-14';

function cyc(over: Partial<PermitCycle>): PermitCycle {
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

let pid = 0;
function mkPermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    num: 'BLD-1',
    status: null,
    stage: null,
    stage_override: null,
    da: 'Fisk',
    dm: null,
    ent_lead: 'Briana',
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
    // ★ Touched FOUR DAYS AGO — fresh record, stale state.
    updated_at: '2026-08-10T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

const build = (permits: PermitWithCycles[], over = {}) =>
  buildAging({
    permits,
    projectAddress: () => '4000 SW Concord St',
    today: TODAY,
    ...over,
  });

// ---------------------------------------------------------------------------
describe('fix-305: ★★ THE ACCEPTANCE TEST — 4000 SW Concord St', () => {
  /** 7138853-CN: submitted 12 May, still Ready for Intake, scraped 10 Aug. */
  const concordBp = () =>
    mkPermit({
      num: '7138853-CN',
      type: 'Building Permit',
      status: 'Ready for Intake',
      updated_at: '2026-08-10T12:00:00Z',
      permit_cycles: [cyc({ submitted: '2026-05-12' })],
    });

  it('★ appears at PRIORITY — 94 days in Ready for Intake', () => {
    const { aged } = build([concordBp()]);
    expect(aged).toHaveLength(1);
    expect(aged[0]!.daysInState).toBe(94);
    expect(aged[0]!.level).toBe('priority');
    expect(aged[0]!.state).toBe('ready_for_intake');
  });

  it('★★ even though it was TOUCHED FOUR DAYS AGO', () => {
    // "Untouched for 3 days" would not have caught this: the scraper is
    // visiting it happily. The record is fresh; the state is stale.
    const p = concordBp();
    const daysSinceTouch = Math.round(
      (Date.parse(`${TODAY}T12:00:00Z`) - Date.parse(p.updated_at!)) / 86_400_000,
    );
    expect(daysSinceTouch).toBe(4);
    expect(build([p]).aged[0]!.level).toBe('priority');
  });

  it('and it says what is expected, and whose it is', () => {
    const row = build([concordBp()]).aged[0]!;
    expect(row.expectation).toBe('Intake booked and attended');
    expect(row.owner).toBe('entitlement');
  });

  it("★ the sibling STFI is caught even though its status reads 'Completed'", () => {
    // approval_date set, no issue date, fees unpaid, 18 days. Deriving state
    // from the status string alone would file it as finished.
    const stfi = mkPermit({
      num: '003864-26PA',
      type: 'STFI',
      status: 'Completed',
      approval_date: '2026-07-27',
      actual_issue: null,
    });
    const row = build([stfi]).aged[0]!;
    expect(row.state).toBe('approved_not_issued');
    expect(row.daysInState).toBe(18);
    expect(row.level).toBe('task');
  });
});

// ---------------------------------------------------------------------------
describe('fix-305: time-in-state, never time-since-update', () => {
  it('★ touched yesterday but stuck 30 days still escalates', () => {
    const p = mkPermit({
      status: 'Ready for Intake',
      updated_at: '2026-08-13T12:00:00Z',
      permit_cycles: [cyc({ submitted: '2026-07-15' })],
    });
    expect(build([p]).aged[0]!.level).toBe('priority');
  });

  it('★ updated 30 days ago but in a state needing nothing does NOT', () => {
    // Issued and gone. Time-since-update is 30 days and irrelevant.
    const p = mkPermit({
      status: 'Issued',
      actual_issue: '2026-07-01',
      updated_at: '2026-07-15T12:00:00Z',
      permit_cycles: [cyc({ submitted: '2026-05-01' })],
    });
    expect(build([p]).aged).toEqual([]);
    expect(permitState(p).state).toBeNull();
  });

  it('a permit in a tracked state for 2 days is below the ladder', () => {
    const p = mkPermit({ approval_date: '2026-08-12' });
    expect(build([p]).aged).toEqual([]);
  });

  it('the ladder is 3 / 7 / 21 for every state alike', () => {
    expect(AGING_LADDER).toEqual({ acknowledge: 3, task: 7, priority: 21 });
    expect(agingLevel(2)).toBe('none');
    expect(agingLevel(3)).toBe('acknowledge');
    expect(agingLevel(6)).toBe('acknowledge');
    expect(agingLevel(7)).toBe('task');
    expect(agingLevel(20)).toBe('task');
    expect(agingLevel(21)).toBe('priority');
    expect(agingLevel(227)).toBe('priority');
  });

  it('rows are ranked by age — 227 days never sits below 22', () => {
    const rows = build([
      mkPermit({ approval_date: '2026-07-20' }), // 25d
      mkPermit({ approval_date: '2026-01-01' }), // 225d
      mkPermit({ approval_date: '2026-08-01' }), // 13d
    ]).aged;
    expect(rows.map((r) => r.daysInState)).toEqual([225, 25, 13]);
  });
});

// ---------------------------------------------------------------------------
describe('fix-305: ★ the city target has ONE BUSINESS day of grace', () => {
  // Friday 2026-08-14 is a Friday in this calendar; check the helper directly
  // rather than trusting an assumption about the date.
  const friday = '2026-08-14';
  const saturday = '2026-08-15';
  const sunday = '2026-08-16';
  const monday = '2026-08-17';

  it('the calendar assumption holds', () => {
    expect(new Date(`${friday}T12:00:00Z`).getUTCDay()).toBe(5);
    expect(new Date(`${monday}T12:00:00Z`).getUTCDay()).toBe(1);
  });

  it('★ a FRIDAY target produces nothing on Saturday or Sunday', () => {
    // A calendar-day grace would raise a false alarm every single weekend,
    // which would poison the feature inside a month.
    expect(cityTargetChaseable(friday, saturday)).toBe(false);
    expect(cityTargetChaseable(friday, sunday)).toBe(false);
    expect(cityTargetLevel(friday, saturday)).toBe('none');
    expect(cityTargetLevel(friday, sunday)).toBe('none');
  });

  it('★ …and appears on Monday', () => {
    expect(cityTargetChaseable(friday, monday)).toBe(true);
    expect(nextBusinessDay(friday)).toBe(monday);
  });

  it('the whole due day is theirs — a target is not chaseable on its own day', () => {
    expect(cityTargetChaseable(friday, friday)).toBe(false);
  });

  it('a midweek target is chaseable the next day', () => {
    expect(nextBusinessDay('2026-08-12')).toBe('2026-08-13'); // Wed -> Thu
    expect(cityTargetChaseable('2026-08-12', '2026-08-13')).toBe(true);
  });

  it('after the grace, the same ladder applies', () => {
    expect(cityTargetLevel('2026-08-01', TODAY)).toBe('task'); // 13d
    expect(cityTargetLevel('2026-06-01', TODAY)).toBe('priority'); // 74d
  });

  it('no target means nothing to chase', () => {
    expect(cityTargetLevel(null, TODAY)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
describe('fix-305: ★ day one — show everything, auto-create nothing', () => {
  it('a pre-deploy clock shows but never offers a task', () => {
    // 72 permits hit priority the moment this ships. They all show, ranked —
    // Concord appears immediately, which is the point — but 72 new tasks on
    // Miles and Briana in one morning would be ignored as a block, on top of
    // 212 already overdue.
    const old = mkPermit({ approval_date: '2026-01-01' });
    const row = build([old]).aged[0]!;
    expect(row.level).toBe('priority');
    expect(row.mayCreateTask).toBe(false);
  });

  it('★ a POST-deploy flip does offer one once it reaches the rung', () => {
    const fresh = mkPermit({ approval_date: '2026-08-20' });
    const row = buildAging({
      permits: [fresh],
      projectAddress: () => 'A St',
      today: '2026-08-30', // 10 days later
    }).aged[0]!;
    expect(row.level).toBe('task');
    expect(row.mayCreateTask).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('fix-305: ★ the permits that cannot be aged', () => {
  it('appear in the data-gap group, never in an aged bucket', () => {
    // 35 of the 37 "additional info requested" permits have no approval date
    // and no submitted date on any cycle. There is nothing to measure from.
    const p = mkPermit({
      status: 'Additional Info Requested',
      permit_cycles: [cyc({ submitted: null })],
    });
    const { aged, dataGaps } = build([p]);
    expect(aged).toEqual([]);
    expect(dataGaps).toHaveLength(1);
    expect(dataGaps[0]!.missing).toBe('submitted date');
  });

  it('★ and are NEVER aged from created_at', () => {
    // That is when we added the row, not when anything happened — it would look
    // precise while meaning nothing.
    const p = mkPermit({
      status: 'Additional Info Requested',
      created_at: '2025-01-01T00:00:00Z',
      permit_cycles: [cyc({ submitted: null })],
    });
    expect(build([p]).aged).toEqual([]);
  });

  it('one WITH an anchor is aged normally', () => {
    const p = mkPermit({
      status: 'Additional Info Requested',
      permit_cycles: [cyc({ submitted: '2026-06-01' })],
    });
    const { aged, dataGaps } = build([p]);
    expect(dataGaps).toEqual([]);
    expect(aged[0]!.state).toBe('additional_info');
  });
});

// ---------------------------------------------------------------------------
describe('fix-305: state derivation', () => {
  it('corrections outrank an approval date', () => {
    const p = mkPermit({
      approval_date: '2026-08-01',
      permit_cycles: [cyc({ corr_issued: '2026-08-05' })],
    });
    expect(permitState(p).state).toBe('corrections');
    expect(permitState(p).owner).toBe('design');
  });

  it('answered corrections are no longer corrections', () => {
    const p = mkPermit({
      permit_cycles: [cyc({ corr_issued: '2026-07-01', resubmitted: '2026-07-10' })],
    });
    expect(permitState(p).state).toBe('resubmitted');
  });

  it('sub-permits and cancelled projects are excluded', () => {
    const sub = mkPermit({ parent_permit_id: 9, approval_date: '2026-01-01' });
    const cancelled = mkPermit({ project_id: 'gone', approval_date: '2026-01-01' });
    const { aged } = build([sub, cancelled], { cancelledIds: new Set(['gone']) });
    expect(aged).toEqual([]);
  });

  it('scoped to the viewer unless they hold oversight', () => {
    const notMine = mkPermit({ da: 'Marc', ent_lead: 'Miles', approval_date: '2026-01-01' });
    expect(build([notMine], { viewerName: 'Briana' }).aged).toEqual([]);
    expect(build([notMine], { viewerName: 'Briana', isOversight: true }).aged).toHaveLength(1);
    expect(build([notMine], { viewerName: 'Miles' }).aged).toHaveLength(1);
  });
});
