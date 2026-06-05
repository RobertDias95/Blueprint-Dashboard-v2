import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KpiSplitView from '../components/shared/KpiSplitView';

// fix-129-b: side-by-side comparison renderer for KpiTile + MetricCard.
// Pin the direction × sign color matrix + 1-decimal delta math + the
// "no comparison data" affordance so future refactors don't drift.

describe('<KpiSplitView /> (fix-129-b)', () => {
  it('renders two value cells with date labels + the delta strip', () => {
    render(
      <KpiSplitView
        currentRangeLabel="2026-06-01 – 2026-06-30"
        comparisonRangeLabel="2026-05-01 – 2026-05-31"
        currentValueText="64d"
        comparisonValueText="67d"
        currentNumeric={64}
        comparisonNumeric={67}
        direction="lower_better"
        comparisonModeLabel="vs prev period"
        testId="kpi-split"
      />,
    );
    expect(screen.getByTestId('kpi-split-current').textContent).toContain(
      '2026-06-01 – 2026-06-30',
    );
    expect(screen.getByTestId('kpi-split-current').textContent).toContain('64d');
    expect(screen.getByTestId('kpi-split-comparison').textContent).toContain(
      '2026-05-01 – 2026-05-31',
    );
    expect(screen.getByTestId('kpi-split-comparison').textContent).toContain(
      '67d',
    );
    expect(screen.getByTestId('kpi-split-delta').textContent).toContain('-3');
    expect(screen.getByTestId('kpi-split-delta').textContent).toContain('vs prev period');
  });

  it('lower_better + negative delta colors green (faster = good)', () => {
    render(
      <KpiSplitView
        currentRangeLabel="Jun"
        comparisonRangeLabel="May"
        currentValueText="64d"
        comparisonValueText="67d"
        currentNumeric={64}
        comparisonNumeric={67}
        direction="lower_better"
        testId="kpi-split"
      />,
    );
    expect(screen.getByTestId('kpi-split-delta').getAttribute('style')).toMatch(
      /var\(--color-pm\)/,
    );
    expect(screen.getByTestId('kpi-split-delta').textContent).toContain('↓');
  });

  it('lower_better + positive delta colors red (slower = bad)', () => {
    render(
      <KpiSplitView
        currentRangeLabel="Jun"
        comparisonRangeLabel="May"
        currentValueText="70d"
        comparisonValueText="64d"
        currentNumeric={70}
        comparisonNumeric={64}
        direction="lower_better"
        testId="kpi-split"
      />,
    );
    expect(screen.getByTestId('kpi-split-delta').getAttribute('style')).toMatch(
      /var\(--color-co\)/,
    );
    expect(screen.getByTestId('kpi-split-delta').textContent).toContain('↑');
  });

  it('higher_better + positive delta colors green (more = good)', () => {
    render(
      <KpiSplitView
        currentRangeLabel="Jun"
        comparisonRangeLabel="May"
        currentValueText="47"
        comparisonValueText="32"
        currentNumeric={47}
        comparisonNumeric={32}
        direction="higher_better"
        testId="kpi-split"
      />,
    );
    expect(screen.getByTestId('kpi-split-delta').getAttribute('style')).toMatch(
      /var\(--color-pm\)/,
    );
    expect(screen.getByTestId('kpi-split-delta').textContent).toContain('↑');
  });

  it('neutral direction colors muted regardless of sign', () => {
    render(
      <KpiSplitView
        currentRangeLabel="Jun"
        comparisonRangeLabel="May"
        currentValueText="+5d"
        comparisonValueText="-2d"
        currentNumeric={5}
        comparisonNumeric={-2}
        direction="neutral"
        testId="kpi-split"
      />,
    );
    expect(screen.getByTestId('kpi-split-delta').getAttribute('style')).toMatch(
      /var\(--color-muted\)/,
    );
  });

  it('comparisonNumeric=null renders "no comparison data" affordance', () => {
    render(
      <KpiSplitView
        currentRangeLabel="Jun"
        comparisonRangeLabel="May"
        currentValueText="42"
        comparisonValueText="—"
        currentNumeric={42}
        comparisonNumeric={null}
        direction="higher_better"
        testId="kpi-split"
      />,
    );
    expect(screen.getByTestId('kpi-split-delta').textContent).toMatch(
      /no comparison data/i,
    );
  });

  it('1-decimal rounding on ugly floats (100 vs 99.8 → +0.2)', () => {
    // formatCompareNumber rounds the (100 − 99.8) leak from 0.19999999
    // to 0.2. Pinned in fix-124-a; verify the split inherits the policy.
    render(
      <KpiSplitView
        currentRangeLabel="Jun"
        comparisonRangeLabel="May"
        currentValueText="100"
        comparisonValueText="99.8"
        currentNumeric={100}
        comparisonNumeric={99.8}
        direction="higher_better"
        testId="kpi-split"
      />,
    );
    const delta = screen.getByTestId('kpi-split-delta').textContent ?? '';
    expect(delta).toMatch(/\+0\.2/);
    expect(delta).not.toMatch(/0\.19\d/);
  });

  it('clean integer deltas stringify without trailing .0 (25 stays "25")', () => {
    render(
      <KpiSplitView
        currentRangeLabel="Jun"
        comparisonRangeLabel="May"
        currentValueText="100"
        comparisonValueText="80"
        currentNumeric={100}
        comparisonNumeric={80}
        direction="higher_better"
        testId="kpi-split"
      />,
    );
    const delta = screen.getByTestId('kpi-split-delta').textContent ?? '';
    expect(delta).toMatch(/\+20/);
    expect(delta).not.toMatch(/20\.0/);
    expect(delta).toMatch(/\+25%/);
    expect(delta).not.toMatch(/25\.0%/);
  });
});
