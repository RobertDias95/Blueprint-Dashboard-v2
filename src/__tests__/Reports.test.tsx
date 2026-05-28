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

// fix-22 Mig 3: go_date / units / product_type / project_tags moved
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
      product_type: 'SFR',
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
      product_type: 'Attached Units',
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
      status: null,
      num: 'BP-1',
      da: 'Trevor',
      dm: 'Lindsay',
      ent_lead: 'Bobby',
      dual_da: null,
      target_submit: '2026-02-01',
      dd_start: null,
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
      status: null,
      num: 'DM-1',
      da: 'Ahmadi',
      dm: 'Brittani',
      ent_lead: 'Miles',
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

  it('IN CORRECTIONS card always renders + ISSUED sub-text reflects actual_issue count', () => {
    renderIt();
    const card = screen.getByTestId('metric-in-corrections');
    expect(card.textContent).toContain('0'); // no permits at stage=co
    // Fixtures: no actual_issue set → 0 permits issued
    expect(card.textContent).toContain('0 permits issued');
  });

  it('AVG CITY REVIEW reflects the cycle 1 review math (Jan 27 → Mar 1 = 33d)', () => {
    renderIt();
    const card = screen.getByTestId('metric-city-review');
    expect(card.textContent).toContain('33');
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

  it('Time range = 3mo shows only permits with go_date in last 90 days', () => {
    renderIt();
    // today=2026-05-15, cutoff=2026-02-14.
    // permit 1 go=2026-01-01 (out), permit 2 go=2026-04-01 (in).
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

  // fix-67: Saved Reports hub (Phase 1) — the Weekly DA Update card is
  // additive; the existing CSV export must remain.
  it('renders the Weekly DA Update card linking to /reports/weekly-da, CSV export preserved', () => {
    renderIt();
    const card = screen.getByTestId('report-card-weekly-da');
    expect(card).toBeInTheDocument();
    expect(card.getAttribute('href')).toBe('/reports/weekly-da');
    expect(card.textContent).toMatch(/Weekly DA Update/);
    // The pre-existing CSV export button is still present (additive change).
    expect(screen.getByTestId('reports-export-csv')).toBeInTheDocument();
  });
});
