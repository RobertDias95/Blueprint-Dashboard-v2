import type { PerCycleBucket } from '../../lib/perCycleMetrics';

// fix-142: collapsible per-cycle breakdown drawer. Sits between the
// Overview MetricCards and the charts row; toggled open/closed by clicking
// any of the three timeline tiles (City Review / Response Time / Permit
// Timeline). Surfaces Bobby's "cycle 1 → cycle 2 → cycle 3 feeds the total"
// mental model as one row per cycle bucket.
//
// Comparison treatment mirrors the tiles: when Period B is set, every value
// cell becomes a mini-split (current | comparison | delta), direction
// lower_better for both metrics. The split here is a lightweight inline
// CellSplit rather than the card-sized KpiSplitView — the table cell has no
// room for KpiSplitView's range-stamped header + full-width delta strip.

interface Props {
  open: boolean;
  buckets: PerCycleBucket[];
  /** Null when no Period B is set. */
  comparisonBuckets: PerCycleBucket[] | null;
  comparisonLabel: string | null;
}

/** Stable per-bucket testid fragment: 1/2/3 → '1'/'2'/'3', the 4+ aggregate → '4plus'. */
function bucketKey(b: PerCycleBucket): string {
  return b.cycleBucket === 4 ? '4plus' : String(b.cycleBucket);
}

function fmt(v: number | null): string {
  return v === null ? '—' : `${v}d`;
}

/** Lightweight current | comparison | delta cell for comparison mode. */
function CellSplit({
  testId,
  current,
  comparison,
}: {
  testId: string;
  current: number | null;
  comparison: number | null;
}) {
  const hasBoth = typeof current === 'number' && typeof comparison === 'number';
  const delta = hasBoth ? current! - comparison! : null;
  // Both metrics are lower_better: a negative delta (faster) is good (green),
  // positive (slower) is bad (red), zero/no-data is muted.
  const color =
    delta === null || delta === 0
      ? 'var(--color-muted)'
      : delta < 0
        ? 'var(--color-pm)'
        : 'var(--color-co)';
  const arrow = delta === null ? '→' : delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="font-display font-bold text-text"
        data-testid={`${testId}-split-current`}
      >
        {fmt(current)}
      </span>
      <span className="text-dim">|</span>
      <span
        className="font-display text-muted"
        data-testid={`${testId}-split-comparison`}
      >
        {fmt(comparison)}
      </span>
      <span
        className="text-[10px] font-bold"
        style={{ color }}
        data-testid={`${testId}-split-delta`}
      >
        {delta === null ? (
          <span className="italic text-dim font-normal">—</span>
        ) : (
          <>
            <span aria-hidden="true">{arrow}</span>
            {delta > 0 ? '+' : ''}
            {delta}
          </>
        )}
      </span>
    </span>
  );
}

export default function PerCycleDrawer({
  open,
  buckets,
  comparisonBuckets,
  comparisonLabel,
}: Props) {
  const cmpByBucket = new Map<number, PerCycleBucket>();
  if (comparisonBuckets) {
    for (const b of comparisonBuckets) cmpByBucket.set(b.cycleBucket, b);
  }

  return (
    <div
      data-testid="per-cycle-drawer"
      aria-hidden={!open}
      className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
      style={{ maxHeight: open ? 600 : 0 }}
    >
      <div className="bg-surface border border-border rounded-lg px-4 py-3 mt-1">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[11px] font-display font-bold text-text">
            Per-cycle breakdown
          </div>
          {comparisonBuckets && comparisonLabel && (
            <div className="text-[10px] text-dim">{comparisonLabel}</div>
          )}
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-dim font-display font-bold">
              <th className="text-left py-1">Cycle</th>
              <th className="text-left py-1">City Review</th>
              <th className="text-left py-1">Response Time</th>
              <th className="text-right py-1">Permits</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              const key = bucketKey(b);
              const cmp = cmpByBucket.get(b.cycleBucket) ?? null;
              const showSplit = comparisonBuckets !== null;
              return (
                <tr
                  key={key}
                  data-testid={`per-cycle-row-${key}`}
                  className="border-t border-border"
                >
                  <td className="py-1.5 font-display font-bold text-text">
                    {b.bucketLabel}
                  </td>
                  <td
                    className="py-1.5 text-text"
                    data-testid={`per-cycle-city-${key}`}
                  >
                    {showSplit ? (
                      <CellSplit
                        testId={`per-cycle-city-${key}`}
                        current={b.avgCityCourtTime}
                        comparison={cmp?.avgCityCourtTime ?? null}
                      />
                    ) : (
                      fmt(b.avgCityCourtTime)
                    )}
                  </td>
                  <td
                    className="py-1.5 text-text"
                    data-testid={`per-cycle-response-${key}`}
                  >
                    {showSplit ? (
                      <CellSplit
                        testId={`per-cycle-response-${key}`}
                        current={b.avgResponseTime}
                        comparison={cmp?.avgResponseTime ?? null}
                      />
                    ) : (
                      fmt(b.avgResponseTime)
                    )}
                  </td>
                  <td className="py-1.5 text-right text-dim whitespace-nowrap">
                    {showSplit
                      ? `n=${b.permitCount} | vs n=${cmp?.permitCount ?? 0}`
                      : `n=${b.permitCount} permits`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
