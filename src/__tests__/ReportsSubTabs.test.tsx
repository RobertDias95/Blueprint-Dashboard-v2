import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';

// fix-trends-subtab: the Reports page hosts Overview + Trends sub-tabs,
// driven by ?tab=. We stub both tab bodies so these tests focus purely on
// the tab bar + URL behavior (the real Overview content is covered by
// Reports.test.tsx; Trends by Trends.test.tsx).

vi.mock('../components/Reports/ReportsOverviewTab', () => ({
  default: () => <div data-testid="overview-stub">OVERVIEW</div>,
}));
vi.mock('../pages/Trends', () => ({
  default: () => <div data-testid="trends-stub">TRENDS</div>,
}));
vi.mock('../components/Reports/TeamTab', () => ({
  default: () => <div data-testid="team-stub">TEAM</div>,
}));
vi.mock('../components/Reports/RedesignsTab', () => ({
  default: () => <div data-testid="redesigns-stub">REDESIGNS</div>,
}));

import Reports from '../pages/Reports';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/reports"
          element={
            <>
              <Reports />
              <LocationProbe />
            </>
          }
        />
        {/* Mirrors the real router's legacy /trends redirect. */}
        <Route
          path="/trends"
          element={<Navigate to="/reports?tab=trends" replace />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Reports sub-tabs (fix-trends-subtab)', () => {
  it('renders both tab triggers; Overview is active by default', () => {
    renderAt('/reports');
    const overviewTab = screen.getByTestId('reports-tab-overview');
    const trendsTab = screen.getByTestId('reports-tab-trends');
    expect(overviewTab).toBeInTheDocument();
    expect(trendsTab).toBeInTheDocument();
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(trendsTab).toHaveAttribute('aria-selected', 'false');
    // Overview body shown; Trends body not mounted.
    expect(screen.getByTestId('overview-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('trends-stub')).toBeNull();
  });

  it('is a tablist with four tabs (a11y roles)', () => {
    // fix-127 added a third "Team" tab. fix-134 added a fourth
    // "Redesigns" tab. The tablist contract (role, tab count) updates
    // here; the per-tab keyboard + click flows are covered by the
    // surrounding tests + ReportsTeam.test.tsx + RedesignsTab.test.tsx.
    renderAt('/reports');
    const list = screen.getByTestId('reports-subtab-bar');
    expect(list).toHaveAttribute('role', 'tablist');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    // Order: Overview / Trends / Team / Redesigns.
    expect(screen.getByTestId('reports-tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('reports-tab-trends')).toBeInTheDocument();
    expect(screen.getByTestId('reports-tab-team')).toBeInTheDocument();
    expect(screen.getByTestId('reports-tab-redesigns')).toBeInTheDocument();
  });

  it('?tab=redesigns selects the Redesigns tab and renders its body', () => {
    renderAt('/reports?tab=redesigns');
    expect(screen.getByTestId('reports-tab-redesigns')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('redesigns-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-stub')).toBeNull();
  });

  it('clicking Redesigns updates the URL to ?tab=redesigns', () => {
    renderAt('/reports');
    fireEvent.click(screen.getByTestId('reports-tab-redesigns'));
    expect(screen.getByTestId('loc').textContent).toBe(
      '/reports?tab=redesigns',
    );
    expect(screen.getByTestId('redesigns-stub')).toBeInTheDocument();
  });

  it('clicking Trends updates the URL to ?tab=trends and shows Trends content', () => {
    renderAt('/reports');
    fireEvent.click(screen.getByTestId('reports-tab-trends'));
    expect(screen.getByTestId('loc').textContent).toBe('/reports?tab=trends');
    expect(screen.getByTestId('trends-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-stub')).toBeNull();
    expect(screen.getByTestId('reports-tab-trends')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('clicking back to Overview clears the tab param', () => {
    renderAt('/reports?tab=trends');
    expect(screen.getByTestId('trends-stub')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reports-tab-overview'));
    // Overview is the default → param dropped, URL is clean.
    expect(screen.getByTestId('loc').textContent).toBe('/reports');
    expect(screen.getByTestId('overview-stub')).toBeInTheDocument();
  });

  it('direct navigation to /reports?tab=trends opens with Trends active', () => {
    renderAt('/reports?tab=trends');
    expect(screen.getByTestId('reports-tab-trends')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('trends-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-stub')).toBeNull();
  });

  it('arrow keys move between tabs', () => {
    renderAt('/reports');
    const overviewTab = screen.getByTestId('reports-tab-overview');
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(screen.getByTestId('loc').textContent).toBe('/reports?tab=trends');
    expect(screen.getByTestId('trends-stub')).toBeInTheDocument();
  });

  it('legacy /trends redirects to /reports?tab=trends with Trends active', () => {
    renderAt('/trends');
    expect(screen.getByTestId('loc').textContent).toBe('/reports?tab=trends');
    expect(screen.getByTestId('reports-tab-trends')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('trends-stub')).toBeInTheDocument();
  });
});
