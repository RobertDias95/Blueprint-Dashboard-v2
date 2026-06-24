import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q7.2.b: smoke tests for the Reports page. Mocks usePermits + useProjects
// so the page renders synchronously against a fixed dataset. Recharts is
// stubbed so we don't have to drive ResponsiveContainer width measurement
// in jsdom — assertions focus on the metric/filter/chart-container DOM,
// not the rendered SVG.

const T = 'test-tenant-uuid';
const FIXED_TODAY = new Date(2026, 4, 15); // 2026-05-15

// Recharts uses ResponsiveContainer which measures parent width via
// ResizeObserver / getBoundingClientRect — both flaky in jsdom. Stub it
// with a fixed-size wrapper so children always render at 400x200.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

// fix-22 Mig 3: go_date / units / product_types / project_tags moved
// permits → projects. Reports surface reads them from the joined project.
const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'p1',
      address: '500 Pike St',
      juris: 'Seattle',
      archived: false,
      notes: null,
      go_date: '2026-01-01',
      units: 4,
      product_types: ['SFR'],
      project_tags: ['ECA'],
    },
    {
      id: 'p2',
      address: '750 Oak Way',
      juris: 'Bellevue',
      archived: false,
      notes: null,
      go_date: '2026-04-01',
      units: 3,
      product_types: ['Attached Units'],
      project_tags: [],
    },
  ],
  permits: [
    // Building Permit at Seattle, on-time submit, intake gap of 2d (green),
    // approved 5 days ahead of expected_issue.
    {
      id: 1,
      project_id: 'p1',
      type: 'Building Permit',
      stage: 'pm',
      stage_override: null,
      // fix-113-a: permit-level status (decoupled from team's actual_issue
      // stamp). 'Issued' here = the city portal reports the permit as
      // issued; the team's actual_issue is still null (different signal).
      status: 'Issued',
      num: 'BP-1',
      da: 'Trevor',
      dm: 'Lindsay',
      ent_lead: 'Bobby',
      dual_da: null,
      target_submit: '2026-02-01',
      // fix-204: cohort windows on the project DD start now. Mirror each
      // permit's dd_start to its project go_date so the existing date-range
      // membership tests (3mo, custom comparison) hold under the new anchor.
      dd_start: '2026-01-01',
      dd_end: null,
      expected_issue: '2026-05-01',
      actual_issue: null,
      approval_date: '2026-04-26',
      intake_date: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      corr_rounds: 2,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-04-26T00:00:00Z',
      permit_cycles: [
        {
          id: 'c1',
          permit_id: 1,
          cycle_index: 1,
          submitted: '2026-01-25', // earlier than target — on-time
          city_target: null,
          corr_issued: '2026-03-01',
          resubmitted: '2026-03-15',
          intake_accepted: '2026-01-27',
          created_at: '2026-01-25T00:00:00Z',
          updated_at: '2026-03-15T00:00:00Z',
        },
      ],
    },
    // Demolition at Bellevue, no cycles yet.
    {
      id: 2,
      project_id: 'p2',
      type: 'Demolition',
      stage: 'de',
      stage_override: null,
      // fix-113-a: distinct permit-level status so the permit-status filter
      // has multiple options to choose from in the dropdown.
      status: 'Reviews In Process',
      num: 'DM-1',
      da: 'Ahmadi',
      dm: 'Brittani',
      ent_lead: 'Miles',
      dual_da: null,
      target_submit: null,
      dd_start: '2026-04-01', // fix-204: mirrors p2 go_date for cohort windowing
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
      updated_at: '2026-04-01T00:00:00Z',
      permit_cycles: [],
    },
  ],
}));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TODAY);
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

import Reports from '../pages/Reports';
import MetricCards from '../components/Reports/MetricCards';
import type { ReportMetrics } from '../lib/reportMetrics';

// fix-141: a full ReportMetrics literal with neutral defaults so a test can
// override just the fields under exercise (City Review / Permit Timeline /
// Response Time) and render MetricCards in isolation with a controlled gap.
function makeMetrics(over: Partial<ReportMetrics> = {}): ReportMetrics {
  return {
    totalPermits: 0,
    totalUnits: 0,
    avgSubmitVariance: null,
    onTimeSubmits: 0,
    lateSubmits: 0,
    avgGoToSubmit: null,
    avgGoToDDStart: null,
    avgCityReview: null,
    avgPermitTimeline: null,
    avgResponseTime: null,
    avgSubmitToIntake: null,
    avgApprovalToIssue: null,
    avgCorrectionCycles: null,
    permitsWithCorrections: 0,
    inCorrections: 0,
    issuedCount: 0,
    avgScheduleVariance: null,
    avgDDDuration: null,
    avgDDEndToSubmit: null,
    sampleSizes: {},
    ...over,
  };
}

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Reports />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('<Reports /> Q7.2.b', () => {
  it('renders FilterBar + MetricCards + 4 charts', () => {
    renderIt();
    expect(screen.getByTestId('reports-page')).toBeInTheDocument();
    expect(screen.getByTestId('report-filterbar')).toBeInTheDocument();
    expect(screen.getByTestId('report-metric-cards')).toBeInTheDocument();
    expect(screen.getByTestId('chart-permits-by-type')).toBeInTheDocument();
    expect(screen.getByTestId('chart-permits-by-juris')).toBeInTheDocument();
    expect(screen.getByTestId('chart-go-to-submit-by-type')).toBeInTheDocument();
    expect(screen.getByTestId('chart-schedule-variance-by-type')).toBeInTheDocument();
  });

  it('TOTAL PERMITS card shows count + total units sub-text', () => {
    renderIt();
    const card = screen.getByTestId('metric-total-permits');
    expect(card.textContent).toContain('2'); // 2 permits
    expect(card.textContent).toContain('7 units'); // 4 + 3 across distinct addresses
  });

  it('fix-113-b: IN CORRECTIONS subtext = "{n} of {total} issued" — names the denominator', () => {
    renderIt();
    const card = screen.getByTestId('metric-in-corrections');
    expect(card.textContent).toContain('0'); // no permits at stage=co
    // Fixtures: 2 permits, neither has actual_issue → "0 of 2 issued".
    expect(card.textContent).toContain('0 of 2 issued');
  });

  it('fix-141: AVG PERMIT TIMELINE renders "—" when no permit has c0.intake_accepted (strict canonical)', () => {
    // fix-141 moved the strict intake → approval clock onto the Permit
    // Timeline tile (permitTimelineDays = approval_date − c0.intake_accepted).
    // The default fixture stamps intake on cycle_index=1 with no cycle 0, so
    // permitTimelineDays is null → the Permit Timeline tile shows "—".
    // (Avg City Review, redefined as sum-over-cycles city-court time, now
    // DOES produce a number from this fixture's cycle-1 corr_issued — that
    // divergence is asserted separately below.)
    renderIt();
    const card = screen.getByTestId('metric-permit-timeline');
    expect(card.textContent).toMatch(/—/);
  });

  it('Submit Variance card surfaces on-time count (1) and late count (0)', () => {
    renderIt();
    // permit 1: target_submit=2026-02-01, firstSubmitted=2026-01-25 → -7d (on-time)
    // permit 2: no target_submit → not counted
    const card = screen.getByTestId('metric-submit-variance');
    expect(card.textContent).toContain('-7');
    expect(card.textContent).toMatch(/1 on-time/);
    expect(card.textContent).toMatch(/0 late/);
  });

  it('AVG SCHEDULE VAR. card shows -5d (approval 5 days before expected_issue)', () => {
    renderIt();
    const card = screen.getByTestId('metric-schedule-variance');
    // 2026-04-26 - 2026-05-01 = -5d
    expect(card.textContent).toContain('-5');
    expect(card.textContent).toContain('ahead of forecast');
  });

  it('Filter narrowing: selecting juris=Bellevue removes Seattle permits + updates result count', () => {
    renderIt();
    expect(screen.getByTestId('filter-result-count').textContent).toBe('2 permits');
    // Q9.5.f Item 6: filter is a dropdown now — open it first, then pick.
    fireEvent.click(screen.getByTestId('filter-juris-btn'));
    fireEvent.click(screen.getByTestId('filter-juris-opt-Bellevue'));
    expect(screen.getByTestId('filter-result-count').textContent).toBe('1 permit');
    // Only Demolition remains → total permits card reads 1.
    expect(screen.getByTestId('metric-total-permits').textContent).toContain('1');
  });

  it("Status='issued' filter excludes both permits (neither has actual_issue) → empty state", () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-status'), {
      target: { value: 'issued' },
    });
    expect(screen.getByTestId('filter-result-count').textContent).toBe('0 permits');
    expect(screen.getByTestId('metric-total-permits').textContent).toContain('0');
  });

  it('Search filter narrows by joined permit + project fields', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-search'), {
      target: { value: 'pike' },
    });
    expect(screen.getByTestId('filter-result-count').textContent).toBe('1 permit');
  });

  it('Clear button resets all filter dimensions', () => {
    renderIt();
    // Q9.5.f Item 6: filter is a dropdown now — open it first, then pick.
    fireEvent.click(screen.getByTestId('filter-juris-btn'));
    fireEvent.click(screen.getByTestId('filter-juris-opt-Bellevue'));
    expect(screen.getByTestId('filter-result-count').textContent).toBe('1 permit');
    fireEvent.click(screen.getByTestId('filter-clear'));
    expect(screen.getByTestId('filter-result-count').textContent).toBe('2 permits');
  });

  it('Time range = 3mo shows only permits with project DD start in last 90 days', () => {
    renderIt();
    // today=2026-05-15, cutoff=2026-02-14.
    // permit 1 dd_start=2026-01-01 (out), permit 2 dd_start=2026-04-01 (in).
    fireEvent.change(screen.getByTestId('filter-range'), {
      target: { value: '3mo' },
    });
    expect(screen.getByTestId('filter-result-count').textContent).toBe('1 permit');
  });

  it("Time range = 'custom' surfaces the date inputs", () => {
    renderIt();
    expect(screen.queryByTestId('filter-date-from')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('filter-range'), {
      target: { value: 'custom' },
    });
    expect(screen.getByTestId('filter-date-from')).toBeInTheDocument();
    expect(screen.getByTestId('filter-date-to')).toBeInTheDocument();
  });

  // Q7.2.c additions —————————————————————————————————————————

  it('renders the 2 new charts (City Review by Juris, Correction Response by Type)', () => {
    renderIt();
    expect(screen.getByTestId('chart-city-review-by-juris')).toBeInTheDocument();
    expect(screen.getByTestId('chart-corr-response-by-type')).toBeInTheDocument();
  });

  it('Schedule Benchmarks card surfaces for each (type · juris) combo in the set', () => {
    renderIt();
    expect(screen.getByTestId('schedule-benchmarks')).toBeInTheDocument();
    // Both fixture permits live at distinct type·juris combos.
    expect(
      screen.getByTestId('benchmark-card-Building Permit-Seattle'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('benchmark-card-Demolition-Bellevue'),
    ).toBeInTheDocument();
  });

  it('fix-112-a: Schedule Benchmarks honors the page Juris filter (was: silently bypassed)', () => {
    renderIt();
    // Baseline: both type·juris combos render.
    expect(
      screen.getByTestId('benchmark-card-Building Permit-Seattle'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('benchmark-card-Demolition-Bellevue'),
    ).toBeInTheDocument();
    // Narrow to Bellevue only — Seattle BP cohort drops out of the filtered
    // permit set, so its benchmark card should disappear. Pre-fix, ScheduleBenchmarks
    // received raw `permits` and kept the Seattle card visible.
    fireEvent.click(screen.getByTestId('filter-juris-btn'));
    fireEvent.click(screen.getByTestId('filter-juris-opt-Bellevue'));
    expect(
      screen.queryByTestId('benchmark-card-Building Permit-Seattle'),
    ).toBeNull();
    expect(
      screen.getByTestId('benchmark-card-Demolition-Bellevue'),
    ).toBeInTheDocument();
  });

  it('fix-112-c: Schedule Benchmarks badge no longer renders the invented "↑ LAST 120D" string', () => {
    // Pre-fix-112-c the badge always showed "↑ LAST 120D" for any non-
    // all-time estimate, but the learner's actual cascade is 90/180/365
    // (scheduleBenchmarks.ts WINDOW_TIERS_DAYS). The text "120D" matched
    // no real tier. Replaced with badgeLabelFor(recencyTier).
    renderIt();
    const sb = screen.getByTestId('schedule-benchmarks');
    expect(sb.textContent).not.toMatch(/120D/);
  });

  it('fix-112-c: Schedule Benchmarks renders the DEFAULT badge when the learner has no samples', () => {
    // The fixture permits both fall under "Insufficient data" (BP·Seattle
    // has its only cycle at cycle_index=1, so extractSample's c0 anchor
    // is null; Demolition·Bellevue has no approval). Both cards therefore
    // show recencyTier='default' → "DEFAULT" badge label.
    renderIt();
    const bldgCard = screen.getByTestId('benchmark-card-Building Permit-Seattle');
    const demoCard = screen.getByTestId('benchmark-card-Demolition-Bellevue');
    expect(bldgCard.textContent).toMatch(/DEFAULT/);
    expect(demoCard.textContent).toMatch(/DEFAULT/);
  });

  it('fix-112-a: Schedule Benchmarks honors the page Type filter (was: silently bypassed)', () => {
    renderIt();
    // Narrow to type=Demolition — Building Permit cohort drops, leaving only
    // the Demolition·Bellevue benchmark card.
    fireEvent.click(screen.getByTestId('filter-type-btn'));
    fireEvent.click(screen.getByTestId('filter-type-opt-Demolition'));
    expect(
      screen.queryByTestId('benchmark-card-Building Permit-Seattle'),
    ).toBeNull();
    expect(
      screen.getByTestId('benchmark-card-Demolition-Bellevue'),
    ).toBeInTheDocument();
  });

  it('Schedule Benchmarks shows "Insufficient data" when the learner returns null', () => {
    renderIt();
    // Permit 2 (Demolition · Bellevue) has no approval → insufficient.
    const demoCard = screen.getByTestId('benchmark-card-Demolition-Bellevue');
    expect(demoCard.textContent).toMatch(/Insufficient data/i);
    // fix-24i: Permit 1 (Building Permit · Seattle) has approval_date but
    // (a) its intake_accepted is on cycle_index=1, not cycle_index=0 (so it
    // drops out of extractSample's intake gate) and (b) even if it counted,
    // 1 sample is below MIN_SAMPLES_FOR_LEARNER=3. The card surfaces the
    // insufficient-data state regardless of cross-juris fallback because
    // there are no other Building Permit approvals in the fixture.
    const bldgCard = screen.getByTestId('benchmark-card-Building Permit-Seattle');
    expect(bldgCard.textContent).toMatch(/Insufficient data/i);
  });

  it('Report Table renders one row per project + permit headline count', () => {
    renderIt();
    const table = screen.getByTestId('report-table');
    // Q9.5.f-fix-4: rows aggregate by project. Two permits in two
    // different projects (p1 + p2) → two rows. Header reports both
    // project + permit counts.
    expect(table.textContent).toContain('Permit Ledger (2 projects · 2 permits)');
    expect(screen.getByTestId('report-table-row-p1')).toBeInTheDocument();
    expect(screen.getByTestId('report-table-row-p2')).toBeInTheDocument();
  });

  it('Report Table empty state when filter narrows to zero', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-search'), {
      target: { value: 'no-such-address-zzz' },
    });
    expect(screen.getByTestId('report-table').textContent).toMatch(
      /No permits match/i,
    );
  });

  it('Report Table header click toggles sort direction', () => {
    renderIt();
    const headerGo = screen.getByTestId('report-table-header-go');
    // Default state is { key: 'go', dir: 'desc' } so first click flips to asc.
    expect(headerGo.textContent).toContain('▼');
    fireEvent.click(headerGo);
    expect(headerGo.textContent).toContain('▲');
    fireEvent.click(headerGo);
    expect(headerGo.textContent).toContain('▼');
  });

  it('Report Table sort-by-juris reorders rows alphabetically', () => {
    renderIt();
    // Click juris header → asc by default for non-active columns.
    fireEvent.click(screen.getByTestId('report-table-header-juris'));
    const rows = screen
      .getAllByTestId(/^report-table-row-/)
      .map((tr) => tr.getAttribute('data-testid'));
    // Bellevue < Seattle alphabetically → project p2 (Bellevue) first.
    expect(rows[0]).toBe('report-table-row-p2');
    expect(rows[1]).toBe('report-table-row-p1');
  });

  it('Report Table filter narrowing flows through to row set', () => {
    renderIt();
    // Q9.5.f Item 6: filter is a dropdown now — open it first, then pick.
    fireEvent.click(screen.getByTestId('filter-juris-btn'));
    fireEvent.click(screen.getByTestId('filter-juris-opt-Bellevue'));
    expect(screen.getByTestId('report-table').textContent).toContain(
      'Permit Ledger (1 project · 1 permit)',
    );
    expect(screen.queryByTestId('report-table-row-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-table-row-p2')).toBeInTheDocument();
  });

  // Q9.5.f-fix-5: ledger-local controls (stage select, assignee select,
  // smart search) narrow on top of the page-level filters.
  it('ledger search narrows to matching project rows', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ledger-search'), {
      target: { value: 'oak' },
    });
    // Fixture: p1 = 500 Pike (Seattle), p2 = 750 Oak Way (Bellevue).
    // Search "oak" hits p2 only.
    expect(screen.queryByTestId('report-table-row-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-table-row-p2')).toBeInTheDocument();
    expect(screen.getByTestId('report-table').textContent).toContain(
      'Permit Ledger (1 project',
    );
  });

  it('ledger stage select narrows to projects with that dominant stage', () => {
    renderIt();
    // Fixture: p1 permit stage='pm', p2 permit stage='de'. Selecting 'pm'
    // keeps only p1; selecting 'de' keeps only p2.
    fireEvent.change(screen.getByTestId('ledger-filter-stage'), {
      target: { value: 'pm' },
    });
    expect(screen.getByTestId('report-table-row-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('report-table-row-p2')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('ledger-filter-stage'), {
      target: { value: 'de' },
    });
    expect(screen.queryByTestId('report-table-row-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-table-row-p2')).toBeInTheDocument();
  });

  it('ledger Clear button resets all 3 local filters', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ledger-search'), {
      target: { value: 'oak' },
    });
    expect(screen.queryByTestId('report-table-row-p1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ledger-filter-clear'));
    // After clear, both rows return.
    expect(screen.getByTestId('report-table-row-p1')).toBeInTheDocument();
    expect(screen.getByTestId('report-table-row-p2')).toBeInTheDocument();
  });

  // ─── fix-113-c: deferred fix-111 label cleanups ──────────────────────
  it('fix-113-c: ReportTable column header reads "Expected Issue (latest)" — the actual semantic', () => {
    // Pre-fix the column was labelled "ACQ Target" but rendered
    // max(expected_issue) across the project's permits (per fix-12
    // comment "acq target proxy until task #63"). Renamed to what's
    // actually in the cell.
    renderIt();
    const table = screen.getByTestId('report-table');
    expect(table.textContent).toContain('Expected Issue (latest)');
    expect(table.textContent).not.toContain('ACQ Target');
  });

  it('fix-113-c: ScheduleBenchmarks renders no CROSS-JURIS badge surface', () => {
    // The (type, *) cascade was removed in fix-37; the badge JSX is now
    // gone too. Regression assertion lives in ScheduleBenchmarksCrossJuris
    // test file; smoke-asserted here so the change is visible in the
    // page-level Reports test alongside the rest of the fix-113-c sweep.
    renderIt();
    const sb = screen.getByTestId('schedule-benchmarks');
    expect(sb.textContent).not.toMatch(/CROSS-JURIS/);
  });

  // fix-68: the Saved Reports library relocated to Settings -> Reporting.
  // The Reports tab is analytics-only now — the Weekly DA card + the Saved
  // Reports section are gone; CSV export + charts remain.
  it('no longer renders the Saved Reports section or the Weekly DA card; CSV export + charts remain', () => {
    renderIt();
    expect(screen.queryByTestId('saved-reports')).toBeNull();
    expect(screen.queryByTestId('report-card-weekly-da')).toBeNull();
    // Analytics surface is intact.
    expect(screen.getByTestId('reports-export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('report-filterbar')).toBeInTheDocument();
    expect(screen.getByTestId('chart-permits-by-type')).toBeInTheDocument();
  });

  // ─── fix-113-a: Project Status / Permit Status split ─────────────────
  it('fix-113-a: filter bar renders both Project Status and Permit Status controls', () => {
    renderIt();
    // Project-level rollup (renamed; same backing logic + options).
    const projectStatus = screen.getByTestId('filter-status');
    expect(projectStatus).toBeInTheDocument();
    // Per-permit cohort filter (new).
    const permitStatus = screen.getByTestId('filter-permit-status');
    expect(permitStatus).toBeInTheDocument();
    // The filterbar HTML still carries the old label text "Project Status"
    // alongside "Permit Status".
    const bar = screen.getByTestId('report-filterbar');
    expect(bar.textContent).toMatch(/Project Status/);
    expect(bar.textContent).toMatch(/Permit Status/);
  });

  it('fix-113-a: Permit Status dropdown auto-populates distinct permit.status values from the cohort', () => {
    renderIt();
    const select = screen.getByTestId('filter-permit-status') as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.value);
    // 'all' sentinel + each distinct cohort status, sorted.
    expect(optionTexts).toEqual(['all', 'Issued', 'Reviews In Process']);
  });

  it('fix-113-a: Permit Status="Issued" narrows to permit-level matches (project rollup ignored)', () => {
    renderIt();
    // Baseline: 2 permits visible.
    expect(screen.getByTestId('filter-result-count').textContent).toBe('2 permits');
    fireEvent.change(screen.getByTestId('filter-permit-status'), {
      target: { value: 'Issued' },
    });
    // Only the BP (status='Issued') survives — note its project is still
    // "Active" by the project-status rollup (no permit has actual_issue),
    // proving the permit filter doesn't piggy-back the project filter.
    expect(screen.getByTestId('filter-result-count').textContent).toBe('1 permit');
    expect(screen.getByTestId('report-table-row-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('report-table-row-p2')).not.toBeInTheDocument();
  });

  it('fix-113-a: Project Status="Active" + Permit Status="Issued" = the issued permit inside an active project', () => {
    // The brief's demonstration scenario. Project p1 is Active (no permit
    // has actual_issue set) AND contains 1 Issued permit. Pre-fix the
    // single conflated Status filter could not express this — choosing
    // "Active" hid the Issued permit; choosing "Fully Issued" hid the
    // whole project. Now both can be active simultaneously.
    renderIt();
    fireEvent.change(screen.getByTestId('filter-status'), {
      target: { value: 'active' },
    });
    fireEvent.change(screen.getByTestId('filter-permit-status'), {
      target: { value: 'Issued' },
    });
    expect(screen.getByTestId('filter-result-count').textContent).toBe('1 permit');
    expect(screen.getByTestId('report-table-row-p1')).toBeInTheDocument();
  });

  it('fix-113-a: Permit Status filter does not affect projects whose permits all carry different statuses', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-permit-status'), {
      target: { value: 'Reviews In Process' },
    });
    expect(screen.getByTestId('filter-result-count').textContent).toBe('1 permit');
    expect(screen.queryByTestId('report-table-row-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-table-row-p2')).toBeInTheDocument();
  });

  it('fix-113-b: subtext denominator follows the filtered cohort, not the unfiltered set', () => {
    // Verify the universal copy reacts to the active filter — picking a
    // single juris drops the denominator from 2 to 1. The numerator
    // (issuedCount) is 0 throughout because neither fixture permit has
    // actual_issue; the test exercises the denominator-tracks-filter
    // contract that the fix-111 audit flagged as missing.
    renderIt();
    expect(screen.getByTestId('metric-in-corrections').textContent).toContain(
      '0 of 2 issued',
    );
    fireEvent.click(screen.getByTestId('filter-juris-btn'));
    fireEvent.click(screen.getByTestId('filter-juris-opt-Bellevue'));
    expect(screen.getByTestId('metric-in-corrections').textContent).toContain(
      '0 of 1 issued',
    );
    // And the new Permit Status filter narrows it too.
    fireEvent.click(screen.getByTestId('filter-clear'));
    fireEvent.change(screen.getByTestId('filter-permit-status'), {
      target: { value: 'Issued' },
    });
    expect(screen.getByTestId('metric-in-corrections').textContent).toContain(
      '0 of 1 issued',
    );
  });

  it('fix-113-a: Clear resets both Status filters', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-status'), {
      target: { value: 'active' },
    });
    fireEvent.change(screen.getByTestId('filter-permit-status'), {
      target: { value: 'Issued' },
    });
    expect(screen.getByTestId('filter-result-count').textContent).toBe('1 permit');
    fireEvent.click(screen.getByTestId('filter-clear'));
    expect(screen.getByTestId('filter-result-count').textContent).toBe('2 permits');
    // Reset to defaults.
    expect((screen.getByTestId('filter-status') as HTMLSelectElement).value).toBe('all');
    expect(
      (screen.getByTestId('filter-permit-status') as HTMLSelectElement).value,
    ).toBe('all');
  });

  // ── fix-115-c → fix-137: Reports/Overview comparison ────────────────
  // fix-137 replaced the filter-bar "Compare to" dropdown +
  // ComparePresetChips row with a single AddComparisonButton +
  // ComparePanel. Comparison data flow is unchanged.
  it('fix-137: AddComparisonButton defaults to closed, no comparison rows render', () => {
    renderIt();
    const btn = screen.getByTestId('reports-compare-add-button');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Add comparison/);
    // No comparison chip; no card -cmp children.
    expect(screen.queryByTestId('reports-compare-chip')).toBeNull();
    expect(screen.queryByTestId('metric-total-permits-cmp')).toBeNull();
    expect(screen.queryByTestId('metric-submit-variance-cmp')).toBeNull();
    expect(screen.queryByTestId('metric-city-review-cmp')).toBeNull();
    expect(screen.queryByTestId('metric-avg-correction-cycles-cmp')).toBeNull();
    expect(screen.queryByTestId('metric-in-corrections-cmp')).toBeNull();
  });

  // Helper: open the new ComparePanel + apply Period A + Period B.
  function applyCompareViaPanel(periodA: { from: string; to: string }, periodB: { from: string; to: string }) {
    fireEvent.click(screen.getByTestId('reports-compare-add-button'));
    fireEvent.change(
      screen.getByTestId('reports-compare-panel-period-a-from'),
      { target: { value: periodA.from } },
    );
    fireEvent.change(
      screen.getByTestId('reports-compare-panel-period-a-to'),
      { target: { value: periodA.to } },
    );
    fireEvent.change(
      screen.getByTestId('reports-compare-panel-period-b-from'),
      { target: { value: periodB.from } },
    );
    fireEvent.change(
      screen.getByTestId('reports-compare-panel-period-b-to'),
      { target: { value: periodB.to } },
    );
    fireEvent.click(screen.getByTestId('reports-compare-panel-apply'));
  }

  it('fix-137: Apr 2026 vs Mar 2026 via ComparePanel → dual values + delta', () => {
    renderIt();
    // Apr 2026 cohort has 1 permit (p2); Mar 2026 has 0 (p1 is Jan).
    applyCompareViaPanel(
      { from: '2026-04-01', to: '2026-04-30' },
      { from: '2026-03-01', to: '2026-03-31' },
    );
    const tile = screen.getByTestId('metric-total-permits');
    expect(tile.textContent).toMatch(/1/); // current cohort has 1 permit
    const split = screen.getByTestId('metric-total-permits-split');
    expect(split).toBeInTheDocument();
    expect(
      screen.getByTestId('metric-total-permits-split-comparison').textContent,
    ).toMatch(/0/);
    expect(
      screen.getByTestId('metric-total-permits-split-comparison').textContent,
    ).toContain('2026-03-01 – 2026-03-31');
    const deltaSpan = screen.getByTestId('metric-total-permits-split-delta');
    expect(deltaSpan.textContent).toMatch(/↑/);
    expect(deltaSpan.textContent).toMatch(/\+1/);
    // fix-137: mode label collapsed to a unified "vs comparison".
    expect(deltaSpan.textContent).toMatch(/vs comparison/);
    expect(deltaSpan.getAttribute('style')).toMatch(/color: var\(--color-pm\)/);
  });

  it('fix-137: Apr 2026 vs Apr 2025 with no prior-year data → "no comparison data" on numeric cards', () => {
    renderIt();
    applyCompareViaPanel(
      { from: '2026-04-01', to: '2026-04-30' },
      { from: '2025-04-01', to: '2025-04-30' },
    );
    const delta = screen.getByTestId('metric-city-review-split-delta');
    expect(delta.textContent).toMatch(/no comparison data/i);
    // fix-137: mode tag collapsed to a unified "vs comparison".
    expect(delta.textContent).toMatch(/vs comparison/);
  });

  it('fix-137: comparison wired on numeric MetricCards but skipped on ScheduleBenchmarks / ReportTable / chart cards', () => {
    renderIt();
    applyCompareViaPanel(
      { from: '2026-04-01', to: '2026-04-30' },
      { from: '2026-03-01', to: '2026-03-31' },
    );
    // Wired (assert presence on at least one numeric card). fix-129-b
    // moved the comparison rendering from -cmp to -split.
    expect(screen.getByTestId('metric-total-permits-split')).toBeInTheDocument();
    // Skipped surfaces — no -cmp testid on charts, benchmarks, or the table.
    expect(screen.queryByTestId('chart-permits-by-type-cmp')).toBeNull();
    expect(screen.queryByTestId('chart-permits-by-juris-cmp')).toBeNull();
    expect(screen.queryByTestId('chart-go-to-submit-by-type-cmp')).toBeNull();
    expect(screen.queryByTestId('chart-schedule-variance-by-type-cmp')).toBeNull();
    expect(screen.queryByTestId('chart-city-review-by-juris-cmp')).toBeNull();
    expect(screen.queryByTestId('chart-corr-response-by-type-cmp')).toBeNull();
    expect(screen.queryByTestId('schedule-benchmarks-cmp')).toBeNull();
    expect(screen.queryByTestId('report-table-cmp')).toBeNull();
  });

  it('fix-137: panel Apply is disabled until BOTH Period A and Period B are filled', () => {
    // The new control replaces the old "range=all + compareTo silently
    // no-ops" branch — the panel's Apply button is now the gate. Users
    // can't activate a comparison without supplying explicit Period B.
    renderIt();
    fireEvent.click(screen.getByTestId('reports-compare-add-button'));
    const apply = screen.getByTestId(
      'reports-compare-panel-apply',
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    // Fill ONLY Period A → still disabled.
    fireEvent.change(
      screen.getByTestId('reports-compare-panel-period-a-from'),
      { target: { value: '2026-04-01' } },
    );
    fireEvent.change(
      screen.getByTestId('reports-compare-panel-period-a-to'),
      { target: { value: '2026-04-30' } },
    );
    expect(apply.disabled).toBe(true);
    // Fill Period B → enabled.
    fireEvent.change(
      screen.getByTestId('reports-compare-panel-period-b-from'),
      { target: { value: '2026-03-01' } },
    );
    fireEvent.change(
      screen.getByTestId('reports-compare-panel-period-b-to'),
      { target: { value: '2026-03-31' } },
    );
    expect(apply.disabled).toBe(false);
  });

  // fix-137: replaces the old fix-124-b chip-row tests. The 6 presets
  // now live INSIDE the ComparePanel, opened by the AddComparisonButton.
  // Apply commits BOTH Period A and Period B to the filter state.
  describe('fix-137 ComparePanel preset shortcuts', () => {
    it('clicking the Add comparison button opens the panel with 6 preset shortcuts', () => {
      renderIt();
      expect(screen.queryByTestId('reports-compare-panel')).toBeNull();
      fireEvent.click(screen.getByTestId('reports-compare-add-button'));
      expect(screen.getByTestId('reports-compare-panel')).toBeInTheDocument();
      for (const preset of [
        'this_month_vs_last',
        'this_quarter_vs_last',
        'this_year_vs_last',
        'last_30d_vs_prior',
        'last_60d_vs_prior',
        'last_90d_vs_prior',
      ]) {
        expect(
          screen.getByTestId(`reports-compare-panel-preset-${preset}`),
        ).toBeInTheDocument();
      }
    });

    it('"This year vs last" preset fills Period A=2026 + Period B=2025', () => {
      renderIt();
      fireEvent.click(screen.getByTestId('reports-compare-add-button'));
      fireEvent.click(
        screen.getByTestId('reports-compare-panel-preset-this_year_vs_last'),
      );
      // Period A inputs filled with this year (2026 — based on FIXED_TODAY=2026-05-15).
      expect(
        (screen.getByTestId(
          'reports-compare-panel-period-a-from',
        ) as HTMLInputElement).value,
      ).toBe('2026-01-01');
      expect(
        (screen.getByTestId(
          'reports-compare-panel-period-a-to',
        ) as HTMLInputElement).value,
      ).toBe('2026-12-31');
      // Period B inputs filled with last year (2025) via the calendar snap.
      expect(
        (screen.getByTestId(
          'reports-compare-panel-period-b-from',
        ) as HTMLInputElement).value,
      ).toBe('2025-01-01');
      expect(
        (screen.getByTestId(
          'reports-compare-panel-period-b-to',
        ) as HTMLInputElement).value,
      ).toBe('2025-12-31');
    });

    it('Apply after preset commits BOTH ranges to the filter bar + closes the panel', () => {
      renderIt();
      fireEvent.click(screen.getByTestId('reports-compare-add-button'));
      fireEvent.click(
        screen.getByTestId('reports-compare-panel-preset-this_quarter_vs_last'),
      );
      fireEvent.click(screen.getByTestId('reports-compare-panel-apply'));
      // Panel closes; the chip shows the Period B range; filter-bar
      // Period A inputs reflect Q2 2026.
      expect(screen.queryByTestId('reports-compare-panel')).toBeNull();
      const chip = screen.getByTestId('reports-compare-chip');
      expect(chip.textContent).toContain('2026-01-01 – 2026-03-31');
      expect(
        (screen.getByTestId('filter-date-from') as HTMLInputElement).value,
      ).toBe('2026-04-01');
      expect(
        (screen.getByTestId('filter-date-to') as HTMLInputElement).value,
      ).toBe('2026-06-30');
    });

    it('chip × removes the comparison without touching Period A', () => {
      renderIt();
      applyCompareViaPanel(
        { from: '2026-04-01', to: '2026-04-30' },
        { from: '2026-03-01', to: '2026-03-31' },
      );
      expect(screen.getByTestId('reports-compare-chip')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('reports-compare-remove-button'));
      expect(screen.queryByTestId('reports-compare-chip')).toBeNull();
      // Period A inputs unchanged after removing the comparison.
      expect(
        (screen.getByTestId('filter-date-from') as HTMLInputElement).value,
      ).toBe('2026-04-01');
    });
  });

  // fix-129-c: every MetricCard label + BarChartCard title is wrapped
  // in a MetricInfoTooltip with the right slug. The slugs come from
  // metricDefinitions.ts. Iterate the expected slugs from the same
  // source so adding a new metric there triggers the per-row pin
  // automatically.
  describe('fix-129-c MetricInfoTooltip wiring', () => {
    const reportsSlugs = [
      'totalPermits',
      'submitVariance',
      'avgGoToSubmit',
      'avgCityReview',
      'avgCorrectionCycles',
      'inCorrections',
      'avgScheduleVariance',
      // fix-140-b: Avg Permit Timeline (12th tile).
      'avgPermitTimeline',
      // fix-141: Avg Response Time (13th tile).
      'avgResponseTime',
    ];
    it.each(reportsSlugs)('MetricCard "%s" has a tooltip trigger', (slug) => {
      renderIt();
      expect(
        screen.getByTestId(`metric-tooltip-trigger-reports-${slug}`),
      ).toBeInTheDocument();
    });

    const barSlugs = [
      'permitsByType',
      'permitsByJuris',
      'goToSubmitByType',
      'scheduleVarianceByType',
      'cityReviewByJuris',
      'corrResponseByType',
    ];
    it.each(barSlugs)('BarChartCard "%s" has a tooltip trigger', (slug) => {
      renderIt();
      expect(
        screen.getByTestId(`metric-tooltip-trigger-bar-${slug}`),
      ).toBeInTheDocument();
    });
  });

  // fix-129-b: horizontal comparison split on the MetricCards. When the
  // user picks a comparison mode AND a date range, the cards swap from
  // the legacy ComparisonRow path to the side-by-side KpiSplitView.
  describe('fix-129-b horizontal split on comparison-active MetricCards', () => {
    function setRangeAndCompare() {
      renderIt();
      // fix-137: range + Period B both committed via the panel Apply.
      applyCompareViaPanel(
        { from: '2026-04-01', to: '2026-04-30' },
        { from: '2026-03-01', to: '2026-03-31' },
      );
    }
    it('Total Permits card renders KpiSplitView cells with date ranges', () => {
      setRangeAndCompare();
      const split = screen.getByTestId('metric-total-permits-split');
      expect(split).toBeInTheDocument();
      expect(
        screen.getByTestId('metric-total-permits-split-current'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('metric-total-permits-split-comparison'),
      ).toBeInTheDocument();
    });
    it('legacy ComparisonRow no longer renders on cards that use split', () => {
      setRangeAndCompare();
      // The split branch is taken — no -cmp suffix from ComparisonRow.
      expect(screen.queryByTestId('metric-total-permits-cmp')).toBeNull();
    });
  });

  // ============================================================
  // fix-140: Overview KPI tile polish
  // ============================================================
  describe('fix-140 Overview KPI tile polish', () => {
    function setRangeAndCompare() {
      renderIt();
      fireEvent.click(screen.getByTestId('reports-compare-add-button'));
      fireEvent.change(
        screen.getByTestId('reports-compare-panel-period-a-from'),
        { target: { value: '2026-04-01' } },
      );
      fireEvent.change(
        screen.getByTestId('reports-compare-panel-period-a-to'),
        { target: { value: '2026-04-30' } },
      );
      fireEvent.change(
        screen.getByTestId('reports-compare-panel-period-b-from'),
        { target: { value: '2026-03-01' } },
      );
      fireEvent.change(
        screen.getByTestId('reports-compare-panel-period-b-to'),
        { target: { value: '2026-03-31' } },
      );
      fireEvent.click(screen.getByTestId('reports-compare-panel-apply'));
    }

    it('fix-141: Avg City Review and Avg Permit Timeline no longer carry the same value', () => {
      // Pre-fix-141 the Permit Timeline tile borrowed metrics.avgCityReview,
      // so the two tiles were always identical. fix-141 split the fields:
      // City Review = sum-over-cycles city-court time; Permit Timeline =
      // intake → approval. The default fixture (cycle-1 corr_issued, no
      // cycle 0) forces a gap: City Review computes a number while Permit
      // Timeline is null ("—"). They must no longer match.
      renderIt();
      const timeline = screen.getByTestId('metric-permit-timeline');
      const cityReview = screen.getByTestId('metric-city-review');
      expect(timeline).toBeInTheDocument();
      expect(cityReview).toBeInTheDocument();
      const extractValue = (txt: string) => txt.match(/(\d+d|—)/)?.[0] ?? '';
      expect(extractValue(timeline.textContent ?? '')).not.toBe(
        extractValue(cityReview.textContent ?? ''),
      );
    });

    it('fix-140-a: page nowhere renders "NaN" — Avg Schedule Var falls back to "—" on bad data', () => {
      renderIt();
      // Scan the entire rendered document for "NaN" — the NaN bug surfaced
      // as "NaN d" in the Schedule Variance card pre-fix.
      expect(document.body.textContent ?? '').not.toMatch(/NaN/);
      // Schedule Var tile specifically renders the "—" placeholder when
      // null (the fixture has no expected_issue + approval pairs).
      const card = screen.getByTestId('metric-schedule-variance');
      // Either a real number with 'd' OR the '—' placeholder, never 'NaN'.
      expect(card.textContent ?? '').not.toMatch(/NaN/);
    });

    it('fix-140-c: comparison renders the KpiSplitView on all 7 newly-wired tiles + the new Timeline tile', () => {
      setRangeAndCompare();
      // The 7 newly-wired tiles all expose -split testids when comparison
      // is active. Conditional tiles (avgGoToDDStart, avgDDDuration,
      // avgDDEndToSubmit, avgSubmitToIntake) only render when the metric
      // is non-null — for this fixture, only the unconditional ones
      // ship a -split node. Assert the unconditional set + Timeline.
      // (Conditional tiles are validated by individual unit tests above.)
      const unconditional = [
        'metric-go-to-submit-split',
        'metric-permit-timeline-split',
        'metric-schedule-variance-split',
      ];
      for (const id of unconditional) {
        expect(screen.getByTestId(id)).toBeInTheDocument();
      }
    });

    it('fix-140-c: every comparison-wired tile carries data-tone (good/bad/neutral) based on its declared direction', () => {
      setRangeAndCompare();
      // Schedule Variance is direction=neutral — split-delta tone is
      // always 'neutral' regardless of sign.
      const schedDelta = screen.getByTestId(
        'metric-schedule-variance-split-delta',
      );
      expect(schedDelta).toBeInTheDocument();
      // fix-141: Permit Timeline and City Review are now distinct metrics,
      // but in this comparison cohort (Apr 2026 = one cycle-less permit;
      // Mar 2026 = empty) both are null, so both deltas render the neutral
      // "no comparison data" state with the same data-direction.
      const timelineDelta = screen.getByTestId(
        'metric-permit-timeline-split-delta',
      );
      const cityDelta = screen.getByTestId(
        'metric-city-review-split-delta',
      );
      expect(timelineDelta.getAttribute('data-direction')).toBe(
        cityDelta.getAttribute('data-direction'),
      );
    });
  });

  // ============================================================
  // fix-141: redefine Avg City Review + add Avg Response Time tile
  // ============================================================
  describe('fix-141 City Review redefinition + Response Time tile', () => {
    function setRangeAndCompare() {
      renderIt();
      fireEvent.click(screen.getByTestId('reports-compare-add-button'));
      fireEvent.change(
        screen.getByTestId('reports-compare-panel-period-a-from'),
        { target: { value: '2026-04-01' } },
      );
      fireEvent.change(
        screen.getByTestId('reports-compare-panel-period-a-to'),
        { target: { value: '2026-04-30' } },
      );
      fireEvent.change(
        screen.getByTestId('reports-compare-panel-period-b-from'),
        { target: { value: '2026-03-01' } },
      );
      fireEvent.change(
        screen.getByTestId('reports-compare-panel-period-b-to'),
        { target: { value: '2026-03-31' } },
      );
      fireEvent.click(screen.getByTestId('reports-compare-panel-apply'));
    }

    it('renders the 13th tile (Avg Response Time)', () => {
      renderIt();
      expect(screen.getByTestId('metric-response-time')).toBeInTheDocument();
    });

    it('Avg City Review subtext reads "time in city\'s court" (not the old intake → corrections/issue)', () => {
      renderIt();
      const card = screen.getByTestId('metric-city-review');
      expect(card.textContent).toContain("time in city's court");
      expect(card.textContent).not.toContain('intake accepted → corrections/issue');
    });

    it('Avg Response Time renders a comparison split when Period A/B are set', () => {
      setRangeAndCompare();
      expect(
        screen.getByTestId('metric-response-time-split'),
      ).toBeInTheDocument();
    });

    it('City Review and Permit Timeline show different numbers on a divergent cohort (case #2)', () => {
      // Cohort case #2: full round-trip over 2 cycles → City Review = 24d
      // (city-court time), Permit Timeline = 29d (intake → approval). Render
      // MetricCards directly with the computed values so the numeric gap is
      // explicit (the shared page fixture only forces a number-vs-"—" gap).
      render(
        <MetricCards
          metrics={makeMetrics({
            avgCityReview: 24,
            avgPermitTimeline: 29,
            avgResponseTime: 5,
          })}
        />,
      );
      const cityNum = screen
        .getByTestId('metric-city-review')
        .textContent?.match(/\d+/)?.[0];
      const timelineNum = screen
        .getByTestId('metric-permit-timeline')
        .textContent?.match(/\d+/)?.[0];
      expect(cityNum).toBe('24');
      expect(timelineNum).toBe('29');
      expect(cityNum).not.toBe(timelineNum);
    });
  });

  // ============================================================
  // fix-203: per-metric n= sample-size annotation
  // ============================================================
  describe('fix-203 n= sample size on Overview cards', () => {
    it('renders the n= line on a completion card; n=0 shows "—" not a borrowed number', () => {
      // Recent immature cohort: 9 permits, but 0 reached approval → Avg Permit
      // Timeline must read "—" with n=0 of 9 (the maturity story), NOT a value.
      render(
        <MetricCards
          metrics={makeMetrics({
            totalPermits: 9,
            avgPermitTimeline: null,
            sampleSizes: { totalPermits: 9, avgPermitTimeline: 0 },
          })}
        />,
      );
      const card = screen.getByTestId('metric-permit-timeline');
      // Value is the em-dash placeholder, not a number.
      expect(card.textContent).toContain('—');
      expect(card.textContent).not.toMatch(/\d+d/);
      // n= line present and reads "n=0 of 9".
      expect(
        screen.getByTestId('metric-permit-timeline-n').textContent,
      ).toBe('n=0 of 9');
    });

    it('count metric shows bare n= (n equals the cohort); comparison appends " · vs n="', () => {
      render(
        <MetricCards
          metrics={makeMetrics({
            totalPermits: 9,
            sampleSizes: { totalPermits: 9 },
          })}
          comparisonMetrics={makeMetrics({
            totalPermits: 20,
            sampleSizes: { totalPermits: 20 },
          })}
          comparisonLabel="vs prev period"
        />,
      );
      // n equals total for a count metric → bare "n=9", plus the comparison n.
      expect(screen.getByTestId('metric-total-permits-n').textContent).toBe(
        'n=9 · vs n=20',
      );
    });

    it('a completion card still renders (to show its comparison) when CURRENT n=0 — pre-fix it vanished', () => {
      // avgSubmitToIntake is a conditional card. Current null (n=0) but the
      // comparison has data → the card must show, with current "—".
      render(
        <MetricCards
          metrics={makeMetrics({
            totalPermits: 9,
            avgSubmitToIntake: null,
            sampleSizes: { totalPermits: 9, avgSubmitToIntake: 0 },
          })}
          comparisonMetrics={makeMetrics({
            totalPermits: 20,
            avgSubmitToIntake: 4,
            sampleSizes: { totalPermits: 20, avgSubmitToIntake: 12 },
          })}
          comparisonLabel="vs prev period"
        />,
      );
      const card = screen.getByTestId('metric-submit-to-intake');
      expect(card).toBeInTheDocument();
      expect(screen.getByTestId('metric-submit-to-intake-n').textContent).toBe(
        'n=0 of 9 · vs n=12 of 20',
      );
    });
  });

  // ============================================================
  // fix-142: per-cycle breakdown drawer
  // ============================================================
  describe('fix-142 per-cycle breakdown drawer', () => {
    it('drawer is closed by default — timeline tiles aria-expanded=false, drawer aria-hidden', () => {
      renderIt();
      expect(
        screen.getByTestId('metric-city-review').getAttribute('aria-expanded'),
      ).toBe('false');
      expect(
        screen
          .getByTestId('metric-permit-timeline')
          .getAttribute('aria-expanded'),
      ).toBe('false');
      expect(
        screen.getByTestId('per-cycle-drawer').getAttribute('aria-hidden'),
      ).toBe('true');
    });

    it('all four bucket rows render (Cycle 1, 2, 3, 4+)', () => {
      renderIt();
      for (const k of ['1', '2', '3', '4plus']) {
        expect(screen.getByTestId(`per-cycle-row-${k}`)).toBeInTheDocument();
      }
    });

    it('clicking any of the three timeline tiles toggles the same drawer', () => {
      renderIt();
      const city = () => screen.getByTestId('metric-city-review');
      const drawer = () => screen.getByTestId('per-cycle-drawer');
      // Closed.
      expect(city().getAttribute('aria-expanded')).toBe('false');
      // Click City Review → opens.
      fireEvent.click(city());
      expect(city().getAttribute('aria-expanded')).toBe('true');
      expect(drawer().getAttribute('aria-hidden')).toBe('false');
      // Click Response Time → toggles closed (shared toggle).
      fireEvent.click(screen.getByTestId('metric-response-time'));
      expect(city().getAttribute('aria-expanded')).toBe('false');
      // Click Permit Timeline → toggles back open.
      fireEvent.click(screen.getByTestId('metric-permit-timeline'));
      expect(city().getAttribute('aria-expanded')).toBe('true');
    });

    it('chevron flips ▾ → ▴ when the drawer opens', () => {
      renderIt();
      const city = () => screen.getByTestId('metric-city-review');
      expect(city().textContent).toContain('▾');
      fireEvent.click(city());
      expect(city().textContent).toContain('▴');
    });

    it('Cycle 1 bucket reflects the fixture (city-court 35d, response —, n=1)', () => {
      // Default fixture permit 1 has one review cycle (index 1) with
      // corr_issued → city-court = submitted(2026-01-25) → corr_issued
      // (2026-03-01) = 35d; no next cycle → response "—".
      renderIt();
      expect(screen.getByTestId('per-cycle-city-1').textContent).toContain('35');
      expect(screen.getByTestId('per-cycle-response-1').textContent).toContain('—');
      expect(screen.getByTestId('per-cycle-row-1').textContent).toContain('n=1');
    });

    // fix-184b: composition summary on the Avg Permit Timeline drawer only.
    it('composition summary shows when opened via Permit Timeline, not via City Review', () => {
      renderIt();
      expect(screen.queryByTestId('timeline-composition')).toBeNull();
      // Open via Permit Timeline → composition present.
      fireEvent.click(screen.getByTestId('metric-permit-timeline'));
      expect(screen.getByTestId('timeline-composition')).toBeInTheDocument();
      // Close, then open via City Review → composition absent, table still there.
      fireEvent.click(screen.getByTestId('metric-permit-timeline'));
      fireEvent.click(screen.getByTestId('metric-city-review'));
      expect(screen.queryByTestId('timeline-composition')).toBeNull();
      expect(screen.getByTestId('per-cycle-row-1')).toBeInTheDocument();
    });

    it('comparison: each row cell carries -split-current and -split-comparison children', () => {
      renderIt();
      applyCompareViaPanel(
        { from: '2026-04-01', to: '2026-04-30' },
        { from: '2026-03-01', to: '2026-03-31' },
      );
      expect(
        screen.getByTestId('per-cycle-city-1-split-current'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('per-cycle-city-1-split-comparison'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('per-cycle-response-2-split-current'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('per-cycle-response-2-split-comparison'),
      ).toBeInTheDocument();
    });
  });
});
