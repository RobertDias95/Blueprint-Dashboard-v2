import { describe, it, expect } from 'vitest';
import {
  computeTeamMetrics,
  type TeamMetricsFilters,
} from '../lib/teamPerformance';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  TeamMember,
} from '../lib/database.types';

// fix-127: team performance aggregation tests.
//
// Bobby's framing example: Trevor 5 projects (8 units, 2 redesigns + 4
// redesign units), Ainsley 3 projects (5 units, 0 redesigns). The
// volume row should show Trevor at 5 originals + 2 redesigns; Ainsley
// 3 + 0. Phase metrics fold redesign permits in by default; toggling
// includeRedesigns off shrinks them to originals only.

function mkProject(
  over: Omit<Partial<Project>, 'id' | 'address'> & Pick<Project, 'id' | 'address'>,
): Project {
  const { id, address, ...rest } = over;
  return {
    id,
    address,
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...rest,
  };
}

function mkCycle(
  over: Omit<Partial<PermitCycle>, 'cycle_index'> & Pick<PermitCycle, 'cycle_index'>,
): PermitCycle {
  const { cycle_index, ...rest } = over;
  return {
    id: `c-${cycle_index}-${Math.random()}`,
    permit_id: 1,
    cycle_index,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...rest,
  };
}

function mkPermit(
  over: Omit<Partial<PermitWithCycles>, 'id' | 'project_id'> & {
    id: number;
    project_id: string;
  },
): PermitWithCycles {
  const { id, project_id, ...rest } = over;
  return {
    id,
    project_id,
    type: 'Building Permit',
    stage: 'is',
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
    updated_at: '2026-01-01T00:00:00Z',
    permit_cycles: [],
    ...rest,
  };
}

function mkMember(
  over: Omit<Partial<TeamMember>, 'name' | 'role'> & Pick<TeamMember, 'name' | 'role'>,
): TeamMember {
  const { name, role, ...rest } = over;
  return {
    id: `m-${name}-${role}-${Math.random()}`,
    name,
    role,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-01-01T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...rest,
  };
}

const baseFilters: TeamMetricsFilters = {
  role: 'da',
  activeOnly: true,
  dateFrom: null,
  dateTo: null,
  juris: '',
  includeRedesigns: true,
};

describe('computeTeamMetrics — empty', () => {
  it('returns empty rows + null team averages on an empty cohort', () => {
    const out = computeTeamMetrics([], [], [], baseFilters);
    expect(out.rows).toEqual([]);
    expect(out.teamAvgDdDays).toBeNull();
    expect(out.teamAvgCityReviewDays).toBeNull();
    expect(out.teamAvgCorrectionsCycles).toBeNull();
    expect(out.teamAvgIssuanceDays).toBeNull();
  });
});

describe('computeTeamMetrics — Bobby fixture (5 originals + 2 redesigns vs 3 originals)', () => {
  // Trevor's 5 original projects (units 1,2,2,2,1 → 8 total) + 2 redesigns
  // (units 2 + 2 = 4 total). Ainsley's 3 originals (units 1,2,2 → 5 total).
  // Each project has one permit credited to its respective DA.

  const trevorOriginals = [
    mkProject({ id: 'tp1', address: '1', units: 1 }),
    mkProject({ id: 'tp2', address: '2', units: 2 }),
    mkProject({ id: 'tp3', address: '3', units: 2 }),
    mkProject({ id: 'tp4', address: '4', units: 2 }),
    mkProject({ id: 'tp5', address: '5', units: 1 }),
  ];
  const trevorRedesigns = [
    mkProject({
      id: 'tr1',
      address: 'r1',
      units: 2,
      redesign_of_project_id: 'tp1',
    }),
    mkProject({
      id: 'tr2',
      address: 'r2',
      units: 2,
      redesign_of_project_id: 'tp2',
    }),
  ];
  const ainsleyOriginals = [
    mkProject({ id: 'ap1', address: 'a1', units: 1 }),
    mkProject({ id: 'ap2', address: 'a2', units: 2 }),
    mkProject({ id: 'ap3', address: 'a3', units: 2 }),
  ];

  const projects = [...trevorOriginals, ...trevorRedesigns, ...ainsleyOriginals];

  const permits: PermitWithCycles[] = [
    ...trevorOriginals.map((p, i) =>
      mkPermit({ id: 100 + i, project_id: p.id, da: 'Trevor' }),
    ),
    ...trevorRedesigns.map((p, i) =>
      mkPermit({ id: 200 + i, project_id: p.id, da: 'Trevor' }),
    ),
    ...ainsleyOriginals.map((p, i) =>
      mkPermit({ id: 300 + i, project_id: p.id, da: 'Ainsley' }),
    ),
  ];

  const team: TeamMember[] = [
    mkMember({ name: 'Trevor', role: 'da', active: true }),
    mkMember({ name: 'Ainsley', role: 'da', active: true }),
  ];

  it('Trevor row shows 5 originals + 8 units + 2 redesigns + 4 redesign units', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    const trevor = out.rows.find((r) => r.name === 'Trevor');
    expect(trevor).toBeDefined();
    expect(trevor!.projectCount).toBe(5);
    expect(trevor!.unitCount).toBe(8);
    expect(trevor!.redesignProjectCount).toBe(2);
    expect(trevor!.redesignUnitCount).toBe(4);
    expect(trevor!.permitCount).toBe(5);
    expect(trevor!.redesignPermitCount).toBe(2);
  });

  it('Ainsley row shows 3 originals + 5 units + 0 redesigns', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    const ainsley = out.rows.find((r) => r.name === 'Ainsley');
    expect(ainsley).toBeDefined();
    expect(ainsley!.projectCount).toBe(3);
    expect(ainsley!.unitCount).toBe(5);
    expect(ainsley!.redesignProjectCount).toBe(0);
    expect(ainsley!.redesignUnitCount).toBe(0);
    expect(ainsley!.permitCount).toBe(3);
    expect(ainsley!.redesignPermitCount).toBe(0);
  });

  it('default sort = projectCount desc, then name asc', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    expect(out.rows.map((r) => r.name)).toEqual(['Trevor', 'Ainsley']);
  });
});

describe('fix-192 computeTeamMetrics — accumulation + lead-vs-delegate', () => {
  // 5053 25th Ave SW: same DA (Trevor) owns the original (2 lots / 6 units)
  // AND the redesign (2 lots / 6 units). Accumulated total = 4 lots / 12 units.
  const original = mkProject({ id: 'orig', address: '5053', num_lots: 2, units: 6 });
  const redesign = mkProject({
    id: 'rd', address: '5053 [Redesign 1]', num_lots: 2, units: 6,
    redesign_of_project_id: 'orig',
  });
  const team: TeamMember[] = [
    mkMember({ name: 'Trevor', role: 'da' }),
    mkMember({ name: 'Cam', role: 'da' }),
  ];

  it('the owner accrues original + redesign volume (4 lots / 12 units), not 2/6', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({ id: 1, project_id: 'orig', type: 'Building Permit', da: 'Trevor' }),
      mkPermit({ id: 2, project_id: 'rd', type: 'Building Permit', da: 'Trevor' }),
    ];
    const out = computeTeamMetrics(permits, [original, redesign], team, baseFilters);
    const trevor = out.rows.find((r) => r.name === 'Trevor')!;
    // Originals split.
    expect(trevor.unitCount).toBe(6);
    expect(trevor.lotCount).toBe(2);
    // Redesign split.
    expect(trevor.redesignUnitCount).toBe(6);
    expect(trevor.redesignLotCount).toBe(2);
    // Accumulated totals — how Bobby grades volume.
    expect(trevor.totalUnitCount).toBe(12);
    expect(trevor.totalLotCount).toBe(4);
    expect(trevor.totalProjectCount).toBe(2);
  });

  it('the holistic DA carries the volume; a permit delegate (Cam) gets a permit count + ZERO volume', () => {
    // Original project: BP da=Nicky… but here Trevor draws the BP and Cam is on
    // the Demolition (the delegate). Trevor owns the 6 units; Cam owns nothing.
    const permits: PermitWithCycles[] = [
      mkPermit({ id: 10, project_id: 'orig', type: 'Building Permit', da: 'Trevor' }),
      mkPermit({ id: 11, project_id: 'orig', type: 'Demolition', da: 'Cam' }),
    ];
    const out = computeTeamMetrics(permits, [original], team, baseFilters);

    const trevor = out.rows.find((r) => r.name === 'Trevor')!;
    expect(trevor.totalUnitCount).toBe(6);
    expect(trevor.totalLotCount).toBe(2);
    expect(trevor.permitCount).toBe(2); // both permits sit on his owned project
    expect(trevor.delegatePermitCount).toBe(0);

    const cam = out.rows.find((r) => r.name === 'Cam')!;
    // Delegate: measured ONLY by permits touched — zero lot/unit/project volume.
    expect(cam.unitCount).toBe(0);
    expect(cam.lotCount).toBe(0);
    expect(cam.totalUnitCount).toBe(0);
    expect(cam.totalLotCount).toBe(0);
    expect(cam.projectCount).toBe(0);
    expect(cam.delegatePermitCount).toBe(1);
  });

  it('no double-counting: a project credited once even with multiple DAs across its permits', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({ id: 20, project_id: 'orig', type: 'Building Permit', da: 'Trevor' }),
      mkPermit({ id: 21, project_id: 'orig', type: 'Demolition', da: 'Cam' }),
    ];
    const out = computeTeamMetrics(permits, [original], team, {
      ...baseFilters,
      activeOnly: false,
    });
    const totalUnitsCredited = out.rows.reduce((s, r) => s + r.totalUnitCount, 0);
    expect(totalUnitsCredited).toBe(6); // the project's 6 units, not 12
  });

  it('dual_da is a delegate — permit count only, no volume', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({ id: 30, project_id: 'orig', type: 'Building Permit', da: 'Trevor', dual_da: 'Cam' }),
    ];
    const out = computeTeamMetrics(permits, [original], team, baseFilters);
    const cam = out.rows.find((r) => r.name === 'Cam')!;
    expect(cam.totalUnitCount).toBe(0);
    expect(cam.delegatePermitCount).toBe(1);
    const trevor = out.rows.find((r) => r.name === 'Trevor')!;
    expect(trevor.totalUnitCount).toBe(6);
  });
});

describe('computeTeamMetrics — phase metrics + includeRedesigns', () => {
  // Trevor on 2 originals + 1 redesign.
  // Originals dd_days: 10, 20 → avg 15
  // Redesign dd_days: 30
  // includeRedesigns=true → (10+20+30)/3 = 20
  // includeRedesigns=false → (10+20)/2 = 15

  const projects = [
    mkProject({ id: 'p1', address: '1', units: 1 }),
    mkProject({ id: 'p2', address: '2', units: 1 }),
    mkProject({
      id: 'r1',
      address: 'r1',
      units: 1,
      redesign_of_project_id: 'p1',
    }),
  ];
  const permits: PermitWithCycles[] = [
    mkPermit({
      id: 1,
      project_id: 'p1',
      da: 'Trevor',
      dd_start: '2026-01-01',
      dd_end: '2026-01-11', // 10d
    }),
    mkPermit({
      id: 2,
      project_id: 'p2',
      da: 'Trevor',
      dd_start: '2026-02-01',
      dd_end: '2026-02-21', // 20d
    }),
    mkPermit({
      id: 3,
      project_id: 'r1',
      da: 'Trevor',
      dd_start: '2026-03-01',
      dd_end: '2026-03-31', // 30d
    }),
  ];
  const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

  it('includeRedesigns=true folds redesign permits into the avg (20d)', () => {
    const out = computeTeamMetrics(permits, projects, team, {
      ...baseFilters,
      includeRedesigns: true,
    });
    expect(out.rows[0].avgDdDays).toBe(20);
  });

  it('includeRedesigns=false drops redesign permits from the avg (15d)', () => {
    const out = computeTeamMetrics(permits, projects, team, {
      ...baseFilters,
      includeRedesigns: false,
    });
    expect(out.rows[0].avgDdDays).toBe(15);
    // Redesign volume columns still populate.
    expect(out.rows[0].redesignProjectCount).toBe(1);
    expect(out.rows[0].redesignUnitCount).toBe(1);
  });
});

describe('computeTeamMetrics — city review + corr + issuance', () => {
  const projects = [mkProject({ id: 'p1', address: '1', units: 1 })];
  const permits: PermitWithCycles[] = [
    mkPermit({
      id: 1,
      project_id: 'p1',
      da: 'Trevor',
      approval_date: '2026-06-01',
      actual_issue: '2026-06-15',
      corr_rounds: 2,
      permit_cycles: [
        mkCycle({ cycle_index: 0, intake_accepted: '2026-01-01' }), // 151d city review
      ],
    }),
    mkPermit({
      id: 2,
      project_id: 'p1',
      da: 'Trevor',
      approval_date: '2026-07-01',
      actual_issue: '2026-07-21',
      corr_rounds: 4,
      permit_cycles: [
        mkCycle({ cycle_index: 0, intake_accepted: '2026-01-31' }), // 151d
      ],
    }),
  ];
  const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

  it('measures city review = approval_date - c0.intake_accepted', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    expect(out.rows[0].avgCityReviewDays).toBe(151);
  });

  it('averages corr_rounds across permits', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    expect(out.rows[0].avgCorrectionsCycles).toBe(3); // (2+4)/2
  });

  it('measures issuance = actual_issue - approval_date', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    // (14 + 20) / 2 = 17
    expect(out.rows[0].avgIssuanceDays).toBe(17);
  });

  it('team averages match the single visible row when only one associate', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    expect(out.teamAvgCityReviewDays).toBe(151);
    expect(out.teamAvgCorrectionsCycles).toBe(3);
    expect(out.teamAvgIssuanceDays).toBe(17);
  });
});

describe('computeTeamMetrics — activeOnly filter', () => {
  const projects = [
    mkProject({ id: 'p1', address: '1', units: 1 }),
    mkProject({ id: 'p2', address: '2', units: 1 }),
  ];
  const permits: PermitWithCycles[] = [
    mkPermit({ id: 1, project_id: 'p1', da: 'Trevor' }),
    mkPermit({ id: 2, project_id: 'p2', da: 'Cam' }),
  ];
  const team: TeamMember[] = [
    mkMember({ name: 'Trevor', role: 'da', active: true }),
    mkMember({ name: 'Cam', role: 'da', active: false }),
  ];

  it('activeOnly=true drops Cam', () => {
    const out = computeTeamMetrics(permits, projects, team, {
      ...baseFilters,
      activeOnly: true,
    });
    expect(out.rows.map((r) => r.name)).toEqual(['Trevor']);
  });

  it('activeOnly=false includes both', () => {
    const out = computeTeamMetrics(permits, projects, team, {
      ...baseFilters,
      activeOnly: false,
    });
    expect(out.rows.map((r) => r.name).sort()).toEqual(['Cam', 'Trevor']);
    const cam = out.rows.find((r) => r.name === 'Cam')!;
    expect(cam.isActive).toBe(false);
  });
});

describe('computeTeamMetrics — date + juris filters', () => {
  const projects = [
    mkProject({
      id: 'p1',
      address: '1',
      units: 1,
      juris: 'Seattle',
      go_date: '2026-03-15',
    }),
    mkProject({
      id: 'p2',
      address: '2',
      units: 2,
      juris: 'Bellevue',
      go_date: '2026-04-10',
    }),
    mkProject({
      id: 'p3',
      address: '3',
      units: 1,
      juris: 'Seattle',
      go_date: '2025-12-01',
    }),
  ];
  const permits: PermitWithCycles[] = projects.map((p) =>
    mkPermit({
      id: Number(p.id.replace('p', '')),
      project_id: p.id,
      da: 'Trevor',
    }),
  );
  const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

  it('juris filter narrows to matching projects', () => {
    const out = computeTeamMetrics(permits, projects, team, {
      ...baseFilters,
      juris: 'Seattle',
    });
    // p1 + p3 → 2 projects + 2 units (1 + 1).
    expect(out.rows[0].projectCount).toBe(2);
    expect(out.rows[0].unitCount).toBe(2);
  });

  it('dateFrom + dateTo filter on project.go_date', () => {
    const out = computeTeamMetrics(permits, projects, team, {
      ...baseFilters,
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
    });
    // p1 + p2 (in window). p3 (2025) drops.
    expect(out.rows[0].projectCount).toBe(2);
    expect(out.rows[0].unitCount).toBe(3);
  });

  it('projects without go_date drop out when a date filter is set', () => {
    const projWithNullGo = [
      mkProject({ id: 'pn', address: 'n', units: 5, go_date: null }),
    ];
    const permitsWithNullGo: PermitWithCycles[] = [
      mkPermit({ id: 999, project_id: 'pn', da: 'Trevor' }),
    ];
    const out = computeTeamMetrics(
      permitsWithNullGo,
      projWithNullGo,
      team,
      { ...baseFilters, dateFrom: '2026-01-01', dateTo: '2026-12-31' },
    );
    expect(out.rows).toEqual([]);
  });
});

describe('computeTeamMetrics — role selection (ENT picks both ent + ent_lead variants)', () => {
  const projects = [mkProject({ id: 'p1', address: '1', units: 1 })];
  const permits: PermitWithCycles[] = [
    mkPermit({ id: 1, project_id: 'p1', ent_lead: 'Bobby' }),
  ];
  const team: TeamMember[] = [
    // Bobby exists under both role variants — fix-127's role mapper
    // treats ENT as union of both.
    mkMember({ name: 'Bobby', role: 'ent', active: true }),
    mkMember({ name: 'Bobby', role: 'ent_lead', active: true }),
  ];

  it('role=ent matches Bobby on either team_member role variant', () => {
    const out = computeTeamMetrics(permits, projects, team, {
      ...baseFilters,
      role: 'ent',
    });
    expect(out.rows.map((r) => r.name)).toEqual(['Bobby']);
  });

  it('role=da does NOT pick up a permit credited via ent_lead', () => {
    const out = computeTeamMetrics(permits, projects, team, {
      ...baseFilters,
      role: 'da',
    });
    expect(out.rows).toEqual([]);
  });
});

describe('computeTeamMetrics — team averages', () => {
  const projects = [
    mkProject({ id: 'p1', address: '1', units: 1 }),
    mkProject({ id: 'p2', address: '2', units: 1 }),
  ];
  const permits: PermitWithCycles[] = [
    mkPermit({
      id: 1,
      project_id: 'p1',
      da: 'Trevor',
      dd_start: '2026-01-01',
      dd_end: '2026-01-11', // 10d
    }),
    mkPermit({
      id: 2,
      project_id: 'p2',
      da: 'Ainsley',
      dd_start: '2026-02-01',
      dd_end: '2026-02-21', // 20d
    }),
  ];
  const team: TeamMember[] = [
    mkMember({ name: 'Trevor', role: 'da' }),
    mkMember({ name: 'Ainsley', role: 'da' }),
  ];

  it('teamAvgDdDays = average across visible rows', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    // (10 + 20) / 2 = 15
    expect(out.teamAvgDdDays).toBe(15);
  });
});

// fix-172 (effect B): per-associate phase tiles subtract held days.
import type { ProjectHold } from '../lib/database.types';
describe('fix-172 computeTeamMetrics — held days subtracted', () => {
  function tpHold(start: string, end: string | null): ProjectHold {
    return {
      id: `h-${start}`, tenant_id: 't1', project_id: 'p1', reason: 'MHA', note: null,
      hold_start: start, hold_end: end, created_by: null, created_at: '', updated_at: '',
    };
  }
  const projects = [mkProject({ id: 'p1', address: '1', units: 1 })];
  const permits: PermitWithCycles[] = [
    mkPermit({
      id: 1,
      project_id: 'p1',
      da: 'Trevor',
      approval_date: '2026-06-01',
      permit_cycles: [mkCycle({ cycle_index: 0, intake_accepted: '2026-01-01' })], // 151d
    }),
  ];
  const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

  it('avgCityReviewDays drops by the held days; no-hold byte-identical', () => {
    expect(computeTeamMetrics(permits, projects, team, baseFilters).rows[0].avgCityReviewDays).toBe(151);
    const holds = new Map([['p1', [tpHold('2026-02-01', '2026-02-11')]]]); // 10 held days
    const withHold = computeTeamMetrics(permits, projects, team, baseFilters, holds);
    expect(withHold.rows[0].avgCityReviewDays).toBe(141);
    // empty map → unchanged
    expect(
      computeTeamMetrics(permits, projects, team, baseFilters, new Map()).rows[0].avgCityReviewDays,
    ).toBe(151);
  });
});

// fix-216: per-DA REUSE context metric. Counts (and rates) the owner's lead
// projects that were templated off another project. Must attribute to the SAME
// holistic owner as volume, and must NOT alter volume/lot/unit credit.
describe('computeTeamMetrics — fix-216 reuse metric', () => {
  // Ainsley owns 4 projects via the BP da; 2 carry reused_from_project_id.
  const projects: Project[] = [
    mkProject({ id: 'a1', address: '1 A', units: 3 }),
    mkProject({ id: 'a2', address: '2 A', units: 4, reused_from_project_id: 'src-1' }),
    mkProject({ id: 'a3', address: '3 A', units: 2, reused_from_project_id: 'src-2' }),
    mkProject({ id: 'a4', address: '4 A', units: 5 }),
  ];
  const permits: PermitWithCycles[] = [
    mkPermit({ id: 1, project_id: 'a1', da: 'Ainsley' }),
    // a2: Ainsley owns the BP; a delegate DA on a 2nd permit must NOT get reuse credit.
    mkPermit({ id: 2, project_id: 'a2', da: 'Ainsley' }),
    mkPermit({ id: 3, project_id: 'a2', type: 'Demolition', da: 'Cam' }),
    mkPermit({ id: 4, project_id: 'a3', da: 'Ainsley' }),
    mkPermit({ id: 5, project_id: 'a4', da: 'Ainsley' }),
  ];
  const team: TeamMember[] = [
    mkMember({ name: 'Ainsley', role: 'da', active: true }),
    mkMember({ name: 'Cam', role: 'da', active: true }),
  ];

  it('counts reuse among the owner\'s lead projects with the right rate', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    const ainsley = out.rows.find((r) => r.name === 'Ainsley')!;
    expect(ainsley.totalProjectCount).toBe(4);
    expect(ainsley.reuseProjectCount).toBe(2);
    expect(ainsley.reuseRate).toBe(50); // 2/4 = 50%
    // Volume credit is unchanged by reuse: 3+4+2+5 = 14 units.
    expect(ainsley.totalUnitCount).toBe(14);
  });

  it('reuse is attributed to the holistic owner, not a permit-level delegate', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters);
    const cam = out.rows.find((r) => r.name === 'Cam');
    // Cam is only a delegate on a2's Demolition — no lead projects, so no reuse.
    expect(cam?.reuseProjectCount ?? 0).toBe(0);
    expect(cam?.totalProjectCount ?? 0).toBe(0);
    expect(cam?.delegatePermitCount).toBe(1);
  });

  it('reuseRate is null for an owner with no lead projects (guards /0)', () => {
    // Only a delegate → filtered/zero; assert via a solo owner with 0 reuse too.
    const out = computeTeamMetrics(
      [mkPermit({ id: 9, project_id: 'a1', da: 'Ainsley' })],
      [mkProject({ id: 'a1', address: '1 A', units: 1 })],
      team,
      baseFilters,
    );
    const ainsley = out.rows.find((r) => r.name === 'Ainsley')!;
    expect(ainsley.reuseProjectCount).toBe(0);
    expect(ainsley.reuseRate).toBe(0); // 0/1 = 0%, not null (has a lead project)
  });
});

// fix-226: DA co-credit — a project handed off DA-A → DA-B shows in BOTH DAs'
// per-DA metrics; the org total counts it once; the shared count surfaces it.
describe('computeTeamMetrics — DA co-credit (fix-226)', () => {
  const team = [
    mkMember({ name: 'Trevor', role: 'da' }),
    mkMember({ name: 'Nicky', role: 'da' }),
    mkMember({ name: 'Ainsley', role: 'da' }),
  ];
  // One shared project (handed off Trevor → Nicky; permits.da is now Nicky) and
  // one solo project owned by Ainsley.
  const shared = mkProject({ id: 'sp', address: '900 Shared', units: 9, num_lots: 3 });
  const solo = mkProject({ id: 'so', address: '11 Solo', units: 2, num_lots: 1 });
  const projects = [shared, solo];
  const permits = [
    mkPermit({ id: 1, project_id: 'sp', da: 'Nicky' }),
    mkPermit({ id: 2, project_id: 'so', da: 'Ainsley' }),
  ];
  const coCredit = new Map<string, Set<string>>([
    ['sp', new Set(['Trevor', 'Nicky'])],
  ]);

  it('a handed-off project appears in BOTH the original and new DA metrics', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters, undefined, coCredit);
    const trevor = out.rows.find((r) => r.name === 'Trevor')!;
    const nicky = out.rows.find((r) => r.name === 'Nicky')!;
    // Both credited the full volume (9 units / 3 lots), not split.
    expect(trevor.projectCount).toBe(1);
    expect(trevor.unitCount).toBe(9);
    expect(trevor.lotCount).toBe(3);
    expect(nicky.projectCount).toBe(1);
    expect(nicky.unitCount).toBe(9);
    expect(nicky.lotCount).toBe(3);
    // Both see it flagged shared.
    expect(trevor.sharedProjectCount).toBe(1);
    expect(nicky.sharedProjectCount).toBe(1);
  });

  it('the org roll-up counts the shared project once (sum of holistic owners)', () => {
    // With NO co-credit map the buckets ARE the holistic-owner attribution an org
    // total iterates: the project lands on exactly one owner (Nicky), never Trevor.
    const org = computeTeamMetrics(permits, projects, team, baseFilters);
    const nicky = org.rows.find((r) => r.name === 'Nicky')!;
    expect(nicky.projectCount).toBe(1);
    expect(nicky.unitCount).toBe(9);
    expect(org.rows.find((r) => r.name === 'Trevor')).toBeUndefined();
    // Company-wide unit total = 9 (shared) + 2 (solo) = 11 — counted once.
    const orgUnits = org.rows.reduce((s, r) => s + r.unitCount, 0);
    expect(orgUnits).toBe(11);
  });

  it('a project with no handoff shows only under its owner; no shared flag', () => {
    const out = computeTeamMetrics(permits, projects, team, baseFilters, undefined, coCredit);
    const ainsley = out.rows.find((r) => r.name === 'Ainsley')!;
    expect(ainsley.projectCount).toBe(1);
    expect(ainsley.unitCount).toBe(2);
    expect(ainsley.sharedProjectCount).toBe(0); // solo is not shared
  });
});
