import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComparisonRow } from '../components/shared/ComparisonRow';

// fix-115-b: standalone tests for the extracted ComparisonRow. Pin the
// direction → color matrix without going through a parent KPI surface, so
// future consumers (fix-115-c Reports/Overview, fix-116 chart cards) can
// rely on the same semantics.

describe('ComparisonRow — direction × sign color matrix', () => {
  function renderRow(props: Partial<React.ComponentProps<typeof ComparisonRow>> = {}) {
    return render(
      <ComparisonRow
        testId="cmp"
        comparisonLabel="vs prev period (2026-01-01 – 2026-03-31)"
        comparisonValueText="80"
        currentNumeric={100}
        comparisonNumeric={80}
        direction="higher_better"
        {...props}
      />,
    );
  }

  it('higher_better + positive delta → green (--color-pm)', () => {
    renderRow({
      currentNumeric: 100,
      comparisonNumeric: 80,
      direction: 'higher_better',
    });
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/↑/);
    expect(delta.textContent).toMatch(/\+20/);
    expect(delta.textContent).toMatch(/\+25%/);
    expect(delta.getAttribute('style')).toMatch(/color: var\(--color-pm\)/);
  });

  it('higher_better + negative delta → red (--color-co)', () => {
    renderRow({
      currentNumeric: 80,
      comparisonNumeric: 100,
      direction: 'higher_better',
    });
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/↓/);
    expect(delta.textContent).toMatch(/-20/);
    expect(delta.textContent).toMatch(/-20%/);
    expect(delta.getAttribute('style')).toMatch(/color: var\(--color-co\)/);
  });

  it('lower_better + positive delta → red (more = bad)', () => {
    // Inverted from higher_better. e.g. avg city-clock days went UP from
    // 80 → 100 — that's a regression on a time-on-clock metric.
    renderRow({
      currentNumeric: 100,
      comparisonNumeric: 80,
      direction: 'lower_better',
    });
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/↑/);
    expect(delta.getAttribute('style')).toMatch(/color: var\(--color-co\)/);
  });

  it('lower_better + negative delta → green (less = good)', () => {
    // 100 → 80 days on a time-on-clock metric is an improvement.
    renderRow({
      currentNumeric: 80,
      comparisonNumeric: 100,
      direction: 'lower_better',
    });
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/↓/);
    expect(delta.getAttribute('style')).toMatch(/color: var\(--color-pm\)/);
  });

  it('neutral direction → muted color regardless of sign', () => {
    // Submit-variance shaped metric — both increases and decreases are
    // ambiguous without context (early can be good, late can be bad,
    // depending on the project).
    renderRow({
      currentNumeric: 100,
      comparisonNumeric: 80,
      direction: 'neutral',
    });
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/↑/);
    expect(delta.getAttribute('style')).toMatch(/color: var\(--color-muted\)/);
  });

  it('zero delta → arrow → and muted color', () => {
    renderRow({
      currentNumeric: 50,
      comparisonNumeric: 50,
      direction: 'higher_better',
    });
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/→/);
    expect(delta.textContent).toMatch(/\+0|0/);
    // Neither good nor bad — muted.
    expect(delta.getAttribute('style')).toMatch(/color: var\(--color-muted\)/);
  });

  it('comparisonNumeric = 0 → percentage renders "—" (no divide by zero)', () => {
    renderRow({
      currentNumeric: 5,
      comparisonNumeric: 0,
      direction: 'higher_better',
    });
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/\+5/);
    expect(delta.textContent).toMatch(/—/);
  });
});

describe('ComparisonRow — no-data affordance', () => {
  it('current=numeric, comparison=null → "no comparison data" instead of "vs —"', () => {
    render(
      <ComparisonRow
        testId="cmp"
        comparisonLabel="vs prev year (2025-06-01 – 2025-06-30)"
        currentNumeric={42}
        comparisonNumeric={null}
        direction="higher_better"
      />,
    );
    const row = screen.getByTestId('cmp');
    expect(row.textContent).toMatch(/no comparison data/i);
    // Label still surfaces so the user knows WHICH prior period had no data.
    expect(row.textContent).toMatch(/vs prev year/);
    // The delta span isn't rendered in this branch.
    expect(screen.queryByTestId('cmp-delta')).toBeNull();
  });

  it('both sides null → "no comparison data"', () => {
    render(
      <ComparisonRow
        testId="cmp"
        comparisonLabel="vs prev period (2026-01-01 – 2026-03-31)"
        currentNumeric={null}
        comparisonNumeric={null}
        direction="lower_better"
      />,
    );
    expect(screen.getByTestId('cmp').textContent).toMatch(/no comparison data/i);
  });

  it('comparisonValueText overrides the numeric formatting in the "vs" line', () => {
    render(
      <ComparisonRow
        testId="cmp"
        comparisonLabel="vs prev period"
        comparisonValueText="12 of 20 (60%)"
        currentNumeric={75}
        comparisonNumeric={60}
        direction="higher_better"
      />,
    );
    const row = screen.getByTestId('cmp');
    expect(row.textContent).toMatch(/vs 12 of 20 \(60%\)/);
  });
});

// fix-124-a: float-precision sanity case. The 100 vs 99.8 pairing was
// Bobby's repro — pct = (0.2 / 99.8) * 100 = 0.20040080160320646
// pre-fix; ComparisonRow's old Math.round-to-integer flattened that to
// "0%" (losing signal); the raw delta also stringified as
// "0.19999999999999574". Now both round to 1 decimal cleanly.
describe('ComparisonRow — fix-124-a 1-decimal formatting', () => {
  it('100 vs 99.8 → "+0.2 (+0.2%)", not the floating-point trail', () => {
    render(
      <ComparisonRow
        testId="cmp"
        comparisonLabel="vs prev period"
        comparisonValueText="99.8"
        currentNumeric={100}
        comparisonNumeric={99.8}
        direction="higher_better"
      />,
    );
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/\+0\.2/);
    expect(delta.textContent).toMatch(/\+0\.2%/);
    // Defense: no 0.19999 / 0.20040 leak.
    expect(delta.textContent).not.toMatch(/0\.19/);
    expect(delta.textContent).not.toMatch(/0\.20\d\d/);
  });

  it('67.333 vs 60 → "+7.3 (+12.2%)" (mid-precision aggregate-of-aggregates)', () => {
    render(
      <ComparisonRow
        testId="cmp"
        comparisonLabel="vs prev period"
        comparisonValueText="60"
        currentNumeric={67.333}
        comparisonNumeric={60}
        direction="higher_better"
      />,
    );
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/\+7\.3/);
    expect(delta.textContent).toMatch(/\+12\.2%/);
  });

  it('clean integers still display without trailing .0 (25 stays "25", not "25.0")', () => {
    render(
      <ComparisonRow
        testId="cmp"
        comparisonLabel="vs prev period"
        comparisonValueText="80"
        currentNumeric={100}
        comparisonNumeric={80}
        direction="higher_better"
      />,
    );
    const delta = screen.getByTestId('cmp-delta');
    expect(delta.textContent).toMatch(/\+20/);
    expect(delta.textContent).not.toMatch(/20\.0/);
    expect(delta.textContent).toMatch(/\+25%/);
    expect(delta.textContent).not.toMatch(/25\.0%/);
  });
});
