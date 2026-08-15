import { describe, it, expect } from 'vitest';
import {
  BOARD_SECTION_CAPS,
  buildForecast,
  buildQueue,
  designLegStatus,
  legShape,
  relayStateFor,
  resolveBoardViewer,
  suppressionCounts,
  todayIso,
  type BoardInput,
  type BoardTask,
  type BoardViewer,
} from '../lib/myBoard';
import type {
  PermitWithCycles,
  Project,
  TeamMember,
} from '../lib/database.types';

// fix-298 Phase 1 — the relay, the two panels, and the rules that keep them
// from being redundant.
//
// PROD PROBE (2026-08-13, eibnmwthkcuumyclyxoe, READ-ONLY) — every number the
// design rests on, re-measured rather than taken from the brief:
//   active permits 259 · two-leg 253 · one-leg (da IS NULL) 6, ALL Demolition
//   permits in corrections 32 · of those with ZERO tasks 4 (the handoff trap)
//   Fisk 26 active permits / 0 tasks assigned by name; Francesca 22/0; Qisheng 16/0
//   live tasks 487, of which 183 carry an assignee and ZERO carry a due_date
//   Miles: 165 permits, 62 projects, 139 past-due dated items, 0 today, 2 this week
//   Bobby: 5 permits, 3 projects, 4 past due, 1 today
//
// ★ The brief said one-leg was "13 active permits, 9 of them Demolition".
// fix-302 briefly shrank that to 6 by cascading the Building Permit's DA onto
// every secondary permit — exactly the population that used to be one-leg.
// ★ fix-312 reverted that cascade (it was assigning designers to ULS and IPR
// records, which should never carry one), so the one-leg population is back and
// larger than before. The RULE is unchanged and matters more, not less: derive
// from `da IS NULL`, never from the type, because a Demolition WITH a DA does
// have a design leg — and now a ULS without one genuinely has no design leg.

const TODAY = '2026-08-13';

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

function mkProject(id: string, address: string): Project {
  return { id, address, juris: 'Seattle', archived: false, notes: null } as Project;
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

// ---------------------------------------------------------------------------
// fix-298 derived the leg shape from `da IS NULL` — never from the permit
// type, which was the right half of the rule and is still asserted below.
//
// ★★ fix-308 (#42/#43) added the other half: a named DA is NECESSARY but NOT
// SUFFICIENT. Bobby sat with Cam on 3921's Demolition permit, which the board
// called both "ready to hand off" and "blocked by Cam" while he had no task on
// it at all — six tasks, every one `discipline='ent'`. `da IS NOT NULL` does
// not mean "this permit has a design leg"; it means somebody is named in a
// column.
//
//   "If no tasks for design, then it falls on ENT. If no tasks for design or
//    ENT, still falls on ENT, because then that is saying there is nothing
//    holding this permit from advancing."
describe('fix-308: leg shape needs a DA AND design work that exists', () => {
  it('★★ a permit with a DA but NO design tasks is ONE-leg — the 3921 case', () => {
    // Six ENT tasks, not one arch. Cam is named; Cam has nothing to do.
    const entOnly = [
      mkTask({ discipline: 'ent', status: 'Resolved' }),
      mkTask({ discipline: 'ent', status: 'Open', assigned_to: 'Miles' }),
    ];
    expect(legShape(mkPermit({ da: 'Cam' }), entOnly)).toBe('one-leg');
  });

  it('★ a permit with a DA and NO TASKS AT ALL is one-leg — ENT owns it', () => {
    // "…still falls on ENT, because then that is saying there is nothing
    // holding this permit from advancing."
    expect(legShape(mkPermit({ da: 'Fisk' }), [])).toBe('one-leg');
    expect(legShape(mkPermit({ da: 'Fisk' }))).toBe('one-leg');
  });

  it('a permit with a DA AND a design task is two-leg — the old behaviour', () => {
    expect(legShape(mkPermit({ da: 'Fisk' }), [mkTask({ discipline: 'arch' })])).toBe(
      'two-leg',
    );
  });

  it('★ and a RESOLVED design task still proves the leg exists', () => {
    // A permit whose design work is finished is still two-leg — that is what
    // keeps the handoff prompt alive for the permits that earned it.
    expect(
      legShape(mkPermit({ da: 'Fisk' }), [
        mkTask({ discipline: 'arch', status: 'Resolved' }),
      ]),
    ).toBe('two-leg');
  });

  it('a permit with no DA is one-leg however many design tasks it has', () => {
    expect(legShape(mkPermit({ da: null }))).toBe('one-leg');
    expect(legShape(mkPermit({ da: '   ' }))).toBe('one-leg');
    expect(legShape(mkPermit({ da: null }), [mkTask({ discipline: 'arch' })])).toBe(
      'one-leg',
    );
  });

  // fix-298's half of the rule, unchanged.
  it('★ a DEMOLITION WITH a DA and design work is two-leg — the type is not the rule', () => {
    // Cam holds 41 active permits, many of them Demolition. Hardcoding
    // Demolition to one-leg would strip the design half from all of them.
    expect(
      legShape(mkPermit({ type: 'Demolition', da: 'Cam' }), [
        mkTask({ discipline: 'arch' }),
      ]),
    ).toBe('two-leg');
  });

  it('a NON-Demolition with no DA is one-leg', () => {
    expect(legShape(mkPermit({ type: 'ULS', da: null }))).toBe('one-leg');
  });
});

// ---------------------------------------------------------------------------
describe('fix-298: the handoff trap — zero tasks is not "complete"', () => {
  it('★ a permit with NO tasks is "no-tasks", never "complete"', () => {
    // 4 of the 32 permits in corrections have no tasks at all. "All tasks
    // complete" is vacuously true for them; an automatic rule would announce
    // them ready to file on day one, in front of the whole team.
    expect(designLegStatus([])).toBe('no-tasks');
  });

  it('a permit with ONE RESOLVED design task IS complete', () => {
    expect(
      designLegStatus([mkTask({ discipline: 'arch', status: 'Resolved' })]),
    ).toBe('complete');
  });

  it('a permit with any live design task is in progress', () => {
    expect(
      designLegStatus([
        mkTask({ discipline: 'arch', status: 'Resolved' }),
        mkTask({ discipline: 'arch', status: 'Open' }),
      ]),
    ).toBe('in-progress');
  });

  it('entitlement tasks do not count as the design leg', () => {
    // Only 'arch' is the design column (fix-244: discipline follows team).
    expect(
      designLegStatus([mkTask({ discipline: 'ent', status: 'Resolved' })]),
    ).toBe('no-tasks');
  });

  it('a CANCELLED task is not live, so it does not hold the leg open', () => {
    expect(
      designLegStatus([
        mkTask({ discipline: 'arch', status: 'Resolved' }),
        mkTask({ discipline: 'arch', status: 'Cancelled' }),
      ]),
    ).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
describe('fix-298: the three relay states', () => {
  it('design acts first on corrections; entitlement WAITS', () => {
    expect(relayStateFor('corrections', 'design', 'two-leg', 'in-progress')).toBe('mine');
    expect(relayStateFor('corrections', 'entitlement', 'two-leg', 'in-progress')).toBe(
      'waiting',
    );
  });

  it('once design is complete the roles swap', () => {
    expect(relayStateFor('corrections', 'design', 'two-leg', 'complete')).toBe('waiting');
    expect(relayStateFor('corrections', 'entitlement', 'two-leg', 'complete')).toBe('mine');
  });

  it('★ zero tasks leaves entitlement WAITING — it never reads as ready', () => {
    expect(relayStateFor('corrections', 'entitlement', 'two-leg', 'no-tasks')).toBe(
      'waiting',
    );
  });

  it('★ a one-leg permit has NO design half at all', () => {
    expect(relayStateFor('corrections', 'design', 'one-leg', 'no-tasks')).toBe('absent');
    expect(relayStateFor('target_submit', 'design', 'one-leg', 'no-tasks')).toBe('absent');
  });

  it('★ one-leg entitlement owns it end to end — never "waiting on design"', () => {
    expect(relayStateFor('corrections', 'entitlement', 'one-leg', 'no-tasks')).toBe('mine');
  });

  it('entitlement-only milestones are absent from the design side', () => {
    for (const k of ['fees', 'intake', 'reviewer_silent', 'issuance'] as const) {
      expect(relayStateFor(k, 'design', 'two-leg', 'in-progress')).toBe('absent');
      expect(relayStateFor(k, 'entitlement', 'two-leg', 'in-progress')).toBe('mine');
    }
  });

  it('the draw window is design-only', () => {
    expect(relayStateFor('draw', 'entitlement', 'two-leg', 'in-progress')).toBe('absent');
    expect(relayStateFor('draw', 'design', 'two-leg', 'in-progress')).toBe('mine');
  });
});

// ---------------------------------------------------------------------------
describe('fix-298: ★ forecast needs a DATE, queue needs a STATE', () => {
  it('a reviewer gone quiet has no date — it is on the QUEUE, never the forecast', () => {
    const permit = mkPermit({
      da: null,
      ent_lead: 'Miles',
      // ★ Silence is measured from the last MOVEMENT (updated_at), not from
      // submission — see the note in permitMilestones.
      updated_at: '2026-07-01T12:00:00Z',
      permit_cycles: [
        {
          id: 'c1',
          permit_id: 1,
          cycle_index: 1,
          submitted: '2026-07-01',
          intake_accepted: '2026-07-02',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          created_at: '',
          updated_at: '',
        },
      ],
    });
    const inp = input({ permits: [permit] });
    const f = buildForecast(inp);
    expect(
      f.past_due.total + f.today.total + f.tomorrow.total + f.this_week.total,
    ).toBe(0);
    const q = buildQueue(inp);
    expect(q.blocked_on_you.total).toBe(1);
    expect(q.blocked_on_you.items[0]!.next.toLowerCase()).toContain('ping the reviewer');
  });

  it('★ silence is measured from the last MOVEMENT, not from submission', () => {
    // Measured on prod: "14 days since submitted" flags 45 of Miles's 57
    // in-review permits — that is normal review duration, not silence, and it
    // would rebuild the wall of red. "14 days since the row last changed"
    // flags 6. A permit submitted long ago but touched yesterday is NOT quiet.
    const cycles = [
      {
        id: 'c1',
        permit_id: 1,
        cycle_index: 1,
        submitted: '2026-01-01', // submitted 7 months ago
        intake_accepted: '2026-01-02',
        city_target: null,
        corr_issued: null,
        resubmitted: null,
        created_at: '',
        updated_at: '',
      },
    ];
    const touchedYesterday = mkPermit({
      da: null,
      ent_lead: 'Miles',
      updated_at: '2026-08-12T12:00:00Z',
      permit_cycles: cycles,
    });
    expect(buildQueue(input({ permits: [touchedYesterday] })).blocked_on_you.total).toBe(0);

    const untouchedForMonths = mkPermit({
      da: null,
      ent_lead: 'Miles',
      updated_at: '2026-06-01T12:00:00Z',
      permit_cycles: cycles,
    });
    expect(buildQueue(input({ permits: [untouchedForMonths] })).blocked_on_you.total).toBe(1);
  });

  it('a dated target submit is on the FORECAST', () => {
    const permit = mkPermit({ target_submit: '2026-08-10', da: null });
    const f = buildForecast(input({ permits: [permit] }));
    expect(f.past_due.total).toBe(1);
    expect(f.past_due.items[0]!.daysLate).toBe(3);
  });

  it('an undated task never reaches the forecast', () => {
    // Today that is EVERY live task: 0 of 487 carry a due_date.
    const t = mkTask({ assigned_to: 'Miles', due_date: null });
    const f = buildForecast(input({ tasks: [t] }));
    expect(f.past_due.total + f.today.total).toBe(0);
  });

  it('a dated task assigned to me by name IS on the forecast', () => {
    const t = mkTask({ assigned_to: 'Miles', due_date: TODAY });
    const f = buildForecast(input({ tasks: [t] }));
    expect(f.today.total).toBe(1);
    expect(f.today.items[0]!.source).toBe('task');
  });

  it("another person's named task is never duplicated onto my board", () => {
    const t = mkTask({ assigned_to: 'Briana', due_date: TODAY });
    const f = buildForecast(input({ tasks: [t] }));
    expect(f.today.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fix-298 built the board so a DA with no NAMED tasks still had something to
// work from — the relay derives from the PERMIT, not from task assignment.
//
// ★★ fix-308 (#42/#43) narrows that, deliberately, and it is worth being
// precise about what changed. A DA still needs no task ASSIGNED TO THEM BY
// NAME — that is fix-298's point and it survives below. But the permit must
// have design work SOMEWHERE, or it has no design leg and belongs to ENT.
//
// ★ Measured on prod 2026-08-16: Fisk holds 16 active permits, 9 of which have
// design tasks. So his board keeps 9 and loses 7 — it does not go empty. Cam,
// the worst case, keeps 10 of 44. What leaves is work that was never his.
describe('fix-308: ★ Fisk — a DA with no NAMED tasks still gets a populated board', () => {
  const permits = Array.from({ length: 7 }, (_, i) =>
    mkPermit({
      project_id: `p${i}`,
      da: 'Fisk',
      ent_lead: 'Miles',
      target_submit: '2026-03-26',
      status: 'Corrections Required',
      permit_cycles: [
        {
          id: `c${i}`,
          permit_id: i,
          cycle_index: 1,
          submitted: null,
          intake_accepted: null,
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          created_at: '',
          updated_at: '',
        },
      ],
    }),
  );
  const projects = permits.map((_, i) => mkProject(`p${i}`, `${100 + i} Test St`));

  // Design work exists on every permit, and NONE of it is assigned to Fisk by
  // name — which is the fix-298 condition, unchanged.
  const designWork = permits.map((p) =>
    mkTask({ permit_id: p.id, discipline: 'arch', status: 'Open', assigned_to: null }),
  );

  it('his forecast is populated from permit milestones, with no task NAMED to him', () => {
    const f = buildForecast(
      input({ viewer: FISK, permits, projects, tasks: designWork }),
    );
    expect(f.past_due.total).toBe(7);
    expect(f.past_due.items.length).toBe(BOARD_SECTION_CAPS.past_due);
  });

  it('every row on his board is HIS to act on, not someone else waiting', () => {
    const f = buildForecast(
      input({ viewer: FISK, permits, projects, tasks: designWork }),
    );
    expect(f.past_due.items.every((i) => i.actionable)).toBe(true);
    expect(f.past_due.items[0]!.verb).toBe('Finish the set');
  });

  // ★★ AND THE OTHER HALF, which is the whole ticket: strip the design work
  // and those same permits leave his board entirely, because they are ENT's.
  it('★★ but with NO design work anywhere, those permits are not his at all', () => {
    const f = buildForecast(input({ viewer: FISK, permits, projects, tasks: [] }));
    expect(f.past_due.total).toBe(0);
    expect(f.today.total + f.tomorrow.total + f.this_week.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('fix-298: ★ oversight is ADDITIVE, never a replacement', () => {
  const roster: TeamMember[] = [
    { name: 'Gena', role: 'dm', is_oversight: true } as TeamMember,
    { name: 'Ahmadi', role: 'dm', is_oversight: false } as TeamMember,
    { name: 'Bobby', role: 'ent', is_oversight: true } as TeamMember,
    { name: 'Bobby', role: 'ent_lead', is_oversight: false } as TeamMember,
  ];

  it('resolves the flag from the roster, not from a hardcoded name list', () => {
    expect(resolveBoardViewer('Gena', roster).isOversight).toBe(true);
    expect(resolveBoardViewer('Ahmadi', roster).isOversight).toBe(false);
  });

  it('ORs across a person’s multiple roster rows', () => {
    // team_members is one row per (name, role); Bobby holds two.
    expect(resolveBoardViewer('Bobby', roster).isOversight).toBe(true);
  });

  it('an unmapped login gets no oversight', () => {
    expect(resolveBoardViewer(null, roster).isOversight).toBe(false);
  });

  it('★ oversight ADDS the wide view: Gena sees permits she is not on', () => {
    const notHers = mkPermit({ da: 'Fisk', ent_lead: 'Miles', target_submit: '2026-08-01' });
    const gena = resolveBoardViewer('Gena', roster);
    const f = buildForecast(input({ viewer: gena, permits: [notHers] }));
    expect(f.past_due.total).toBe(1);
  });

  it('★ a DM WITHOUT the flag sees only her own scope', () => {
    const notHers = mkPermit({ da: 'Fisk', ent_lead: 'Miles', target_submit: '2026-08-01' });
    const ahmadi = resolveBoardViewer('Ahmadi', roster);
    const f = buildForecast(input({ viewer: ahmadi, permits: [notHers] }));
    expect(f.past_due.total).toBe(0);
  });

  it('oversight does NOT strip her own scope — her own permits still appear', () => {
    const hers = mkPermit({ da: 'Gena', ent_lead: 'Miles', target_submit: '2026-08-01' });
    const gena = resolveBoardViewer('Gena', roster);
    // ★ fix-308: as a DA, Gena's design leg exists only where design work does.
    const f = buildForecast(
      input({
        viewer: gena,
        permits: [hers],
        tasks: [mkTask({ permit_id: hers.id, discipline: 'arch', status: 'Open' })],
      }),
    );
    expect(f.past_due.total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('fix-298: ★ the board does not grow with the workload', () => {
  // Miles's real shape: 165 permits across 62 projects, 139 past due.
  const milesPermits = Array.from({ length: 139 }, (_, i) =>
    mkPermit({
      project_id: `mp${i % 62}`,
      da: 'Fisk',
      ent_lead: 'Miles',
      target_submit: '2026-01-01',
    }),
  );
  const milesProjects = Array.from({ length: 62 }, (_, i) =>
    mkProject(`mp${i}`, `${i} Miles Way`),
  );
  // Bobby's real shape: 5 permits across 3 projects, 4 past due.
  const bobbyPermits = Array.from({ length: 4 }, (_, i) =>
    mkPermit({
      project_id: `bp${i % 3}`,
      da: 'Fisk',
      ent_lead: 'Bobby',
      target_submit: '2026-08-01',
    }),
  );
  const bobbyProjects = Array.from({ length: 3 }, (_, i) =>
    mkProject(`bp${i}`, `${i} Bobby Way`),
  );

  it('★ Miles: 139 past due, but only 5 rows are rendered', () => {
    const f = buildForecast(
      input({ viewer: MILES, permits: milesPermits, projects: milesProjects }),
    );
    expect(f.past_due.total).toBe(139);
    expect(f.past_due.items.length).toBe(5);
    expect(f.past_due.capped).toBe(true);
  });

  it('★ a capped section still reports its TRUE total — the scale is never hidden', () => {
    const f = buildForecast(
      input({ viewer: MILES, permits: milesPermits, projects: milesProjects }),
    );
    // The header renders `total`, not `items.length`. Miles must be able to see
    // that the number is 139 without expanding anything.
    expect(f.past_due.total).not.toBe(f.past_due.items.length);
    expect(f.past_due.total).toBe(139);
  });

  it('★ Bobby: 4 past due, all shown, nothing capped — same shape, less density', () => {
    const f = buildForecast(
      input({
        viewer: { name: 'Bobby', isOversight: false },
        permits: bobbyPermits,
        projects: bobbyProjects,
      }),
    );
    expect(f.past_due.total).toBe(4);
    expect(f.past_due.items.length).toBe(4);
    expect(f.past_due.capped).toBe(false);
  });

  it('★ both boards render the SAME number of sections — one product', () => {
    const miles = buildForecast(
      input({ viewer: MILES, permits: milesPermits, projects: milesProjects }),
    );
    const bobby = buildForecast(
      input({
        viewer: { name: 'Bobby', isOversight: false },
        permits: bobbyPermits,
        projects: bobbyProjects,
      }),
    );
    expect(Object.keys(miles).sort()).toEqual(Object.keys(bobby).sort());
  });

  it('every queue group is capped independently, each keeping its true total', () => {
    const q = buildQueue(
      input({ viewer: MILES, permits: milesPermits, projects: milesProjects }),
    );
    for (const g of [q.blocked_on_you, q.waiting_on_design, q.waiting_on_city]) {
      expect(g.items.length).toBeLessThanOrEqual(BOARD_SECTION_CAPS.queueGroup);
      if (g.capped) expect(g.total).toBeGreaterThan(g.items.length);
    }
  });

  it('★ past due is RANKED, not listed — the latest item leads', () => {
    const permits = [
      mkPermit({ project_id: 'a', ent_lead: 'Miles', da: null, target_submit: '2026-08-12' }),
      mkPermit({ project_id: 'b', ent_lead: 'Miles', da: null, target_submit: '2026-01-01' }),
    ];
    const f = buildForecast(
      input({
        permits,
        projects: [mkProject('a', 'A St'), mkProject('b', 'B St')],
      }),
    );
    expect(f.past_due.items[0]!.daysLate).toBeGreaterThan(f.past_due.items[1]!.daysLate);
  });
});

// ---------------------------------------------------------------------------
describe('fix-298: ★ never notify, but show the count', () => {
  it('counts scraper retries and manual-edit guards as SUPPRESSED, not delivered', () => {
    const rows = [
      { action: 'scrape_workflow_fetch_recovered', ent_lead: 'Miles' },
      { action: 'scrape_workflow_fetch_recovered', ent_lead: 'Briana' },
      { action: 'scrape_skipped_recent_manual_edit', ent_lead: 'Miles' },
      { action: 'scrape_cycle_skipped_recent_manual_edit', ent_lead: 'Miles' },
      { action: 'scrape_change_applied', ent_lead: 'Briana' },
      { action: 'scrape_change_applied', ent_lead: 'Miles' },
    ];
    const c = suppressionCounts(rows, MILES);
    expect(c.retries).toBe(2);
    expect(c.guarded).toBe(2);
    expect(c.notYours).toBe(1); // Briana's applied change; Miles's own is not suppressed
  });

  it('returns zeroes rather than throwing on an empty feed', () => {
    // The counts must RENDER at zero — that is how a quiet day and a broken
    // notifier stop looking the same.
    expect(suppressionCounts([], MILES)).toEqual({
      retries: 0,
      guarded: 0,
      notYours: 0,
    });
  });
});

// ---------------------------------------------------------------------------
describe('fix-298: housekeeping', () => {
  it('todayIso is local-calendar, not UTC', () => {
    expect(todayIso(new Date(2026, 7, 13, 23, 30))).toBe('2026-08-13');
  });

  it('sub-permits never appear as work', () => {
    const sub = mkPermit({ parent_permit_id: 9, ent_lead: 'Miles', target_submit: '2026-01-01' });
    const f = buildForecast(input({ permits: [sub] }));
    expect(f.past_due.total).toBe(0);
  });

  it('cancelled projects never appear as work', () => {
    const p = mkPermit({ ent_lead: 'Miles', target_submit: '2026-01-01' });
    const f = buildForecast(
      input({ permits: [p], cancelledIds: new Set(['p1']) }),
    );
    expect(f.past_due.total).toBe(0);
  });
});
