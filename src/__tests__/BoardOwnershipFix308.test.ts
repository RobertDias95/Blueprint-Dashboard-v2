import { describe, it, expect } from 'vitest';
import {
  buildForecast,
  buildQueue,
  designLegStatus,
  handoffAffordance,
  legShape,
  relayStateFor,
  resolveBoardViewer,
  type BoardInput,
  type BoardTask,
} from '../lib/myBoard';
import type { PermitWithCycles, Project } from '../lib/database.types';
import {
  DA_QUEUE_KINDS,
  UNOWNED_LABEL,
  buildHandedOff,
  byWorstFirst,
  daQueueAllows,
  handedOffEscalates,
  milestoneStateLabel,
  milestoneWhyYours,
  taskOwnership,
  unownedSurfacesTo,
  usesDaQueueShape,
} from '../lib/boardOwnership';

// fix-308 (register #42–#47) — the board is naming the wrong person.
//
// ★★ THE CASE, verified against prod before a line was changed. Bobby sat with
// Cam on 3921 43rd Ave S, the Demolition permit. The board told him two
// contradictory things at once — "ready to hand off" AND "blocked by Cam" —
// and he had no task on it at all.
//
//   permit 165 · 7133443-DM · Corrections Required · DA Cam · ENT Miles
//   six tasks, EVERY ONE discipline='ent', not one 'arch'
//   open: "Resubmit to the city" (Miles) and "Waiting on min risk statement"
//         (nobody, target 2026-08-04, past due)
//
// Reproduced exactly on prod 2026-08-16. Both lies came from `da IS NOT NULL`
// alone meaning "this permit has a design leg" — it does not, it means somebody
// is named in a column.
//
// ★ RE-MEASURED, since the brief says to treat its figures as claims:
//     active permits ............................ 282
//     …with a DA ................................ 161   (brief said 167)
//     …that have never had a single arch task ... 100   (brief said 106) = 62%
//     open tasks ................................ 501   ✓ matches
//     open tasks with no assignee ............... 316   ✓ matches (63%)
//   The brief's #44 heading says "234 unassigned"; its own table says 316, and
//   316 is what prod holds. The defect shape is confirmed either way.

const TODAY = '2026-08-16';

let pid = 0;
let tid = 0;

function mkPermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    target_submit: null,
    approval_date: null,
    actual_issue: null,
    intake_date: null,
    dd_start: null,
    dd_end: null,
    parent_permit_id: null,
    updated_at: '2026-08-10T00:00:00Z',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

function mkTask(over: Partial<BoardTask> = {}): BoardTask {
  return {
    id: `t${++tid}`,
    permit_id: 1,
    parent_task_id: null,
    project_id: 'p1',
    project_address: '3921 43rd Ave S',
    permit_type: 'Demolition',
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
    ...over,
  } as unknown as BoardTask;
}

function mkProject(id: string, address: string): Project {
  return { id, address } as unknown as Project;
}

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    viewer: resolveBoardViewer('Miles', []),
    permits: [],
    projects: [mkProject('p1', '3921 43rd Ave S')],
    tasks: [],
    today: TODAY,
    ...over,
  } as BoardInput;
}

// ---------------------------------------------------------------------------
// ★★ #42/#43 — the acceptance test
// ---------------------------------------------------------------------------

describe('fix-308 ★★ the 3921 case, by name', () => {
  /** Permit 165 as prod holds it: DA Cam, ENT Miles, six ENT tasks, no arch. */
  function permit3921() {
    const p = mkPermit({
      type: 'Demolition',
      num: '7133443-DM',
      status: 'Corrections Required',
      da: 'Cam',
      ent_lead: 'Miles',
      target_submit: '2026-03-01',
    });
    const tasks = [
      mkTask({ permit_id: p.id, text: 'Verify: intake submitted / fees paid', status: 'Resolved' }),
      mkTask({ permit_id: p.id, text: 'Verify: intake accepted', status: 'Resolved' }),
      mkTask({ permit_id: p.id, text: 'Corrections issued (cycle 1)', status: 'Resolved' }),
      mkTask({ permit_id: p.id, text: 'Resubmit to the city', assigned_to: 'Miles' }),
      mkTask({ permit_id: p.id, text: 'Sent Plans to cam', status: 'Resolved' }),
      mkTask({ permit_id: p.id, text: 'Waiting on min risk statement', target_date: '2026-08-04' }),
    ];
    return { p, tasks };
  }

  it('★★ has NO design leg — a named DA is not a design leg', () => {
    const { p, tasks } = permit3921();
    expect(legShape(p, tasks)).toBe('one-leg');
    // Every task really is ENT — the fixture is the prod shape, not a strawman.
    expect(tasks.every((t) => t.discipline === 'ent')).toBe(true);
  });

  it('★★ shows Cam NOTHING — not "ready to hand off", not "blocked by"', () => {
    const { p, tasks } = permit3921();
    const cam = resolveBoardViewer('Cam', []);
    const f = buildForecast(input({ viewer: cam, permits: [p], tasks }));
    const rows =
      f.past_due.total + f.today.total + f.tomorrow.total + f.this_week.total +
      f.next_week.total;
    expect(rows, 'Cam has no task on this permit and must see no row').toBe(0);

    const q = buildQueue(input({ viewer: cam, permits: [p], tasks }));
    expect(q.blocked_on_you.total).toBe(0);
    expect(q.waiting_on_design.total).toBe(0);
  });

  it('★★ and offers no handoff — there is nothing to hand off FROM', () => {
    const { p, tasks } = permit3921();
    expect(handoffAffordance(p, tasks, [])).toBe('none');
  });

  it('★★ it is MILES\'s permit — the ENT lead is named, and it is his to act on', () => {
    const { p, tasks } = permit3921();
    const miles = resolveBoardViewer('Miles', []);
    const f = buildForecast(input({ viewer: miles, permits: [p], tasks }));
    const all = [...f.past_due.items, ...f.today.items, ...f.this_week.items];
    expect(all.length).toBeGreaterThan(0);
    // Not greyed, not waiting on a design half that does not exist.
    expect(all.every((i) => i.actionable)).toBe(true);
  });
});

describe('fix-308 #42/#43: the ownership cascade', () => {
  it('★ no tasks at all falls to ENT — "nothing is holding this permit"', () => {
    const p = mkPermit({ da: 'Cam', ent_lead: 'Miles', target_submit: '2026-03-01' });
    expect(legShape(p, [])).toBe('one-leg');

    const cam = resolveBoardViewer('Cam', []);
    expect(buildForecast(input({ viewer: cam, permits: [p] })).past_due.total).toBe(0);

    const miles = resolveBoardViewer('Miles', []);
    expect(
      buildForecast(input({ viewer: miles, permits: [p] })).past_due.total,
    ).toBeGreaterThan(0);
  });

  it('★ a permit WITH open design tasks still blocks the DA — the old behaviour survives', () => {
    const p = mkPermit({ da: 'Cam', ent_lead: 'Miles', target_submit: '2026-03-01' });
    const tasks = [mkTask({ permit_id: p.id, discipline: 'arch', status: 'Open' })];
    expect(legShape(p, tasks)).toBe('two-leg');

    const cam = resolveBoardViewer('Cam', []);
    const f = buildForecast(input({ viewer: cam, permits: [p], tasks }));
    expect(f.past_due.total).toBeGreaterThan(0);
    // And the design half is genuinely his, not a waiting row.
    expect(f.past_due.items.some((i) => i.actionable)).toBe(true);
  });

  it('the relay is unchanged where a design leg exists', () => {
    // 'no-tasks' is still not 'complete' — fix-298's rule, still true.
    expect(designLegStatus([])).toBe('no-tasks');
    expect(
      relayStateFor('corrections', 'entitlement', 'two-leg', 'no-tasks'),
    ).toBe('waiting');
    // ...but a one-leg permit never waits on a design half.
    expect(relayStateFor('corrections', 'entitlement', 'one-leg', 'no-tasks')).toBe('mine');
    expect(relayStateFor('corrections', 'design', 'one-leg', 'no-tasks')).toBe('absent');
  });
});

// ---------------------------------------------------------------------------
// #44 — unassigned open tasks
// ---------------------------------------------------------------------------

describe('fix-308 #44: an unassigned open task blocks nobody', () => {
  const permit = { da: 'Cam', ent_lead: 'Miles' };

  it('★ an assigned task names its assignee', () => {
    expect(taskOwnership(mkTask({ assigned_to: 'Miles' }), permit)).toEqual({
      owner: 'Miles',
      unowned: false,
      label: 'Miles',
    });
  });

  it('★★ an UNASSIGNED task says it needs an owner — and never names the DA', () => {
    const own = taskOwnership(mkTask({ assigned_to: null }), permit);
    expect(own.unowned).toBe(true);
    expect(own.label).toBe(UNOWNED_LABEL);
    expect(own.label).toMatch(/needs an owner/i);
    // ★ THE BUG: it must not be attributed to Cam. That is what produced
    // "blocked by Cam" on a permit where Cam had no task.
    expect(own.label).not.toContain('Cam');
    expect(own.owner).not.toBe('Cam');
    expect(taskOwnership(mkTask({ assigned_to: '   ' }), permit).unowned).toBe(true);
  });

  it('★ it surfaces to the ENT lead — the default owner — and to nobody else', () => {
    expect(unownedSurfacesTo(permit, 'Miles')).toBe(true);
    expect(unownedSurfacesTo(permit, 'Cam')).toBe(false);
    expect(unownedSurfacesTo(permit, 'Fisk')).toBe(false);
    expect(unownedSurfacesTo(permit, null)).toBe(false);
    // Case and whitespace are not a way past the rule.
    expect(unownedSurfacesTo(permit, '  miles ')).toBe(true);
  });

  it('with no ENT lead it belongs to nobody, and still says so', () => {
    const orphan = taskOwnership(mkTask({ assigned_to: null }), { da: 'Cam', ent_lead: null });
    expect(orphan.owner).toBeNull();
    expect(orphan.label).toBe(UNOWNED_LABEL);
  });
});

// ---------------------------------------------------------------------------
// #45 — state, action, why it is yours
// ---------------------------------------------------------------------------

describe('fix-308 #45: a milestone says what to do AND why it is on your list', () => {
  it('★ states past due / due today / upcoming', () => {
    expect(milestoneStateLabel(12)).toBe('Past due');
    expect(milestoneStateLabel(0)).toBe('Due today');
    expect(milestoneStateLabel(-3)).toBe('Upcoming');
  });

  it('★ says why it is yours — a role, not a paragraph', () => {
    const p = { da: 'Cam', ent_lead: 'Miles' };
    expect(milestoneWhyYours('entitlement', 'mine', p)).toMatch(/entitlement lead/i);
    expect(milestoneWhyYours('design', 'mine', p)).toMatch(/design associate/i);
    // ★ #22's cut is not undone: one short clause, no prose.
    expect(milestoneWhyYours('entitlement', 'mine', p).length).toBeLessThan(60);
  });

  it('★ and when it is NOT yours, it says who has it', () => {
    const p = { da: 'Cam', ent_lead: 'Miles' };
    expect(milestoneWhyYours('entitlement', 'waiting', p)).toContain('Cam');
    expect(milestoneWhyYours('design', 'waiting', p)).toContain('Miles');
    expect(milestoneWhyYours('entitlement', 'waiting', { da: null })).toMatch(
      /other half/i,
    );
  });
});

// ---------------------------------------------------------------------------
// #46 — handed off
// ---------------------------------------------------------------------------

describe('fix-308 #46: "Handed off — waiting on others"', () => {
  const row = (over: Record<string, unknown>) => ({
    key: 'k1',
    where: '3921 43rd Ave S · Demolition',
    permitId: 1,
    daysLate: 2,
    actionable: false,
    withWhom: 'Miles',
    ...over,
  });

  it('★ shows who it went to and how long ago', () => {
    const out = buildHandedOff([row({})]);
    expect(out).toHaveLength(1);
    expect(out[0]!.withWhom).toBe('Miles');
    expect(out[0]!.daysAgo).toBe(2);
  });

  it('★ carries only rows that have LEFT the sender — actionable ones stay put', () => {
    // An actionable row is still in the sender's dated buckets; it has not
    // been handed anywhere.
    expect(buildHandedOff([row({ actionable: true })])).toHaveLength(0);
    // And a row with nobody to be with is not a handoff either.
    expect(buildHandedOff([row({ withWhom: '  ' })])).toHaveLength(0);
  });

  it('★ climbs within the section — oldest first', () => {
    const out = buildHandedOff([
      row({ key: 'a', daysLate: 2 }),
      row({ key: 'b', daysLate: 30 }),
      row({ key: 'c', daysLate: 9 }),
    ]);
    expect(out.map((h) => h.key)).toEqual(['b', 'c', 'a']);
  });

  it('a not-yet-due row reads as 0 days, never negative', () => {
    expect(buildHandedOff([row({ daysLate: -4 })])[0]!.daysAgo).toBe(0);
  });

  // ★★ THE DECIDED RULE, asserted at the age the brief names.
  it('★★ NEVER escalates on the sender\'s board — asserted at 30 days', () => {
    expect(handedOffEscalates(30)).toBe(false);
    expect(handedOffEscalates(0)).toBe(false);
    expect(handedOffEscalates(365)).toBe(false);
    // It is the receiver's obligation; fix-305's ladder escalates it on THEIR
    // board. One obligation, one board.
  });
});

// ---------------------------------------------------------------------------
// #47 — the DA's queue
// ---------------------------------------------------------------------------

describe('fix-308 #47: a design associate sees intakes and corrections only', () => {
  it('★ those two kinds, and no others', () => {
    expect(daQueueAllows('intake')).toBe(true);
    expect(daQueueAllows('corrections')).toBe(true);
    for (const k of ['fees', 'issuance', 'target_submit', 'draw', 'reviewer_silent'] as const) {
      expect(daQueueAllows(k), k).toBe(false);
    }
    expect([...DA_QUEUE_KINDS].sort()).toEqual(['corrections', 'intake']);
  });

  it('★ the DA shape applies only when design is the ONLY leg held', () => {
    expect(usesDaQueueShape(['design'])).toBe(true);
    // ★ Somebody who is a DA here and an ENT lead there keeps the FULL queue —
    // narrowing it would hide their entitlement work.
    expect(usesDaQueueShape(['design', 'entitlement'])).toBe(false);
    expect(usesDaQueueShape(['entitlement'])).toBe(false);
    expect(usesDaQueueShape([])).toBe(false);
  });

  it('★ ordering reuses the forecast concept — worst first, not a second sort', () => {
    const rows = [
      { key: 'intake-2d', daysLate: 2 },
      { key: 'corr-40d', daysLate: 40 },
      { key: 'upcoming', daysLate: -5 },
      { key: 'today', daysLate: 0 },
    ];
    expect([...rows].sort(byWorstFirst).map((r) => r.key)).toEqual([
      'corr-40d',
      'intake-2d',
      'today',
      'upcoming',
    ]);
  });
});
