import { describe, it, expect } from 'vitest';
import {
  buildForecast,
  buildQueue,
  buildTeamQueues,
  designReportsFor,
  entitlementReportsFor,
  queuePermitDetail,
  teamMappingGap,
  type BoardInput,
  type BoardTask,
  type DmDaRow,
} from '../lib/myBoard';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  TeamMember,
} from '../lib/database.types';

// fix-303 — team queues, real permit depth, and the mapping gap.
//
// PROD RE-MEASURE (2026-08-14, eibnmwthkcuumyclyxoe, READ-ONLY). The brief's
// figures are from earlier the same day and several had moved:
//   Brittani (Ahmadi, Fisk, Marc) ......... 90 permits  (brief 94)
//   Lindsay  (Ainsley, Francesca, Trevor) . 69          (brief 70)
//   Derry    (Chad, Nicky, Qisheng) ....... 37          (brief 38)
//   Jade     (Alex, Erick, Nidhi) ......... 13          (brief 13)
//
// ★ BOTH halves of the mapping gap reproduce — under the ROSTER definition,
// which is the one that matters for a management structure:
//   Active roster DAs in NO manager group: Cam (41 live permits), Shire (3),
//     George (0). Cam holds the largest DA load in the company and no design
//     manager would see any of it.
//   In a group but FORMER staff: Alex, Chad, Nidhi. ★ They are NOT dead
//     entries — they still hold 10 active permits between them, so a DM's
//     queue shows live work attributed to people who have left. That is worse
//     than an empty row, and it is why both directions are surfaced.

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

const mkProject = (id: string, address: string): Project =>
  ({ id, address, juris: 'Seattle', archived: false, notes: null }) as Project;

function input(over: Partial<BoardInput>): BoardInput {
  return {
    viewer: { name: 'Miles', isOversight: false },
    permits: [],
    projects: [mkProject('p1', '3626 164th Pl SE')],
    tasks: [] as BoardTask[],
    today: TODAY,
    ...over,
  };
}

// ---------------------------------------------------------------------------
describe('fix-303 §2: team queues are DERIVED, never named in code', () => {
  const permits = [
    mkPermit({ ent_lead: 'Miles', da: 'Fisk' }),
    mkPermit({ ent_lead: 'Briana', da: 'Marc' }),
    mkPermit({ ent_lead: 'Bobby', da: 'Cam' }),
  ];

  it('an oversight entitlement leader picks up the OTHER leads', () => {
    expect(entitlementReportsFor({ name: 'Bobby', isOversight: true }, permits)).toEqual([
      'Briana',
      'Miles',
    ]);
  });

  it('★ a plain entitlement lead does NOT acquire a team', () => {
    expect(entitlementReportsFor({ name: 'Miles', isOversight: false }, permits)).toEqual(
      [],
    );
  });

  it('★ a DM picks up their DESIGN ASSOCIATES via dm_da_groups, not permit.dm', () => {
    // DMs are assigned to projects and tasks, not permits — their queue can
    // only come from the group mapping.
    const rows: DmDaRow[] = [
      { dm_name: 'Brittani', da_name: 'Ahmadi' },
      { dm_name: 'Brittani', da_name: 'Fisk' },
      { dm_name: 'Brittani', da_name: 'Marc' },
      { dm_name: 'Lindsay', da_name: 'Trevor' },
    ];
    expect(designReportsFor({ name: 'Brittani', isOversight: false }, rows)).toEqual([
      'Ahmadi',
      'Fisk',
      'Marc',
    ]);
  });

  it('★ a DA sees no team queue at all', () => {
    const rows: DmDaRow[] = [{ dm_name: 'Brittani', da_name: 'Fisk' }];
    expect(designReportsFor({ name: 'Fisk', isOversight: false }, rows)).toEqual([]);
    expect(entitlementReportsFor({ name: 'Fisk', isOversight: false }, permits)).toEqual(
      [],
    );
  });

  it("★ a report's queue is THEIRS — built as they would see it, never merged", () => {
    // A STATEFUL permit (reviewer gone quiet) — the queue only takes
    // milestones with no date; a dated one belongs on the forecast.
    const p = mkPermit({
      ent_lead: 'Miles',
      da: null,
      updated_at: '2026-05-01T12:00:00Z',
      permit_cycles: [mkCycle({ submitted: '2026-04-01', intake_accepted: '2026-04-02' })],
    });
    const [miles] = buildTeamQueues(input({ permits: [p] }), [
      { owner: 'Miles', relationship: 'entitlement-lead' },
    ]);
    expect(miles!.owner).toBe('Miles');
    expect(miles!.queue.blocked_on_you.total).toBe(1);

    // Same input, different owner → nothing. Proof the queue is scoped to the
    // report rather than inherited from whoever is looking.
    const [briana] = buildTeamQueues(input({ permits: [p] }), [
      { owner: 'Briana', relationship: 'entitlement-lead' },
    ]);
    expect(briana!.queue.blocked_on_you.total).toBe(0);
  });

  it('each report keeps its own relationship label, so grouping is unambiguous', () => {
    const qs = buildTeamQueues(input({}), [
      { owner: 'Miles', relationship: 'entitlement-lead' },
      { owner: 'Fisk', relationship: 'design-associate' },
    ]);
    expect(qs.map((q) => [q.owner, q.relationship])).toEqual([
      ['Miles', 'entitlement-lead'],
      ['Fisk', 'design-associate'],
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('fix-303 §2: ★ the dm_da_groups gap is surfaced, not papered over', () => {
  const members = [
    { name: 'Cam', role: 'da', active: true, former: false },
    { name: 'Shire', role: 'da', active: true, former: false },
    { name: 'George', role: 'da', active: true, former: false },
    { name: 'Fisk', role: 'da', active: true, former: false },
    { name: 'Chad', role: 'da', active: false, former: true },
    { name: 'Miles', role: 'ent_lead', active: true, former: false },
  ] as unknown as TeamMember[];
  const rows: DmDaRow[] = [
    { dm_name: 'Brittani', da_name: 'Fisk' },
    { dm_name: 'Derry', da_name: 'Chad' },
  ];
  const permits = [
    ...Array.from({ length: 41 }, () => mkPermit({ da: 'Cam' })),
    ...Array.from({ length: 3 }, () => mkPermit({ da: 'Shire' })),
    ...Array.from({ length: 3 }, () => mkPermit({ da: 'Chad' })),
  ];

  it('★ Cam surfaces rather than vanishing — with his load attached', () => {
    const gap = teamMappingGap(members, rows, permits);
    const names = gap.unassignedDas.map((d) => d.name);
    expect(names).toContain('Cam');
    expect(names).toContain('Shire');
    expect(names).toContain('George');
    // Ordered by load, so the biggest hole reads first.
    expect(gap.unassignedDas[0]!.name).toBe('Cam');
    expect(gap.unassignedDas[0]!.activePermits).toBe(41);
  });

  it('a DA who HAS a manager is not reported as a gap', () => {
    expect(
      teamMappingGap(members, rows, permits).unassignedDas.map((d) => d.name),
    ).not.toContain('Fisk');
  });

  it('non-DAs are not reported as unassigned designers', () => {
    expect(
      teamMappingGap(members, rows, permits).unassignedDas.map((d) => d.name),
    ).not.toContain('Miles');
  });

  it('★ former staff in a group are reported WITH their live load', () => {
    // Not a dead entry: Chad has left and still holds 3 active permits, which
    // sit on Derry's queue attributed to somebody who is gone.
    expect(teamMappingGap(members, rows, permits).formerInGroups).toEqual([
      { name: 'Chad', dm: 'Derry', activePermits: 3 },
    ]);
  });

  it('sub-permits and cancelled projects do not inflate the load figures', () => {
    const noisy = [
      mkPermit({ da: 'Cam', parent_permit_id: 7 }),
      mkPermit({ da: 'Cam', project_id: 'gone' }),
    ];
    const gap = teamMappingGap(members, rows, noisy, new Set(['gone']));
    expect(gap.unassignedDas.find((d) => d.name === 'Cam')!.activePermits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('fix-303 §4: a queue row answers what, when and how long', () => {
  it('carries the permit number, type, dates, cycle and time-in-state', () => {
    const p = mkPermit({
      num: 'BLD2026-0319',
      type: 'ULS',
      da: null,
      ent_lead: 'Miles',
      permit_cycles: [
        mkCycle({
          cycle_index: 2,
          submitted: '2026-06-01',
          intake_accepted: '2026-06-05',
          city_target: '2026-08-01',
        }),
      ],
    });
    const d = queuePermitDetail(p, TODAY);
    expect(d.num).toBe('BLD2026-0319');
    expect(d.type).toBe('ULS');
    expect(d.submitted).toBe('2026-06-01');
    expect(d.intakeAccepted).toBe('2026-06-05');
    expect(d.cityTarget).toBe('2026-08-01');
    expect(d.cityTargetPassed).toBe(true);
    expect(d.cycleIndex).toBe(2);
    expect(d.stateLabel).toBe('in review');
    expect(d.daysInState).toBe(70);
  });

  it('★ a MISSING target date is not overdue — unknown and late are different', () => {
    const p = mkPermit({
      da: null,
      permit_cycles: [mkCycle({ submitted: '2026-06-01', city_target: null })],
    });
    const d = queuePermitDetail(p, TODAY);
    expect(d.cityTarget).toBeNull();
    // A blank would render as "not passed" AND look like zero. The row says
    // "No target date" instead, which is the whole point.
    expect(d.cityTargetPassed).toBe(false);
  });

  it('a future target has not passed', () => {
    const p = mkPermit({
      da: null,
      permit_cycles: [mkCycle({ submitted: '2026-06-01', city_target: '2026-12-01' })],
    });
    expect(queuePermitDetail(p, TODAY).cityTargetPassed).toBe(false);
  });

  it('the clock counts from the most recent REAL event', () => {
    const p = mkPermit({
      da: null,
      permit_cycles: [
        mkCycle({
          submitted: '2026-01-01',
          intake_accepted: '2026-01-05',
          corr_issued: '2026-08-04',
        }),
      ],
    });
    const d = queuePermitDetail(p, TODAY);
    expect(d.stateLabel).toBe('in corrections');
    expect(d.daysInState).toBe(10);
  });

  it('a permit with no number says so rather than rendering blank', () => {
    expect(queuePermitDetail(mkPermit({ num: null, da: null }), TODAY).num).toBeNull();
  });

  it('the detail rides along on the queue row itself', () => {
    const p = mkPermit({
      num: 'X-1',
      da: null,
      ent_lead: 'Miles',
      updated_at: '2026-05-01T12:00:00Z',
      permit_cycles: [mkCycle({ submitted: '2026-04-01', intake_accepted: '2026-04-02' })],
    });
    const q = buildQueue(input({ permits: [p] }));
    expect(q.blocked_on_you.items[0]!.permits[0]!.num).toBe('X-1');
  });
});

// ---------------------------------------------------------------------------
describe('fix-303 §1: a section keeps every row so it CAN expand', () => {
  it('★ the capped section still carries the full list', () => {
    // Phase 1 could not expand because the section had already thrown the rest
    // away — the button had nothing to show even if it had been wired.
    const permits = Array.from({ length: 12 }, (_, i) =>
      mkPermit({
        project_id: `p${i}`,
        da: null,
        ent_lead: 'Miles',
        target_submit: '2026-01-01',
      }),
    );
    const projects = Array.from({ length: 12 }, (_, i) => mkProject(`p${i}`, `${i} St`));
    const f = buildForecast(input({ permits, projects }));
    expect(f.past_due.items.length).toBe(5); // capped
    expect(f.past_due.all.length).toBe(12); // …but nothing was discarded
    expect(f.past_due.total).toBe(12);
  });
});
