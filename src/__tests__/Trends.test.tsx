import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-25-feat-V: Trends page KPI tile + table column for submission →
// intake variance. Mocks the data hooks so the assertions can pin
// specific values without a live DB.

function mkCycle(
  over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>,
): PermitCycle {
  return {
    id: `c-${over.cycle_index}-${Math.random()}`,
    permit_id: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function mkPermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
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
    ...over,
  };
}

function mkProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...over,
  };
}

// Approval dates land inside the default 12-month window ending today
// (system clock). Tests use 2026-05-* / 2026-06-* which the system
// reminder confirms is "today" relative to the harness fixture.
const PERMITS: PermitWithCycles[] = [
  // Seattle BP — submitted 2026-05-01, intake 2026-05-06 → +5d variance.
  mkPermit({
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    approval_date: '2026-05-30',
    permit_cycles: [
      mkCycle({
        cycle_index: 0,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-06',
      }),
    ],
  }),
  // Seattle BP — submitted 2026-05-01, intake 2026-05-11 → +10d variance.
  mkPermit({
    id: 2,
    project_id: 'p2',
    type: 'Building Permit',
    approval_date: '2026-06-15',
    permit_cycles: [
      mkCycle({
        cycle_index: 0,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-11',
      }),
    ],
  }),
  // Seattle Demo — c0.intake_accepted NULL → excluded from variance.
  mkPermit({
    id: 3,
    project_id: 'p3',
    type: 'Demolition',
    approval_date: '2026-05-20',
    permit_cycles: [
      mkCycle({
        cycle_index: 0,
        submitted: '2026-05-01',
        intake_accepted: null,
      }),
    ],
  }),
];

const PROJECTS: Project[] = [
  mkProject({ id: 'p1', juris: 'Seattle' }),
  mkProject({ id: 'p2', juris: 'Seattle' }),
  mkProject({ id: 'p3', juris: 'Seattle' }),
];

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: PERMITS,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: PROJECTS,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
// fix-25-feat-BB: Trends now reads catalog types so the Target
// Submit table can iterate them. Provide a minimal type catalog so
// the section renders rows for the BPs in the fixture.
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
      { name: 'Grading / Clearing', is_builtin: true, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import Trends from '../pages/Trends';

function renderTrends() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/trends?from=2025-01-01&to=2027-12-31']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Trends />, { wrapper });
}

beforeEach(() => {
  // Date-range default uses `new Date()` — tests above hardcode a wide
  // explicit range via search params so the system clock doesn't affect
  // which rows fall in window.
});

describe('Trends — fix-25-feat-V submit→intake surface', () => {
  it('renders the new Avg submit → intake delay KPI tile with weighted avg + n', () => {
    renderTrends();
    const tile = screen.getByTestId('trends-kpi-submit-intake');
    // Two BPs: +5 and +10 days → avg 7.5 → rounded 8. n=2.
    expect(tile.textContent).toMatch(/8d/);
    expect(tile.textContent).toMatch(/2 samples/);
  });

  it('KPI tile carries the interpretation tooltip on its container', () => {
    renderTrends();
    const tile = screen.getByTestId('trends-kpi-submit-intake');
    const title = tile.getAttribute('title') ?? '';
    expect(title).toMatch(/team submission/i);
    expect(title).toMatch(/city intake/i);
  });

  it('renders the new Submit→Intake column header alongside the existing 7', () => {
    renderTrends();
    const table = screen.getByTestId('trends-breakdown-table');
    expect(table.textContent).toMatch(/Submit→Intake/);
  });

  it('per-cohort cell shows the variance number for BPs (7d weighted) and — for Demos (no samples)', () => {
    renderTrends();
    const bpRow = screen.getByTestId('trends-row-Seattle-Building Permit');
    // Variance helper's per-cohort avg = round((5 + 10) / 2) = 8 (mean)
    // Wait: the helper averages WITHIN a cohort. Both BPs are Seattle
    // BP → one cohort with deltas [5, 10] → avg 7.5 → rounds to 8.
    expect(bpRow.textContent).toMatch(/8d/);
    const demoRow = screen.getByTestId('trends-row-Seattle-Demolition');
    // Demo had no intake → variance helper produced no row for this
    // cohort → column renders "—".
    const demoCells = demoRow.querySelectorAll('td');
    // Column order: juris | type | n | clock | cycles | city/cyc |
    // team/cyc | submit→intake | target hit → index 7 is the variance.
    expect(demoCells[7].textContent).toBe('—');
  });

  it('sorting by Submit→Intake column works (click header toggles direction)', () => {
    renderTrends();
    // Add a second BP cohort with low variance by mutating? Easier:
    // assert clicking the header changes active state via testid
    // attribute on the th. The sort logic itself is covered by
    // perfTrends helper tests; here we verify the wiring fires.
    const header = Array.from(
      screen.getByTestId('trends-breakdown-table').querySelectorAll('th'),
    ).find((th) => th.textContent?.includes('Submit→Intake'));
    expect(header).toBeTruthy();
    fireEvent.click(header!);
    // After click, the header text gets a sort arrow appended.
    expect(header!.textContent).toMatch(/▼/);
    fireEvent.click(header!);
    expect(header!.textContent).toMatch(/▲/);
  });

  // fix-25-feat-BB: sectioned layout + Target Submit section + Volume
  // section adopted from Reports → Trends.
  it('renders the new sectioned layout: filter bar, KPI row, Volume, City performance, Variance, Target Submit, Breakdown', () => {
    renderTrends();
    // Filter bar still present.
    expect(screen.getByTestId('trends-filter-bar')).toBeInTheDocument();
    // All five sections by testid.
    expect(screen.getByTestId('trends-section-volume')).toBeInTheDocument();
    expect(screen.getByTestId('trends-section-city')).toBeInTheDocument();
    expect(screen.getByTestId('trends-section-variance')).toBeInTheDocument();
    expect(
      screen.getByTestId('trends-section-target-submit'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('trends-section-breakdown')).toBeInTheDocument();
  });

  it('Volume section renders the 4 v1-parity charts (submitted / approved / timeline / GOs)', () => {
    renderTrends();
    expect(screen.getByTestId('tr-chart-submitted')).toBeInTheDocument();
    expect(screen.getByTestId('tr-chart-approved')).toBeInTheDocument();
    expect(screen.getByTestId('tr-chart-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('tr-chart-goes')).toBeInTheDocument();
  });

  it('Target Submit section renders one row per (juris × type) with non-mirror anchor', () => {
    renderTrends();
    // Demolition is in the catalog but has no Demo permits with the
    // required anchor (BP c0 intake) populated — still shown with
    // hardcoded fallback / source=default.
    const bpRow = screen.getByTestId('trends-ts-row-Seattle-Building Permit');
    expect(bpRow).toBeInTheDocument();
    const demoRow = screen.getByTestId('trends-ts-row-Seattle-Demolition');
    expect(demoRow).toBeInTheDocument();
    // Mirror types (Grading / Clearing) are excluded.
    expect(
      screen.queryByTestId('trends-ts-row-Seattle-Grading / Clearing'),
    ).toBeNull();
  });

  it('Target Submit row for Demolition (no samples) shows the "default" tier badge', () => {
    renderTrends();
    const demoRow = screen.getByTestId('trends-ts-row-Seattle-Demolition');
    // The tier badge has data-testid="tier-{source}"; default tier =
    // hardcoded fallback fired.
    const tierBadge = demoRow.querySelector('[data-testid="tier-default"]');
    expect(tierBadge).toBeTruthy();
    // Source column reads "hardcoded fallback" for default tier.
    expect(demoRow.textContent).toMatch(/hardcoded fallback/i);
  });

  it('Variance section paragraph quotes the submit→intake weighted avg + target hit rate', () => {
    renderTrends();
    const variance = screen.getByTestId('trends-section-variance');
    // Same numbers as the KPI tiles (8d weighted, n=2).
    expect(variance.textContent).toMatch(/8d/);
    expect(variance.textContent).toMatch(/n=2/);
  });

  it('KPI tile shows "—" when no permits have both submitted + intake_accepted in window', () => {
    // Narrow the URL date range to a window with no qualifying permits.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/trends?from=2099-01-01&to=2099-12-31']}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    const tile = screen.getByTestId('trends-kpi-submit-intake');
    expect(tile.textContent).toMatch(/—/);
  });

  it('fix-110: the timeline chart subtitle reads "(submit → approval/issue, days)" — honest about the COALESCE endpoint', () => {
    // Pre-fix the subtitle claimed "submit → approval" but the helper
    // uses approval_date ?? actual_issue. Silent today for Seattle BPs
    // (none are issue-only) but the wording was incorrect.
    renderTrends();
    const card = screen.getByTestId('tr-chart-timeline');
    expect(card.textContent).toContain('submit → approval/issue, days');
  });

  it('fix-112-c: page renders the "Showing approved permits only" affordance', () => {
    // Trends KPI row + City + Variance + Breakdown all route through
    // filterPermits (perfTrends.ts:46-63) which gates on
    // approval_date ?? actual_issue. Make the cohort restriction visible.
    renderTrends();
    const banner = screen.getByTestId('trends-approved-only-banner');
    expect(banner.textContent).toMatch(/Showing approved permits only/i);
    expect(banner.textContent).toMatch(/in-progress activity is not included/i);
  });

  // ─── fix-114: period comparison ────────────────────────────────────
  it('fix-114: Compare to defaults to "off" and no comparison row renders', () => {
    renderTrends();
    expect(screen.getByTestId('trends-compare')).toBeInTheDocument();
    const select = screen.getByTestId('trends-compare') as HTMLSelectElement;
    expect(select.value).toBe('off');
    // None of the KPI tiles render a comparison row testid.
    expect(screen.queryByTestId('trends-kpi-total-cmp')).toBeNull();
    expect(screen.queryByTestId('trends-kpi-clock-cmp')).toBeNull();
  });

  it('fix-114: previous_period with cohorts in both windows renders dual values + delta', () => {
    // URL: current = June 2026 only (1 permit: id=2), previous = May 2026
    // (permits 1 & 3 — id=1, id=3). kpiTotal: current=1, cmp=2, delta=-1.
    // Direction='higher_better' → negative delta colors red (--color-co).
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_period',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });

    // Approved-permits tile renders both numbers + the delta.
    //
    // fix-129-b: the comparison rendering moved from ComparisonRow
    // (testid trends-kpi-X-cmp) to KpiSplitView (testid
    // trends-kpi-X-split with -current / -comparison / -delta cells).
    const tile = screen.getByTestId('trends-kpi-total');
    expect(tile.textContent).toMatch(/^.*1/); // current value = 1
    const split = screen.getByTestId('trends-kpi-total-split');
    expect(split).toBeInTheDocument();
    // Comparison cell carries the prior value (2) + its range label.
    expect(
      screen.getByTestId('trends-kpi-total-split-comparison').textContent,
    ).toContain('2');
    expect(
      screen.getByTestId('trends-kpi-total-split-comparison').textContent,
    ).toContain('2026-05-01 – 2026-05-31');
    // Delta strip: -1 with the down arrow.
    const deltaSpan = screen.getByTestId('trends-kpi-total-split-delta');
    expect(deltaSpan.textContent).toMatch(/↓/);
    expect(deltaSpan.textContent).toMatch(/-1/);
    expect(deltaSpan.textContent).toMatch(/vs prev period/);
    // Direction='higher_better' + negative delta → red color on the delta line.
    expect(deltaSpan.getAttribute('style')).toMatch(/color: var\(--color-co\)/);
  });

  it('fix-114: previous_year with no permits in prior period renders "no comparison data"', () => {
    // URL: current = June 2026 (1 permit) ; previous = June 2025 (zero fixture
    // permits). Numeric tiles (city clock, cycles, submit→intake) show the
    // "no comparison data" affordance because comparison returns null.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_year',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });

    // The city-clock tile has a real current value (permit 2 contributes)
    // but the prior-year window is empty → "no comparison data" on the
    // KpiSplitView delta strip (fix-129-b moved the affordance from
    // ComparisonRow to KpiSplitView's delta line).
    const delta = screen.getByTestId('trends-kpi-clock-split-delta');
    expect(delta.textContent).toMatch(/no comparison data/i);
    expect(delta.textContent).toMatch(/vs prev year/);
  });

  it('fix-114: higher_better + positive delta colors GREEN (--color-pm)', () => {
    // URL: current = May 2026 (permits 1 + 3) vs prev = Apr 2026 (empty).
    // kpiTotal: current=2, cmp=0, delta=+2 → direction='higher_better' →
    // positive delta = good = green.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-05-01&to=2026-05-31&compare=previous_period',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    // fix-129-b: delta lives on the split's -delta cell now.
    const delta = screen.getByTestId('trends-kpi-total-split-delta');
    expect(delta.textContent).toMatch(/↑/);
    expect(delta.textContent).toMatch(/\+2/);
    expect(delta.getAttribute('style')).toMatch(/color: var\(--color-pm\)/);
  });

  it('fix-114→fix-118: Breakdown table + Variance + Target Submit stay single-cohort regardless of compareTo', () => {
    // Non-regression: fix-118 extended comparison overlay to the City
    // performance charts (trends-chart-clock, trends-chart-citytm). The
    // deferred-surface list now shrinks to:
    //   - Breakdown table (rows are type×juris but it's a TABLE not a chart —
    //     per-row delta is fix-119+ scope)
    //   - Variance section (not time-series, distinct semantics)
    //   - Target Submit table (its own learner-recency window)
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_period',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    expect(screen.queryByTestId('trends-breakdown-table-cmp')).toBeNull();
    expect(screen.queryByTestId('trends-section-variance-cmp')).toBeNull();
    expect(screen.queryByTestId('trends-section-target-submit-cmp')).toBeNull();
  });

  it('fix-112-c: Volume subtitle drops the stale juris/type carve-out + signals it includes in-progress', () => {
    // Pre-fix the subtitle still claimed "juris/type filters do not"
    // (a fix-110 leftover) and didn't signal the contrast with the
    // approved-only sections above it.
    renderTrends();
    const volume = screen.getByTestId('trends-section-volume');
    expect(volume.textContent).not.toMatch(/juris\/type filters do not/);
    expect(volume.textContent).toMatch(/includes in-progress permits/i);
  });

  // ─── fix-116: Volume + Timeline chart comparison overlay ────────────
  it('fix-116: compareTo="off" (default) → no cmp legend strip on any Volume chart', () => {
    renderTrends();
    expect(screen.queryByTestId('tr-chart-submitted-cmp-legend')).toBeNull();
    expect(screen.queryByTestId('tr-chart-approved-cmp-legend')).toBeNull();
    expect(screen.queryByTestId('tr-chart-timeline-cmp-legend')).toBeNull();
    expect(screen.queryByTestId('tr-chart-goes-cmp-legend')).toBeNull();
  });

  it('fix-116: previous_period with current=Jun 2026 → all 4 Volume charts render the comparison legend', () => {
    // URL: current = June 2026; fix-115-a snap → comparison = May 2026.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_period',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    // All four Volume charts render the legend strip.
    expect(screen.getByTestId('tr-chart-submitted-cmp-legend')).toBeInTheDocument();
    expect(screen.getByTestId('tr-chart-approved-cmp-legend')).toBeInTheDocument();
    expect(screen.getByTestId('tr-chart-timeline-cmp-legend')).toBeInTheDocument();
    expect(screen.getByTestId('tr-chart-goes-cmp-legend')).toBeInTheDocument();
  });

  it('fix-116: legend strip names the current range + the comparison range', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_period',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    const legend = screen.getByTestId('tr-chart-submitted-cmp-legend');
    // Current range surfaces as the from–to string.
    expect(legend.textContent).toContain('2026-06-01 – 2026-06-30');
    // Comparison range is the calendar-snapped May 2026.
    expect(legend.textContent).toContain('2026-05-01 – 2026-05-31');
    // "vs" prefix on the comparison side.
    expect(legend.textContent).toMatch(/vs\s+2026-05-01/);
  });

  it('fix-116: previous_year with empty prior-year cohort → legend renders the "(no data)" affordance', () => {
    // URL: current = June 2026 with permit id=2; prev_year = June 2025
    // which has no fixture permits in any of the four series helpers'
    // gates. Empty cohort renders the "(no data)" affordance in the
    // legend strip rather than crashing.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_year',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    expect(
      screen.getByTestId('tr-chart-submitted-cmp-legend-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('tr-chart-approved-cmp-legend-empty'),
    ).toBeInTheDocument();
  });

  // ─── fix-118: City performance comparison overlay ──────────────────
  it('fix-118: compareTo="off" (default) → no cmp legend strip on clock/citytm charts', () => {
    renderTrends();
    expect(screen.queryByTestId('trends-chart-clock-cmp-legend')).toBeNull();
    expect(screen.queryByTestId('trends-chart-citytm-cmp-legend')).toBeNull();
  });

  it('fix-118: previous_period with current=Jun 2026 → both City performance charts render the comparison legend', () => {
    // URL: current=Jun 2026; fix-115-a snap → comparison=May 2026. Both
    // charts in this section share the wire-up pattern from fix-116; only
    // the data sources differ (intakeToApprovalByMonth vs
    // breakdownByTypeAndJuris).
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_period',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    expect(
      screen.getByTestId('trends-chart-clock-cmp-legend'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('trends-chart-citytm-cmp-legend'),
    ).toBeInTheDocument();
  });

  it('fix-118: clock chart legend names current + snapped comparison ranges', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_period',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    const legend = screen.getByTestId('trends-chart-clock-cmp-legend');
    expect(legend.textContent).toContain('2026-06-01 – 2026-06-30');
    expect(legend.textContent).toContain('2026-05-01 – 2026-05-31');
    expect(legend.textContent).toMatch(/vs\s+2026-05-01/);
  });

  it('fix-118: previous_year with empty prior-year cohort → "(no data)" affordance renders on both', () => {
    // Mirror fix-116's empty-cohort test pattern. The clock chart's
    // intakeToApprovalByMonth returns [] when no permits in the prior year
    // qualify; the citytm chart's breakdownByTypeAndJuris does the same.
    // Both legend strips render "(no data)" rather than crashing.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            '/trends?from=2026-06-01&to=2026-06-30&compare=previous_year',
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    expect(
      screen.getByTestId('trends-chart-clock-cmp-legend-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('trends-chart-citytm-cmp-legend-empty'),
    ).toBeInTheDocument();
  });

  // fix-124-b: preset chip row above the filter bar collapses
  // "quarter vs last quarter" from 4 clicks to 1. End-to-end test:
  // click the chip → URL params reflect the new (range, compareTo).
  describe('fix-124-b preset chip row', () => {
    it('renders all 6 chips above the filter bar', () => {
      renderTrends();
      expect(screen.getByTestId('trends-preset-this_month_vs_last')).toBeInTheDocument();
      expect(screen.getByTestId('trends-preset-this_quarter_vs_last')).toBeInTheDocument();
      expect(screen.getByTestId('trends-preset-this_year_vs_last')).toBeInTheDocument();
      expect(screen.getByTestId('trends-preset-last_30d_vs_prior')).toBeInTheDocument();
      expect(screen.getByTestId('trends-preset-last_60d_vs_prior')).toBeInTheDocument();
      expect(screen.getByTestId('trends-preset-last_90d_vs_prior')).toBeInTheDocument();
    });

    it('clicking a preset updates the From/To inputs + the Compare to dropdown in one shot', () => {
      // System reminders confirm "today" is 2026-06-05 for this harness,
      // so "This quarter vs last" should land on Q2 2026 (2026-04-01 to
      // 2026-06-30) with compareTo=previous_period.
      renderTrends();
      fireEvent.click(
        screen.getByTestId('trends-preset-this_quarter_vs_last'),
      );
      const from = screen.getByTestId('trends-from') as HTMLInputElement;
      const to = screen.getByTestId('trends-to') as HTMLInputElement;
      const compare = screen.getByTestId('trends-compare') as HTMLSelectElement;
      expect(from.value).toBe('2026-04-01');
      expect(to.value).toBe('2026-06-30');
      expect(compare.value).toBe('previous_period');
    });

    it('the active chip is filled after the URL state matches it', () => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter
            initialEntries={[
              '/trends?from=2026-04-01&to=2026-06-30&compare=previous_period',
            ]}
          >
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      );
      render(<Trends />, { wrapper });
      expect(
        screen.getByTestId('trends-preset-this_quarter_vs_last').getAttribute('data-active'),
      ).toBe('true');
    });

    it('manual tweak of the From input drops the active highlight', () => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter
            initialEntries={[
              '/trends?from=2026-04-01&to=2026-06-30&compare=previous_period',
            ]}
          >
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      );
      render(<Trends />, { wrapper });
      // Start with this_quarter active.
      expect(
        screen.getByTestId('trends-preset-this_quarter_vs_last').getAttribute('data-active'),
      ).toBe('true');
      // Edit From off by one day → no preset matches.
      fireEvent.change(screen.getByTestId('trends-from'), {
        target: { value: '2026-04-02' },
      });
      expect(
        screen.getByTestId('trends-preset-this_quarter_vs_last').getAttribute('data-active'),
      ).toBe('false');
    });

    // Power-user controls still work: pin that the underlying Date + Compare
    // to controls are untouched and continue to drive the filter state.
    it('Custom Date range + Compare to dropdown still work for arbitrary slicing', () => {
      renderTrends();
      // Manually pick a slice that matches no preset.
      fireEvent.change(screen.getByTestId('trends-from'), {
        target: { value: '2026-05-15' },
      });
      fireEvent.change(screen.getByTestId('trends-to'), {
        target: { value: '2026-05-21' },
      });
      fireEvent.change(screen.getByTestId('trends-compare'), {
        target: { value: 'previous_year' },
      });
      const from = screen.getByTestId('trends-from') as HTMLInputElement;
      const to = screen.getByTestId('trends-to') as HTMLInputElement;
      const compare = screen.getByTestId('trends-compare') as HTMLSelectElement;
      expect(from.value).toBe('2026-05-15');
      expect(to.value).toBe('2026-05-21');
      expect(compare.value).toBe('previous_year');
      // No preset chip is highlighted under previous_year (no preset uses it).
      for (const preset of [
        'this_month_vs_last',
        'this_quarter_vs_last',
        'this_year_vs_last',
        'last_30d_vs_prior',
        'last_60d_vs_prior',
        'last_90d_vs_prior',
      ]) {
        expect(
          screen.getByTestId(`trends-preset-${preset}`).getAttribute('data-active'),
        ).toBe('false');
      }
    });
  });

  // fix-125: per-cycle breakdown charts in the City performance section.
  // Sit beside the existing clock + citytm charts, surface "cycle 3 is
  // slower than cycle 2" patterns that disappear in the per-(type, juris)
  // citytm rollup. Both charts get the same comparison overlay treatment
  // as fix-118's clock + citytm charts.
  describe('fix-125 per-cycle breakdown charts', () => {
    it('renders both new chart cards inside the City performance section', () => {
      renderTrends();
      const section = screen.getByTestId('trends-section-city');
      expect(
        within(section).getByTestId('trends-chart-cityreview-by-cycle'),
      ).toBeInTheDocument();
      expect(
        within(section).getByTestId('trends-chart-response-by-cycle'),
      ).toBeInTheDocument();
    });

    it('the by-cycle charts sit AFTER the existing clock + citytm charts (insertion order)', () => {
      renderTrends();
      const section = screen.getByTestId('trends-section-city');
      // Use querySelectorAll order; each child carries a testid that
      // identifies the chart.
      const chartIds = Array.from(
        section.querySelectorAll('[data-testid^="trends-chart-"]'),
      )
        .map((el) => el.getAttribute('data-testid'))
        .filter((id): id is string => !!id && !id.endsWith('-cmp-legend'));
      // Clock and citytm come first, then the new by-cycle pair.
      expect(chartIds).toEqual([
        'trends-chart-clock',
        'trends-chart-citytm',
        'trends-chart-cityreview-by-cycle',
        'trends-chart-response-by-cycle',
      ]);
    });

    it('compareTo=off → no comparison legend on either new chart', () => {
      renderTrends();
      expect(
        screen.queryByTestId('trends-chart-cityreview-by-cycle-cmp-legend'),
      ).toBeNull();
      expect(
        screen.queryByTestId('trends-chart-response-by-cycle-cmp-legend'),
      ).toBeNull();
    });

    it('compareTo=previous_period with no cohort in prior window → "(no data)" affordance', () => {
      // Current = May 2026 (1 permit: id=2 with intake May 11 + approval Jun 15).
      // Prev = Apr 2026 → empty fixture. Legend renders with "(no data)".
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter
            initialEntries={[
              '/trends?from=2026-05-01&to=2026-05-31&compare=previous_period',
            ]}
          >
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      );
      render(<Trends />, { wrapper });
      // Both legend strips render when comparison mode is active.
      expect(
        screen.getByTestId('trends-chart-cityreview-by-cycle-cmp-legend'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('trends-chart-response-by-cycle-cmp-legend'),
      ).toBeInTheDocument();
      // Both flag "(no data)" — no permits have multi-cycle data in
      // April 2026 (the prior window of the May 2026 current window).
      expect(
        screen.getByTestId(
          'trends-chart-cityreview-by-cycle-cmp-legend-empty',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          'trends-chart-response-by-cycle-cmp-legend-empty',
        ),
      ).toBeInTheDocument();
    });

    it('non-regression: existing clock + citytm charts still render under compareTo', () => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter
            initialEntries={[
              '/trends?from=2026-06-01&to=2026-06-30&compare=previous_period',
            ]}
          >
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      );
      render(<Trends />, { wrapper });
      expect(screen.getByTestId('trends-chart-clock')).toBeInTheDocument();
      expect(screen.getByTestId('trends-chart-citytm')).toBeInTheDocument();
      // Their legend strips also render under compareTo.
      expect(
        screen.getByTestId('trends-chart-clock-cmp-legend'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('trends-chart-citytm-cmp-legend'),
      ).toBeInTheDocument();
    });

    it('both charts render an empty state when the cohort has no multi-cycle data', () => {
      // Default fixture: every permit only has cycle 0 (intake + submit
      // only; no cycle 1 corr_issued). cityReviewByCycle returns all
      // nulls; both charts show the empty label.
      renderTrends();
      const cr = screen.getByTestId('trends-chart-cityreview-by-cycle');
      expect(cr.textContent).toMatch(/No multi-cycle review data/i);
      const resp = screen.getByTestId('trends-chart-response-by-cycle');
      expect(resp.textContent).toMatch(/No correction response data/i);
    });
  });

  // fix-129-c: every KPI tile + chart title is wrapped in a
  // MetricInfoTooltip. The trigger testids come from metricDefinitions
  // via the kpiTip / chartTip factories. Surfacing them as a single
  // it.each so adding a new metric to the library auto-pins the
  // wiring.
  describe('fix-129-c MetricInfoTooltip wiring (Trends)', () => {
    const kpiSlugs = [
      'approvedInWindow',
      'avgSubmitToIntakeDelay',
      'avgCityClock',
      'avgCyclesPerPermit',
      'targetSubmitHitRate',
    ];
    it.each(kpiSlugs)('KpiTile "%s" has a tooltip trigger', (slug) => {
      renderTrends();
      expect(
        screen.getByTestId(`metric-tooltip-trigger-trends-${slug}`),
      ).toBeInTheDocument();
    });

    const chartSlugs = [
      'cityClockByMonth',
      'cycleSplit',
      'cityReviewByCycle',
      'responseByCycle',
      'permitsSubmittedByMonth',
      'permitsApprovedByMonth',
      'permitTimelineByMonth',
      'gosByMonth',
    ];
    it.each(chartSlugs)('ChartCard "%s" has a tooltip trigger', (slug) => {
      renderTrends();
      expect(
        screen.getByTestId(`metric-tooltip-trigger-chart-${slug}`),
      ).toBeInTheDocument();
    });
  });
});
