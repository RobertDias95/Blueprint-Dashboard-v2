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
