import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PhaseDurationsReport from '../pages/PhaseDurationsReport';
import type { PhaseDurationRow } from '../lib/phaseDurations';

// fix-253: the Phase Durations report. Read-only surface — it renders the
// learned city-vs-ours medians per cycle and the recent-window trend.

const state: { rows: PhaseDurationRow[]; isLoading: boolean } = {
  rows: [],
  isLoading: false,
};

vi.mock('../hooks/usePhaseDurationGrid', () => ({
  usePhaseDurationGrid: () => ({
    data: state.rows,
    isLoading: state.isLoading,
    error: null,
    refetch: () => {},
  }),
}));

function row(over: Partial<PhaseDurationRow> = {}): PhaseDurationRow {
  return {
    type: 'Building Permit',
    juris: 'Seattle',
    cycleIndex: 1,
    side: 'city',
    medianDays: 72,
    n: 81,
    minDays: 0,
    maxDays: 133,
    recentMedianDays: 75,
    recentN: 56,
    ...over,
  };
}

beforeEach(() => {
  state.isLoading = false;
  state.rows = [
    row({ side: 'city', cycleIndex: 1, medianDays: 72, n: 81, recentMedianDays: 75 }),
    row({ side: 'ours', cycleIndex: 1, medianDays: 24, n: 76, recentMedianDays: 21 }),
    row({ side: 'city', cycleIndex: 2, medianDays: 25, n: 63, recentMedianDays: 25 }),
    row({ side: 'ours', cycleIndex: 2, medianDays: 13, n: 60, recentMedianDays: 13 }),
  ];
});

describe('PhaseDurationsReport', () => {
  it('renders one row per cycle with both sides paired', () => {
    render(<PhaseDurationsReport />);
    expect(
      screen.getByTestId('phase-row-Seattle-Building Permit-1'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('phase-row-Seattle-Building Permit-2'),
    ).toBeTruthy();
  });

  it('shows the city median, our median, and n for each', () => {
    render(<PhaseDurationsReport />);
    const r1 = screen.getByTestId('phase-row-Seattle-Building Permit-1');
    expect(r1.textContent).toContain('72d');
    expect(r1.textContent).toContain('n=81');
    expect(r1.textContent).toContain('24d');
    expect(r1.textContent).toContain('n=76');
  });

  it('flags a city phase that got slower and our phase that got faster', () => {
    render(<PhaseDurationsReport />);
    const r1 = screen.getByTestId('phase-row-Seattle-Building Permit-1');
    const city = r1.querySelector('[data-testid="phase-trend-city"]');
    const ours = r1.querySelector('[data-testid="phase-trend-ours"]');
    // City 72 -> 75 = slower; ours 24 -> 21 = faster. Whose phase moved is the
    // whole question this report exists to answer.
    expect(city?.getAttribute('data-direction')).toBe('slower');
    expect(ours?.getAttribute('data-direction')).toBe('faster');
  });

  it('says "need 3" instead of a median for a thin cohort', () => {
    state.rows = [
      row({ side: 'city', cycleIndex: 3, medianDays: null, n: 2, recentMedianDays: null, recentN: 0 }),
    ];
    render(<PhaseDurationsReport />);
    expect(screen.getByTestId('phase-city-insufficient').textContent).toContain(
      'n=2',
    );
  });

  it('renders an empty state when no cohort clears the gate', () => {
    state.rows = [];
    render(<PhaseDurationsReport />);
    expect(screen.getByTestId('phase-durations-empty')).toBeTruthy();
  });

  it('offers a jurisdiction filter built from the data', () => {
    state.rows = [
      row({ juris: 'Seattle' }),
      row({ juris: 'Kirkland', medianDays: 53, n: 7 }),
    ];
    render(<PhaseDurationsReport />);
    const sel = screen.getByTestId('phase-durations-juris') as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain('Seattle');
    expect(opts).toContain('Kirkland');
  });
});
