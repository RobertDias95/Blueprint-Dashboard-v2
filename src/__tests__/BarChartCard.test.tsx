import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BarChartCard from '../components/Reports/BarChartCard';

// fix-117: standalone tests for the BarChartCard category-union logic +
// legend rendering. Recharts is stubbed so assertions focus on the DOM
// frame (legend, footer) rather than the rendered SVG bars.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

describe('BarChartCard — fix-117 comparison overlay', () => {
  it('renders no legend strip when comparisonData is absent (single-cohort)', () => {
    render(
      <BarChartCard
        title="Permits by Type"
        data={[
          { name: 'BP', value: 5 },
          { name: 'Demolition', value: 2 },
        ]}
        color="jv"
        testId="ch"
      />,
    );
    expect(screen.queryByTestId('ch-cmp-legend')).toBeNull();
  });

  it('renders the legend strip when comparisonData is non-null', () => {
    render(
      <BarChartCard
        title="Permits by Type"
        data={[
          { name: 'BP', value: 5 },
          { name: 'Demolition', value: 2 },
        ]}
        comparisonData={[{ name: 'BP', value: 3 }]}
        currentLabel="2026-04-01 – 2026-04-30"
        comparisonLabel="2026-03-01 – 2026-03-31"
        color="jv"
        testId="ch"
      />,
    );
    const legend = screen.getByTestId('ch-cmp-legend');
    expect(legend.textContent).toContain('2026-04-01 – 2026-04-30');
    expect(legend.textContent).toContain('2026-03-01 – 2026-03-31');
    expect(legend.textContent).toMatch(/vs\s+2026-03-01/);
  });

  it('renders the legend "(no data)" affordance when comparisonData is empty array', () => {
    render(
      <BarChartCard
        title="Permits by Type"
        data={[{ name: 'BP', value: 5 }]}
        comparisonData={[]}
        currentLabel="2026-04-01 – 2026-04-30"
        comparisonLabel="2025-04-01 – 2025-04-30"
        color="jv"
        testId="ch"
      />,
    );
    expect(screen.getByTestId('ch-cmp-legend-empty')).toBeInTheDocument();
  });

  it('Avg footer surfaces both averages + delta when both are non-null', () => {
    render(
      <BarChartCard
        title="GO → Submit"
        data={[
          { name: 'BP', value: 20 },
          { name: 'Demolition', value: 10 },
        ]}
        comparisonData={[
          { name: 'BP', value: 15 },
          { name: 'Demolition', value: 5 },
        ]}
        currentLabel="2026-04-01 – 2026-04-30"
        comparisonLabel="2026-03-01 – 2026-03-31"
        color="de"
        unit="d"
        testId="ch"
      />,
    );
    const footer = screen.getByTestId('ch-avg-footer');
    // current avg = (20+10)/2 = 15 ; comparison avg = (15+5)/2 = 10 ; Δ +5d.
    expect(footer.textContent).toMatch(/Avg:\s*15d/);
    expect(footer.textContent).toMatch(/vs\s*10d/);
    const delta = screen.getByTestId('ch-avg-delta');
    expect(delta.textContent).toMatch(/Δ\s*\+5d/);
  });

  it('Avg footer shows current avg + "vs —" when comparison data is empty', () => {
    render(
      <BarChartCard
        title="GO → Submit"
        data={[{ name: 'BP', value: 20 }]}
        comparisonData={[]}
        currentLabel="2026-04-01 – 2026-04-30"
        comparisonLabel="2025-04-01 – 2025-04-30"
        color="de"
        unit="d"
        testId="ch"
      />,
    );
    const footer = screen.getByTestId('ch-avg-footer');
    expect(footer.textContent).toMatch(/Avg:\s*20d/);
    expect(footer.textContent).toMatch(/vs\s*—/);
    // No delta when comparison side is null.
    expect(screen.queryByTestId('ch-avg-delta')).toBeNull();
  });

  it('category union preserves per-cohort avg math (current and comparison stats stay clean over original arrays)', () => {
    // The brief's "current=[BP,Demo], comparison=[BP,MEP]" non-overlapping
    // scenario. The union goes into the bar canvas (verifiable visually
    // but recharts SVG category text doesn't reliably render through jsdom)
    // — pin the BEHAVIOR by checking the Avg footer:
    //   current avg = (10+4)/2 = 7   (BP, Demolition)
    //   comparison avg = (8+3)/2 = 5.5 → Math.round = 6   (BP, MEP)
    //   Δ = 7 - 6 = +1
    // Each cohort's average is computed over its OWN original array, NOT
    // the union (so MEP doesn't pull down current's stat with a zero,
    // and Demolition doesn't pull down comparison's stat with a zero).
    render(
      <BarChartCard
        title="Permits by Type"
        data={[
          { name: 'BP', value: 10 },
          { name: 'Demolition', value: 4 },
        ]}
        comparisonData={[
          { name: 'BP', value: 8 },
          { name: 'MEP', value: 3 },
        ]}
        currentLabel="2026-04-01 – 2026-04-30"
        comparisonLabel="2026-03-01 – 2026-03-31"
        color="jv"
        testId="ch"
      />,
    );
    const footer = screen.getByTestId('ch-avg-footer');
    expect(footer.textContent).toMatch(/Avg:\s*7/);
    expect(footer.textContent).toMatch(/vs\s*6/);
    const delta = screen.getByTestId('ch-avg-delta');
    expect(delta.textContent).toMatch(/Δ\s*\+1/);
  });
});
