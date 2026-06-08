import { describe, it, expect } from 'vitest';
import { computeTeamWorkload } from '../lib/teamWorkload';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  TeamMember,
} from '../lib/database.types';

// fix-133-a: current workload aggregation. These tests pin the open/
// closed gate, the lifecycle-stage breakdown, the role-roster filter,
// the activeOnly filter, the sort order, and the team-avg math.

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
    stage: 'de',
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

function mkCycle(over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>): PermitCycle {
  const { cycle_index, ...rest } = over;
  return {
    id: `c-${Math.random()}`,
    permit_id: 0,
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

describe('computeTeamWorkload — Trevor heavy load demonstration', () => {
  // Brief's demonstration fixture: Trevor 12 open (5 design / 4 review
  // / 3 corrections), Cam 2 open. Team avg = (12 + 2) / 2 = 7.
  const projects = [
    mkProject({ id: 'tp1', address: 'T1' }),
    mkProject({ id: 'tp2', address: 'T2' }),
    mkProject({ id: 'tp3', address: 'T3' }),
    mkProject({ id: 'tp4', address: 'T4' }),
    mkProject({ id: 'cp1', address: 'C1' }),
  ];
  const team: TeamMember[] = [
    mkMember({ name: 'Trevor', role: 'da' }),
    mkMember({ name: 'Cam', role: 'da' }),
  ];

  // 5 in design: dd_start set, no approval, no submitted cycle.
  const trevorDesign: PermitWithCycles[] = [];
  for (let i = 0; i < 5; i++) {
    trevorDesign.push(
      mkPermit({
        id: 100 + i,
        project_id: `tp${(i % 4) + 1}`,
        da: 'Trevor',
        dd_start: '2026-04-01',
      }),
    );
  }
  // 4 in review: latest cycle has submitted, no corr_issued.
  const trevorReview: PermitWithCycles[] = [];
  for (let i = 0; i < 4; i++) {
    trevorReview.push(
      mkPermit({
        id: 200 + i,
        project_id: `tp${(i % 4) + 1}`,
        da: 'Trevor',
        permit_cycles: [mkCycle({ cycle_index: 0, submitted: '2026-05-01' })],
      }),
    );
  }
  // 3 in corrections: latest cycle has corr_issued, no resubmitted.
  const trevorCorr: PermitWithCycles[] = [];
  for (let i = 0; i < 3; i++) {
    trevorCorr.push(
      mkPermit({
        id: 300 + i,
        project_id: `tp${(i % 4) + 1}`,
        da: 'Trevor',
        permit_cycles: [
          mkCycle({
            cycle_index: 0,
            submitted: '2026-04-01',
            corr_issued: '2026-05-15',
          }),
        ],
      }),
    );
  }
  // Cam: 2 open (1 design, 1 review).
  const camPermits: PermitWithCycles[] = [
    mkPermit({
      id: 500,
      project_id: 'cp1',
      da: 'Cam',
      dd_start: '2026-04-01',
    }),
    mkPermit({
      id: 501,
      project_id: 'cp1',
      da: 'Cam',
      permit_cycles: [mkCycle({ cycle_index: 0, submitted: '2026-05-01' })],
    }),
  ];

  const permits = [
    ...trevorDesign,
    ...trevorReview,
    ...trevorCorr,
    ...camPermits,
  ];

  it("Trevor's row: 12 open / 4 distinct projects, breakdown 5 design / 4 review / 3 corrections", () => {
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    const trevor = out.rows.find((r) => r.name === 'Trevor');
    expect(trevor).toBeDefined();
    expect(trevor!.activePermitCount).toBe(12);
    expect(trevor!.activeProjectCount).toBe(4);
    expect(trevor!.inDesignCount).toBe(5);
    expect(trevor!.inReviewCount).toBe(4);
    expect(trevor!.inCorrectionsCount).toBe(3);
  });

  it("Cam's row is much shorter: 2 open, 1 design + 1 review", () => {
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    const cam = out.rows.find((r) => r.name === 'Cam');
    expect(cam!.activePermitCount).toBe(2);
    expect(cam!.activeProjectCount).toBe(1);
    expect(cam!.inDesignCount).toBe(1);
    expect(cam!.inReviewCount).toBe(1);
    expect(cam!.inCorrectionsCount).toBe(0);
  });

  it('team avg open permits = (12 + 2) / 2 = 7', () => {
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.teamAvgActivePermitCount).toBe(7);
  });

  it('team avg active projects = (4 + 1) / 2 = 2.5', () => {
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.teamAvgActiveProjectCount).toBe(2.5);
  });

  it('sort = highest load first (Trevor before Cam)', () => {
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows.map((r) => r.name)).toEqual(['Trevor', 'Cam']);
  });
});

describe('computeTeamWorkload — open/closed gate via effectiveStage', () => {
  const projects = [mkProject({ id: 'p1', address: '1' })];
  const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

  it('permits with actual_issue set drop out (effectiveStage=is)', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Trevor',
        actual_issue: '2026-06-01',
        approval_date: '2026-05-01',
      }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows).toHaveLength(0);
  });

  it('permits with approval_date but no issue drop out (effectiveStage=ap)', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Trevor',
        approval_date: '2026-05-01',
      }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    // approval_date alone → 'ap' → out of bucket.
    expect(out.rows).toHaveLength(0);
  });

  it('a fresh dd_start permit lands in design', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Trevor',
        dd_start: '2026-04-01',
      }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows[0].inDesignCount).toBe(1);
    expect(out.rows[0].inReviewCount).toBe(0);
    expect(out.rows[0].inCorrectionsCount).toBe(0);
  });

  it('a submitted permit lands in review (pm)', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Trevor',
        permit_cycles: [mkCycle({ cycle_index: 0, submitted: '2026-05-01' })],
      }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows[0].inReviewCount).toBe(1);
    expect(out.rows[0].inDesignCount).toBe(0);
  });

  it('a corr_issued (no resubmitted) permit lands in corrections (co)', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Trevor',
        permit_cycles: [
          mkCycle({
            cycle_index: 0,
            submitted: '2026-04-01',
            corr_issued: '2026-05-15',
          }),
        ],
      }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows[0].inCorrectionsCount).toBe(1);
    expect(out.rows[0].inReviewCount).toBe(0);
  });

  it('resubmitted on the latest cycle reverts back to review (pm), not corrections', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        da: 'Trevor',
        permit_cycles: [
          mkCycle({
            cycle_index: 0,
            submitted: '2026-04-01',
            corr_issued: '2026-05-15',
            resubmitted: '2026-05-20',
          }),
        ],
      }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows[0].inCorrectionsCount).toBe(0);
    expect(out.rows[0].inReviewCount).toBe(1);
  });
});

describe('computeTeamWorkload — activeOnly + role roster gates', () => {
  const projects = [mkProject({ id: 'p1', address: '1' })];

  it('activeOnly=true drops inactive associates', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({ id: 1, project_id: 'p1', da: 'Trevor', dd_start: '2026-04-01' }),
      mkPermit({ id: 2, project_id: 'p1', da: 'Cam', dd_start: '2026-04-01' }),
    ];
    const team: TeamMember[] = [
      mkMember({ name: 'Trevor', role: 'da', active: true }),
      mkMember({ name: 'Cam', role: 'da', active: false }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows.map((r) => r.name)).toEqual(['Trevor']);
  });

  it('activeOnly=false reveals inactive associates', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({ id: 1, project_id: 'p1', da: 'Trevor', dd_start: '2026-04-01' }),
      mkPermit({ id: 2, project_id: 'p1', da: 'Cam', dd_start: '2026-04-01' }),
    ];
    const team: TeamMember[] = [
      mkMember({ name: 'Trevor', role: 'da', active: true }),
      mkMember({ name: 'Cam', role: 'da', active: false }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: false,
    });
    expect(out.rows.map((r) => r.name).sort()).toEqual(['Cam', 'Trevor']);
    expect(out.rows.find((r) => r.name === 'Cam')!.isActive).toBe(false);
  });

  it('a name credited under role X is dropped when filter selects role Y', () => {
    // Bobby is ENT in the roster, but he's credited on the DA field —
    // shouldn't show up under role=da.
    const permits: PermitWithCycles[] = [
      mkPermit({ id: 1, project_id: 'p1', da: 'Bobby', dd_start: '2026-04-01' }),
    ];
    const team: TeamMember[] = [mkMember({ name: 'Bobby', role: 'ent' })];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows).toHaveLength(0);
  });

  it('role=ent matches both ent and ent_lead roster rows (union)', () => {
    const permits: PermitWithCycles[] = [
      mkPermit({
        id: 1,
        project_id: 'p1',
        ent_lead: 'Bobby',
        dd_start: '2026-04-01',
      }),
    ];
    const team: TeamMember[] = [
      mkMember({ name: 'Bobby', role: 'ent_lead' }),
    ];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'ent',
      activeOnly: true,
    });
    expect(out.rows.map((r) => r.name)).toEqual(['Bobby']);
  });
});

describe('computeTeamWorkload — empty + edge cases', () => {
  it('no permits → empty rows + null team avgs', () => {
    const out = computeTeamWorkload(
      [],
      [],
      [mkMember({ name: 'Trevor', role: 'da' })],
      { role: 'da', activeOnly: true },
    );
    expect(out.rows).toEqual([]);
    expect(out.teamAvgActiveProjectCount).toBeNull();
    expect(out.teamAvgActivePermitCount).toBeNull();
  });

  it('distinct project count dedupes permits across the same project', () => {
    const projects = [mkProject({ id: 'p1', address: '1' })];
    const permits: PermitWithCycles[] = [
      mkPermit({ id: 1, project_id: 'p1', da: 'Trevor', dd_start: '2026-04-01' }),
      mkPermit({ id: 2, project_id: 'p1', da: 'Trevor', dd_start: '2026-04-01' }),
    ];
    const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];
    const out = computeTeamWorkload(permits, projects, team, {
      role: 'da',
      activeOnly: true,
    });
    expect(out.rows[0].activeProjectCount).toBe(1);
    expect(out.rows[0].activePermitCount).toBe(2);
  });
});
