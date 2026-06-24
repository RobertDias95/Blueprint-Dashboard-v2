import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DrillInData, MetricDrillInRow } from '../../lib/metricDrillIn';
import {
  REPORTS_OVERVIEW_METRICS,
  type MetricDefinition,
} from '../../lib/metricDefinitions';

// fix-184a: generalized metric drill-in modal. Reuses the BenchmarkSourceModal
// shell + date-timeline row pattern, but is metric-agnostic: it renders the
// rows buildDrillIn() produced for any Overview card. Value metrics sort by
// value descending by default (slowest/most-variant first) with an asc toggle
// and a min/median/max/n footer; count-only metrics sort by address with no
// value column / no stats footer. Each row links to the permit
// (/project/:id?permit=:permitId) — the same target ProjectList uses.

interface Props {
  data: DrillInData;
  /** Active filter context for the header, e.g. "Seattle · Building Permit". */
  filterContext?: string;
  /** fix-201: explicit metric definition for the formula/cohort sub-labels.
   *  Lets non-Overview surfaces (e.g. Trends KPI tiles, whose keys live in
   *  TRENDS_KPI_METRICS) reuse this modal. Falls back to the Overview library. */
  metricDef?: MetricDefinition;
  onClose: () => void;
}

export default function MetricDrillIn({
  data,
  filterContext,
  metricDef,
  onClose,
}: Props) {
  const [desc, setDesc] = useState(true);
  const def = metricDef ?? REPORTS_OVERVIEW_METRICS[data.key];

  const rows = useMemo(() => {
    const copy = [...data.rows];
    if (data.isCount) {
      copy.sort((a, b) => a.address.localeCompare(b.address));
      return copy;
    }
    // Value metrics: nulls last; otherwise by value in the chosen direction.
    copy.sort((a, b) => {
      if (a.value === null && b.value === null) return 0;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return desc ? b.value - a.value : a.value - b.value;
    });
    return copy;
  }, [data.rows, data.isCount, desc]);

  const unitSuffix = data.unit === 'd' ? 'd' : data.unit === 'rounds' ? '' : '';

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9998 }}
        data-testid="metric-drillin-backdrop"
      />
      <div
        role="dialog"
        aria-label={`${data.label} — contributing permits`}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-modal, 0 16px 48px rgba(0,0,0,.35))',
          width: 'min(94vw, 820px)',
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        data-testid="metric-drillin-modal"
      >
        <header
          className="px-4 py-3 border-b flex items-start justify-between gap-3"
          style={{ background: 'var(--color-s2)', borderBottomColor: 'var(--color-border)' }}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-display font-bold text-text">
              {data.label}
              {filterContext ? (
                <span className="text-dim font-normal"> · {filterContext}</span>
              ) : null}
            </span>
            {def?.formula && (
              <span className="text-[10px] text-dim font-mono truncate" title={def.formula}>
                {def.formula}
              </span>
            )}
            {def?.cohort && (
              <span className="text-[10px] text-dim italic">{def.cohort}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!data.isCount && data.rows.length > 1 && (
              <button
                type="button"
                onClick={() => setDesc((d) => !d)}
                className="text-[11px] font-display text-muted hover:text-text border border-border rounded-md px-2 py-1 cursor-pointer"
                data-testid="metric-drillin-sort"
                title="Toggle sort direction"
              >
                {desc ? 'Highest first ▼' : 'Lowest first ▲'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] font-display text-muted hover:text-text border border-border rounded-md px-3 py-1 cursor-pointer"
              data-testid="metric-drillin-close"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto" data-testid="metric-drillin-body">
          {rows.length === 0 ? (
            <div className="text-[11px] text-dim italic px-4 py-6 text-center">
              No contributing permits in the current filter.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <DrillRow key={r.permitId} row={r} unitSuffix={unitSuffix} isCount={data.isCount} />
              ))}
            </ul>
          )}
        </div>

        <footer
          className="px-4 py-2 border-t flex items-center justify-between gap-3"
          style={{ borderTopColor: 'var(--color-border)' }}
        >
          <span className="text-[10px] text-dim font-mono" data-testid="metric-drillin-count">
            {data.n} permit{data.n === 1 ? '' : 's'} contributing
          </span>
          {!data.isCount && data.stats && (
            <span className="text-[10px] text-dim font-mono" data-testid="metric-drillin-stats">
              min {data.stats.min}
              {unitSuffix} · median {data.stats.median}
              {unitSuffix} · max {data.stats.max}
              {unitSuffix}
            </span>
          )}
        </footer>
      </div>
    </>
  );
}

function DrillRow({
  row,
  unitSuffix,
  isCount,
}: {
  row: MetricDrillInRow;
  unitSuffix: string;
  isCount: boolean;
}) {
  return (
    <li className="px-4 py-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Link
          to={`/project/${row.projectId}?permit=${row.permitId}`}
          className="text-[12px] font-bold text-de underline truncate"
          data-testid={`metric-drillin-row-${row.permitId}`}
        >
          {row.address || '(no address)'}
        </Link>
        {row.num && (
          <span className="text-[10px] text-muted font-mono flex-shrink-0">{row.num}</span>
        )}
        {!isCount && (
          <span
            className="text-[12px] font-mono font-bold text-text ml-auto flex-shrink-0"
            data-testid={`metric-drillin-value-${row.permitId}`}
          >
            {row.value === null ? '—' : `${row.value}${unitSuffix}`}
          </span>
        )}
        {isCount && row.secondary && (
          <span className="text-[10px] text-dim font-mono ml-auto flex-shrink-0">
            {row.secondary}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-[10px] flex-wrap text-dim">
        <span className="font-mono">{row.juris || '—'}</span>
        <span>·</span>
        <span className="font-mono">{row.type || '—'}</span>
        {row.lead && (
          <>
            <span>·</span>
            <span className="font-mono">{row.lead}</span>
          </>
        )}
        {/* fix-201: value-metric secondary (e.g. hit/miss on the hit-rate
            drill-in) — count metrics already render secondary by the value. */}
        {!isCount && row.secondary && (
          <>
            <span>·</span>
            <span
              className="font-mono font-bold"
              data-testid={`metric-drillin-secondary-${row.permitId}`}
            >
              {row.secondary}
            </span>
          </>
        )}
      </div>

      {row.dates.length > 0 && (
        <div className="flex items-center gap-2 text-[10px] flex-wrap">
          {row.dates.map((d, i) => (
            <span key={d.label} className="text-dim flex items-center gap-2">
              {i > 0 && <span className="text-dim">→</span>}
              <span>
                {d.label}{' '}
                <span className="font-mono text-text">{d.date ?? '—'}</span>
              </span>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
