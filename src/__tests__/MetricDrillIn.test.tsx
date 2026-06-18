import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MetricDrillIn from '../components/Reports/MetricDrillIn';
import MetricCards from '../components/Reports/MetricCards';
import type { DrillInData } from '../lib/metricDrillIn';
import type { EnrichedPermit, ReportMetrics } from '../lib/reportMetrics';

// fix-184a: the generalized drill-in modal + the MetricCards click wiring.

function row(over: Partial<DrillInData['rows'][number]>) {
  return {
    permitId: 1, projectId: 'p1', num: 'BP-1', address: '500 Pike St',
    juris: 'Seattle', type: 'Building Permit', lead: 'Miles', value: 5,
    dates: [{ label: 'Submitted', date: '2026-03-10' }], secondary: null, ...over,
  };
}

function renderModal(data: DrillInData, filterContext?: string) {
  return render(
    <MemoryRouter>
      <MetricDrillIn data={data} filterContext={filterContext} onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('<MetricDrillIn /> value metric', () => {
  const data: DrillInData = {
    key: 'avgSubmitToIntake', label: 'Avg Submit → Intake', unit: 'd', isCount: false,
    rows: [
      row({ permitId: 1, address: 'A St', value: 3 }),
      row({ permitId: 2, address: 'B St', value: 16 }),
      row({ permitId: 3, address: 'C St', value: 9 }),
    ],
    n: 3, stats: { min: 3, median: 9, max: 16 },
  };

  it('sorts by value DESCENDING by default (outliers first)', () => {
    renderModal(data, 'Seattle');
    const ids = screen.getAllByTestId(/^metric-drillin-row-/).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual([
      'metric-drillin-row-2', // 16
      'metric-drillin-row-3', // 9
      'metric-drillin-row-1', // 3
    ]);
  });

  it('toggles to ascending', () => {
    renderModal(data);
    fireEvent.click(screen.getByTestId('metric-drillin-sort'));
    const ids = screen.getAllByTestId(/^metric-drillin-row-/).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['metric-drillin-row-1', 'metric-drillin-row-3', 'metric-drillin-row-2']);
  });

  it('renders the value+unit, min/median/max/n footer, and filter context in the header', () => {
    renderModal(data, 'Seattle · Building Permit');
    expect(screen.getByTestId('metric-drillin-value-2').textContent).toBe('16d');
    expect(screen.getByTestId('metric-drillin-stats').textContent).toContain('min 3d');
    expect(screen.getByTestId('metric-drillin-stats').textContent).toContain('median 9d');
    expect(screen.getByTestId('metric-drillin-stats').textContent).toContain('max 16d');
    expect(screen.getByTestId('metric-drillin-count').textContent).toContain('3 permits');
    expect(screen.getByTestId('metric-drillin-modal').textContent).toContain('Seattle · Building Permit');
  });

  it('links each row to /project/:id?permit=:permitId', () => {
    renderModal(data);
    expect(screen.getByTestId('metric-drillin-row-2').getAttribute('href')).toBe(
      '/project/p1?permit=2',
    );
  });
});

describe('<MetricDrillIn /> count-only metric', () => {
  const data: DrillInData = {
    key: 'totalPermits', label: 'Total Permits', unit: '', isCount: true,
    rows: [
      row({ permitId: 1, address: 'Zeta', value: null, secondary: 'de' }),
      row({ permitId: 2, address: 'Alpha', value: null, secondary: 'Issued' }),
    ],
    n: 2, stats: null,
  };

  it('renders no value column and no stats footer; sorts by address', () => {
    renderModal(data);
    expect(screen.queryByTestId('metric-drillin-value-1')).toBeNull();
    expect(screen.queryByTestId('metric-drillin-stats')).toBeNull();
    expect(screen.queryByTestId('metric-drillin-sort')).toBeNull();
    const ids = screen.getAllByTestId(/^metric-drillin-row-/).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['metric-drillin-row-2', 'metric-drillin-row-1']); // Alpha, Zeta
    expect(screen.getByTestId('metric-drillin-count').textContent).toContain('2 permits');
  });
});

// --- click wiring through MetricCards ---------------------------------------

const ZERO_METRICS: ReportMetrics = {
  totalPermits: 1, totalUnits: 4, avgSubmitVariance: null, onTimeSubmits: 0,
  lateSubmits: 0, avgGoToSubmit: 12, avgGoToDDStart: null, avgCityReview: null,
  avgPermitTimeline: null, avgResponseTime: null, avgSubmitToIntake: null,
  avgApprovalToIssue: null, avgCorrectionCycles: null, permitsWithCorrections: 0,
  inCorrections: 0, issuedCount: 0, avgScheduleVariance: null, avgDDDuration: null,
  avgDDEndToSubmit: null,
};

function enrichedFixture(): EnrichedPermit[] {
  const base = {
    address: '500 Pike St', juris: 'Seattle', productTypes: [], projectTags: [],
    goDate: '2026-01-01', units: 4, firstSubmitted: '2026-03-10',
    firstIntakeAccepted: null, goToSubmit: 68, goToDDStart: null, ddDuration: null,
    ddEndToSubmit: null, submitToIntake: null, approvalToIssue: null,
    permitTimelineDays: null, corrResponseDays: null, variance: null,
  };
  return [
    {
      ...base,
      permit: {
        id: 1, project_id: 'p1', type: 'Building Permit', num: 'BP-1',
        ent_lead: 'Miles', da: 'Trevor', status: 'Reviews In Process',
        permit_cycles: [],
      } as unknown as EnrichedPermit['permit'],
    },
  ];
}

describe('MetricCards drill wiring', () => {
  it('clicking a Phase A card opens the drill-in modal with the cohort rows', () => {
    render(
      <MemoryRouter>
        <MetricCards metrics={ZERO_METRICS} enriched={enrichedFixture()} filterContext="Seattle" />
      </MemoryRouter>,
    );
    // No modal initially.
    expect(screen.queryByTestId('metric-drillin-modal')).toBeNull();
    // Avg GO → Submit (goToSubmit=68 on the one permit) → drill.
    fireEvent.click(screen.getByTestId('metric-go-to-submit'));
    const modal = screen.getByTestId('metric-drillin-modal');
    expect(within(modal).getByTestId('metric-drillin-row-1')).toBeInTheDocument();
    expect(within(modal).getByTestId('metric-drillin-value-1').textContent).toBe('68d');
  });

  it('does NOT make cards clickable when no population is supplied (back-compat)', () => {
    render(
      <MemoryRouter>
        <MetricCards metrics={ZERO_METRICS} />
      </MemoryRouter>,
    );
    const card = screen.getByTestId('metric-go-to-submit');
    expect(card.getAttribute('role')).toBeNull();
    fireEvent.click(card);
    expect(screen.queryByTestId('metric-drillin-modal')).toBeNull();
  });

  it('does not add drill onClick to the timeline tiles (Phase B) — they keep aria-expanded', () => {
    render(
      <MemoryRouter>
        <MetricCards
          metrics={ZERO_METRICS}
          enriched={enrichedFixture()}
          onTimelineTileClick={vi.fn()}
          drawerOpen={false}
        />
      </MemoryRouter>,
    );
    // City Review tile is a toggle (aria-expanded set), not a drill trigger.
    expect(screen.getByTestId('metric-city-review').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByTestId('metric-city-review'));
    expect(screen.queryByTestId('metric-drillin-modal')).toBeNull();
  });
});
