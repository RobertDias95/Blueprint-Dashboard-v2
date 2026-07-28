import { useMemo, useState } from 'react';
import { usePhaseDurationGrid } from '../hooks/usePhaseDurationGrid';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  MIN_PHASE_SAMPLES,
  PHASE_RECENT_WINDOW_DAYS,
  pairSidesByCycle,
  phaseTrend,
  trendTone,
  type PhaseCyclePair,
  type PhaseDurationRow,
} from '../lib/phaseDurations';

// fix-253: "Phase Durations" — how long each half of the review chain actually
// takes, per permit type, jurisdiction and cycle.
//
// A permit's schedule is a chain of alternating phases, each with an OWNER:
//   target_submit --[CITY: review]--> corr_issued
//                 --[OURS: turnaround]--> resubmitted --> ...
//
// Both sides compress sharply each round (Seattle BP: city 72 -> 25 -> 19,
// ours 24 -> 13 -> 5), which is precisely what a single flat per-type offset
// cannot represent. This report is the evidence for that model.
//
// READ-ONLY. Nothing here writes, and nothing here feeds a target_submit —
// rewiring the engine is fix-254, gated on these numbers.

const RECENT_OPTIONS = [90, PHASE_RECENT_WINDOW_DAYS, 365];

function days(v: number | null | undefined): string {
  return v == null ? '—' : `${v}d`;
}

export default function PhaseDurationsReport() {
  const [recentDays, setRecentDays] = useState<number>(PHASE_RECENT_WINDOW_DAYS);
  const [jurisFilter, setJurisFilter] = useState<string>('');
  const gridQ = usePhaseDurationGrid(recentDays);

  const rows = useMemo(() => gridQ.data ?? [], [gridQ.data]);

  const jurisdictions = useMemo(
    () => [...new Set(rows.map((r) => r.juris))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const pairs = useMemo(() => {
    const filtered = jurisFilter
      ? rows.filter((r) => r.juris === jurisFilter)
      : rows;
    return pairSidesByCycle(filtered);
  }, [rows, jurisFilter]);

  if (gridQ.error) {
    return (
      <QueryError
        title="Phase durations failed to load"
        error={gridQ.error as Error}
        onRetry={() => gridQ.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="phase-durations-report">
      <div>
        <h1 className="text-base font-display font-bold text-text mb-1">
          Phase Durations
        </h1>
        <p className="text-[11px] text-muted max-w-3xl">
          Every review cycle is two phases with two different owners:{' '}
          <span className="font-semibold">city review</span> (we submit → they
          issue corrections) and{' '}
          <span className="font-semibold">our turnaround</span> (they issue
          corrections → we resubmit). Medians over all history, with a trailing{' '}
          {recentDays}-day window beside them so you can see which half is
          moving — and whose it is. Cohorts under n={MIN_PHASE_SAMPLES} are not
          shown at all. Display only; this changes no dates.
        </p>
      </div>

      <div className="bg-surface-2 border border-border rounded-lg p-3 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-dim">
            Jurisdiction
          </span>
          <select
            value={jurisFilter}
            onChange={(e) => setJurisFilter(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
            data-testid="phase-durations-juris"
          >
            <option value="">All jurisdictions</option>
            {jurisdictions.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-dim">
            Recent window
          </span>
          <select
            value={String(recentDays)}
            onChange={(e) => setRecentDays(Number(e.target.value))}
            className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
            data-testid="phase-durations-window"
          >
            {RECENT_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </label>
      </div>

      {gridQ.isLoading ? (
        <SkeletonRows count={8} rowClassName="h-9" />
      ) : pairs.length === 0 ? (
        <div
          className="py-8 text-center text-dim italic text-xs"
          data-testid="phase-durations-empty"
        >
          No cohort has {MIN_PHASE_SAMPLES} or more completed phases yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
                <th className="text-left py-1.5 font-display font-bold">
                  Jurisdiction
                </th>
                <th className="text-left py-1.5 font-display font-bold">Type</th>
                <th className="text-center py-1.5 font-display font-bold">
                  Cycle
                </th>
                <th className="text-right py-1.5 font-display font-bold pr-3">
                  City review
                </th>
                <th className="text-right py-1.5 font-display font-bold pr-3">
                  Our turnaround
                </th>
                <th className="text-left py-1.5 font-display font-bold pl-2">
                  Trend (last {recentDays}d)
                </th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <PairRow key={`${p.juris}-${p.type}-${p.cycleIndex}`} pair={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PairRow({ pair }: { pair: PhaseCyclePair }) {
  return (
    <tr
      className="border-b border-border/40"
      data-testid={`phase-row-${pair.juris}-${pair.type}-${pair.cycleIndex}`}
    >
      <td className="py-1.5 text-muted">{pair.juris}</td>
      <td className="py-1.5 text-text">{pair.type}</td>
      <td className="py-1.5 text-center text-muted">{pair.cycleIndex}</td>
      <SideCell row={pair.city} testid="city" />
      <SideCell row={pair.ours} testid="ours" />
      <td className="py-1.5 pl-2">
        <div className="flex flex-col gap-0.5">
          <TrendChip label="City" row={pair.city} />
          <TrendChip label="Ours" row={pair.ours} />
        </div>
      </td>
    </tr>
  );
}

function SideCell({
  row,
  testid,
}: {
  row: PhaseDurationRow | null;
  testid: string;
}) {
  if (!row || row.medianDays == null) {
    return (
      <td className="py-1.5 text-right pr-3">
        <span
          className="text-[10px] text-dim italic"
          data-testid={`phase-${testid}-insufficient`}
        >
          {row ? `n=${row.n}, need ${MIN_PHASE_SAMPLES}` : '—'}
        </span>
      </td>
    );
  }
  return (
    <td className="py-1.5 text-right pr-3" data-testid={`phase-${testid}-cell`}>
      <span className="text-text font-semibold">{days(row.medianDays)}</span>{' '}
      <span className="text-[10px] text-dim">
        n={row.n} · {row.minDays}–{row.maxDays}d
      </span>
    </td>
  );
}

function TrendChip({
  label,
  row,
}: {
  label: string;
  row: PhaseDurationRow | null;
}) {
  if (!row) return null;
  const t = phaseTrend(row);
  if (t.direction === 'unknown') {
    return (
      <span className="text-[9px] text-dim italic">
        {label}: not enough recent history
      </span>
    );
  }
  const tone = trendTone(t);
  const arrow = t.direction === 'slower' ? '▲' : t.direction === 'faster' ? '▼' : '=';
  const signed =
    t.deltaDays == null ? '' : t.deltaDays > 0 ? `+${t.deltaDays}` : `${t.deltaDays}`;
  return (
    <span
      className="text-[9px] font-semibold"
      style={{
        color:
          tone === 'bad'
            ? 'var(--color-co)'
            : tone === 'good'
              ? 'var(--color-pm)'
              : 'var(--color-dim)',
      }}
      data-testid={`phase-trend-${label.toLowerCase()}`}
      data-direction={t.direction}
      title={`All-time median ${row.medianDays}d vs recent ${row.recentMedianDays}d (n=${row.recentN})`}
    >
      {label}: {arrow} {signed}d
    </span>
  );
}
