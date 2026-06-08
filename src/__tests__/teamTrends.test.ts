import { describe, it, expect } from 'vitest';
import {
  buildMonthBuckets,
  computeTeamTrends,
} from '../lib/teamTrends';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  TeamMember,
} from '../lib/database.types';

// fix-132-a: per-month phase trend aggregation for the drill-down.
// The snapshot (fix-131-c) tells you who's slow today; the trend tells
// you whether they're getting better. These tests pin the bucketing +
// the per-phase math + the team-cohort baseline + the empty-month
// affordance.

function mkProject(over: Partial<Project> & Pick<Project, 'id' | 'address'>): Project {
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

function mkC0(intake: string): PermitCycle {
  return {
    id: `c-0-${Math.random()}`,
    permit_id: 1,
    cycle_index: 0,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: intake,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('buildMonthBuckets', () => {
  it('returns inclusive YYYY-MM buckets between monthFrom and monthTo', () => {
    expect(buildMonthBuckets('2026-01', '2026-03')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });

  it('returns a single month when monthFrom === monthTo', () => {
    expect(buildMonthBuckets('2026-05', '2026-05')).toEqual(['2026-05']);
  });

  it('rolls over year boundaries', () => {
    expect(buildMonthBuckets('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('returns empty when monthFrom > monthTo', () => {
    expect(buildMonthBuckets('2026-06', '2026-03')).toEqual([]);
  });
});

describe('computeTeamTrends — Trevor demonstration', () => {
  // Trevor has 3 BPs: DD 3d in Jan, 5d in Feb, 2d in Mar.
  // Each permit's dd_end month anchors which bucket the value lands in.
  const projects = [
    mkProject({ id: 'p1', address: 'Jan St' }),
    mkProject({ id: 'p2', address: 'Feb Ave' }),
    mkProject({ id: 'p3', address: 'Mar Way' }),
  ];
  const permits: PermitWithCycles[] = [
    mkPermit({
      id: 1,
      project_id: 'p1',
      da: 'Trevor',
      dd_start: '2026-01-01',
      dd_end: '2026-01-04', // 3d
    }),
    mkPermit({
      id: 2,
      project_id: 'p2',
      da: 'Trevor',
      dd_start: '2026-02-01',
      dd_end: '2026-02-06', // 5d
    }),
    mkPermit({
      id: 3,
      project_id: 'p3',
      da: 'Trevor',
      dd_start: '2026-03-01',
      dd_end: '2026-03-03', // 2d
    }),
  ];
  const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

  it('DD Phase: 3 month buckets show 3 / 5 / 2 days respectively', () => {
    const out = computeTeamTrends(permits, projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-03',
    });
    expect(out.ddPhase).toHaveLength(3);
    expect(out.ddPhase[0]).toMatchObject({
      month: '2026-01',
      associateAvg: 3,
      associateN: 1,
    });
    expect(out.ddPhase[1]).toMatchObject({
      month: '2026-02',
      associateAvg: 5,
      associateN: 1,
    });
    expect(out.ddPhase[2]).toMatchObject({
      month: '2026-03',
      associateAvg: 2,
      associateN: 1,
    });
  });

  it('team avg equals the associate avg when the associate is the only role member', () => {
    const out = computeTeamTrends(permits, projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-03',
    });
    expect(out.ddPhase[0].teamAvg).toBe(3);
    expect(out.ddPhase[1].teamAvg).toBe(5);
    expect(out.ddPhase[2].teamAvg).toBe(2);
  });
});

describe('computeTeamTrends — team baseline overlay', () => {
  // Two DAs: Trevor has DD 30d in Jan, Ainsley has DD 10d in Jan.
  // → Trevor's associateAvg = 30; teamAvg = (30+10)/2 = 20.
  const projects = [
    mkProject({ id: 'tp', address: 'T' }),
    mkProject({ id: 'ap', address: 'A' }),
  ];
  const permits: PermitWithCycles[] = [
    mkPermit({
      id: 1,
      project_id: 'tp',
      da: 'Trevor',
      dd_start: '2026-01-01',
      dd_end: '2026-01-31', // 30d
    }),
    mkPermit({
      id: 2,
      project_id: 'ap',
      da: 'Ainsley',
      dd_start: '2026-01-01',
      dd_end: '2026-01-11', // 10d
    }),
  ];
  const team: TeamMember[] = [
    mkMember({ name: 'Trevor', role: 'da' }),
    mkMember({ name: 'Ainsley', role: 'da' }),
  ];

  it("Trevor's avg = 30d, team avg = 20d (cohort includes Ainsley)", () => {
    const out = computeTeamTrends(permits, projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-01',
    });
    expect(out.ddPhase[0].associateAvg).toBe(30);
    expect(out.ddPhase[0].teamAvg).toBe(20);
    expect(out.ddPhase[0].associateN).toBe(1);
    expect(out.ddPhase[0].teamN).toBe(2);
  });
});

describe('computeTeamTrends — empty months + missing fields', () => {
  const projects = [mkProject({ id: 'p1', address: '1' })];
  const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

  it('a month with no associate permits → associateAvg=null, associateN=0', () => {
    // Trevor only has Jan data; Feb + Mar are empty for him.
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Trevor',
        dd_start: '2026-01-01',
        dd_end: '2026-01-11',
      }),
    ];
    const out = computeTeamTrends(permits, projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-03',
    });
    expect(out.ddPhase[0].associateAvg).toBe(10);
    expect(out.ddPhase[1].associateAvg).toBeNull();
    expect(out.ddPhase[1].associateN).toBe(0);
    expect(out.ddPhase[2].associateAvg).toBeNull();
  });

  it('a month with no role-cohort permits at all → both avgs null', () => {
    const out = computeTeamTrends([], projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-01',
    });
    expect(out.ddPhase[0].associateAvg).toBeNull();
    expect(out.ddPhase[0].teamAvg).toBeNull();
    expect(out.ddPhase[0].associateN).toBe(0);
    expect(out.ddPhase[0].teamN).toBe(0);
  });

  it('permits missing dd_start / dd_end drop out cleanly', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Trevor',
        dd_start: null,
        dd_end: '2026-01-15',
      }),
      mkPermit({
        id: 2,
        project_id: 'p1',
        da: 'Trevor',
        dd_start: '2026-01-01',
        dd_end: '2026-01-11', // 10d — the only valid one
      }),
    ];
    const out = computeTeamTrends(permits, projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-01',
    });
    expect(out.ddPhase[0].associateAvg).toBe(10);
    expect(out.ddPhase[0].associateN).toBe(1);
  });

  it('permits with role-credit name NOT in the roster are ignored', () => {
    // "Stranger" has a permit credit but isn't in team_members → does
    // not contribute to either side.
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Stranger',
        dd_start: '2026-01-01',
        dd_end: '2026-01-11',
      }),
    ];
    const out = computeTeamTrends(permits, projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-01',
    });
    expect(out.ddPhase[0].teamAvg).toBeNull();
    expect(out.ddPhase[0].associateAvg).toBeNull();
  });
});

describe('computeTeamTrends — per-phase anchors', () => {
  const projects = [mkProject({ id: 'p1', address: '1' })];
  const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

  it('City Review anchors on approval_date month and uses c0.intake_accepted', () => {
    const permit = mkPermit({
      id: 1,
      project_id: 'p1',
      da: 'Trevor',
      approval_date: '2026-03-15',
      permit_cycles: [mkC0('2026-01-15')], // 59 days
    });
    const out = computeTeamTrends([permit], projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-03',
    });
    expect(out.cityReview[2]).toMatchObject({
      month: '2026-03',
      associateAvg: 59,
      associateN: 1,
    });
    // Jan and Feb buckets have nothing (no approval landed those months).
    expect(out.cityReview[0].associateN).toBe(0);
    expect(out.cityReview[1].associateN).toBe(0);
  });

  it('Corrections anchors on approval_date month and reads corr_rounds', () => {
    const permit = mkPermit({
      id: 1,
      project_id: 'p1',
      da: 'Trevor',
      approval_date: '2026-02-10',
      corr_rounds: 3,
    });
    const out = computeTeamTrends([permit], projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-03',
    });
    expect(out.corrections[1]).toMatchObject({
      month: '2026-02',
      associateAvg: 3,
      associateN: 1,
    });
  });

  it('Issuance anchors on actual_issue month and uses approval_date → actual_issue', () => {
    const permit = mkPermit({
      id: 1,
      project_id: 'p1',
      da: 'Trevor',
      approval_date: '2026-02-15',
      actual_issue: '2026-03-01', // 14d
    });
    const out = computeTeamTrends([permit], projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-03',
    });
    expect(out.issuance[2]).toMatchObject({
      month: '2026-03',
      associateAvg: 14,
      associateN: 1,
    });
  });
});

describe('computeTeamTrends — ENT role variants merged', () => {
  it('role=ent matches both team_members.role=ent and ent_lead', () => {
    const projects = [mkProject({ id: 'p1', address: '1' })];
    const team: TeamMember[] = [
      mkMember({ name: 'Bobby', role: 'ent' }),
      mkMember({ name: 'Bobby', role: 'ent_lead' }),
    ];
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        ent_lead: 'Bobby',
        dd_start: '2026-01-01',
        dd_end: '2026-01-11',
      }),
    ];
    const out = computeTeamTrends(permits, projects, team, {
      role: 'ent',
      associateName: 'Bobby',
      monthFrom: '2026-01',
      monthTo: '2026-01',
    });
    expect(out.ddPhase[0].associateAvg).toBe(10);
  });
});
