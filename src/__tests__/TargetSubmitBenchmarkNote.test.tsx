import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TargetSubmitBenchmarkNote from '../components/ProjectDetail/TargetSubmitBenchmarkNote';
import type { TargetSubmitBenchmark } from '../lib/targetSubmitPolicy';

// fix-249: the display-only note under Target Submit. The date itself comes
// from the configured policy offset; this line reports what history says and
// marks projections. It must never imply precision it doesn't have.

const state: {
  benchmark: TargetSubmitBenchmark;
  isLoading: boolean;
  offsets: Map<string, { type: string; jurisdiction: string | null; offset_days: number }>;
} = {
  benchmark: {
    medianDays: 99,
    n: 8,
    minDays: 8,
    maxDays: 196,
    windowLabel: 'all_time',
    totalSamples: 8,
  },
  isLoading: false,
  offsets: new Map(),
};

vi.mock('../hooks/useTargetSubmitBenchmark', () => ({
  useTargetSubmitBenchmark: () => ({
    data: state.benchmark,
    isLoading: state.isLoading,
  }),
}));

vi.mock('../hooks/useTargetSubmitFormulas', async () => {
  const actual = await vi.importActual<
    typeof import('../hooks/useTargetSubmitFormulas')
  >('../hooks/useTargetSubmitFormulas');
  return {
    ...actual,
    useTargetSubmitFormulas: () => ({
      formulas: [...state.offsets.values()],
      byScope: state.offsets,
      isLoading: false,
      error: null,
      refetch: () => {},
    }),
  };
});

beforeEach(() => {
  state.isLoading = false;
  state.benchmark = {
    medianDays: 99,
    n: 8,
    minDays: 8,
    maxDays: 196,
    windowLabel: 'all_time',
    totalSamples: 8,
  };
  // Base row (jurisdiction NULL) — key shape is `${type}||`.
  state.offsets = new Map([
    ['TRAO||', { type: 'TRAO', jurisdiction: null, offset_days: 3 }],
  ]);
});

describe('TargetSubmitBenchmarkNote', () => {
  it('shows the historical median and the gap against the configured offset', () => {
    render(<TargetSubmitBenchmarkNote type="TRAO" juris="Seattle" />);
    const gap = screen.getByTestId('target-submit-benchmark-gap');
    // 99 median vs a policy offset of 3 → +96.
    expect(gap.textContent).toContain('hist. GO+99d');
    expect(gap.textContent).toContain('+96 vs target');
    expect(gap.textContent).toContain('n=8');
  });

  it('paints amber when history overruns the configured standard', () => {
    render(<TargetSubmitBenchmarkNote type="TRAO" juris="Seattle" />);
    expect(screen.getByTestId('target-submit-benchmark')).toHaveAttribute(
      'data-tone',
      'over',
    );
  });

  it('stays neutral when history beats the standard', () => {
    state.offsets = new Map([
      ['TRAO||', { type: 'TRAO', jurisdiction: null, offset_days: 200 }],
    ]);
    render(<TargetSubmitBenchmarkNote type="TRAO" juris="Seattle" />);
    expect(screen.getByTestId('target-submit-benchmark')).toHaveAttribute(
      'data-tone',
      'neutral',
    );
  });

  it('says "not enough history" instead of a thin median', () => {
    state.benchmark = {
      medianDays: null,
      n: null,
      minDays: null,
      maxDays: null,
      windowLabel: 'insufficient',
      totalSamples: 1,
    };
    render(<TargetSubmitBenchmarkNote type="IPR" juris="Seattle" />);
    expect(
      screen.getByTestId('target-submit-benchmark-gap').textContent,
    ).toContain('not enough history');
  });

  it('marks a projected target visibly', () => {
    render(
      <TargetSubmitBenchmarkNote type="IPR" juris="Seattle" isProjected />,
    );
    expect(
      screen.getByTestId('target-submit-benchmark-projected'),
    ).toHaveTextContent('projected');
    expect(screen.getByTestId('target-submit-benchmark')).toHaveAttribute(
      'data-projected',
      'true',
    );
  });

  it('does not mark a manual date as projected — manual outranks the engine', () => {
    render(
      <TargetSubmitBenchmarkNote
        type="IPR"
        juris="Seattle"
        isProjected
        isManual
      />,
    );
    expect(
      screen.queryByTestId('target-submit-benchmark-projected'),
    ).toBeNull();
  });

  it('renders nothing for mirror types, which have no cohort', () => {
    const { container } = render(
      <TargetSubmitBenchmarkNote type="Grading / Clearing" juris="Seattle" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
