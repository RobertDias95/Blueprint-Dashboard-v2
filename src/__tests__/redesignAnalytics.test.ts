import { describe, it, expect } from 'vitest';
import { computeRedesignAnalytics } from '../lib/redesignAnalytics';
import type {
  PermitWithCycles,
  Project,
  RedesignTrigger,
} from '../lib/database.types';

// fix-134-a: redesign analytics aggregation tests. Cover the trigger
// breakdown, builder rate math, per-role leaderboards, reuse-permit
// rate, the date/juris filters, and the empty-state path.

function mkProject(
  over: Partial<Project> & Pick<Project, 'id' | 'address'>,
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

// Brief's demonstration fixture:
//   - 5 redesigns total: 3 trigger=builder, 1 city_correction, 1 unknown
//   - 1 dominant builder (Acme): 3 of their 5 total projects are redesigns
//     → redesignRate = 0.6 = 60%
const demoProjects: Project[] = [
  // Acme's 5 projects: 2 originals + 3 redesigns.
  mkProject({ id: 'op1', address: '1 Original', builder_name: 'Acme', go_date: '2026-01-01' }),
  mkProject({ id: 'op2', address: '2 Original', builder_name: 'Acme', go_date: '2026-01-15' }),
  mkProject({
    id: 'rp1',
    address: '1 Redesign',
    builder_name: 'Acme',
    go_date: '2026-02-01',
    redesign_of_project_id: 'op1',
    redesign_trigger: 'builder',
    redesign_reuses_original_permit: true,
    redesign_notes: 'Scope change requested by builder',
    created_at: '2026-02-10T00:00:00Z',
  }),
  mkProject({
    id: 'rp2',
    address: '2 Redesign',
    builder_name: 'Acme',
    go_date: '2026-03-01',
    redesign_of_project_id: 'op2',
    redesign_trigger: 'builder',
    redesign_reuses_original_permit: false,
    created_at: '2026-03-05T00:00:00Z',
  }),
  mkProject({
    id: 'rp3',
    address: '3 Redesign',
    builder_name: 'Acme',
    go_date: '2026-03-15',
    redesign_of_project_id: 'op1',
    redesign_trigger: 'builder',
    redesign_reuses_original_permit: null,
    created_at: '2026-03-20T00:00:00Z',
  }),
  // BetaBuilds: 1 redesign with city_correction trigger.
  mkProject({ id: 'bop1', address: 'Beta Original', builder_name: 'BetaBuilds', go_date: '2026-01-01' }),
  mkProject({
    id: 'brp1',
    address: 'Beta Redesign',
    builder_name: 'BetaBuilds',
    go_date: '2026-04-01',
    redesign_of_project_id: 'bop1',
    redesign_trigger: 'city_correction',
    redesign_reuses_original_permit: true,
    created_at: '2026-04-10T00:00:00Z',
  }),
  // Standalone redesign with no trigger (unknown bucket).
  mkProject({
    id: 'urp1',
    address: 'Mystery Redesign',
    builder_name: null,
    go_date: '2026-05-01',
    redesign_of_project_id: 'op1',
    redesign_trigger: null,
    created_at: '2026-05-10T00:00:00Z',
  }),
];

// Permits credit Trevor on Acme's redesigns; Ainsley on Beta's.
const demoPermits: PermitWithCycles[] = [
  mkPermit({ id: 1, project_id: 'rp1', da: 'Trevor', dm: 'Jade', ent_lead: 'Bobby' }),
  mkPermit({ id: 2, project_id: 'rp2', da: 'Trevor' }),
  mkPermit({ id: 3, project_id: 'rp3', da: 'Trevor' }),
  mkPermit({ id: 4, project_id: 'brp1', da: 'Ainsley' }),
];

describe('computeRedesignAnalytics — demonstration fixture', () => {
  const out = computeRedesignAnalytics(demoPermits, demoProjects, {
    dateFrom: null,
    dateTo: null,
    juris: '',
  });

  it('totalRedesigns = 5', () => {
    expect(out.totalRedesigns).toBe(5);
  });

  it('reuse permit rate: 2 of 5 → 0.4', () => {
    expect(out.reusePermitCount).toBe(2);
    expect(out.reusePermitRate).toBe(0.4);
  });

  it('trigger breakdown sorts builder first (count=3), then city_correction (1), then unknown (1)', () => {
    expect(out.triggerBreakdown.map((t) => t.trigger)).toEqual([
      'builder',
      'city_correction',
      'unknown',
    ]);
    expect(out.triggerBreakdown[0].count).toBe(3);
    expect(out.triggerBreakdown[0].label).toBe('Builder');
    expect(out.triggerBreakdown[2].label).toBe('Unspecified');
  });

  it('Acme tops the builder leaderboard with rate=60%', () => {
    expect(out.builderLeaderboard[0].builderName).toBe('Acme');
    expect(out.builderLeaderboard[0].redesignCount).toBe(3);
    expect(out.builderLeaderboard[0].totalProjectCount).toBe(5);
    expect(out.builderLeaderboard[0].redesignRate).toBeCloseTo(0.6, 5);
  });

  it('BetaBuilds appears below Acme with redesignRate=50%', () => {
    const beta = out.builderLeaderboard.find((b) => b.builderName === 'BetaBuilds');
    expect(beta).toBeDefined();
    expect(beta!.redesignCount).toBe(1);
    expect(beta!.totalProjectCount).toBe(2);
    expect(beta!.redesignRate).toBeCloseTo(0.5, 5);
    // Sort order: Acme (3) before BetaBuilds (1).
    expect(out.builderLeaderboard.map((b) => b.builderName)).toEqual([
      'Acme',
      'BetaBuilds',
    ]);
  });

  it('DA leaderboard: Trevor with 3 redesigns, Ainsley with 1', () => {
    const da = out.daLeaderboard;
    expect(da.map((r) => r.name)).toEqual(['Trevor', 'Ainsley']);
    expect(da[0].redesignCount).toBe(3);
    expect(da[1].redesignCount).toBe(1);
  });

  it('DM leaderboard: Jade with 1 (credited on rp1)', () => {
    expect(out.dmLeaderboard.map((r) => r.name)).toEqual(['Jade']);
    expect(out.dmLeaderboard[0].redesignCount).toBe(1);
  });

  it('ENT leaderboard: Bobby with 1 (credited on rp1)', () => {
    expect(out.entLeaderboard.map((r) => r.name)).toEqual(['Bobby']);
  });

  it('recent redesigns sorted by created_at desc (Mystery Redesign first)', () => {
    expect(out.recentRedesigns[0].redesignAddress).toBe('Mystery Redesign');
    expect(out.recentRedesigns[0].triggerLabel).toBe('Unspecified');
    expect(out.recentRedesigns[1].redesignAddress).toBe('Beta Redesign');
    expect(out.recentRedesigns[4].redesignAddress).toBe('1 Redesign');
  });

  it('recent row carries the original address when the FK resolves', () => {
    const row = out.recentRedesigns.find(
      (r) => r.redesignProjectId === 'rp1',
    );
    expect(row!.originalProjectId).toBe('op1');
    expect(row!.originalAddress).toBe('1 Original');
  });
});

describe('computeRedesignAnalytics — filters', () => {
  it('date filter excludes redesigns outside the window', () => {
    const out = computeRedesignAnalytics(demoPermits, demoProjects, {
      dateFrom: '2026-04-01',
      dateTo: '2026-06-01',
      juris: '',
    });
    // Only brp1 (2026-04-01) and urp1 (2026-05-01) remain.
    expect(out.totalRedesigns).toBe(2);
    expect(out.recentRedesigns.map((r) => r.redesignAddress).sort()).toEqual([
      'Beta Redesign',
      'Mystery Redesign',
    ]);
  });

  it('juris filter narrows to the matching projects', () => {
    const mixed: Project[] = [
      mkProject({
        id: 'op',
        address: 'Original',
        juris: 'Seattle',
        go_date: '2026-01-01',
      }),
      mkProject({
        id: 'rs',
        address: 'Seattle Redesign',
        juris: 'Seattle',
        go_date: '2026-02-01',
        redesign_of_project_id: 'op',
        redesign_trigger: 'builder',
      }),
      mkProject({
        id: 'rb',
        address: 'Bellevue Redesign',
        juris: 'Bellevue',
        go_date: '2026-02-01',
        redesign_of_project_id: 'op',
        redesign_trigger: 'builder',
      }),
    ];
    const out = computeRedesignAnalytics([], mixed, {
      dateFrom: null,
      dateTo: null,
      juris: 'Seattle',
    });
    expect(out.totalRedesigns).toBe(1);
    expect(out.recentRedesigns[0].redesignAddress).toBe('Seattle Redesign');
  });
});

describe('computeRedesignAnalytics — empty + edge cases', () => {
  it('empty cohort: totalRedesigns=0, all leaderboards empty, rate=null', () => {
    const out = computeRedesignAnalytics([], [], {
      dateFrom: null,
      dateTo: null,
      juris: '',
    });
    expect(out.totalRedesigns).toBe(0);
    expect(out.reusePermitRate).toBeNull();
    expect(out.triggerBreakdown).toEqual([]);
    expect(out.builderLeaderboard).toEqual([]);
    expect(out.daLeaderboard).toEqual([]);
    expect(out.dmLeaderboard).toEqual([]);
    expect(out.entLeaderboard).toEqual([]);
    expect(out.recentRedesigns).toEqual([]);
  });

  it('redesigns with no builder_name drop out of the builder leaderboard', () => {
    // urp1 in the demo fixture has builder_name=null.
    const out = computeRedesignAnalytics(demoPermits, demoProjects, {
      dateFrom: null,
      dateTo: null,
      juris: '',
    });
    expect(
      out.builderLeaderboard.find((b) => b.builderName === ''),
    ).toBeUndefined();
    // Total redesigns still 5 (the unknown-builder one counted there).
    expect(out.totalRedesigns).toBe(5);
  });

  it('every supported trigger value resolves to a non-empty label', () => {
    // Walk all 8 vocab values; build a redesign per trigger; assert the
    // breakdown labels are non-empty (pulled through
    // REDESIGN_TRIGGER_LABELS).
    const triggers: RedesignTrigger[] = [
      'builder',
      'ceo',
      'acquisitions',
      'design_mgmt',
      'design_associate',
      'city_correction',
      'market',
      'other',
    ];
    const projects: Project[] = [
      mkProject({ id: 'orig', address: 'O' }),
      ...triggers.map((t, i) =>
        mkProject({
          id: `r${i}`,
          address: `R${i}`,
          go_date: '2026-01-01',
          redesign_of_project_id: 'orig',
          redesign_trigger: t,
        }),
      ),
    ];
    const out = computeRedesignAnalytics([], projects, {
      dateFrom: null,
      dateTo: null,
      juris: '',
    });
    expect(out.triggerBreakdown).toHaveLength(8);
    for (const t of out.triggerBreakdown) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.label).not.toBe('Unspecified');
    }
  });

  it('builder leaderboard caps at 10 entries', () => {
    const projects: Project[] = [];
    for (let i = 0; i < 15; i++) {
      projects.push(mkProject({ id: `op${i}`, address: `O${i}`, builder_name: `B${i}` }));
      projects.push(
        mkProject({
          id: `rp${i}`,
          address: `R${i}`,
          builder_name: `B${i}`,
          go_date: '2026-01-01',
          redesign_of_project_id: `op${i}`,
          redesign_trigger: 'builder',
        }),
      );
    }
    const out = computeRedesignAnalytics([], projects, {
      dateFrom: null,
      dateTo: null,
      juris: '',
    });
    expect(out.builderLeaderboard.length).toBe(10);
  });
});
