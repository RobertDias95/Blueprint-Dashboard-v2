import { useMemo, useState } from 'react';
import type { ReportColumnType } from '../../lib/database.types';

// fix-69: shared sortable result table for custom reports. Used by both the
// Custom Report viewer and the builder's Preview. Client-side sort on header
// click (type-aware); dates formatted; portal_url rendered as a link.

export interface ResultColumnMeta {
  key: string;
  label: string;
  type: ReportColumnType;
}

interface Props {
  columns: ResultColumnMeta[];
  rows: Array<Record<string, unknown>>;
}

function fmtDate(v: unknown): string {
  if (typeof v !== 'string' || v === '') return v == null ? '' : String(v);
  const d = new Date(v.length <= 10 ? v + 'T12:00:00' : v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function compare(a: unknown, b: unknown, type: ReportColumnType): number {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an && bn) return 0;
  if (an) return 1; // nulls last
  if (bn) return -1;
  if (type === 'number') return Number(a) - Number(b);
  if (type === 'date') {
    return new Date(String(a)).getTime() - new Date(String(b)).getTime();
  }
  if (type === 'boolean') return Number(Boolean(a)) - Number(Boolean(b));
  return String(a).localeCompare(String(b));
}

export default function ReportResultTable({ columns, rows }: Props) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(
    null,
  );

  const typeByKey = useMemo(() => {
    const m = new Map<string, ReportColumnType>();
    for (const c of columns) m.set(c.key, c.type);
    return m;
  }, [columns]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const type = typeByKey.get(sort.key) ?? 'text';
    const copy = [...rows];
    copy.sort((ra, rb) => {
      const r = compare(ra[sort.key], rb[sort.key], type);
      return sort.dir === 'desc' ? -r : r;
    });
    return copy;
  }, [rows, sort, typeByKey]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click clears
    });
  }

  if (rows.length === 0) {
    return (
      <div
        className="text-xs text-dim italic px-3 py-6 bg-s2 border border-border rounded text-center"
        data-testid="report-result-empty"
      >
        No rows matched.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full border-collapse text-[11px]" data-testid="report-result-table">
        <thead>
          <tr style={{ background: 'var(--color-s2)' }}>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="px-2 py-1.5 text-left text-[9px] font-extrabold text-text uppercase tracking-wider border-b cursor-pointer select-none whitespace-nowrap hover:bg-s3"
                  style={{ borderColor: 'var(--color-border)' }}
                  data-testid={`report-col-${c.key}`}
                >
                  {c.label}
                  {active && (
                    <span className="ml-1 text-dim">
                      {sort?.dir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr
              key={i}
              className="border-b last:border-b-0"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid={`report-result-row-${i}`}
            >
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-1 text-text align-top whitespace-nowrap">
                  <Cell value={row[c.key]} type={c.type} colKey={c.key} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  value,
  type,
  colKey,
}: {
  value: unknown;
  type: ReportColumnType;
  colKey: string;
}) {
  if (value == null || value === '') return <span className="text-dim">—</span>;
  if (colKey === 'portal_url' && typeof value === 'string') {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-de hover:underline"
      >
        link ↗
      </a>
    );
  }
  if (type === 'date') return <span className="font-mono">{fmtDate(value)}</span>;
  if (type === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  return <span>{String(value)}</span>;
}
