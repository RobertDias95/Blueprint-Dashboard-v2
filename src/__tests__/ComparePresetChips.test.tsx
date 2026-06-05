import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ComparePresetChips from '../components/shared/ComparePresetChips';

// fix-124-b: standalone component tests for the chip row. Pin the
// callback shape (range + 'previous_period') + the active-highlight
// matrix without going through Trends / Reports/Overview parents.

function todayAt(y: number, m1: number, d: number): Date {
  return new Date(Date.UTC(y, m1 - 1, d, 12, 0, 0));
}

describe('<ComparePresetChips /> — fix-124-b', () => {
  const today = todayAt(2026, 6, 5);

  it('renders all 6 preset chips', () => {
    const onApply = vi.fn();
    render(
      <ComparePresetChips
        currentRange={null}
        compareTo="off"
        today={today}
        onApply={onApply}
      />,
    );
    expect(screen.getByTestId('compare-preset-this_month_vs_last')).toBeInTheDocument();
    expect(screen.getByTestId('compare-preset-this_quarter_vs_last')).toBeInTheDocument();
    expect(screen.getByTestId('compare-preset-this_year_vs_last')).toBeInTheDocument();
    expect(screen.getByTestId('compare-preset-last_30d_vs_prior')).toBeInTheDocument();
    expect(screen.getByTestId('compare-preset-last_60d_vs_prior')).toBeInTheDocument();
    expect(screen.getByTestId('compare-preset-last_90d_vs_prior')).toBeInTheDocument();
  });

  it('clicking "This quarter vs last" fires onApply with Q2 2026 range + previous_period', () => {
    const onApply = vi.fn();
    render(
      <ComparePresetChips
        currentRange={null}
        compareTo="off"
        today={today}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByTestId('compare-preset-this_quarter_vs_last'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      { from: '2026-04-01', to: '2026-06-30' },
      'previous_period',
    );
  });

  it('clicking "Last 30d vs prior" fires onApply with today - 29 days range', () => {
    const onApply = vi.fn();
    render(
      <ComparePresetChips
        currentRange={null}
        compareTo="off"
        today={today}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByTestId('compare-preset-last_30d_vs_prior'));
    expect(onApply).toHaveBeenCalledWith(
      { from: '2026-05-07', to: '2026-06-05' },
      'previous_period',
    );
  });

  it('active highlight fires when current state matches a preset exactly', () => {
    render(
      <ComparePresetChips
        currentRange={{ from: '2026-04-01', to: '2026-06-30' }}
        compareTo="previous_period"
        today={today}
        onApply={vi.fn()}
      />,
    );
    const activeChip = screen.getByTestId('compare-preset-this_quarter_vs_last');
    expect(activeChip.getAttribute('data-active')).toBe('true');
    // Other chips are NOT active.
    expect(
      screen.getByTestId('compare-preset-this_month_vs_last').getAttribute('data-active'),
    ).toBe('false');
    expect(
      screen.getByTestId('compare-preset-last_30d_vs_prior').getAttribute('data-active'),
    ).toBe('false');
  });

  it('no chip is active when compareTo is off (highlight requires previous_period)', () => {
    render(
      <ComparePresetChips
        currentRange={{ from: '2026-04-01', to: '2026-06-30' }}
        compareTo="off"
        today={today}
        onApply={vi.fn()}
      />,
    );
    for (const preset of [
      'this_month_vs_last',
      'this_quarter_vs_last',
      'this_year_vs_last',
      'last_30d_vs_prior',
      'last_60d_vs_prior',
      'last_90d_vs_prior',
    ]) {
      expect(
        screen.getByTestId(`compare-preset-${preset}`).getAttribute('data-active'),
      ).toBe('false');
    }
  });

  it('no chip is active on a custom slice that matches no preset', () => {
    render(
      <ComparePresetChips
        currentRange={{ from: '2026-04-02', to: '2026-06-30' }}
        compareTo="previous_period"
        today={today}
        onApply={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId('compare-preset-this_quarter_vs_last').getAttribute('data-active'),
    ).toBe('false');
  });

  it('active chip carries the v1-style filled treatment (de bg + white text)', () => {
    render(
      <ComparePresetChips
        currentRange={{ from: '2026-04-01', to: '2026-06-30' }}
        compareTo="previous_period"
        today={today}
        onApply={vi.fn()}
      />,
    );
    const active = screen.getByTestId(
      'compare-preset-this_quarter_vs_last',
    ) as HTMLElement;
    expect(active.style.background).toContain('--color-de');
    expect(active.style.color).toBe('rgb(255, 255, 255)');
  });

  it('inactive chip carries the muted treatment', () => {
    render(
      <ComparePresetChips
        currentRange={null}
        compareTo="off"
        today={today}
        onApply={vi.fn()}
      />,
    );
    const inactive = screen.getByTestId(
      'compare-preset-this_quarter_vs_last',
    ) as HTMLElement;
    expect(inactive.style.background).toContain('--color-surface');
    expect(inactive.style.color).toContain('--color-muted');
  });

  it('respects a custom testIdPrefix', () => {
    render(
      <ComparePresetChips
        currentRange={null}
        compareTo="off"
        today={today}
        onApply={vi.fn()}
        testIdPrefix="reports-preset"
      />,
    );
    expect(
      screen.getByTestId('reports-preset-this_quarter_vs_last'),
    ).toBeInTheDocument();
  });
});
