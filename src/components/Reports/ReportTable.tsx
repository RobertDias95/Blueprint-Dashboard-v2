import { useMemo, useState } from 'react';
import {
  aggregateByProject,
  type EnrichedPermit,
  type ProjectRow,
} from '../../lib/reportMetrics';
import { effectiveStage } from '../../lib/permitStage';

// Q9.5.f-fix-4: v1 Permit Ledger parity. ReportTable shifts from per-permit
// rows to per-project rows; each row aggregates day metrics + key dates
// across the project's permits and expands to show individual permits on
// click (v1 :1158-1196).
//
// Column set widened from 12 → 19 to match the v1 ledger. Horizontal
// scroll handles narrow viewports. Sort is keyed on the aggregate values
// (so e.g. sorting by 'go' uses earliestGoDate).

type SortKey =
  | 'address'
  | 'juris'
  | 'stage'
  | 'ent'
  | 'da'
  | 'dm'
  | 'go'
  | 'approval'
  | 'actual'
  | 'variance';

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const STAGE_LABELS: Record<string, string> = {
  de: 'D&E',
  pm: 'PM',
  co: 'CO',
  ap: 'Approved',
  is: 'Issued',
};

interface ColDef {
  key: SortKey | null; // null when not sortable
  label: string;
  numeric?: boolean;
  testIdKey?: string;
}

// Order mirrors v1's ledger header at :1158-1196. Day-metric columns sort
// is omitted to keep the sort enum small — Bobby's tests only exercise
// address/juris/go, and the other agg columns sort logically by their
// underlying date field (e.g. variance ties back to approval date).
const COLS: ColDef[] = [
  { key: 'address', label: 'Address' },
  { key: null, label: 'Permits' },
  { key: 'stage', label: 'Stage' },
  { key: 'ent', label: 'ENT' },
  { key: 'da', label: 'DA' },
  { key: 'dm', label: 'DM' },
  { key: 'juris', label: 'Juris' },
  { key: null, label: 'GO→DD', numeric: true, testIdKey: 'go-dd' },
  { key: null, label: 'DD Dur.', numeric: true, testIdKey: 'dd-dur' },
  { key: null, label: 'DD→Sub', numeric: true, testIdKey: 'dd-sub' },
  { key: null, label: 'GO→Sub', numeric: true, testIdKey: 'go-sub' },
  { key: null, label: 'Sub→Int', numeric: true, testIdKey: 'sub-int' },
  { key: null, label: 'Review', numeric: true, testIdKey: 'review' },
  { key: null, label: 'ACQ Target' },
  { key: 'go', label: 'GO' },
  { key: 'approval', label: 'Approval' },
  { key: 'actual', label: 'Actual Issue' },
  { key: 'variance', label: 'Var.', numeric: true },
  { key: null, label: 'Rounds', numeric: true, testIdKey: 'rounds' },
  { key: null, label: 'Units', numeric: true, testIdKey: 'units' },
];

function sortValue(row: ProjectRow, key: SortKey): string | number | null {
  switch (key) {
    case 'address':
      return row.address;
    case 'juris':
      return row.juris;
    case 'stage':
      return row.dominantStage;
    case 'ent':
      return row.ent ?? '';
    case 'da':
      return row.da ?? '';
    case 'dm':
      return row.dm ?? '';
    case 'go':
      return row.earliestGoDate ?? '';
    case 'approval':
      return row.earliestApproval ?? '';
    case 'actual':
      return row.earliestActualIssue ?? '';
    case 'variance':
      return row.variance;
  }
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
  dir: 'asc' | 'desc',
): number {
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

function fmtDays(n: number | null): string {
  if (n === null) return '—';
  return `${n}d`;
}

export default function ReportTable({
  permits,
}: {
  permits: EnrichedPermit[];
}) {
  const [sort, setSort] = useState<SortState>({ key: 'go', dir: 'desc' });
  // Q9.5.f-fix-4: expand-on-click state. project_ids whose row is expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(() => aggregateByProject(permits), [permits]);

  const sorted = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) =>
      compareValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir),
    );
    return copy;
  }, [rows, sort]);

  function onHeaderClick(key: SortKey | null) {
    if (!key) return;
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }
  function toggleExpand(projectId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-testid="report-table"
    >
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
          Permit Ledger ({rows.length} project{rows.length === 1 ? '' : 's'} ·{' '}
          {permits.length} permit{permits.length === 1 ? '' : 's'})
        </div>
        <div className="text-[10px] text-dim">
          Click address to expand permits · click columns to sort
        </div>
      </div>
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="min-w-full text-[11px]">
          <thead className="bg-surface-2 sticky top-0">
            <tr>
              {COLS.map((col) => {
                const active = col.key !== null && sort.key === col.key;
                const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
                const tid = col.testIdKey ?? col.key ?? col.label.toLowerCase();
                return (
                  <th
                    key={tid}
                    onClick={() => onHeaderClick(col.key)}
                    className={`px-2 py-2 text-left font-display font-bold text-[10px] uppercase tracking-wide select-none whitespace-nowrap ${
                      col.key !== null ? 'cursor-pointer' : ''
                    } ${active ? 'text-text' : 'text-muted hover:text-text'} ${col.numeric ? 'text-right' : ''}`}
                    data-testid={`report-table-header-${tid}`}
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
              sorted.flatMap((row) => {
                const isOpen = expanded.has(row.projectId);
                const children: React.ReactNode[] = [
                  <ProjectRowTr
                    key={row.projectId}
                    row={row}
                    open={isOpen}
                    onToggle={() => toggleExpand(row.projectId)}
                  />,
                ];
                if (isOpen) {
                  for (const permit of row.permits) {
                    children.push(
                      <PermitDetailTr
                        key={`${row.projectId}-${permit.permit.id}`}
                        permit={permit}
                      />,
                    );
                  }
                }
                return children;
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectRowTr({
  row,
  open,
  onToggle,
}: {
  row: ProjectRow;
  open: boolean;
  onToggle: () => void;
}) {
  const stageLabel = STAGE_LABELS[row.dominantStage] ?? row.dominantStage ?? '—';
  return (
    <tr
      className="border-t border-border/40 hover:bg-surface-2"
      data-testid={`report-table-row-${row.projectId}`}
    >
      <td
        onClick={onToggle}
        className="px-2 py-1.5 whitespace-nowrap text-text cursor-pointer font-bold"
      >
        <span
          className="inline-block mr-1 text-dim"
          style={{
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        >
          ▶
        </span>
        {row.address || '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.permitCount} permit{row.permitCount === 1 ? '' : 's'}
        {row.activeCount > 0 && (
          <span className="ml-1 text-de">· {row.activeCount} active</span>
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">{stageLabel}</td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">{row.ent ?? '—'}</td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">{row.da ?? '—'}</td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">{row.dm ?? '—'}</td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">{row.juris || '—'}</td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {fmtDays(row.avgGoToDDStart)}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {fmtDays(row.avgDDDuration)}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {fmtDays(row.avgDDEndToSubmit)}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {fmtDays(row.avgGoToSubmit)}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {fmtDays(row.avgSubmitToIntake)}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {fmtDays(row.avgCityReview)}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.latestAcqTarget ?? '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.earliestGoDate ?? '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.earliestApproval ?? '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.earliestActualIssue ?? '—'}
      </td>
      <td
        className={`px-2 py-1.5 whitespace-nowrap text-right ${
          row.variance === null
            ? 'text-muted'
            : row.variance > 0
              ? 'text-[#dc2626]'
              : 'text-pm'
        }`}
      >
        {row.variance !== null
          ? `${row.variance > 0 ? '+' : ''}${row.variance}d`
          : '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {row.maxCorrRounds || '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {row.unitsSum ?? '—'}
      </td>
    </tr>
  );
}

function PermitDetailTr({ permit: e }: { permit: EnrichedPermit }) {
  const stage = effectiveStage(e.permit, e.permit.permit_cycles ?? []);
  const stageLabel = STAGE_LABELS[stage] ?? stage ?? '—';
  return (
    <tr
      className="border-t border-border/20"
      style={{ background: 'var(--color-bg)' }}
      data-testid={`report-table-detail-${e.permit.id}`}
    >
      <td className="px-2 py-1 pl-8 whitespace-nowrap text-muted text-[10px]">
        ↳ {e.permit.type ?? '—'}
        {e.permit.num && (
          <span className="ml-1 text-dim font-mono">{e.permit.num}</span>
        )}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">—</td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {stageLabel}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.ent_lead ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.da ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.dm ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.juris || '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.goToDDStart)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.ddDuration)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.ddEndToSubmit)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.goToSubmit)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.submitToIntake)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.cityReviewDays)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.expected_issue ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.go_date ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.approval_date ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.actual_issue ?? '—'}
      </td>
      <td
        className={`px-2 py-1 whitespace-nowrap text-[10px] text-right ${
          e.variance === null
            ? 'text-dim'
            : e.variance > 0
              ? 'text-[#dc2626]'
              : 'text-pm'
        }`}
      >
        {e.variance !== null
          ? `${e.variance > 0 ? '+' : ''}${e.variance}d`
          : '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {(e.permit.permit_cycles ?? []).length || '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {e.permit.units ?? '—'}
      </td>
    </tr>
  );
}
