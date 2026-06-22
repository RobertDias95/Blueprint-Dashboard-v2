import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PerCycleDrawer from '../components/Reports/PerCycleDrawer';
import type { PerCycleBucket } from '../lib/perCycleMetrics';
import type { TimelineComposition } from '../lib/reportMetrics';

// fix-184b: the composition summary renders inside PerCycleDrawer ONLY when
// showComposition is true (drawer opened via the Avg Permit Timeline tile).
// City Review / Response Time open the same drawer with showComposition=false,
// so their experience is the fix-142 per-cycle table with no composition block.

const buckets: PerCycleBucket[] = [1, 2, 3, 4].map((n) => ({
  cycleBucket: n as 1 | 2 | 3 | 4,
  bucketLabel: (n === 4 ? 'Cycle 4+' : `Cycle ${n}`) as PerCycleBucket['bucketLabel'],
  avgCityCourtTime: null,
  avgResponseTime: null,
  permitCount: 0,
}));

const composition: TimelineComposition = {
  n: 3,
  timeline: 34,
  cityCourt: 27,
  ourCourt: 5,
  residual: 2,
};

function renderDrawer(showComposition: boolean) {
  return render(
    <PerCycleDrawer
      open
      buckets={buckets}
      comparisonBuckets={null}
      comparisonLabel={null}
      composition={composition}
      showComposition={showComposition}
    />,
  );
}

describe('PerCycleDrawer composition summary', () => {
  it('renders the composition with parts that visibly add to the total', () => {
    renderDrawer(true);
    expect(screen.getByTestId('timeline-composition')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-composition-city').textContent).toBe('27d');
    expect(screen.getByTestId('timeline-composition-our').textContent).toBe('5d');
    expect(screen.getByTestId('timeline-composition-residual').textContent).toBe('2d');
    expect(screen.getByTestId('timeline-composition-total').textContent).toBe('34d');
    expect(screen.getByTestId('timeline-composition-n').textContent).toContain('n=3');
    // The three parts reconcile to the displayed total.
    expect(27 + 5 + 2).toBe(34);
  });

  it('still renders the shared per-cycle table alongside the composition', () => {
    renderDrawer(true);
    for (const k of ['1', '2', '3', '4plus']) {
      expect(screen.getByTestId(`per-cycle-row-${k}`)).toBeInTheDocument();
    }
  });

  it('does NOT render the composition when opened via another tile (showComposition=false)', () => {
    renderDrawer(false);
    expect(screen.queryByTestId('timeline-composition')).toBeNull();
    // Per-cycle table is unchanged.
    expect(screen.getByTestId('per-cycle-row-1')).toBeInTheDocument();
  });

  it('renders nothing extra when composition is null even if showComposition', () => {
    render(
      <PerCycleDrawer
        open
        buckets={buckets}
        comparisonBuckets={null}
        comparisonLabel={null}
        composition={null}
        showComposition
      />,
    );
    expect(screen.queryByTestId('timeline-composition')).toBeNull();
  });
});
