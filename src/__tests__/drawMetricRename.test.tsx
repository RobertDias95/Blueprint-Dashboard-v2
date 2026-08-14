import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TeamPerformanceTable from '../components/Reports/TeamPerformanceTable';
import {
  ALL_METRIC_DEFINITIONS,
  REDESIGNS_CYCLE_COMPARISON,
  REPORTS_OVERVIEW_METRICS,
  TEAM_DETAIL_PHASE_METRICS,
} from '../lib/metricDefinitions';
import { METRIC_DRILLINS } from '../lib/metricDrillIn';
import type { EnrichedPermit } from '../lib/reportMetrics';
import { CSV_HEADERS } from '../lib/csvExport';
import {
  computeTeamMetrics,
  type TeamMetricsFilters,
} from '../lib/teamPerformance';
import { computeTeamTrends } from '../lib/teamTrends';
import type {
  PermitWithCycles,
  Project,
  TeamMember,
} from '../lib/database.types';

// fix-296b: the metric that averages (dd_end − dd_start) was displayed as
// "DD Phase" on Team performance, the redesign comparison and the trend
// charts, and as "Avg DD Duration" on the Reports overview. fix-296 had
// already renamed those two columns to Draw Start / Draw End on the project
// overview, so one concept was carrying three names. fix-296b made it "Draw".
//
// ★ fix-310 makes it "DD", and that is NOT a reversal. fix-296b's rule was
// "name it after what it measures"; fix-309 #52 then renamed the thing it
// measures — dd_start / dd_end on the project overview — to DD start / DD end,
// matching the schema, which has always said dd_start / dd_end. So the anchor
// moved and the metric follows it. Same rule, applied again.
//
// This file is the guard for two separate promises:
//   1. no user-facing surface still says "DD Phase" / "Design Development",
//      and now none says "Draw" for this concept either;
//   2. the numbers did not move. Every value assertion below is a figure
//      that held before BOTH renames, so a label change cannot quietly become
//      a maths change.

// ============================================================
// Fixtures
// ============================================================

function mkProject(
  over: Omit<Partial<Project>, 'id' | 'address'> &
    Pick<Project, 'id' | 'address'>,
): Project {
  const { id, address, ...rest } = over;
  return {
    id,
    address,
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...rest,
  } as Project;
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
  } as PermitWithCycles;
}

function mkMember(
  over: Omit<Partial<TeamMember>, 'name' | 'role'> &
    Pick<TeamMember, 'name' | 'role'>,
): TeamMember {
  const { name, role, ...rest } = over;
  return {
    id: `m-${name}-${role}`,
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
  } as TeamMember;
}

// Trevor draws for 10 days on one project and 30 on the other → 20d average.
// The two windows are the ONLY numbers this file cares about; they are what
// "the value did not change" means.
const projects = [
  mkProject({ id: 'p1', address: '1 Draw Ln', units: 1 }),
  mkProject({ id: 'p2', address: '2 Draw Ln', units: 1 }),
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
    dd_end: '2026-03-03', // 30d
  }),
];
const team: TeamMember[] = [mkMember({ name: 'Trevor', role: 'da' })];

const filters: TeamMetricsFilters = {
  role: 'da',
  activeOnly: true,
  dateFrom: null,
  dateTo: null,
  juris: '',
  includeRedesigns: true,
};

// ============================================================
// The metric reads "DD" wherever it is displayed
// ============================================================

describe('fix-310: the dd_start → dd_end metric is called "DD"', () => {
  it('the team-detail phase card is labelled DD', () => {
    expect(TEAM_DETAIL_PHASE_METRICS.avgDdDays!.label).toBe('DD');
  });

  it('the redesign cycle-time comparison card is labelled DD', () => {
    expect(REDESIGNS_CYCLE_COMPARISON.ddPhase!.label).toBe('DD');
  });

  it('the Reports overview tile is labelled Avg DD Duration', () => {
    // The third name for the same formula, which the fix-296 sweep missed.
    expect(REPORTS_OVERVIEW_METRICS.avgDDDuration!.label).toBe(
      'Avg DD Duration',
    );
  });

  it('the Team performance column header reads DD, not Draw or DD Phase', () => {
    const result = computeTeamMetrics(permits, projects, team, filters);
    render(
      <MemoryRouter>
        <TeamPerformanceTable result={result} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('columnheader', { name: /^DD/ })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /^Draw/ })).toBeNull();
    expect(screen.queryByText('DD Phase')).toBeNull();
  });

  it('the drill-in rows name DD Start and DD End', () => {
    const enriched = { permit: permits[0]! } as unknown as EnrichedPermit;
    expect(
      METRIC_DRILLINS.avgDDDuration!.dates(enriched).map((d) => d.label),
    ).toEqual(['DD Start', 'DD End']);
    expect(
      METRIC_DRILLINS.avgGoToDDStart!.dates(enriched).map((d) => d.label),
    ).toContain('DD Start');
  });

  it('the permit CSV export headers say DD', () => {
    expect(CSV_HEADERS).toContain('DD Duration (d)');
    expect(CSV_HEADERS).toContain('DD End → Submit (d)');
    expect(CSV_HEADERS).not.toContain('Draw Duration (d)');
    expect(CSV_HEADERS).not.toContain('Draw End → Submit (d)');
  });

  // ★ The sweep assertion. Not "the four I remembered" — EVERY definition.
  it('no metric definition says DD Phase, Design Development, or Draw', () => {
    for (const [key, def] of Object.entries(ALL_METRIC_DEFINITIONS)) {
      const text = [def.label, def.description, def.cohort ?? '']
        .join(' ');
      expect(text, `${key} still says "DD Phase"`).not.toMatch(/DD Phase/i);
      expect(
        text,
        `${key} still says "Design Development"`,
      ).not.toMatch(/Design Development/i);
      // "started drawing" survives — it is the ACTIVITY, not a name for the
      // concept. "Draw Start" / "Draw Duration" / a bare "Draw" label do not.
      expect(text, `${key} still says "Draw"`).not.toMatch(
        /\bDraw\b(?! Schedule)/,
      );
    }
  });
});

// ============================================================
// The measurement did not move
// ============================================================

describe('fix-296b: renaming the metric did not change what it measures', () => {
  it('the formula and cohort lines are byte-identical to before the rename', () => {
    // Copied verbatim from the pre-rename source. The brief's hard line:
    // the words around the number may change, the number's definition may not.
    expect(TEAM_DETAIL_PHASE_METRICS.avgDdDays!.formula).toBe(
      "avg(dd_end − dd_start) across the associate's permits",
    );
    expect(TEAM_DETAIL_PHASE_METRICS.avgDdDays!.cohort).toBe(
      'Only counts permits with both dd_start AND dd_end set.',
    );
    expect(REDESIGNS_CYCLE_COMPARISON.ddPhase!.formula).toBe(
      'avg(dd_end − dd_start) per cohort',
    );
    expect(REDESIGNS_CYCLE_COMPARISON.ddPhase!.cohort).toBe(
      'Only counts permits with both dd_start AND dd_end set.',
    );
    expect(REPORTS_OVERVIEW_METRICS.avgDDDuration!.formula).toBe(
      'avg(dd_end − dd_start) in days',
    );
    expect(REPORTS_OVERVIEW_METRICS.avgDDDuration!.cohort).toBe(
      'Only counts permits with both dd_start AND dd_end set.',
    );
  });

  it('the Team snapshot still averages 10d and 30d to 20d', () => {
    const result = computeTeamMetrics(permits, projects, team, filters);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.avgDdDays).toBe(20);
    expect(result.teamAvgDdDays).toBe(20);
  });

  it('the rendered Draw cell shows that same 20d', () => {
    const result = computeTeamMetrics(permits, projects, team, filters);
    render(
      <MemoryRouter>
        <TeamPerformanceTable result={result} />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId('team-cell-Trevor-avgDdDays').textContent,
    ).toContain('20');
  });

  it('the monthly trend series still buckets on dd_end with the same values', () => {
    const out = computeTeamTrends(permits, projects, team, {
      role: 'da',
      associateName: 'Trevor',
      monthFrom: '2026-01',
      monthTo: '2026-03',
    });
    // Anchored on dd_end: the 10d window closes in January, the 30d in March.
    expect(out.ddPhase.map((e) => e.associateAvg)).toEqual([10, null, 30]);
  });
});
