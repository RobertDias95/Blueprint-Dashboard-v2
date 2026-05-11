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
}

export default function BarChartCard({
  title,
  data,
  color,
  unit = '',
  showAverage = true,
  testId,
  emptyState = 'No data',
}: Props) {
  const colorValue = CHART_COLORS[color];
  const avg =
    data.length === 0
      ? null
      : Math.round(data.reduce((s, d) => s + d.value, 0) / data.length);

  return (
    <div
      className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-2"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
        {title}
      </div>

      {data.length === 0 ? (
        <div className="text-xs text-dim text-center py-6 italic">
          {emptyState}
        </div>
      ) : (
        <>
          <div style={{ width: '100%', height: Math.max(120, data.length * 26) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={data}
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
                  formatter={(v) => [`${v ?? ''}${unit}`, '']}
                />
                <Bar dataKey="value" radius={[2, 2, 2, 2]} barSize={10}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={colorValue} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {showAverage && avg !== null && (
            <div className="text-[10px] text-dim border-t border-border pt-2 mt-1">
              Avg:{' '}
              <span
                className="font-bold"
                style={{ color: colorValue }}
              >
                {avg}
                {unit}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
