import { describe, it, expect } from 'vitest';
import {
  BOARD_SECTION_CAPS,
  buildForecast,
  buildQueue,
  milestoneAction,
  sourceSplit,
  type BoardInput,
  type BoardTask,
  type BoardViewer,
  type ForecastItem,
} from '../lib/myBoard';
import {
  buildHandedOff,
  milestoneCounterparty,
  milestoneWhyYours,
} from '../lib/boardOwnership';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// fix-348 — My Board, reviewed holistically
// ===========================================================================
//
// Bobby: *"There seems like there is a little confliction… I think the whole My
// Board just needs to be re-looked at holistically and make sure that it is
// functioning and talking to every category and every section accurately."*
//
// ★ THE MAP IS THE DELIVERABLE, and this file is the map made executable: one
// describe per bucket, each naming the rule that fills it.
//
// ★★ RE-MEASURED FIRST, on prod 2026-08-19, because fix-337 landed after the
// screenshot and removed 335 false milestone prompts:
//
//   open tasks 558 · with a due_date 0 · with a target_date 278
//   unassigned + no co-assignee 344 (275 ent, 68 arch, 1 no discipline)
//   …of those 275 ent, 274 sit on a permit that HAS an entitlement lead
//   past-due milestones  Miles 57 · Briana 50 · Nicky 12 · Bobby 2
//   past-due tasks       Miles 145 · Briana 16 · Qisheng 8 · everyone else ≤5
//
// ★ THE TWO CONTRADICTIONS WERE REPRODUCED, not inferred from the screenshot.
// Permit 10491 on prod — `4137 54th Ave SW · PAR/Pre-Sub`, da='Cam',
// ent_lead='Bobby', target_submit='2026-08-17', nothing submitted, exactly one
// open `arch` task — is rebuilt verbatim below and produces both symptoms
// against the old code.

const TODAY = '2026-08-19';

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
    ent_lead: null,
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
    updated_at: '2026-08-17T12:00:00Z',
    permit_cycles: [{ id: 'c0', permit_id: 0, cycle_index: 0 }],
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
    project_address: '4137 54th Ave SW',
    permit_type: 'PAR/Pre-Sub',
    bucket: 'de',
    text: 'Do the thing',
    start_date: null,
    target_date: null,
    due_date: null,
    done_at: null,
    sort_order: 0,
    assigned_to: null,
    discipline: 'ent',
    status: 'Open',
    primary_assignee: null,
    co_assignees: [],
    permit_da: null,
    ...over,
  } as BoardTask;
}

function mkProject(id: string, address: string): Project {
  return {
    id,
    address,
    juris: 'Seattle',
    archived: false,
    notes: null,
    schematic_designer: [],
  } as unknown as Project;
}

const BOBBY: BoardViewer = { name: 'Bobby', isOversight: false };
const CAM: BoardViewer = { name: 'Cam', isOversight: false };

function input(over: Partial<BoardInput>): BoardInput {
  return {
    viewer: BOBBY,
    permits: [],
    projects: [mkProject('p1', '4137 54th Ave SW')],
    tasks: [],
    today: TODAY,
    ...over,
  };
}

/** ★ The permit from the screenshot, rebuilt from its prod row. Two-leg (a DA
 *  AND an open arch task), target_submit one day past, nothing submitted — so
 *  the entitlement leg is 'waiting' on the design half. */
function theScreenshot(): { permits: PermitWithCycles[]; tasks: BoardTask[] } {
  const permit = mkPermit({
    type: 'PAR/Pre-Sub',
    da: 'Cam',
    ent_lead: 'Bobby',
    target_submit: '2026-08-18',
  });
  const tasks = [
    mkTask({ permit_id: permit.id, discipline: 'arch', assigned_to: 'Cam' }),
  ];
  return { permits: [permit], tasks };
}

function allBuckets(f: ReturnType<typeof buildForecast>): ForecastItem[] {
  return [
    ...f.past_due.all,
    ...f.today.all,
    ...f.tomorrow.all,
    ...f.this_week.all,
    ...f.next_week.all,
  ];
}

// ===========================================================================
// §1 — THE INVARIANTS. Whatever the cause, these two cannot come back.
// ===========================================================================

describe('fix-348 §1: the two contradictions, reproduced then made impossible', () => {
  it('★★★ CONTRADICTION 1 (across buckets): one item appears in AT MOST ONE place', () => {
    const { permits, tasks } = theScreenshot();
    const f = buildForecast(input({ permits, tasks }));

    // The dated buckets and the handed-off section are disjoint by
    // construction: buildForecast splits, it no longer re-filters.
    const datedKeys = allBuckets(f).map((i) => i.key);
    const handedKeys = f.handed_off.map((i) => i.key);
    expect(new Set(datedKeys).size).toBe(datedKeys.length);
    for (const k of handedKeys) expect(datedKeys).not.toContain(k);

    // ★ And specifically: this permit is past due for Bobby and is NOT in the
    // handed-off list, because an entitlement-leg wait is INCOMING work. He did
    // not hand it to anybody — the old code told him he had handed it to
    // himself ("Bobby · 1 day").
    expect(f.past_due.total).toBe(1);
    expect(f.handed_off).toHaveLength(0);
    expect(buildHandedOff(f.handed_off.map((i) => ({ ...i, withWhom: i.withWhom ?? '' })))).toEqual([]);
  });

  it('★★★ CONTRADICTION 2 (inside one row): the prose and the named person agree', () => {
    const { permits, tasks } = theScreenshot();
    const f = buildForecast(input({ permits, tasks }));
    const row = f.past_due.all[0]!;

    // The row is the entitlement leg, waiting on the design half. Cam is the DA.
    expect(row.actionable).toBe(false);
    expect(row.withWhom).toBe('Cam');
    expect(row.actionLine).toBe('Wait — with Cam');
    expect(row.whyYours).toBe('Not yours yet — with Cam');

    // ★ THE REGRESSION, NAMED. `why` used to append "Sitting with the
    // entitlement lead." to every waiting row whatever its leg — so this row
    // said the permit was with the entitlement lead (Bobby, the viewer) one
    // line above "Wait — with Cam".
    expect(row.why).not.toMatch(/entitlement lead/i);
    expect(row.why).not.toMatch(/sitting with/i);

    // Every string on the row that names somebody names the SAME somebody.
    const named = [row.actionLine, row.whyYours, row.withWhom ?? ''];
    for (const s of named) expect(s).toContain('Cam');
    for (const s of named) expect(s).not.toContain('Bobby');
  });

  it('★★ the counterparty follows the LEG, and there is only one definition of it', () => {
    const permit = { da: 'Cam', ent_lead: 'Bobby' };
    // Entitlement leg waiting → design still holds it → the DA.
    expect(milestoneCounterparty('entitlement', permit).name).toBe('Cam');
    expect(milestoneCounterparty('entitlement', permit).role).toBe('design associate');
    // Design leg waiting → design finished → the lead holds it.
    expect(milestoneCounterparty('design', permit).name).toBe('Bobby');
    expect(milestoneCounterparty('design', permit).role).toBe('entitlement lead');

    // ★ The three consumers all read that one answer — asserted by giving them
    // the same input and requiring the same name out.
    const m = { date: '2026-08-18', daysLate: 1 };
    expect(milestoneAction('target_submit', 'entitlement', 'waiting', permit, m)).toContain('Cam');
    expect(milestoneWhyYours('entitlement', 'waiting', permit)).toContain('Cam');
    expect(milestoneAction('target_submit', 'design', 'waiting', permit, m)).toContain('Bobby');
    expect(milestoneWhyYours('design', 'waiting', permit)).toContain('Bobby');
  });

  it('★ an empty seat is named by its ROLE, never left blank and never "the other half"', () => {
    expect(milestoneCounterparty('entitlement', { da: null }).label).toBe(
      'the design associate',
    );
    expect(milestoneCounterparty('design', { ent_lead: '  ' }).label).toBe(
      'the entitlement lead',
    );
  });

  it('★★ the OUTGOING direction still reaches the handed-off section, naming the lead', () => {
    // Design finished (its one arch task resolved) on a two-leg permit → the
    // design leg is 'waiting' and this IS a handoff.
    const permit = mkPermit({
      da: 'Cam',
      ent_lead: 'Bobby',
      target_submit: '2026-08-18',
    });
    const tasks = [
      mkTask({ permit_id: permit.id, discipline: 'arch', status: 'Resolved' }),
    ];
    const f = buildForecast(
      input({ viewer: CAM, permits: [permit], tasks }),
    );
    expect(f.handed_off).toHaveLength(1);
    expect(f.handed_off[0]!.withWhom).toBe('Bobby');
    // ★ And it LEFT the dated buckets — fix-308 #46's comment finally true.
    expect(f.past_due.total).toBe(0);
    const shaped = buildHandedOff(
      f.handed_off.map((i) => ({ ...i, withWhom: i.withWhom ?? '' })),
    );
    expect(shaped).toHaveLength(1);
    expect(shaped[0]!.withWhom).toBe('Bobby');
    expect(shaped[0]!.daysAgo).toBe(1);
  });

  it('★ the queue names the counterparty by leg too — it used to always say the DA', () => {
    // A corrections permit whose design half is done, seen by the DA: the row
    // is with the ENTITLEMENT lead, not with the DA (who is the viewer).
    const permit = mkPermit({
      da: 'Cam',
      ent_lead: 'Bobby',
      permit_cycles: [
        {
          id: 'c0',
          permit_id: 1,
          cycle_index: 0,
          submitted: '2026-06-01',
          intake_accepted: '2026-06-05',
          corr_issued: '2026-07-01',
        },
      ],
    } as Partial<PermitWithCycles>);
    const tasks = [
      mkTask({ permit_id: permit.id, discipline: 'arch', status: 'Resolved' }),
    ];
    const q = buildQueue(input({ viewer: CAM, permits: [permit], tasks }));
    const row = q.waiting_on_design.all[0]!;
    expect(row.status).toBe('With Bobby');
    expect(row.status).not.toContain('Cam');
  });
});

// ===========================================================================
// §2 — THE BUCKETS. One test per bucket, naming the rule that fills it.
// ===========================================================================

describe('fix-348 §2: every forecast bucket, and the rule that fills it', () => {
  /** A task owned by Bobby (he is the ent lead; the task is unassigned `ent`),
   *  dated `date`. */
  function dated(date: string) {
    const permit = mkPermit({ ent_lead: 'Bobby', da: 'Cam' });
    return {
      permits: [permit],
      tasks: [mkTask({ permit_id: permit.id, target_date: date, text: `due ${date}` })],
    };
  }

  it('PAST DUE — rule: dated item whose date is BEFORE today (daysLate > 0)', () => {
    const f = buildForecast(input(dated('2026-08-18')));
    expect(f.past_due.total).toBe(1);
    expect(f.past_due.all[0]!.stateLabel).toBe('Past due');
  });

  it('TODAY — rule: date === today (daysLate === 0)', () => {
    const f = buildForecast(input(dated(TODAY)));
    expect(f.today.total).toBe(1);
    expect(f.today.all[0]!.stateLabel).toBe('Due today');
  });

  it('TOMORROW — rule: exactly one day out (daysLate === -1)', () => {
    const f = buildForecast(input(dated('2026-08-20')));
    expect(f.tomorrow.total).toBe(1);
  });

  it('THIS WEEK — rule: 2..7 days out, ordered by date not by lateness', () => {
    const permit = mkPermit({ ent_lead: 'Bobby' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [
          mkTask({ permit_id: permit.id, target_date: '2026-08-26', text: 'later' }),
          mkTask({ permit_id: permit.id, target_date: '2026-08-21', text: 'sooner' }),
        ],
      }),
    );
    expect(f.this_week.total).toBe(2);
    expect(f.this_week.all.map((i) => i.verb)).toEqual(['sooner', 'later']);
  });

  it('NEXT WEEK — rule: 8..14 days out (fix-304 §23, so "what is coming" reaches past Friday)', () => {
    const f = buildForecast(input(dated('2026-08-30')));
    expect(f.next_week.total).toBe(1);
  });

  it('★ BEYOND next week — rule: nothing. There is no "later" section, by design', () => {
    const f = buildForecast(input(dated('2026-10-01')));
    expect(allBuckets(f)).toHaveLength(0);
    expect(BOARD_SECTION_CAPS.later).toBe(0);
  });

  it('★ NO DATE — rule: never in the forecast at all. It is a QUEUE row', () => {
    const permit = mkPermit({ ent_lead: 'Bobby' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [mkTask({ permit_id: permit.id, target_date: null })],
      }),
    );
    expect(allBuckets(f)).toHaveLength(0);
  });

  it('HANDED OFF — rule: the OUTGOING leg only, and it is not a dated bucket', () => {
    const permit = mkPermit({ da: 'Cam', ent_lead: 'Bobby', target_submit: '2026-08-18' });
    const tasks = [mkTask({ permit_id: permit.id, discipline: 'arch', status: 'Resolved' })];
    const f = buildForecast(input({ viewer: CAM, permits: [permit], tasks }));
    expect(f.handed_off).toHaveLength(1);
    expect(f.handed_off[0]!.handedOff).toBe(true);
    expect(allBuckets(f)).toHaveLength(0);
  });
});

describe('fix-348 §2: every QUEUE group, and the rule that fills it', () => {
  const cyc = (over: Record<string, unknown>) => ({
    id: 'c0',
    permit_id: 1,
    cycle_index: 0,
    ...over,
  });

  it('BLOCKED ON YOU — rule: a stateful (dateless) milestone whose relay state is MINE', () => {
    const permit = mkPermit({
      ent_lead: 'Bobby',
      permit_cycles: [
        cyc({ submitted: '2026-06-01', intake_accepted: '2026-06-05', corr_issued: '2026-07-01' }),
      ],
    } as Partial<PermitWithCycles>);
    const q = buildQueue(input({ permits: [permit] }));
    expect(q.blocked_on_you.total).toBe(1);
  });

  it('WAITING ON DESIGN — rule: a stateful milestone whose relay state is WAITING', () => {
    const permit = mkPermit({
      da: 'Cam',
      ent_lead: 'Bobby',
      permit_cycles: [
        cyc({ submitted: '2026-06-01', intake_accepted: '2026-06-05', corr_issued: '2026-07-01' }),
      ],
    } as Partial<PermitWithCycles>);
    const tasks = [mkTask({ permit_id: permit.id, discipline: 'arch', status: 'Open' })];
    const q = buildQueue(input({ permits: [permit], tasks }));
    expect(q.waiting_on_design.total).toBe(1);
    expect(q.waiting_on_design.all[0]!.status).toBe('With Cam');
  });

  it('WAITING ON THE CITY — rule: nothing stateful, submitted, and not yet approved', () => {
    const permit = mkPermit({
      ent_lead: 'Bobby',
      permit_cycles: [cyc({ submitted: '2026-06-01', intake_accepted: '2026-06-05' })],
      updated_at: `${TODAY}T12:00:00Z`,
    } as Partial<PermitWithCycles>);
    const q = buildQueue(input({ permits: [permit] }));
    expect(q.waiting_on_city.total).toBe(1);
  });

  it('★ NOT IN THE QUEUE AT ALL — rule: pre-submittal with nothing stateful', () => {
    const permit = mkPermit({ ent_lead: 'Bobby', target_submit: '2026-09-01' });
    const q = buildQueue(input({ permits: [permit] }));
    expect(q.projectCount).toBe(0);
  });
});

// ===========================================================================
// §3 — THE BLEND. Tasks and milestones in one dated forecast.
// ===========================================================================

describe('fix-348 §3: tasks and milestones share the date buckets', () => {
  it('★★★ THE BUG: the task path read `due_date`, a column the app cannot write', () => {
    // Measured on prod 2026-08-19: 0 of 558 open tasks carry a due_date; 278
    // carry a target_date, and the live editor (TaskDetailEditor) offers Start
    // Date and Target Date only. The old loop keyed on due_date, so it emitted
    // nothing, ever — which is exactly "I don't really see any my tasks".
    const permit = mkPermit({ ent_lead: 'Bobby' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [mkTask({ permit_id: permit.id, target_date: '2026-08-18', due_date: null })],
      }),
    );
    expect(f.past_due.total).toBe(1);
    expect(f.past_due.all[0]!.source).toBe('task');
  });

  it('★ due_date still works as a fallback when something sets it', () => {
    const permit = mkPermit({ ent_lead: 'Bobby' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [mkTask({ permit_id: permit.id, target_date: null, due_date: '2026-08-18' })],
      }),
    );
    expect(f.past_due.total).toBe(1);
  });

  it('★ target_date WINS over due_date — it is the one the team actually sets', () => {
    const permit = mkPermit({ ent_lead: 'Bobby' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [
          mkTask({ permit_id: permit.id, target_date: '2026-08-18', due_date: '2026-09-30' }),
        ],
      }),
    );
    expect(f.past_due.all[0]!.date).toBe('2026-08-18');
  });

  it('★★ both kinds land in the same bucket and stay TELLABLE APART', () => {
    const permit = mkPermit({ ent_lead: 'Bobby', target_submit: '2026-08-18' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [mkTask({ permit_id: permit.id, target_date: '2026-08-18' })],
      }),
    );
    expect(f.past_due.total).toBe(2);
    expect(new Set(f.past_due.all.map((i) => i.source))).toEqual(
      new Set(['task', 'milestone']),
    );
    // The distinction is DATA, not styling — fix-304 §21's row vocabulary reads
    // this field to pick the ✓ task / ◆ milestone badge.
    expect(sourceSplit(f.past_due.all)).toEqual({ milestones: 1, tasks: 1 });
  });

  it('★★ PAST DUE DOES NOT BECOME A WALL: the cap holds, and shows both kinds', () => {
    // Miles's real shape, scaled down to the cap: many more milestones than the
    // section can show, plus tasks. A pure lateness sort would show five
    // milestones and no tasks — the complaint, re-created inside a section.
    const permits = Array.from({ length: 10 }, (_, i) =>
      mkPermit({ ent_lead: 'Bobby', target_submit: '2026-01-01', project_id: 'p1', id: 100 + i }),
    );
    const tasks = permits.map((p) =>
      mkTask({ permit_id: p.id, target_date: '2026-08-18', text: `task ${p.id}` }),
    );
    const f = buildForecast(input({ permits, tasks }));
    expect(f.past_due.total).toBe(20);
    expect(f.past_due.items).toHaveLength(BOARD_SECTION_CAPS.past_due);
    const shown = sourceSplit(f.past_due.items);
    expect(shown.milestones).toBeGreaterThan(0);
    expect(shown.tasks).toBeGreaterThan(0);
    // ★ The cap never hides the scale: `all` keeps every row for "Show all".
    expect(f.past_due.all).toHaveLength(20);
    expect(f.past_due.capped).toBe(true);
  });

  it('★ a section with only one kind is unaffected by the interleave', () => {
    const permits = Array.from({ length: 8 }, (_, i) =>
      mkPermit({ ent_lead: 'Bobby', target_submit: '2026-01-01', id: 200 + i }),
    );
    const f = buildForecast(input({ permits }));
    expect(f.past_due.items).toHaveLength(BOARD_SECTION_CAPS.past_due);
    expect(sourceSplit(f.past_due.items).tasks).toBe(0);
  });

  it('★ a RESOLVED or CANCELLED task is not forecast work', () => {
    const permit = mkPermit({ ent_lead: 'Bobby' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [
          mkTask({ permit_id: permit.id, target_date: '2026-08-18', status: 'Resolved' }),
          mkTask({ permit_id: permit.id, target_date: '2026-08-18', status: 'Cancelled' }),
        ],
      }),
    );
    expect(allBuckets(f)).toHaveLength(0);
  });

  it('★ a task on a CANCELLED PROJECT is not work either (fix-264)', () => {
    const permit = mkPermit({ ent_lead: 'Bobby' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [mkTask({ permit_id: permit.id, target_date: '2026-08-18' })],
        cancelledIds: new Set(['p1']),
      }),
    );
    expect(allBuckets(f)).toHaveLength(0);
  });

  it('★ a task on a SUB-PERMIT is not work either (fix-194)', () => {
    const parent = mkPermit({ ent_lead: 'Bobby' });
    const sub = mkPermit({ ent_lead: 'Bobby', parent_permit_id: parent.id });
    const f = buildForecast(
      input({
        permits: [parent, sub],
        tasks: [mkTask({ permit_id: sub.id, target_date: '2026-08-18' })],
      }),
    );
    expect(allBuckets(f)).toHaveLength(0);
  });
});

// ===========================================================================
// §4 — ★★★ THE UNASSIGNED QUESTION. Answered, and asserted either way.
// ===========================================================================
//
// The brief: *"THE QUESTION THE MAP MUST ANSWER: does an unassigned task reach
// anyone? … if it does not, 322 tasks are invisible to everyone, which would be
// the largest finding on this board."*
//
// ★ THE ANSWER, MEASURED: post-fix-337 the figure is 275 open unassigned `ent`
// tasks (was 322) and 68 `arch` (was 78). They DO reach somebody — but only
// through fix-238's resolver, which is the My Tasks rule. `resolvePrimaryAssignee`
// maps an UNSET assignee to the discipline's default owner (fix-230: 'ent' →
// the entitlement lead, otherwise the DA), so all 274 of the 275 whose permit
// carries an ent lead land in that person's My Tasks. One does not.
//
// ★★★ AND THE BOARD DID NOT USE THAT RULE. buildForecast compared `assigned_to`
// as a raw string, so on MY BOARD every one of the 344 unassigned tasks — and
// every role-assigned one — reached nobody. Two surfaces on one screen, two
// answers. That is the finding, and it is fixed here rather than reported,
// because the blend above would otherwise have surfaced only the 214 tasks that
// carry a literal name.
//
// ★ Nothing is mass-assigned. Ownership is DERIVED at read time, exactly as My
// Tasks has always derived it; not one row is written.

describe('fix-348 §4: does an unassigned task reach anybody?', () => {
  it('★★★ an unassigned ENT task reaches the permit\'s ENTITLEMENT LEAD', () => {
    const permit = mkPermit({ ent_lead: 'Bobby', da: 'Cam' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [
          mkTask({
            permit_id: permit.id,
            discipline: 'ent',
            assigned_to: null,
            target_date: '2026-08-18',
          }),
        ],
      }),
    );
    expect(f.past_due.total).toBe(1);
  });

  it('★ …and NOT the DA — fix-308 #44\'s rule survives', () => {
    const permit = mkPermit({ ent_lead: 'Bobby', da: 'Cam' });
    const f = buildForecast(
      input({
        viewer: CAM,
        permits: [permit],
        tasks: [
          mkTask({
            permit_id: permit.id,
            discipline: 'ent',
            assigned_to: null,
            target_date: '2026-08-18',
          }),
        ],
      }),
    );
    expect(allBuckets(f)).toHaveLength(0);
  });

  it('★★ an unassigned ARCH task reaches the DA — fix-238\'s blanket, on the board too', () => {
    const permit = mkPermit({ ent_lead: 'Bobby', da: 'Cam' });
    const f = buildForecast(
      input({
        viewer: CAM,
        permits: [permit],
        tasks: [
          mkTask({
            permit_id: permit.id,
            discipline: 'arch',
            assigned_to: null,
            permit_da: 'Cam',
            target_date: '2026-08-18',
          }),
        ],
      }),
    );
    expect(f.past_due.total).toBe(1);
  });

  it('★★ a ROLE-assigned task routes to whoever holds the role, not to the name', () => {
    // The 4040/4060 E Via Estrella bug fix-238 fixed, asserted on the board.
    const permit = mkPermit({ ent_lead: 'Bobby', da: 'Cam', dm: 'Derry' });
    const task = mkTask({
      permit_id: permit.id,
      discipline: 'arch',
      assigned_to: 'Design Manager',
      target_date: '2026-08-18',
    });
    const derry: BoardViewer = { name: 'Derry', isOversight: false };
    expect(
      buildForecast(input({ viewer: derry, permits: [permit], tasks: [task] })).past_due
        .total,
    ).toBe(1);
  });

  it('★ a CO-ASSIGNEE reaches the board as well as My Tasks', () => {
    const permit = mkPermit({ ent_lead: 'Miles', da: 'Cam' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [
          mkTask({
            permit_id: permit.id,
            discipline: 'ent',
            assigned_to: 'Miles',
            co_assignees: ['Bobby'],
            target_date: '2026-08-18',
          }),
        ],
      }),
    );
    expect(f.past_due.total).toBe(1);
  });

  it('★ an unassigned task on a permit with NOBODY on it reaches nobody — and says so honestly', () => {
    // ★ Re-measured: ZERO open unassigned tasks sit on such a permit today (the
    // brief's "permits with neither: 1" counted PERMITS, and that permit has no
    // open unassigned task). The rule is still asserted, because it is the one
    // case the resolver cannot answer: there is no correct person to route to,
    // and inventing one would be the mass-assignment the brief rules out.
    const permit = mkPermit({ ent_lead: null, da: null });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [
          mkTask({
            permit_id: permit.id,
            discipline: 'ent',
            assigned_to: null,
            target_date: '2026-08-18',
          }),
        ],
      }),
    );
    expect(allBuckets(f)).toHaveLength(0);
  });

  it('★★ the injected resolver is what the page uses — the default is not a stub', () => {
    // MyBoard passes useTaskOwnership().matches, which additionally consults
    // dm_da_groups. Both must be the SAME rule, so an injected resolver that
    // says no wins over a default that would have said yes.
    const permit = mkPermit({ ent_lead: 'Bobby' });
    const task = mkTask({ permit_id: permit.id, target_date: '2026-08-18' });
    const withDefault = buildForecast(input({ permits: [permit], tasks: [task] }));
    expect(withDefault.past_due.total).toBe(1);
    const injected = buildForecast(
      input({ permits: [permit], tasks: [task], taskOwns: () => false }),
    );
    expect(allBuckets(injected)).toHaveLength(0);
  });
});
