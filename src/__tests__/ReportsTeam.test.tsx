import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-127: Team tab on Reports. Per-associate volume + phase metrics
// for DA / DM / ENT, with vs-team-avg color treatment on the phase
// cells. These tests use ?tab=team to drop the user directly on the
// Team tab so the Reports tab nav doesn't have to be navigated each
// time. Recharts stub matches the Reports.test.tsx pattern (Team tab
// renders no charts in v1 but the surrounding tabs do).

const T = 'test-tenant-uuid';
const FIXED_TODAY = new Date(2026, 4, 15); // 2026-05-15

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

// Trevor: 2 originals (p1, p2) + 1 redesign (p3).
//   DD days: 10, 20, 30 → with redesigns avg=20, without avg=15
//   City review days (approval - intake_accepted): only p1 (151d) and p2 (134d)
// Ainsley: 1 original (p4). DD 5d.
// Cam: inactive DA, 1 original (p5). DD 7d.
// Bobby: ENT credited on p1's permit. Jade: DM (no permits — empty state path).
const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'p1',
      address: '1 Main',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 4,
      num_lots: 1,
      go_date: '2026-02-01',
    },
    {
      id: 'p2',
      address: '2 Main',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 2,
      num_lots: 1,
      go_date: '2026-03-01',
    },
    {
      id: 'p3',
      address: '3 Main',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 6,
      num_lots: 2,
      go_date: '2026-04-01',
      redesign_of_project_id: 'p1',
    },
    {
      id: 'p4',
      address: '4 Main',
      juris: 'Bellevue',
      archived: false,
      notes: null,
      units: 3,
      num_lots: 1,
      go_date: '2026-02-15',
    },
    {
      id: 'p5',
      address: '5 Main',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 2,
      num_lots: 1,
      go_date: '2026-02-20',
    },
  ],
  permits: [
    // Trevor original 1: DD 10d, city review 151d, corr_rounds 2.
    {
      id: 1,
      project_id: 'p1',
      type: 'Building Permit',
      stage: 'is',
      stage_override: null,
      status: null,
      num: null,
      da: 'Trevor',
      dm: 'Jade',
      ent_lead: 'Bobby',
      dual_da: null,
      target_submit: null,
      dd_start: '2026-02-01',
      dd_end: '2026-02-11',
      expected_issue: null,
      actual_issue: '2026-06-15',
      approval_date: '2026-06-01',
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
      updated_at: '2026-01-01T00:00:00Z',
      permit_cycles: [
        {
          id: 'c0-1',
          permit_id: 1,
          cycle_index: 0,
          submitted: null,
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: '2026-01-01', // approval 2026-06-01 → 151d
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    },
    // Trevor original 2: DD 20d, city review 134d, corr_rounds 4.
    {
      id: 2,
      project_id: 'p2',
      type: 'Building Permit',
      stage: 'is',
      stage_override: null,
      status: null,
      num: null,
      da: 'Trevor',
      dm: null,
      ent_lead: null,
      dual_da: null,
      target_submit: null,
      dd_start: '2026-03-01',
      dd_end: '2026-03-21',
      expected_issue: null,
      actual_issue: null,
      approval_date: '2026-06-15',
      intake_date: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      corr_rounds: 4,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-01-01T00:00:00Z',
      permit_cycles: [
        {
          id: 'c0-2',
          permit_id: 2,
          cycle_index: 0,
          submitted: null,
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: '2026-02-01',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    },
    // Trevor's redesign permit: DD 30d. Pushes Trevor's DD avg from 15d
    // (originals only) to 20d (with redesign). Drives the
    // include-redesigns toggle test.
    {
      id: 3,
      project_id: 'p3',
      type: 'Building Permit',
      stage: 'is',
      stage_override: null,
      status: null,
      num: null,
      da: 'Trevor',
      dm: null,
      ent_lead: null,
      dual_da: null,
      target_submit: null,
      dd_start: '2026-04-01',
      dd_end: '2026-05-01',
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
    },
    // Ainsley: DD 5d, no other phase data.
    {
      id: 4,
      project_id: 'p4',
      type: 'Building Permit',
      stage: 'is',
      stage_override: null,
      status: null,
      num: null,
      da: 'Ainsley',
      dm: null,
      ent_lead: null,
      dual_da: null,
      target_submit: null,
      dd_start: '2026-02-15',
      dd_end: '2026-02-20',
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      corr_rounds: 1,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-01-01T00:00:00Z',
      permit_cycles: [],
    },
    // Cam: inactive DA — dropped when activeOnly=true.
    {
      id: 5,
      project_id: 'p5',
      type: 'Building Permit',
      stage: 'is',
      stage_override: null,
      status: null,
      num: null,
      da: 'Cam',
      dm: null,
      ent_lead: null,
      dual_da: null,
      target_submit: null,
      dd_start: '2026-02-20',
      dd_end: '2026-02-27',
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
    },
  ],
  team: [
    { id: 't-trevor', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 't-ainsley', name: 'Ainsley', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 't-cam', name: 'Cam', role: 'da', active: false, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 't-bobby', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 't-bobby2', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 't-jade', name: 'Jade', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
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
    all: fixtures.team,
    activeDas: [],
    formerDas: [],
    dms: [],
    ents: [],
    acqs: [],
    isLoading: false,
    error: null,
    data: [],
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

function renderTeam(initial: string = '/?tab=team') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Reports />, { wrapper });
}

describe('<Reports /> Team tab — fix-127', () => {
  it('renders the Team sub-tab in the Reports tab bar', () => {
    renderTeam('/?tab=overview');
    expect(screen.getByTestId('reports-tab-team')).toBeInTheDocument();
    expect(screen.getByTestId('reports-tab-team').textContent).toContain('Team');
  });

  it('?tab=team selects the Team tab + role tabs default to Design Associates', () => {
    renderTeam();
    expect(screen.getByTestId('team-tab')).toBeInTheDocument();
    expect(screen.getByTestId('team-role-tabs')).toBeInTheDocument();
    const daTab = screen.getByTestId('team-role-tab-da');
    expect(daTab.getAttribute('data-active')).toBe('true');
    expect(daTab.getAttribute('aria-selected')).toBe('true');
    // Default DA cohort = Trevor + Ainsley (Cam filtered out by active-only).
    expect(screen.getByTestId('team-row-Trevor')).toBeInTheDocument();
    expect(screen.getByTestId('team-row-Ainsley')).toBeInTheDocument();
    expect(screen.queryByTestId('team-row-Cam')).toBeNull();
  });

  it('result count reflects the visible row count', () => {
    renderTeam();
    expect(screen.getByTestId('team-result-count').textContent).toBe(
      '2 associates',
    );
  });

  it('switching role to Entitlement Leads shows Bobby and drops the DAs', () => {
    renderTeam();
    fireEvent.click(screen.getByTestId('team-role-tab-ent'));
    expect(
      screen.getByTestId('team-role-tab-ent').getAttribute('data-active'),
    ).toBe('true');
    expect(screen.getByTestId('team-row-Bobby')).toBeInTheDocument();
    expect(screen.queryByTestId('team-row-Trevor')).toBeNull();
  });

  it('switching role to Design Managers shows Jade only if Jade has at least one credited permit', () => {
    renderTeam();
    fireEvent.click(screen.getByTestId('team-role-tab-dm'));
    // Permit 1 carries dm='Jade'.
    expect(screen.getByTestId('team-row-Jade')).toBeInTheDocument();
  });

  it('Trevor row shows originals=2, units=6, redesignProjects=1, redesignUnits=6', () => {
    // Trevor: p1 (4u) + p2 (2u) originals = 2 projects, 6 units.
    // Redesign: p3 (6u, FK→p1) = 1 redesign project, 6 redesign units.
    renderTeam();
    const trevor = screen.getByTestId('team-row-Trevor');
    expect(trevor.querySelector('[data-testid="team-cell-Trevor-projectCount"]')?.textContent).toBe('2');
    expect(trevor.querySelector('[data-testid="team-cell-Trevor-unitCount"]')?.textContent).toBe('6');
    expect(trevor.querySelector('[data-testid="team-cell-Trevor-redesignProjectCount"]')?.textContent).toBe('1');
    expect(trevor.querySelector('[data-testid="team-cell-Trevor-redesignUnitCount"]')?.textContent).toBe('6');
  });

  it('toggling active-only OFF reveals Cam with the "inactive" affordance', () => {
    renderTeam();
    expect(screen.queryByTestId('team-row-Cam')).toBeNull();
    fireEvent.click(screen.getByTestId('team-filter-active-only'));
    expect(screen.getByTestId('team-row-Cam')).toBeInTheDocument();
    expect(
      screen.getByTestId('team-row-Cam').getAttribute('data-active'),
    ).toBe('false');
    expect(screen.getByTestId('team-row-Cam-inactive')).toBeInTheDocument();
  });

  it('toggling include-redesigns OFF shrinks Trevor avgDdDays from 20d (3 permits) to 15d (originals only)', () => {
    renderTeam();
    // Default include-redesigns=true → (10+20+30)/3 = 20d.
    const cellTrue = screen.getByTestId('team-cell-Trevor-avgDdDays');
    expect(cellTrue.textContent).toContain('20d');
    // Toggle OFF.
    fireEvent.click(screen.getByTestId('team-filter-include-redesigns'));
    // Now originals only: (10+20)/2 = 15d.
    const cellFalse = screen.getByTestId('team-cell-Trevor-avgDdDays');
    expect(cellFalse.textContent).toContain('15d');
  });

  it('clicking the Projects column header flips the sort direction', () => {
    renderTeam();
    // fix-131-a added team-row-{name}-link testids for the drill-down
    // navigation. Filter to the row testids themselves (TR elements) so
    // sort-order assertions only see the row order, not the link
    // children.
    const rowOrder = () =>
      Array.from(document.querySelectorAll('tr[data-testid^="team-row-"]')).map(
        (el) => el.getAttribute('data-testid'),
      );
    // Default sort = projects desc → Trevor (2) above Ainsley (1).
    expect(rowOrder()).toEqual(['team-row-Trevor', 'team-row-Ainsley']);
    // Click → asc.
    fireEvent.click(screen.getByTestId('team-th-projectCount'));
    expect(rowOrder()).toEqual(['team-row-Ainsley', 'team-row-Trevor']);
    // Click again → back to desc.
    fireEvent.click(screen.getByTestId('team-th-projectCount'));
    expect(rowOrder()).toEqual(['team-row-Trevor', 'team-row-Ainsley']);
  });

  // fix-131-a: every Team tab row carries a Link to /reports/team/{name}?role={role}
  // so clicking the name opens the drill-down page.
  it('fix-131-a: each name cell is a Link to the drill-down route', () => {
    renderTeam();
    const trevorLink = screen.getByTestId('team-row-Trevor-link');
    expect(trevorLink.tagName).toBe('A');
    expect(trevorLink.getAttribute('href')).toBe('/reports/team/Trevor?role=da');
    const ainsleyLink = screen.getByTestId('team-row-Ainsley-link');
    expect(ainsleyLink.getAttribute('href')).toBe(
      '/reports/team/Ainsley?role=da',
    );
  });

  it('vs-team-avg coloring: associate below team avg renders data-tone="good"', () => {
    renderTeam();
    // Trevor DD avg = 20d (3 permits). Ainsley DD avg = 5d. Team avg = 12.5d.
    // Ainsley (5d) is well below team avg → "good" (faster = green).
    const ainsleyDd = screen.getByTestId('team-cell-Ainsley-avgDdDays');
    expect(ainsleyDd.getAttribute('data-tone')).toBe('good');
    expect(ainsleyDd.textContent).toContain('↓');
    // Trevor (20d) is above team avg → "bad" (slower = red).
    const trevorDd = screen.getByTestId('team-cell-Trevor-avgDdDays');
    expect(trevorDd.getAttribute('data-tone')).toBe('bad');
    expect(trevorDd.textContent).toContain('↑');
  });

  it('vs-team-avg coloring: ±5% no-signal band renders data-tone="neutral"', () => {
    // Within ±5% of team avg. With just Trevor (20d) and Ainsley (5d),
    // the band check is %. Ainsley deviates by 60% (well outside).
    // Pin the no-signal-band path by switching to ENT — Bobby is the
    // ONLY ENT row → team avg = Bobby's own → delta 0 → neutral.
    renderTeam();
    fireEvent.click(screen.getByTestId('team-role-tab-ent'));
    const bobbyCityReview = screen.getByTestId(
      'team-cell-Bobby-avgCityReviewDays',
    );
    // Bobby has one permit with city review 151d. Team avg = 151d.
    // Delta = 0 → within band → neutral.
    expect(bobbyCityReview.getAttribute('data-tone')).toBe('neutral');
    expect(bobbyCityReview.textContent).toContain('→');
  });

  it('cells with null phase data render the dim em-dash placeholder', () => {
    renderTeam();
    // Ainsley has no approval_date on her permit → city review = null.
    const ainsleyCityReview = screen.getByTestId(
      'team-cell-Ainsley-avgCityReviewDays',
    );
    expect(ainsleyCityReview.textContent).toContain('—');
  });

  it('empty state fires when no associates match the filter', () => {
    renderTeam();
    // Pick a date window that excludes every project.
    fireEvent.change(screen.getByTestId('team-filter-from'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(screen.getByTestId('team-filter-to'), {
      target: { value: '2099-12-31' },
    });
    expect(screen.getByTestId('team-empty-state')).toBeInTheDocument();
    expect(
      screen.getByTestId('team-empty-state').textContent,
    ).toMatch(/No active Design Associates in the current filter\./);
    // The table itself does NOT render in the empty state.
    expect(screen.queryByTestId('team-performance-table')).toBeNull();
  });

  it('empty state for ENT mentions "Entitlement Leads"', () => {
    renderTeam();
    fireEvent.click(screen.getByTestId('team-role-tab-ent'));
    fireEvent.change(screen.getByTestId('team-filter-from'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(screen.getByTestId('team-filter-to'), {
      target: { value: '2099-12-31' },
    });
    expect(
      screen.getByTestId('team-empty-state').textContent,
    ).toMatch(/No active Entitlement Leads in the current filter\./);
  });

  it('juris filter narrows the cohort (Bellevue → Ainsley only)', () => {
    renderTeam();
    fireEvent.change(screen.getByTestId('team-filter-juris'), {
      target: { value: 'Bellevue' },
    });
    expect(screen.queryByTestId('team-row-Trevor')).toBeNull();
    expect(screen.getByTestId('team-row-Ainsley')).toBeInTheDocument();
  });

  it('non-regression: Overview tab still renders when ?tab is omitted', () => {
    renderTeam('/');
    expect(screen.getByTestId('reports-panel-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('team-tab')).toBeNull();
  });

  it('non-regression: Trends tab still renders under ?tab=trends', () => {
    renderTeam('/?tab=trends');
    expect(screen.getByTestId('reports-panel-trends')).toBeInTheDocument();
    expect(screen.queryByTestId('team-tab')).toBeNull();
  });
});
