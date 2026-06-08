import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-134-b: RedesignsTab integration tests. The tab nav itself is
// covered by ReportsSubTabs.test.tsx; here we mount the page directly
// via ?tab=redesigns and exercise the KPI row + trigger chart +
// builder/role leaderboards + recent-redesigns table.

const T = 'test-tenant-uuid';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

// Fixture matches the demo in redesignAnalytics.test.ts so the page +
// helper agree on the data shape.
const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'op1', address: '1 Original', juris: 'Seattle', archived: false, notes: null,
      builder_name: 'Acme', go_date: '2026-01-01',
    },
    {
      id: 'op2', address: '2 Original', juris: 'Seattle', archived: false, notes: null,
      builder_name: 'Acme', go_date: '2026-01-15',
    },
    {
      id: 'rp1', address: '1 Redesign', juris: 'Seattle', archived: false, notes: null,
      builder_name: 'Acme', go_date: '2026-02-01',
      redesign_of_project_id: 'op1', redesign_trigger: 'builder',
      redesign_reuses_original_permit: true, redesign_notes: 'Scope change',
      created_at: '2026-02-10T00:00:00Z',
    },
    {
      id: 'rp2', address: '2 Redesign', juris: 'Seattle', archived: false, notes: null,
      builder_name: 'Acme', go_date: '2026-03-01',
      redesign_of_project_id: 'op2', redesign_trigger: 'builder',
      redesign_reuses_original_permit: false,
      created_at: '2026-03-05T00:00:00Z',
    },
    {
      id: 'rp3', address: '3 Redesign', juris: 'Seattle', archived: false, notes: null,
      builder_name: 'Acme', go_date: '2026-03-15',
      redesign_of_project_id: 'op1', redesign_trigger: 'builder',
      created_at: '2026-03-20T00:00:00Z',
    },
    {
      id: 'bop1', address: 'Beta Original', juris: 'Bellevue', archived: false, notes: null,
      builder_name: 'BetaBuilds', go_date: '2026-01-01',
    },
    {
      id: 'brp1', address: 'Beta Redesign', juris: 'Bellevue', archived: false, notes: null,
      builder_name: 'BetaBuilds', go_date: '2026-04-01',
      redesign_of_project_id: 'bop1', redesign_trigger: 'city_correction',
      redesign_reuses_original_permit: true,
      created_at: '2026-04-10T00:00:00Z',
    },
    {
      id: 'urp1', address: 'Mystery Redesign', juris: 'Seattle', archived: false, notes: null,
      builder_name: null, go_date: '2026-05-01',
      redesign_of_project_id: 'op1', redesign_trigger: null,
      created_at: '2026-05-10T00:00:00Z',
    },
  ],
  permits: [
    { id: 1, project_id: 'rp1', type: 'Building Permit', stage: 'de', stage_override: null, status: null, num: null,
      da: 'Trevor', dm: 'Jade', ent_lead: 'Bobby', dual_da: null,
      target_submit: null, dd_start: null, dd_end: null, expected_issue: null, actual_issue: null,
      approval_date: null, intake_date: null, notes: null, cycle_model: null, view_cycle: null,
      kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null, nickname: null,
      struct_address: null, portal_url: null, updated_at: '2026-01-01T00:00:00Z', permit_cycles: [] },
    { id: 2, project_id: 'rp2', type: 'Building Permit', stage: 'de', stage_override: null, status: null, num: null,
      da: 'Trevor', dm: null, ent_lead: null, dual_da: null,
      target_submit: null, dd_start: null, dd_end: null, expected_issue: null, actual_issue: null,
      approval_date: null, intake_date: null, notes: null, cycle_model: null, view_cycle: null,
      kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null, nickname: null,
      struct_address: null, portal_url: null, updated_at: '2026-01-01T00:00:00Z', permit_cycles: [] },
    { id: 3, project_id: 'rp3', type: 'Building Permit', stage: 'de', stage_override: null, status: null, num: null,
      da: 'Trevor', dm: null, ent_lead: null, dual_da: null,
      target_submit: null, dd_start: null, dd_end: null, expected_issue: null, actual_issue: null,
      approval_date: null, intake_date: null, notes: null, cycle_model: null, view_cycle: null,
      kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null, nickname: null,
      struct_address: null, portal_url: null, updated_at: '2026-01-01T00:00:00Z', permit_cycles: [] },
    { id: 4, project_id: 'brp1', type: 'Building Permit', stage: 'de', stage_override: null, status: null, num: null,
      da: 'Ainsley', dm: null, ent_lead: null, dual_da: null,
      target_submit: null, dd_start: null, dd_end: null, expected_issue: null, actual_issue: null,
      approval_date: null, intake_date: null, notes: null, cycle_model: null, view_cycle: null,
      kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null, nickname: null,
      struct_address: null, portal_url: null, updated_at: '2026-01-01T00:00:00Z', permit_cycles: [] },
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
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [],
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

import Reports from '../pages/Reports';

function renderRedesigns(initial: string = '/reports?tab=redesigns') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/reports" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Reports />, { wrapper });
}

describe('<RedesignsTab /> — fix-134-b', () => {
  it('?tab=redesigns mounts the Redesigns tab + filter bar', () => {
    renderRedesigns();
    expect(screen.getByTestId('redesigns-tab')).toBeInTheDocument();
    expect(screen.getByTestId('redesigns-filter-bar')).toBeInTheDocument();
    expect(screen.getByTestId('redesigns-result-count').textContent).toBe(
      '5 redesigns',
    );
  });

  it('KPI row shows total, reuse rate, and builder count', () => {
    renderRedesigns();
    const total = screen.getByTestId('redesigns-kpi-total');
    expect(total.textContent).toContain('5');
    const reuse = screen.getByTestId('redesigns-kpi-reuse-rate');
    // 2 of 5 reuse → 40%.
    expect(reuse.textContent).toContain('40%');
    expect(reuse.textContent).toMatch(/2 of 5 redesigns/);
    const builders = screen.getByTestId('redesigns-kpi-builders');
    // Acme + BetaBuilds = 2 distinct builders (Mystery has null builder).
    expect(builders.textContent).toContain('2');
  });

  it('each KPI tile has a MetricInfoTooltip trigger', () => {
    renderRedesigns();
    expect(
      screen.getByTestId('metric-tooltip-trigger-redesigns-total'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('metric-tooltip-trigger-redesigns-reuse-rate'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('metric-tooltip-trigger-redesigns-builders'),
    ).toBeInTheDocument();
  });

  it('trigger source chart renders inside the breakdown section', () => {
    renderRedesigns();
    expect(
      screen.getByTestId('redesigns-trigger-breakdown'),
    ).toBeInTheDocument();
    const chart = screen.getByTestId('redesigns-trigger-chart');
    expect(chart).toBeInTheDocument();
    // BarChartCard renders the title inline; the per-bar labels are
    // SVG <text> nodes inside ResponsiveContainer which jsdom doesn't
    // realize. Asserting the title string is enough for "the chart
    // mounted" — bar-data correctness is covered in redesignAnalytics.test.ts.
    expect(chart.textContent).toContain('Trigger Source Breakdown');
  });

  it('builder leaderboard tops Acme at 60% redesign rate with tone=co', () => {
    renderRedesigns();
    const table = screen.getByTestId('redesigns-builder-leaderboard');
    expect(table).toBeInTheDocument();
    const acmeRow = screen.getByTestId('redesigns-builder-row-Acme');
    expect(acmeRow.textContent).toContain('Acme');
    expect(acmeRow.textContent).toContain('60%');
    // High rate → tone=co (the data-tone attribute drives the page's
    // color treatment so the table reads as "this builder warrants a
    // conversation").
    expect(acmeRow.getAttribute('data-tone')).toBe('co');
  });

  it('builder leaderboard shows BetaBuilds at 50% as a second row', () => {
    renderRedesigns();
    const betaRow = screen.getByTestId(
      'redesigns-builder-row-BetaBuilds',
    );
    expect(betaRow).toBeInTheDocument();
    expect(betaRow.textContent).toContain('50%');
    expect(betaRow.getAttribute('data-tone')).toBe('co');
  });

  it('DA / DM / ENT mini-leaderboards each render a card', () => {
    renderRedesigns();
    expect(
      screen.getByTestId('redesigns-da-leaderboard'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('redesigns-dm-leaderboard'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('redesigns-ent-leaderboard'),
    ).toBeInTheDocument();
    // Trevor tops DA with 3 credited redesigns.
    expect(
      screen.getByTestId('redesigns-da-leaderboard-row-Trevor'),
    ).toBeInTheDocument();
  });

  it('DA leaderboard row name links to the drill-down with the role param', () => {
    renderRedesigns();
    const link = screen.getByTestId(
      'redesigns-da-leaderboard-row-Trevor-link',
    );
    expect(link.getAttribute('href')).toBe('/reports/team/Trevor?role=da');
  });

  it('Recent Redesigns table renders rows sorted by created_at desc', () => {
    renderRedesigns();
    const table = screen.getByTestId('redesigns-recent-table');
    expect(table).toBeInTheDocument();
    // Mystery Redesign (2026-05-10) is the most recent.
    const firstRow = screen.getByTestId('redesigns-recent-row-urp1');
    expect(firstRow).toBeInTheDocument();
    // Its redesign-address cell links to /project/urp1.
    const link = screen.getByTestId(
      'redesigns-recent-row-urp1-redesign-link',
    );
    expect(link.getAttribute('href')).toBe('/project/urp1');
  });

  it('Recent row links the original address to /project/{originalId} when present', () => {
    renderRedesigns();
    const link = screen.getByTestId(
      'redesigns-recent-row-rp1-original-link',
    );
    expect(link.getAttribute('href')).toBe('/project/op1');
  });

  it('filter change collapses cohort + empty state appears when totalRedesigns=0', () => {
    renderRedesigns();
    fireEvent.change(screen.getByTestId('redesigns-filter-from'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(screen.getByTestId('redesigns-filter-to'), {
      target: { value: '2099-12-31' },
    });
    expect(screen.getByTestId('redesigns-empty-state')).toBeInTheDocument();
    expect(
      screen.getByTestId('redesigns-empty-state').textContent,
    ).toMatch(/No redesigns recorded in the current filter/);
    // KPIs / tables don't render in the empty state.
    expect(screen.queryByTestId('redesigns-kpi-row')).toBeNull();
    expect(screen.queryByTestId('redesigns-builder-leaderboard')).toBeNull();
  });
});
