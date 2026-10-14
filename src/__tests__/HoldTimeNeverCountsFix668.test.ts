import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  accountableDays,
  attachPermitHolds,
  holdAdjustedDue,
  holdsForPermit,
  pauseHoldIndex,
} from '../lib/holdOverlap';
import { holdsByProjectId } from '../hooks/useProjectHolds';
import { isTaskOverdue } from '../lib/taskStatus';
import { buildForecast, type BoardInput, type BoardTask, type BoardViewer } from '../lib/myBoard';
import { permitUrgency } from '../lib/urgencyHelpers';
import { avgIntakeToApproval } from '../lib/perfTrends';
import { computeTeamTrends } from '../lib/teamTrends';
import { computeRedesignCycleTimeComparison } from '../lib/redesignAnalytics';
import { buildApprovedAwaitingRows } from '../lib/approvedAwaitingIssuance';
import { buildVendorScheduleRows, consultantByProject } from '../lib/vendorReport';
import { buildAging } from '../lib/boardAging';
import { chatTaskStatus } from '../lib/chatTaskStatus';
import type {
  DrawScheduleRow,
  Permit,
  PermitCycle,
  PermitWithCycles,
  Project,
  ProjectHold,
  TeamMember,
} from '../lib/database.types';

// ===========================================================================
// fix-668 (P-024) — "HOLD TIME NEVER COUNTS", on every clock
// ===========================================================================
//
// Bobby, 2026-10-13: *"Hold time never counts."* One helper answers both
// shapes a clock takes — a SPAN (accountableDays) and a DEADLINE
// (holdAdjustedDue) — over one set of windows: the project's `hold` rows plus
// the permit's own, merged. These pin the helper, then one held case per clock.

type W = Pick<ProjectHold, 'hold_start' | 'hold_end'>;
const win = (hold_start: string, hold_end: string | null): W => ({ hold_start, hold_end });

// ---------------------------------------------------------------------------
// §1 · the helper
// ---------------------------------------------------------------------------

describe('fix-668 §1: holdAdjustedDue — a deadline resumes where it left off', () => {
  const TODAY = '2026-10-14';

  it('no holds → the stored date, untouched', () => {
    expect(holdAdjustedDue([], '2026-09-01', '2026-10-01', TODAY)).toBe('2026-10-01');
    expect(holdAdjustedDue(null, '2026-09-01', '2026-10-01', TODAY)).toBe('2026-10-01');
  });

  it('a hold INSIDE the clock moves the due date out by exactly its length', () => {
    // clock 09-01 → due 10-01; held 09-10 → 09-20 (10 days)
    expect(holdAdjustedDue([win('2026-09-10', '2026-09-20')], '2026-09-01', '2026-10-01', TODAY)).toBe(
      '2026-10-11',
    );
  });

  it('a hold OVERLAPPING THE START counts only from the clock start', () => {
    // held 08-20 → 09-05, clock starts 09-01 → 4 held days count
    expect(holdAdjustedDue([win('2026-08-20', '2026-09-05')], '2026-09-01', '2026-10-01', TODAY)).toBe(
      '2026-10-05',
    );
  });

  it('a hold OVERLAPPING THE END (late work sat held) stops the lateness growing', () => {
    // due 10-01, held 09-28 → 10-08: 7 of those days fall after the clock start
    // and before today, all of them count — 10-01 + 10 = 10-11
    expect(holdAdjustedDue([win('2026-09-28', '2026-10-08')], '2026-09-01', '2026-10-01', TODAY)).toBe(
      '2026-10-11',
    );
  });

  it('an OPEN hold runs to today, so held work never ages', () => {
    // due 10-01, open hold since 09-25 → 19 held days to 10-14
    const due = holdAdjustedDue([win('2026-09-25', null)], '2026-09-01', '2026-10-01', TODAY);
    expect(due).toBe('2026-10-20');
    expect(due > TODAY).toBe(true);
  });

  it('TWO holds add up', () => {
    const due = holdAdjustedDue(
      [win('2026-09-05', '2026-09-10'), win('2026-09-15', '2026-09-18')],
      '2026-09-01',
      '2026-10-01',
      TODAY,
    );
    expect(due).toBe('2026-10-09'); // 5 + 3
  });

  it('a hold BEFORE the clock started does nothing', () => {
    expect(holdAdjustedDue([win('2026-06-01', '2026-07-01')], '2026-09-01', '2026-10-01', TODAY)).toBe(
      '2026-10-01',
    );
  });

  it('no anchor → only the held days AFTER the date count (a stored milestone)', () => {
    expect(holdAdjustedDue([win('2026-09-10', '2026-09-20')], null, '2026-10-01', TODAY)).toBe(
      '2026-10-01',
    );
    expect(holdAdjustedDue([win('2026-10-02', '2026-10-06')], null, '2026-10-01', TODAY)).toBe(
      '2026-10-05',
    );
  });
});

describe('fix-668 §1: project + permit holds, merged downward only', () => {
  const projectHolds = [
    { project_id: 'p1', kind: 'hold', hold_start: '2026-09-01', hold_end: '2026-09-11' },
  ];
  const permitHolds = [{ permit_id: 7, hold_start: '2026-09-06', hold_end: '2026-09-16' }];

  it('a project hold and a permit hold that OVERLAP count once (union, 15 days)', () => {
    const idx = pauseHoldIndex(projectHolds, permitHolds);
    const w = holdsForPermit(idx, { id: 7, project_id: 'p1' });
    expect(accountableDays(w, '2026-08-01', '2026-10-01', '2026-10-14')).toBe(61 - 15);
  });

  it("★★★ ONE-WAY: a permit's own hold never pauses its sibling", () => {
    const idx = pauseHoldIndex(projectHolds, permitHolds);
    const sibling = holdsForPermit(idx, { id: 8, project_id: 'p1' });
    expect(accountableDays(sibling, '2026-08-01', '2026-10-01', '2026-10-14')).toBe(61 - 10);
  });

  it('★★★ CANCELLED IS NOT A HOLD — a cancel row is never a pause window', () => {
    const idx = pauseHoldIndex(
      [{ project_id: 'p1', kind: 'cancelled', hold_start: '2026-09-01', hold_end: null }],
      [],
    );
    expect(holdsForPermit(idx, { id: 1, project_id: 'p1' })).toEqual([]);
  });

  it('a team task (no permit, no project) has no windows', () => {
    const idx = pauseHoldIndex(projectHolds, permitHolds);
    expect(holdsForPermit(idx, { id: null, project_id: null })).toEqual([]);
  });

  it('holdsByProjectId carries permit holds to every existing clock; a plain map does not', () => {
    const m = holdsByProjectId([], permitHolds as never);
    expect(holdsForPermit(m, { id: 7, project_id: 'p1' })).toHaveLength(1);
    const plain = attachPermitHolds(new Map<string, W[]>(), null);
    expect(holdsForPermit(plain, { id: 7, project_id: 'p1' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 · one held case per clock
// ---------------------------------------------------------------------------

let pid = 100;
function mkPermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    num: 'BLD-1',
    stage: null,
    stage_override: null,
    da: 'Trevor',
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
const mkCycle = (over: Partial<PermitCycle>): PermitCycle =>
  ({
    id: `c${++pid}`,
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
  }) as PermitCycle;
const mkProject = (id: string, over: Partial<Project> = {}): Project =>
  ({ id, address: `${id} Main St`, juris: 'Seattle', archived: false, notes: null, ...over }) as Project;

/** A RELEASED project hold. */
const projectHold = (project_id: string, hold_start: string, hold_end: string | null) => ({
  id: `h-${project_id}-${hold_start}`,
  project_id,
  kind: 'hold' as const,
  reason: 'Waiting on builder',
  note: null,
  hold_start,
  hold_end,
});

describe('fix-668 §2: task overdue (My Tasks + the /board bar)', () => {
  const task = { status: 'Open', target_date: '2026-10-01', created_at: '2026-09-01T16:00:00Z' };

  it('★★★ a task whose project was held for 3 weeks is no longer overdue', () => {
    expect(isTaskOverdue(task, '2026-10-14')).toBe(true); // the stored date says late
    expect(isTaskOverdue(task, '2026-10-14', [win('2026-09-10', '2026-10-01')])).toBe(false);
  });

  it('…and becomes overdue again once the paused days are used up', () => {
    // 21 held days → effective due 10-22
    expect(isTaskOverdue(task, '2026-10-23', [win('2026-09-10', '2026-10-01')])).toBe(true);
  });
});

describe('fix-668 §2: My Board forecast + My Tasks milestones', () => {
  const TODAY = '2026-08-26';
  const MILES: BoardViewer = { name: 'Miles', isOversight: false };
  const base = (over: Partial<BoardInput>): BoardInput => ({
    viewer: MILES,
    permits: [],
    projects: [mkProject('p1')],
    tasks: [],
    today: TODAY,
    ...over,
  });
  const mkTask = (over: Partial<BoardTask>): BoardTask =>
    ({
      id: 't1',
      permit_id: 1,
      parent_task_id: null,
      project_id: 'p1',
      project_address: 'p1 Main St',
      permit_type: 'Building Permit',
      bucket: 'de',
      text: 'Do the thing',
      start_date: null,
      target_date: '2026-08-01',
      due_date: null,
      done_at: null,
      sort_order: 0,
      assigned_to: 'Miles',
      discipline: 'ent',
      status: 'Open',
      primary_assignee: 'Miles',
      co_assignees: [],
      created_at: '2026-07-01T16:00:00Z',
      ...over,
    }) as BoardTask;

  it('★★★ a task due inside a RELEASED project hold is not past due', () => {
    const permit = mkPermit({ id: 1 });
    const t = mkTask({ permit_id: 1 });
    const raw = buildForecast(base({ permits: [permit], tasks: [t] }));
    expect(raw.past_due.all.some((i) => i.taskId === 't1')).toBe(true);

    // held 07-20 → 08-20: 31 days; 08-01 + 31 = 09-01
    const held = buildForecast(
      base({ permits: [permit], tasks: [t], holdRows: [projectHold('p1', '2026-07-20', '2026-08-20')] }),
    );
    const row = (['past_due', 'today', 'tomorrow', 'this_week', 'next_week', 'later'] as const)
      .flatMap((k) => held[k].all)
      .find((i) => i.taskId === 't1')!;
    expect(held.past_due.all.some((i) => i.taskId === 't1')).toBe(false);
    expect(row.date).toBe('2026-09-01');
    expect(row.daysLate).toBe(-6);
  });

  it('★★★ a target-submit milestone stops ageing for the held days after it', () => {
    const permit = mkPermit({ id: 2, target_submit: '2026-08-01' });
    const late = (f: ReturnType<typeof buildForecast>) =>
      f.past_due.all.find((i) => i.permitId === 2 && i.milestoneKind === 'target_submit')?.daysLate;
    expect(late(buildForecast(base({ permits: [permit] })))).toBe(25);
    // held 08-05 → 08-20: 15 days do not count
    expect(
      late(
        buildForecast(base({ permits: [permit], holdRows: [projectHold('p1', '2026-08-05', '2026-08-20')] })),
      ),
    ).toBe(10);
  });

  it("a permit's OWN hold does the same, and leaves its sibling alone", () => {
    const held = mkPermit({ id: 3, target_submit: '2026-08-01' });
    const sib = mkPermit({ id: 4, target_submit: '2026-08-01' });
    const f = buildForecast(
      base({
        permits: [held, sib],
        permitHoldRows: [{ permit_id: 3, hold_start: '2026-08-05', hold_end: '2026-08-20', reason: 'x', note: null }],
      }),
    );
    const late = (id: number) =>
      f.past_due.all.find((i) => i.permitId === id && i.milestoneKind === 'target_submit')?.daysLate;
    expect(late(3)).toBe(10);
    expect(late(4)).toBe(25);
  });
});

describe('fix-668 §2: dashboard urgency colours', () => {
  const now = new Date('2026-10-14T12:00:00');
  const permit = (over: Partial<Permit>) => mkPermit(over) as Permit;

  it('★★★ de — target submit: red without the hold, not red with it', () => {
    const p = permit({ target_submit: '2026-10-01' });
    expect(permitUrgency(p, [], 'de', now)).toBe('red');
    // held from the target date through today: not one day of it is late
    expect(permitUrgency(p, [], 'de', now, false, undefined, [win('2026-10-01', null)])).toBe('yellow');
    // a released hold shorter than the lateness still leaves it late
    expect(permitUrgency(p, [], 'de', now, false, undefined, [win('2026-10-02', '2026-10-13')])).toBe('red');
  });

  it('co — corrections waiting on us: held days leave the age', () => {
    const c = [mkCycle({ cycle_index: 1, corr_issued: '2026-09-15' })];
    const p = permit({});
    expect(permitUrgency(p, c, 'co', now)).toBe('red');
    expect(permitUrgency(p, c, 'co', now, false, undefined, [win('2026-09-16', '2026-10-12')])).toBe('ok');
  });

  it('ap — approved, not issued: held days leave the age', () => {
    const p = permit({ approval_date: '2026-09-01' });
    expect(permitUrgency(p, [], 'ap', now)).toBe('yellow');
    expect(permitUrgency(p, [], 'ap', now, false, undefined, [win('2026-09-02', '2026-10-10')])).toBe('ok');
  });

  it("pm — the CITY's own target is the city's clock and never moves", () => {
    const c = [mkCycle({ cycle_index: 1, submitted: '2026-09-01', city_target: '2026-10-01' })];
    const p = permit({});
    expect(permitUrgency(p, c, 'pm', now, false, '2026-10-01', [win('2026-09-02', '2026-10-13')])).toBe(
      'red',
    );
  });
});

describe('fix-668 §2: reports + trends now see PERMIT holds too', () => {
  it('★★★ intake → approval leaves a permit-only hold out (it never did before)', () => {
    const p = mkPermit({
      id: 501,
      approval_date: '2026-06-30',
      permit_cycles: [mkCycle({ permit_id: 501, cycle_index: 0, intake_accepted: '2026-04-01' })],
    });
    expect(avgIntakeToApproval([p], holdsByProjectId([]))).toBe(90);
    const m = holdsByProjectId([], [{ permit_id: 501, hold_start: '2026-05-01', hold_end: '2026-05-31' }]);
    expect(avgIntakeToApproval([p], m)).toBe(60);
  });
});

describe('fix-668 §2: team trend chart + redesign phase times', () => {
  const team = [{ name: 'Trevor', role: 'da' }] as TeamMember[];
  const p = mkPermit({ id: 601, dd_start: '2026-01-01', dd_end: '2026-03-02' }); // 60d
  const holds = holdsByProjectId([projectHold('p1', '2026-01-11', '2026-01-31') as unknown as ProjectHold]);

  it('★★★ the trend chart agrees with the snapshot: 60 → 40 days in DD', () => {
    const filters = { role: 'da' as const, associateName: 'Trevor', monthFrom: '2026-03', monthTo: '2026-03' };
    expect(computeTeamTrends([p], [], team, filters).ddPhase[0].associateAvg).toBe(60);
    expect(computeTeamTrends([p], [], team, filters, holds).ddPhase[0].associateAvg).toBe(40);
  });

  it('redesign vs original: a held original no longer looks slow', () => {
    const projects = [mkProject('p1')];
    const f = { dateFrom: null, dateTo: null, juris: '' };
    expect(computeRedesignCycleTimeComparison([p], projects, f).ddPhase.originalAvg).toBe(60);
    expect(computeRedesignCycleTimeComparison([p], projects, f, holds).ddPhase.originalAvg).toBe(40);
  });
});

describe('fix-668 §2: Approved – Awaiting Issuance age', () => {
  it('★★★ the age leaves the held days out', () => {
    const p = mkPermit({ id: 701, approval_date: '2026-09-01' }) as Permit;
    const projects = new Map([['p1', mkProject('p1')]]);
    expect(buildApprovedAwaitingRows([p], projects, '2026-10-01')[0].daysSinceApproval).toBe(30);
    const idx = pauseHoldIndex([projectHold('p1', '2026-09-10', '2026-09-30')], []);
    expect(buildApprovedAwaitingRows([p], projects, '2026-10-01', undefined, idx)[0].daysSinceApproval).toBe(
      10,
    );
  });
});

describe('fix-668 §2: vendor report "overdue"', () => {
  it('★★★ a target send that fell due during a hold is not overdue', () => {
    const p = mkProject('p1');
    const draw = [
      {
        project_id: 'p1',
        da_assigned: null,
        start_week: '2026-07-06',
        end_week: null,
        status: 'Scheduled',
        manual_status: false,
        manually_placed: false,
        dd_start: null,
        dd_end: '2026-08-02',
        notes: null,
        status_override: null,
        updated_at: '2026-07-01T00:00:00Z',
      } as unknown as DrawScheduleRow,
    ];
    const consultants = consultantByProject(
      [
        {
          project_id: 'p1',
          discipline: 'Structural',
          firm_name: 'SSS',
          firm_active: true,
          status: 'Scheduled',
          est_send: null,
          sent: null,
          est_recd: null,
        },
      ],
      'Structural',
    );
    const build = (holdWindowsByProject?: ReturnType<typeof pauseHoldIndex>) =>
      buildVendorScheduleRows({
        draw,
        projects: [p],
        ledger: [],
        consultants,
        todayIso: '2026-08-03',
        holdWindowsByProject,
      })[0];
    expect(build().overdue).toBe(true);
    expect(build(pauseHoldIndex([projectHold('p1', '2026-07-20', null)], [])).overdue).toBe(false);
  });
});

describe('fix-668 §2: board aging (time in state)', () => {
  it('★★★ a permit parked by a hold is not "stale" for the parked stretch', () => {
    const p = mkPermit({ id: 801, approval_date: '2026-07-01' });
    const run = (holdIndex?: ReturnType<typeof pauseHoldIndex>) =>
      buildAging({ permits: [p], projectAddress: () => 'x', today: '2026-08-14', holdIndex }).aged.find(
        (r) => r.permitId === 801,
      );
    expect(run()?.daysInState).toBe(44);
    expect(run(pauseHoldIndex([projectHold('p1', '2026-07-02', '2026-08-13')], []))).toBeUndefined();
  });
});

describe('fix-668 §2: project chat task line', () => {
  it('★★★ "overdue" is not shown for a task that fell due inside a hold', () => {
    const m = {
      task_id: 't1',
      task_status: 'Open',
      task_done: false,
      task_done_at: null,
      task_assigned_to: 'Miles',
      task_due_date: '2026-10-01',
    };
    const now = new Date('2026-10-10T12:00:00');
    expect(chatTaskStatus(m, now)?.overdueDue).toBe('10/1');
    expect(chatTaskStatus(m, now, [win('2026-09-28', null)])?.overdueDue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §3 · the server clocks — the migration patches OURS and leaves the CITY's
// ---------------------------------------------------------------------------

describe('fix-668 §3: the migration (no live DB in CI — the text is the contract)', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../migrations/fix_668_hold_time_never_counts.sql'),
    'utf8',
  );

  it('defines the SQL twin and reads only `hold` rows, never a cancel', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.bp_held_days\(p_permit_id integer, p_from date, p_to date\)/);
    expect(sql).toMatch(/h\.kind = 'hold'/);
    expect(sql).not.toMatch(/kind = 'cancelled'/);
    expect(sql).toMatch(/range_agg/);
  });

  it("★★★ patches OUR three learner clocks — and no CITY clock", () => {
    for (const label of [
      'duration_stats/our_turnaround',
      'duration_stats/intake_to_approval',
      'duration_stats/c1_resub_offset',
      'phase_durations/ours',
      'phase_grid/ours',
      'snapshot/b_age',
      'snapshot/d_age',
      'snapshot/e_age',
      'weekly_da/permit_hold',
    ]) {
      expect(sql).toContain(`'${label}'`);
    }
    // the city's clocks are never an anchor
    expect(sql).not.toMatch(/\(pc\.corr_issued - pc\.submitted\)/);
    expect(sql).not.toMatch(/city_target\)/);
    expect(sql).not.toMatch(/'city_review'/);
    expect(sql).not.toMatch(/resubmit_by/);
  });

  it('is idempotent and patches by anchor, each matched exactly once', () => {
    expect(sql).toMatch(/expected 1/);
    expect((sql.match(/IF position\('bp_held_days' IN v_def\) = 0 THEN/g) ?? []).length).toBe(6);
  });
});
