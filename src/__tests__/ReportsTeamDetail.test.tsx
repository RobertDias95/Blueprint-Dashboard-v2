import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-131: per-associate drill-down page tests.
//
// Fixture: Trevor (DA) has 5 originals (8 units, 5 lots) + 2 redesigns
// (4 redesign units, 2 redesign lots), plus a mix of phase data so the
// vs-team-avg deltas have something to color. Ainsley (also DA) carries
// a sibling cohort so the team averages aren't single-row.

const T = 'test-tenant-uuid';
const FIXED_TODAY = new Date(2026, 4, 15);

const fixtures = vi.hoisted(() => ({
  projects: [
    // Trevor's 5 originals (units: 1+2+2+2+1 = 8, lots: 1+1+1+1+1 = 5)
    { id: 'tp1', address: '1 Trevor St', juris: 'Seattle', archived: false, notes: null, units: 1, num_lots: 1, go_date: '2026-01-01' },
    { id: 'tp2', address: '2 Trevor St', juris: 'Seattle', archived: false, notes: null, units: 2, num_lots: 1, go_date: '2026-02-01' },
    { id: 'tp3', address: '3 Trevor St', juris: 'Seattle', archived: false, notes: null, units: 2, num_lots: 1, go_date: '2026-03-01' },
    { id: 'tp4', address: '4 Trevor St', juris: 'Seattle', archived: false, notes: null, units: 2, num_lots: 1, go_date: '2026-04-01' },
    { id: 'tp5', address: '5 Trevor St', juris: 'Seattle', archived: false, notes: null, units: 1, num_lots: 1, go_date: '2026-05-01' },
    // 2 redesigns of tp1 and tp2 (units: 2+2 = 4, lots: 1+1 = 2)
    { id: 'tr1', address: '1 Trevor St [Redesign 1]', juris: 'Seattle', archived: false, notes: null, units: 2, num_lots: 1, go_date: '2026-05-10', redesign_of_project_id: 'tp1' },
    { id: 'tr2', address: '2 Trevor St [Redesign 1]', juris: 'Seattle', archived: false, notes: null, units: 2, num_lots: 1, go_date: '2026-05-15', redesign_of_project_id: 'tp2' },
    // Ainsley's single project — pads the team avg so deltas register.
    { id: 'ap1', address: 'Ainsley Way', juris: 'Bellevue', archived: false, notes: null, units: 3, num_lots: 1, go_date: '2026-02-15' },
  ],
  // Each project carries a BP permit. Trevor's DD-day pattern: 30/30/30/30/30
  // → avg 30d. Ainsley's: 10d → avg 10d. Team avg = (30+10)/2 = 20d.
  // → Trevor's 30d is above team avg (slower = bad). Ainsley's 10d is below
  // (faster = good).
  permits: [
    ...['tp1','tp2','tp3','tp4','tp5'].map((id, i) => ({
      id: 100 + i,
      project_id: id,
      type: 'Building Permit',
      stage: 'is',
      stage_override: null,
      status: null,
      num: null,
      da: 'Trevor',
      dm: null,
      ent_lead: null,
      dual_da: null,
      target_submit: '2026-06-01',
      dd_start: '2026-04-01',
      dd_end: '2026-05-01', // 30d
      expected_issue: null,
      actual_issue: null,
      approval_date: '2026-05-30',
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
      updated_at: '2026-05-09T12:00:00Z',
      permit_cycles: [],
    })),
    ...['tr1','tr2'].map((id, i) => ({
      id: 200 + i,
      project_id: id,
      type: 'Demolition',
      stage: 'is',
      stage_override: null,
      status: null,
      num: null,
      da: 'Trevor',
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
      updated_at: '2026-05-09T12:00:00Z',
      permit_cycles: [],
    })),
    // Ainsley's BP: DD = 10d.
    {
      id: 300,
      project_id: 'ap1',
      type: 'Building Permit',
      stage: 'is',
      stage_override: null,
      status: null,
      num: null,
      da: 'Ainsley',
      dm: null,
      ent_lead: null,
      dual_da: null,
      target_submit: '2026-05-01',
      dd_start: '2026-03-01',
      dd_end: '2026-03-11', // 10d
      expected_issue: null,
      actual_issue: null,
      approval_date: '2026-04-15',
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
      updated_at: '2026-05-09T12:00:00Z',
      permit_cycles: [],
    },
  ],
  team: [
    { id: 'tm-trevor', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 'tm-ainsley', name: 'Ainsley', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 'tm-bobby1', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 'tm-bobby2', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
    { id: 'tm-cam', name: 'Cam', role: 'da', active: false, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null },
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

import ReportsTeamDetail from '../pages/ReportsTeamDetail';

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports/team/:name" element={<>{children}</>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ReportsTeamDetail />, { wrapper });
}

describe('<ReportsTeamDetail /> fix-131', () => {
  it('renders the page skeleton — back link, name, role, active status', () => {
    renderAt('/reports/team/Trevor?role=da');
    expect(screen.getByTestId('team-detail-page')).toBeInTheDocument();
    expect(screen.getByTestId('team-detail-back')).toBeInTheDocument();
    expect(screen.getByTestId('team-detail-name').textContent).toBe('Trevor');
    expect(screen.getByTestId('team-detail-role').textContent).toMatch(
      /Design Associate/i,
    );
    expect(
      screen.getByTestId('team-detail-active-status').textContent,
    ).toMatch(/Active/i);
  });

  it('URL-encoded name in the path decodes correctly', () => {
    renderAt('/reports/team/Trevor%20Smith?role=da');
    // No "Trevor Smith" associate exists → not-found state surfaces
    // with the DECODED name (not the URL-encoded one).
    expect(screen.queryByTestId('team-detail-name')).toBeNull();
    expect(
      screen.getByTestId('team-detail-not-found').textContent,
    ).toContain('Trevor Smith');
  });

  it('ENT role chip + Bobby active status', () => {
    renderAt('/reports/team/Bobby?role=ent');
    expect(screen.getByTestId('team-detail-role').textContent).toMatch(
      /Entitlement Lead/i,
    );
    expect(
      screen.getByTestId('team-detail-active-status').textContent,
    ).toMatch(/Active/i);
  });

  it('not-found state fires when the associate is missing from the roster', () => {
    renderAt('/reports/team/NobodyKnowsThisName?role=da');
    expect(screen.getByTestId('team-detail-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('team-detail-volume')).toBeNull();
    expect(screen.queryByTestId('team-detail-phase')).toBeNull();
  });

  // ============================================================
  // 131-b: volume summary
  // ============================================================
  describe('Volume summary', () => {
    it('Originals row shows 5 projects, 8 units, 5 lots, 5 permits for Trevor', () => {
      renderAt('/reports/team/Trevor?role=da');
      expect(
        screen.getByTestId('team-detail-volume-projects').textContent,
      ).toContain('5');
      expect(
        screen.getByTestId('team-detail-volume-units').textContent,
      ).toContain('8');
      expect(
        screen.getByTestId('team-detail-volume-lots').textContent,
      ).toContain('5');
      expect(
        screen.getByTestId('team-detail-volume-permits').textContent,
      ).toContain('5');
    });

    it('Redesigns row appears with the right counts (2 projects, 4 units, 2 lots)', () => {
      renderAt('/reports/team/Trevor?role=da');
      expect(
        screen.getByTestId('team-detail-volume-redesign-projects').textContent,
      ).toContain('2');
      expect(
        screen.getByTestId('team-detail-volume-redesign-units').textContent,
      ).toContain('4');
      expect(
        screen.getByTestId('team-detail-volume-redesign-lots').textContent,
      ).toContain('2');
    });

    it('Originals card subtext encodes the combined total when redesigns exist', () => {
      renderAt('/reports/team/Trevor?role=da');
      // Trevor: 5 originals + 2 redesigns = 7 total.
      expect(
        screen.getByTestId('team-detail-volume-projects').textContent,
      ).toContain('+2 redesigns = 7 total');
    });

    it('Redesigns row is hidden when none exist (Ainsley)', () => {
      renderAt('/reports/team/Ainsley?role=da');
      expect(
        screen.queryByTestId('team-detail-volume-redesign-projects'),
      ).toBeNull();
      // Originals card has no subtext line either.
      const projectsCard = screen.getByTestId('team-detail-volume-projects');
      expect(projectsCard.textContent).not.toMatch(/redesigns =/);
    });
  });

  // ============================================================
  // 131-c: phase performance + vs-team-avg deltas
  // ============================================================
  describe('Phase performance', () => {
    it('renders the four phase cards with tooltips', () => {
      renderAt('/reports/team/Trevor?role=da');
      expect(screen.getByTestId('team-detail-phase-dd')).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-phase-city-review'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-phase-corrections'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-phase-issuance'),
      ).toBeInTheDocument();
      // MetricInfoTooltip trigger inside the DD card.
      expect(
        screen.getByTestId('metric-tooltip-trigger-team-avgDdDays'),
      ).toBeInTheDocument();
    });

    it('Trevor DD avg 30d vs team avg 20d → tone=bad (slower = red)', () => {
      renderAt('/reports/team/Trevor?role=da');
      const dd = screen.getByTestId('team-detail-phase-dd');
      expect(dd.getAttribute('data-tone')).toBe('bad');
      expect(dd.textContent).toContain('30');
      expect(dd.textContent).toMatch(/Team avg: 20/);
      // Delta strip: +10d, up arrow.
      expect(
        screen.getByTestId('team-detail-phase-dd-delta').textContent,
      ).toMatch(/↑.*\+10/);
    });

    it('Ainsley DD avg 10d vs team avg 20d → tone=good (faster = green)', () => {
      renderAt('/reports/team/Ainsley?role=da');
      const dd = screen.getByTestId('team-detail-phase-dd');
      expect(dd.getAttribute('data-tone')).toBe('good');
      expect(dd.textContent).toContain('10');
      expect(
        screen.getByTestId('team-detail-phase-dd-delta').textContent,
      ).toMatch(/↓.*-10/);
    });

    it('null phase value renders "Not enough data" with tone=neutral', () => {
      // Bobby has no permits at all → Issuance avg = null.
      renderAt('/reports/team/Bobby?role=ent');
      // Bobby is in the roster but has no credited permits → associate is
      // null + no Volume / Phase cards render. The "no permits in window"
      // affordance fires instead.
      expect(
        screen.getByTestId('team-detail-no-permits'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('team-detail-phase')).toBeNull();
    });
  });

  // ============================================================
  // 131-d: project list
  // ============================================================
  describe('Project list', () => {
    it("Trevor's list shows 7 project rows (5 originals + 2 redesigns)", () => {
      renderAt('/reports/team/Trevor?role=da');
      const list = screen.getByTestId('team-detail-project-list');
      expect(list).toBeInTheDocument();
      // 5 originals + 2 redesigns = 7 rows.
      expect(
        list.querySelectorAll('tr[data-testid^="team-detail-project-row-"]'),
      ).toHaveLength(7);
    });

    it('Redesign chip appears on redesign rows only', () => {
      renderAt('/reports/team/Trevor?role=da');
      // Redesign rows tr1 + tr2 carry the chip.
      expect(
        screen.getByTestId('team-detail-project-row-tr1-redesign-chip'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-project-row-tr2-redesign-chip'),
      ).toBeInTheDocument();
      // Original rows do NOT.
      expect(
        screen.queryByTestId('team-detail-project-row-tp1-redesign-chip'),
      ).toBeNull();
    });

    it('address is a link to /project/{id}', () => {
      renderAt('/reports/team/Trevor?role=da');
      const row = screen.getByTestId('team-detail-project-row-tp1');
      const link = row.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/project/tp1');
    });

    it('default sort is goDate desc (most recent first)', () => {
      renderAt('/reports/team/Trevor?role=da');
      const rows = Array.from(
        document.querySelectorAll(
          'tr[data-testid^="team-detail-project-row-"]',
        ),
      ).map((el) => el.getAttribute('data-testid'));
      // GO dates: tr2=2026-05-15, tr1=2026-05-10, tp5=2026-05-01,
      // tp4=2026-04-01, tp3=2026-03-01, tp2=2026-02-01, tp1=2026-01-01.
      expect(rows[0]).toBe('team-detail-project-row-tr2');
      expect(rows[1]).toBe('team-detail-project-row-tr1');
      expect(rows[6]).toBe('team-detail-project-row-tp1');
    });

    it('clicking a column header toggles the sort direction', () => {
      renderAt('/reports/team/Trevor?role=da');
      // Click address → asc.
      fireEvent.click(screen.getByTestId('team-detail-project-th-address'));
      const rowsAsc = Array.from(
        document.querySelectorAll(
          'tr[data-testid^="team-detail-project-row-"]',
        ),
      ).map((el) => el.getAttribute('data-testid'));
      // Addresses sort alphabetically: "1 Trevor St" first, "1 Trevor St [Redesign 1]" next, ...
      expect(rowsAsc[0]).toBe('team-detail-project-row-tp1');
    });

    it('empty state for an associate with no credited projects', () => {
      // Cam is inactive and has no permits — exercises the empty-state
      // path (associate row exists via the roster, but no projects).
      renderAt('/reports/team/Cam?role=da');
      expect(screen.getByTestId('team-detail-project-list').textContent).toMatch(
        /Cam has no projects in the system/,
      );
    });
  });

  // ============================================================
  // 132-b: phase trend charts
  // ============================================================
  describe('PhaseTrends', () => {
    it('renders the section header with the range tablist + all 4 chart cards', () => {
      renderAt('/reports/team/Trevor?role=da');
      expect(
        screen.getByTestId('team-detail-phase-trends'),
      ).toBeInTheDocument();
      // Range tablist with 4 options.
      expect(
        screen.getByTestId('team-detail-trend-range-3'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-trend-range-6'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-trend-range-12'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-trend-range-24'),
      ).toBeInTheDocument();
      // 4 chart cards.
      expect(
        screen.getByTestId('team-detail-trend-dd'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-trend-city-review'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-trend-corrections'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-trend-issuance'),
      ).toBeInTheDocument();
    });

    it('default range = 6 months (only one tab is active)', () => {
      renderAt('/reports/team/Trevor?role=da');
      expect(
        screen
          .getByTestId('team-detail-trend-range-6')
          .getAttribute('data-active'),
      ).toBe('true');
      expect(
        screen
          .getByTestId('team-detail-trend-range-3')
          .getAttribute('data-active'),
      ).toBe('false');
      expect(
        screen
          .getByTestId('team-detail-trend-range-12')
          .getAttribute('data-active'),
      ).toBe('false');
      expect(
        screen
          .getByTestId('team-detail-trend-range-24')
          .getAttribute('data-active'),
      ).toBe('false');
    });

    it('clicking a range button swaps the active selection', () => {
      renderAt('/reports/team/Trevor?role=da');
      fireEvent.click(screen.getByTestId('team-detail-trend-range-12'));
      expect(
        screen
          .getByTestId('team-detail-trend-range-12')
          .getAttribute('data-active'),
      ).toBe('true');
      expect(
        screen
          .getByTestId('team-detail-trend-range-6')
          .getAttribute('data-active'),
      ).toBe('false');
    });

    it('all 4 charts carry a MetricInfoTooltip for the metric header', () => {
      renderAt('/reports/team/Trevor?role=da');
      // Tooltip triggers live inside each chart card. Slugs derived
      // from `team-trend-${metricKey}` (see TrendChart).
      expect(
        screen.getByTestId('metric-tooltip-trigger-team-trend-avgDdDays'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          'metric-tooltip-trigger-team-trend-avgCityReviewDays',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          'metric-tooltip-trigger-team-trend-avgCorrectionsCycles',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          'metric-tooltip-trigger-team-trend-avgIssuanceDays',
        ),
      ).toBeInTheDocument();
    });

    it('empty state fires on phases where the associate has no data', () => {
      // Trevor's redesign permits (tr1, tr2) have no DD endpoints. His
      // BPs do (avg 30d), so DD has data → no empty state. But Issuance:
      // Trevor's BPs have approval_date set but no actual_issue → no
      // issuance data points anywhere → empty.
      renderAt('/reports/team/Trevor?role=da');
      expect(
        screen.getByTestId('team-detail-trend-issuance-empty'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('team-detail-trend-issuance-empty').textContent,
      ).toMatch(/Not enough data in the 6 month window/);
    });

    it('snapshot phase cards + project list still render alongside the trends (additive)', () => {
      renderAt('/reports/team/Trevor?role=da');
      // 131-c snapshot still present.
      expect(screen.getByTestId('team-detail-phase-dd')).toBeInTheDocument();
      // 131-d project list still present.
      expect(
        screen.getByTestId('team-detail-project-list'),
      ).toBeInTheDocument();
      // 132-b trends sandwiched in between.
      expect(
        screen.getByTestId('team-detail-phase-trends'),
      ).toBeInTheDocument();
    });
  });

  // ============================================================
  // fix-135-b: Export CSV button on the drill-down page
  // ============================================================
  describe('Export CSV button (fix-135-b)', () => {
    let createObjectURLSpy: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.spyOn>;
    let aHrefSpy: ReturnType<typeof vi.spyOn>;
    let aDownloadSpy: ReturnType<typeof vi.spyOn>;
    let capturedDownload = '';

    beforeEach(() => {
      capturedDownload = '';
      createObjectURLSpy = vi.fn(() => 'blob:fake-url');
      (URL as unknown as { createObjectURL: typeof URL.createObjectURL }).createObjectURL =
        createObjectURLSpy as unknown as typeof URL.createObjectURL;
      (URL as unknown as { revokeObjectURL: typeof URL.revokeObjectURL }).revokeObjectURL =
        vi.fn() as unknown as typeof URL.revokeObjectURL;
      clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      aHrefSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'href', 'set')
        .mockImplementation(() => {});
      aDownloadSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'download', 'set')
        .mockImplementation(function (this: HTMLAnchorElement, v: string) {
          capturedDownload = v;
        });
    });
    afterEach(() => {
      clickSpy.mockRestore();
      aHrefSpy.mockRestore();
      aDownloadSpy.mockRestore();
    });

    it('renders the Export CSV button next to the back link', () => {
      renderAt('/reports/team/Trevor?role=da');
      const btn = screen.getByTestId('team-detail-export-csv-button');
      expect(btn).toBeInTheDocument();
      expect(btn.textContent).toContain('Export CSV');
      // Trevor has 7 projects in this fixture → enabled.
      expect(btn.getAttribute('data-disabled')).toBe('false');
    });

    it('clicking downloads {slug}-projects-{today}.csv', () => {
      vi.setSystemTime(new Date(2026, 5, 8));
      renderAt('/reports/team/Trevor?role=da');
      fireEvent.click(
        screen.getByTestId('team-detail-export-csv-button'),
      );
      expect(capturedDownload).toBe('trevor-projects-2026-06-08.csv');
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    });

    it('associate with no credited projects → disabled button', () => {
      renderAt('/reports/team/Cam?role=da');
      const btn = screen.getByTestId('team-detail-export-csv-button');
      expect(btn).toBeDisabled();
      expect(btn.getAttribute('title')).toBe('Nothing to export.');
    });
  });
});
