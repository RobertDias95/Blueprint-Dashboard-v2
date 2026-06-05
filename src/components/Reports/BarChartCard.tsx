import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_COLORS, type ChartColorKey } from '../../lib/chartHelpers';
import type { NamedValue } from '../../lib/chartHelpers';

// Q7.2.b: Recharts wrapper for horizontal bar charts. v1's barChart helper
// (index.html 5206) renders title + horizontal rows + value labels + an
// average footer. Same visual register here, expressed via Recharts'
// vertical-layout BarChart so we get tooltips + responsive resize.
//
// fix-117: optional comparison overlay. When `comparisonData` is non-null
// the category axis becomes the UNION of names in current + comparison;
// each row renders two bars (solid current + dashed/translucent comparison).
// A small legend strip appears above the chart and the Avg footer surfaces
// both averages + a Δ. This is a CATEGORICAL chart so fix-116's dashed-
// line overlay treatment doesn't fit — grouped bars are the idiom.

interface Props {
  title: string;
  data: NamedValue[];
  color: ChartColorKey;
  /** Suffix appended to values in tooltips and the average footer.
   * Common: 'd' for days, '' for raw counts. */
  unit?: string;
  /** Show an "Avg: Xd" footer summary (matches v1's barChart). Default true. */
  showAverage?: boolean;
  /** Test ID for assertions on the outer container. */
  testId?: string;
  /** Empty-state message; defaults to "No data". */
  emptyState?: string;
  // fix-117 additions:
  /** Comparison-cohort data in the same shape. Null = no comparison. */
  comparisonData?: NamedValue[] | null;
  /** Short date-range label for the current cohort (e.g. "2026-04-01 –
   *  2026-04-30"). Drives the legend strip's current swatch. */
  currentLabel?: string;
  /** Short date-range label for the comparison cohort. Drives the legend
   *  strip's dashed swatch and the tooltip's "vs ..." line. */
  comparisonLabel?: string;
}

export default function BarChartCard({
  title,
  data,
  color,
  unit = '',
  showAverage = true,
  testId,
  emptyState = 'No data',
  comparisonData,
  currentLabel,
  comparisonLabel,
}: Props) {
  const colorValue = CHART_COLORS[color];
  const hasComparison = Boolean(comparisonData);

  // fix-117: when comparison is active, the y-axis (category) is the UNION
  // of names across current + comparison. Otherwise it's just current's
  // pre-sorted list. Union sorted by current-value desc, with categories
  // present only in comparison appended at the bottom (also desc by their
  // own value) — keeps the chart readable while preserving "ranked by
  // what's happening NOW" semantics.
  type Row = { name: string; value: number | null; cmpValue: number | null };
  const rows: Row[] = (() => {
    if (!hasComparison) {
      return data.map((d) => ({
        name: d.name,
        value: d.value,
        cmpValue: null,
      }));
    }
    const cmpByName = new Map(
      (comparisonData ?? []).map((d) => [d.name, d.value] as const),
    );
    const currentByName = new Map(
      data.map((d) => [d.name, d.value] as const),
    );
    const currentNames = data.map((d) => d.name);
    const cmpOnlyNames = (comparisonData ?? [])
      .map((d) => d.name)
      .filter((n) => !currentByName.has(n));
    cmpOnlyNames.sort((a, b) => (cmpByName.get(b) ?? 0) - (cmpByName.get(a) ?? 0));
    return [...currentNames, ...cmpOnlyNames].map((name) => ({
      name,
      value: currentByName.get(name) ?? null,
      cmpValue: cmpByName.get(name) ?? null,
    }));
  })();

  // Bar values: Recharts skips null, but the YAxis category still renders.
  // Cohort averages use the original arrays (not the union) so unchanged
  // when comparison is off and use ONLY non-null values when on.
  const avg = computeAvg(data);
  const cmpAvg = hasComparison ? computeAvg(comparisonData ?? []) : null;
  const avgDelta =
    avg !== null && cmpAvg !== null ? avg - cmpAvg : null;

  return (
    <div
      className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-2"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
        {title}
      </div>

      {hasComparison && (
        <ComparisonLegendStrip
          colorValue={colorValue}
          currentLabel={currentLabel}
          comparisonLabel={comparisonLabel}
          comparisonHasData={(comparisonData ?? []).length > 0}
          testId={testId ? `${testId}-cmp-legend` : undefined}
        />
      )}

      {rows.length === 0 ? (
        <div className="text-xs text-dim text-center py-6 italic">
          {emptyState}
        </div>
      ) : (
        <>
          <div style={{ width: '100%', height: Math.max(120, rows.length * 26) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={rows}
                margin={{ top: 4, right: 36, bottom: 4, left: 0 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  content={
                    hasComparison
                      ? (props) => (
                          <ComparisonTooltip
                            payload={props.payload}
                            label={props.label}
                            unit={unit}
                            currentLabel={currentLabel}
                            comparisonLabel={comparisonLabel}
                          />
                        )
                      : undefined
                  }
                  formatter={
                    hasComparison ? undefined : (v) => [`${v ?? ''}${unit}`, '']
                  }
                />
                <Bar dataKey="value" radius={[2, 2, 2, 2]} barSize={10}>
                  {rows.map((_, i) => (
                    <Cell key={i} fill={colorValue} />
                  ))}
                </Bar>
                {hasComparison && (
                  <Bar
                    dataKey="cmpValue"
                    radius={[2, 2, 2, 2]}
                    barSize={8}
                    fillOpacity={0.35}
                    stroke={colorValue}
                    strokeDasharray="2 2"
                    strokeWidth={1}
                  >
                    {rows.map((_, i) => (
                      <Cell key={`cmp-${i}`} fill={colorValue} />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {showAverage && (avg !== null || cmpAvg !== null) && (
            <div
              className="text-[10px] text-dim border-t border-border pt-2 mt-1"
              data-testid={testId ? `${testId}-avg-footer` : undefined}
            >
              Avg:{' '}
              <span className="font-bold" style={{ color: colorValue }}>
                {avg === null ? '—' : `${avg}${unit}`}
              </span>
              {hasComparison && (
                <>
                  {' · vs '}
                  <span
                    className="font-bold"
                    style={{ color: colorValue, opacity: 0.6 }}
                  >
                    {cmpAvg === null ? '—' : `${cmpAvg}${unit}`}
                  </span>
                  {avgDelta !== null && (
                    <>
                      {' · '}
                      <span
                        className="font-bold"
                        data-testid={testId ? `${testId}-avg-delta` : undefined}
                      >
                        Δ {avgDelta > 0 ? '+' : ''}
                        {avgDelta}
                        {unit}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function computeAvg(data: NamedValue[]): number | null {
  if (data.length === 0) return null;
  return Math.round(data.reduce((s, d) => s + d.value, 0) / data.length);
}

// fix-117: legend strip mirrors fix-116's TrendChartCard pattern — DOM
// (not SVG) so tests can pin presence + content via testId.
function ComparisonLegendStrip({
  colorValue,
  currentLabel,
  comparisonLabel,
  comparisonHasData,
  testId,
}: {
  colorValue: string;
  currentLabel?: string;
  comparisonLabel?: string;
  comparisonHasData: boolean;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 text-[10px] text-muted"
      data-testid={testId}
    >
      <span className="flex items-center gap-1.5">
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            background: colorValue,
            borderRadius: 1,
          }}
        />
        <span className="text-text font-display font-bold">
          {currentLabel ?? 'Current'}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            background: colorValue,
            opacity: 0.35,
            border: `1px dashed ${colorValue}`,
            borderRadius: 1,
          }}
        />
        <span className="text-dim font-display">
          vs {comparisonLabel ?? 'previous period'}
          {!comparisonHasData && (
            <span
              className="ml-2 italic"
              data-testid={testId ? `${testId}-empty` : undefined}
            >
              (no data)
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

function ComparisonTooltip({
  payload,
  label,
  unit,
  currentLabel,
  comparisonLabel,
}: {
  // Recharts' generics complicate the type; keep it loose — we only read
  // the row off payload[0].payload.
  payload?: ReadonlyArray<{ payload?: unknown }>;
  label?: string | number;
  unit: string;
  currentLabel?: string;
  comparisonLabel?: string;
}) {
  if (!payload || payload.length === 0) return null;
  const row = payload[0]?.payload as
    | { name?: string; value?: number | null; cmpValue?: number | null }
    | undefined;
  if (!row) return null;
  const cur = typeof row.value === 'number' ? row.value : null;
  const cmp = typeof row.cmpValue === 'number' ? row.cmpValue : null;
  const delta = cur !== null && cmp !== null ? cur - cmp : null;
  const pct =
    delta !== null && cmp !== null && cmp !== 0
      ? Math.round((delta / Math.abs(cmp)) * 100)
      : null;
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        fontSize: 11,
        padding: '6px 8px',
        minWidth: 160,
      }}
    >
      <div className="font-bold text-text mb-1">{label}</div>
      <div className="text-text">
        {currentLabel ?? 'Current'}:{' '}
        <strong>{cur === null ? '—' : `${cur}${unit}`}</strong>
      </div>
      <div className="text-dim">
        vs {comparisonLabel ?? 'Prev'}:{' '}
        <strong>{cmp === null ? '—' : `${cmp}${unit}`}</strong>
      </div>
      {delta !== null && (
        <div
          className="text-[10px] font-bold mt-1"
          style={{
            color:
              delta > 0
                ? 'var(--color-pm)'
                : delta < 0
                  ? 'var(--color-co)'
                  : 'var(--color-muted)',
          }}
        >
          Δ {delta > 0 ? '+' : ''}
          {delta}
          {unit}
          {pct === null ? '' : ` (${pct > 0 ? '+' : ''}${pct}%)`}
        </div>
      )}
    </div>
  );
}
