import { useMemo, useState } from 'react';
import type { EnrichedPermit } from '../../lib/reportMetrics';
import { effectiveStage } from '../../lib/permitStage';

// Q7.2.c: tabular permit list. Sortable click-to-sort columns; default
// sort is GO date desc (most recent first). Renders the filtered set
// passed from Reports.tsx — driven by the same filters that drive the
// metric cards + charts, so the table always agrees with the headline.

type SortKey =
  | 'address'
  | 'juris'
  | 'type'
  | 'ent'
  | 'da'
  | 'go'
  | 'target'
  | 'submitted'
  | 'intake'
  | 'review'
  | 'variance'
  | 'stage';

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const COLS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'address', label: 'Address' },
  { key: 'juris', label: 'Juris' },
  { key: 'type', label: 'Type' },
  { key: 'ent', label: 'ENT' },
  { key: 'da', label: 'DA' },
  { key: 'go', label: 'GO' },
  { key: 'target', label: 'Target' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'intake', label: 'Intake' },
  { key: 'review', label: 'Review', numeric: true },
  { key: 'variance', label: 'Var.', numeric: true },
  { key: 'stage', label: 'Stage' },
];

function extractSortValue(e: EnrichedPermit, key: SortKey): string | number | null {
  switch (key) {
    case 'address':
      return e.address;
    case 'juris':
      return e.juris;
    case 'type':
      return e.permit.type ?? '';
    case 'ent':
      return e.permit.ent_lead ?? '';
    case 'da':
      return e.permit.da ?? '';
    case 'go':
      return e.permit.go_date ?? '';
    case 'target':
      return e.permit.target_submit ?? '';
    case 'submitted':
      return e.firstSubmitted ?? '';
    case 'intake':
      return e.firstIntakeAccepted ?? '';
    case 'review':
      return e.cityReviewDays;
    case 'variance':
      return e.variance;
    case 'stage':
      return effectiveStage(e.permit, e.permit.permit_cycles ?? []) ?? '';
  }
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
  dir: 'asc' | 'desc',
): number {
  // Nulls sort to end regardless of direction.
  const aNull = a === null || a === '';
  const bNull = b === null || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const cmp =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b));
  return dir === 'asc' ? cmp : -cmp;
}

const STAGE_LABELS: Record<string, string> = {
  de: 'D&E',
  pm: 'PM',
  co: 'CO',
  is: 'Issued',
};

export default function ReportTable({
  permits,
}: {
  permits: EnrichedPermit[];
}) {
  const [sort, setSort] = useState<SortState>({ key: 'go', dir: 'desc' });

  const sorted = useMemo(() => {
    const copy = permits.slice();
    copy.sort((a, b) =>
      compareValues(
        extractSortValue(a, sort.key),
        extractSortValue(b, sort.key),
        sort.dir,
      ),
    );
    return copy;
  }, [permits, sort]);

  function onHeaderClick(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }

  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-testid="report-table"
    >
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
          Permit Detail ({permits.length})
        </div>
        <div className="text-[10px] text-dim">
          Click any column to sort
        </div>
      </div>
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="min-w-full text-[11px]">
          <thead className="bg-surface-2 sticky top-0">
            <tr>
              {COLS.map((col) => {
                const active = sort.key === col.key;
                const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
                return (
                  <th
                    key={col.key}
                    onClick={() => onHeaderClick(col.key)}
                    className={`px-2 py-2 text-left font-display font-bold text-[10px] uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${
                      active ? 'text-text' : 'text-muted hover:text-text'
                    } ${col.numeric ? 'text-right' : ''}`}
                    data-testid={`report-table-header-${col.key}`}
                  >
                    {col.label}
                    {arrow}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={COLS.length}
                  className="px-4 py-8 text-center text-dim italic"
                >
                  No permits match the current filter.
                </td>
              </tr>
            ) : (
              sorted.map((e) => {
                const stage = effectiveStage(
                  e.permit,
                  e.permit.permit_cycles ?? [],
                );
                return (
                  <tr
                    key={e.permit.id}
                    className="border-t border-border/40 hover:bg-surface-2"
                    data-testid={`report-table-row-${e.permit.id}`}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap text-text">
                      {e.address || '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {e.juris || '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {e.permit.type ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {e.permit.ent_lead ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {e.permit.da ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {e.permit.go_date ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {e.permit.target_submit ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {e.firstSubmitted ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {e.firstIntakeAccepted ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
                      {e.cityReviewDays !== null ? `${e.cityReviewDays}d` : '—'}
                    </td>
                    <td
                      className={`px-2 py-1.5 whitespace-nowrap text-right ${
                        e.variance === null
                          ? 'text-muted'
                          : e.variance > 0
                            ? 'text-[#dc2626]'
                            : 'text-pm'
                      }`}
                    >
                      {e.variance !== null
                        ? `${e.variance > 0 ? '+' : ''}${e.variance}d`
                        : '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                      {stage ? STAGE_LABELS[stage] ?? stage : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
