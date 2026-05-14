import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_FILTERS,
  buildApprovedSeries,
  buildGoSeries,
  buildSubmittedSeries,
  buildTimelineSeries,
  formatMonthShort,
  getGroupKeys,
  getMonthRange,
  permMatchesGroup,
  trColor,
  trFilteredPermits,
} from '../lib/trendsHelpers';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// Q9.5.d: trends data layer. Fixed today = 2026-05-13 (Wed) — gives
// deterministic month-range math.

const FIXED_TODAY = new Date(2026, 4, 13, 9, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TODAY);
});
afterEach(() => {
  vi.useRealTimers();
});

function makeProject(p: Partial<Project>): Project {
  return {
    id: 'proj-1',
    address: '100 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...p,
  } as Project;
}

function makeCycle(c: Partial<PermitCycle>): PermitCycle {
  return {
    id: 'c-1',
    permit_id: 1,
    cycle_index: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...c,
  };
}

function makePermit(p: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: 1,
    project_id: 'proj-1',
    type: 'Building Permit',
    stage: null,
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
    updated_at: '2026-05-13T00:00:00Z',
    permit_cycles: [],
    ...p,
  } as PermitWithCycles;
}

describe('getMonthRange', () => {
  it('returns the last 12 months ending in current month by default', () => {
    const months = getMonthRange(DEFAULT_FILTERS, []);
    expect(months).toHaveLength(12);
    expect(months[months.length - 1]).toBe('2026-05');
    expect(months[0]).toBe('2025-06');
  });

  it('honors numeric range presets (6 / 24 / 36)', () => {
    expect(
      getMonthRange({ ...DEFAULT_FILTERS, range: '6' }, []),
    ).toHaveLength(6);
    expect(
      getMonthRange({ ...DEFAULT_FILTERS, range: '24' }, []),
    ).toHaveLength(24);
    expect(
      getMonthRange({ ...DEFAULT_FILTERS, range: '36' }, []),
    ).toHaveLength(36);
  });

  it("'custom' with a single date_from steps from that month to current month", () => {
    const months = getMonthRange(
      { ...DEFAULT_FILTERS, range: 'custom', dateFrom: '2026-01' },
      [],
    );
    expect(months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  });

  it("'custom' with date_from + date_to honors both", () => {
    const months = getMonthRange(
      {
        ...DEFAULT_FILTERS,
        range: 'custom',
        dateFrom: '2025-11',
        dateTo: '2026-02',
      },
      [],
    );
    expect(months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it("'all' walks back to the earliest project-anchor date", () => {
    // fix-22 Mig 3: go_date moved to projects; getMonthRange now takes
    // projectsById to resolve each permit's project go_date.
    const p = makePermit({ project_id: 'p1' });
    const projectsById = new Map<string, Project>([
      ['p1', makeProject({ id: 'p1', go_date: '2025-10-15' })],
    ]);
    const months = getMonthRange(
      { ...DEFAULT_FILTERS, range: 'all' },
      [p],
      projectsById,
    );
    expect(months[0]).toBe('2025-10');
    expect(months[months.length - 1]).toBe('2026-05');
  });

  it("'all' falls back to 24 months when no anchor date exists", () => {
    const months = getMonthRange({ ...DEFAULT_FILTERS, range: 'all' }, []);
    expect(months).toHaveLength(24);
  });
});

describe('trFilteredPermits', () => {
  const projectsById = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
    ['p2', makeProject({ id: 'p2', juris: 'Bellevue' })],
  ]);
  const permits = [
    makePermit({ id: 1, project_id: 'p1', type: 'Building Permit', ent_lead: 'Bobby' }),
    makePermit({ id: 2, project_id: 'p2', type: 'Demolition', ent_lead: 'Miles' }),
    makePermit({
      id: 3,
      project_id: 'p1',
      type: 'Building Permit',
      ent_lead: 'Briana',
      da: 'Trevor',
    }),
  ];

  it('returns all permits when no filters set', () => {
    expect(trFilteredPermits(permits, DEFAULT_FILTERS, projectsById)).toHaveLength(3);
  });
  it('narrows by type', () => {
    const r = trFilteredPermits(
      permits,
      { ...DEFAULT_FILTERS, type: 'Demolition' },
      projectsById,
    );
    expect(r.map((p) => p.id)).toEqual([2]);
  });
  it('narrows by juris (via project lookup)', () => {
    const r = trFilteredPermits(
      permits,
      { ...DEFAULT_FILTERS, juris: 'Seattle' },
      projectsById,
    );
    expect(r.map((p) => p.id)).toEqual([1, 3]);
  });
  it('narrows by ent_lead', () => {
    const r = trFilteredPermits(
      permits,
      { ...DEFAULT_FILTERS, ent: 'Briana' },
      projectsById,
    );
    expect(r.map((p) => p.id)).toEqual([3]);
  });
  it('narrows by da (matches da OR architect)', () => {
    const r = trFilteredPermits(
      permits,
      { ...DEFAULT_FILTERS, da: 'Trevor' },
      projectsById,
    );
    expect(r.map((p) => p.id)).toEqual([3]);
  });
  it('acq filter is a no-op until permits.acq_lead lands (task #63)', () => {
    const r = trFilteredPermits(
      permits,
      { ...DEFAULT_FILTERS, acq: 'Caleb' },
      projectsById,
    );
    expect(r).toHaveLength(3); // unchanged
  });
});

describe('getGroupKeys + permMatchesGroup', () => {
  const projectsById = new Map<string, Project>([
    ['p1', makeProject({ id: 'p1', juris: 'Seattle' })],
    ['p2', makeProject({ id: 'p2', juris: 'Bellevue' })],
  ]);
  const permits = [
    makePermit({ id: 1, project_id: 'p1', type: 'BP', ent_lead: 'Bobby' }),
    makePermit({ id: 2, project_id: 'p2', type: 'Demo', ent_lead: 'Miles' }),
    makePermit({ id: 3, project_id: 'p1', type: 'BP', ent_lead: 'Bobby' }),
  ];

  it("getGroupKeys by jurisdiction returns sorted unique values", () => {
    expect(
      getGroupKeys(permits, { ...DEFAULT_FILTERS, group: 'jurisdiction' }, projectsById),
    ).toEqual(['Bellevue', 'Seattle']);
  });
  it('getGroupKeys by type', () => {
    expect(
      getGroupKeys(permits, { ...DEFAULT_FILTERS, group: 'type' }, projectsById),
    ).toEqual(['BP', 'Demo']);
  });
  it("getGroupKeys by total returns single 'Total' bucket", () => {
    expect(
      getGroupKeys(permits, { ...DEFAULT_FILTERS, group: 'total' }, projectsById),
    ).toEqual(['Total']);
  });
  it('getGroupKeys by tag flattens project_tags arrays', () => {
    // fix-22 Mig 3: project_tags moved to projects; group key resolution
    // reads from the project via projectsById.
    const taggedProjects = new Map<string, Project>([
      ['p1', makeProject({ id: 'p1', juris: 'Seattle', project_tags: ['ECA', 'SIP'] })],
      ['p2', makeProject({ id: 'p2', juris: 'Bellevue', project_tags: ['LBA'] })],
    ]);
    const tagged = [
      makePermit({ id: 1, project_id: 'p1' }),
      makePermit({ id: 2, project_id: 'p2' }),
    ];
    expect(
      getGroupKeys(tagged, { ...DEFAULT_FILTERS, group: 'tag' }, taggedProjects),
    ).toEqual(['ECA', 'LBA', 'SIP']);
  });

  it('permMatchesGroup matches jurisdiction via project lookup', () => {
    expect(
      permMatchesGroup(
        permits[0],
        projectsById.get('p1'),
        'Seattle',
        'jurisdiction',
      ),
    ).toBe(true);
    expect(
      permMatchesGroup(
        permits[0],
        projectsById.get('p1'),
        'Bellevue',
        'jurisdiction',
      ),
    ).toBe(false);
  });
  it("permMatchesGroup with group='total' always returns true", () => {
    expect(permMatchesGroup(permits[0], undefined, 'Total', 'total')).toBe(
      true,
    );
  });
});

describe('buildSubmittedSeries', () => {
  const projectsById = new Map([['p1', makeProject({ id: 'p1', juris: 'Seattle' })]]);

  it('counts permits with a cycle.submitted in each month per group', () => {
    const permits = [
      makePermit({
        id: 1,
        project_id: 'p1',
        permit_cycles: [makeCycle({ submitted: '2026-03-15' })],
      }),
      makePermit({
        id: 2,
        project_id: 'p1',
        permit_cycles: [makeCycle({ submitted: '2026-03-22' })],
      }),
      makePermit({
        id: 3,
        project_id: 'p1',
        permit_cycles: [makeCycle({ submitted: '2026-04-01' })],
      }),
    ];
    const months = ['2026-03', '2026-04', '2026-05'];
    const groupKeys = ['Seattle'];
    const series = buildSubmittedSeries(
      permits,
      { ...DEFAULT_FILTERS, group: 'jurisdiction' },
      projectsById,
      months,
      groupKeys,
    );
    expect(series[0].values.Seattle).toBe(2); // 2 in March
    expect(series[1].values.Seattle).toBe(1); // 1 in April
    expect(series[2].values.Seattle).toBe(0); // 0 in May
  });
});

describe('buildApprovedSeries', () => {
  const projectsById = new Map([['p1', makeProject({ id: 'p1' })]]);

  it('counts permits whose approval_date falls in the month', () => {
    const permits = [
      makePermit({ id: 1, project_id: 'p1', approval_date: '2026-04-10' }),
      makePermit({ id: 2, project_id: 'p1', approval_date: '2026-04-25' }),
      makePermit({ id: 3, project_id: 'p1', actual_issue: '2026-05-02' }),
    ];
    const series = buildApprovedSeries(
      permits,
      { ...DEFAULT_FILTERS, group: 'total' },
      projectsById,
      ['2026-04', '2026-05'],
      ['Total'],
    );
    expect(series[0].values.Total).toBe(2);
    expect(series[1].values.Total).toBe(1);
  });

  it('approval_date takes precedence over actual_issue for the same permit', () => {
    const permits = [
      makePermit({
        id: 1,
        project_id: 'p1',
        approval_date: '2026-04-10',
        actual_issue: '2026-05-15', // ignored when approval_date set
      }),
    ];
    const series = buildApprovedSeries(
      permits,
      { ...DEFAULT_FILTERS, group: 'total' },
      projectsById,
      ['2026-04', '2026-05'],
      ['Total'],
    );
    expect(series[0].values.Total).toBe(1);
    expect(series[1].values.Total).toBe(0);
  });
});

describe('buildTimelineSeries', () => {
  const projectsById = new Map([['p1', makeProject({ id: 'p1' })]]);

  it('averages (approval - earliest cycle submitted) days per month', () => {
    const permits = [
      makePermit({
        id: 1,
        project_id: 'p1',
        approval_date: '2026-04-10',
        permit_cycles: [makeCycle({ submitted: '2026-01-10' })],
      }),
      // approval - submit = ~90 days
      makePermit({
        id: 2,
        project_id: 'p1',
        approval_date: '2026-04-20',
        permit_cycles: [makeCycle({ submitted: '2026-02-19' })],
      }),
      // approval - submit = 60 days; average = 75
    ];
    const series = buildTimelineSeries(
      permits,
      { ...DEFAULT_FILTERS, group: 'total' },
      projectsById,
      ['2026-04', '2026-05'],
      ['Total'],
    );
    expect(series[0].values.Total).toBe(75);
    expect(series[1].values.Total).toBeNull(); // no permits approved in May
  });

  it('returns null (not 0) when no permits have both endpoints in month', () => {
    const series = buildTimelineSeries(
      [makePermit({ id: 1, approval_date: '2026-04-10', permit_cycles: [] })],
      { ...DEFAULT_FILTERS, group: 'total' },
      new Map([['proj-1', makeProject({})]]),
      ['2026-04'],
      ['Total'],
    );
    expect(series[0].values.Total).toBeNull();
  });
});

describe('buildGoSeries', () => {
  // fix-22 Mig 3: go_date moved to projects. The dedupe-per-address logic
  // still works because the project carries the canonical go_date.
  const projectsById = new Map([
    ['p1', makeProject({ id: 'p1', address: '100 Pike St', go_date: '2026-03-01' })],
    ['p2', makeProject({ id: 'p2', address: '200 Oak Ave', go_date: '2026-04-10' })],
  ]);

  it('counts distinct addresses with go_date per month (dedupes per address)', () => {
    const permits = [
      makePermit({ id: 1, project_id: 'p1' }),
      makePermit({ id: 2, project_id: 'p1' }), // same addr, ignored
      makePermit({ id: 3, project_id: 'p2' }),
    ];
    const series = buildGoSeries(
      permits,
      { ...DEFAULT_FILTERS, group: 'total' },
      projectsById,
      ['2026-03', '2026-04', '2026-05'],
      ['Total'],
    );
    expect(series[0].values.Total).toBe(1); // 100 Pike only
    expect(series[1].values.Total).toBe(1); // 200 Oak only
    expect(series[2].values.Total).toBe(0);
  });
});

describe('trColor', () => {
  it('returns fixed hue for known jurisdiction names', () => {
    expect(trColor('Seattle', 0)).toBe('#2563eb');
    expect(trColor('Bellevue', 1)).toBe('#059669');
  });
  it('falls back to palette for unknown keys, rotating by index', () => {
    const a = trColor('UnknownA', 0);
    const b = trColor('UnknownB', 1);
    expect(a).toMatch(/^#[0-9a-f]{6}$/i);
    expect(b).toMatch(/^#[0-9a-f]{6}$/i);
    expect(a).not.toBe(b);
  });
});

describe('formatMonthShort', () => {
  it('formats YYYY-MM as MMM YY', () => {
    expect(formatMonthShort('2026-05')).toBe('May 26');
    expect(formatMonthShort('2025-11')).toBe('Nov 25');
  });
  it('passes through unparseable input', () => {
    expect(formatMonthShort('not-a-month')).toBe('not-a-month');
  });
});
