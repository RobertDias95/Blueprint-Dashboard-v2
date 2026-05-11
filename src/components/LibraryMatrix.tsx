import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import {
  buildLibraryRows,
  filterLibraryRows,
  sortLibraryRows,
  type LibraryFilters,
  type LibraryRow,
  type SortableColumn,
  type SortState,
} from '../lib/libraryHelpers';
import type {
  PermitWithCycles,
  Project,
  Stage,
} from '../lib/database.types';
import { SkeletonRows } from './Skeleton';
import QueryError from './QueryError';

// Q6.3.a: Library matrix view (Settings → Library tab). Per-project
// lot/unit-dim matrix used to match new lots against past projects.
// Mirrors v1's renderMatrix layout (index.html lines 5717-5772) minus
// the dead-code Unit W×D column + unit-width filter (spike confirmed
// no DB column, no JSON data, orphan form fields in v1).

const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

const STAGE_BADGE: Record<Stage, string> = {
  de: 'bg-de-bg text-de border-de-border',
  pm: 'bg-pm-bg text-pm border-pm-border',
  co: 'bg-co-bg text-co border-co-border',
  ap: 'bg-jv-bg text-jv border-jv-border',
  is: 'bg-is-bg text-is border-is-border',
};

// v1's product_type dropdown options (index.html line 9365). Filter is
// exact-match so the list must match what's persisted in the column.
const PRODUCT_TYPE_OPTIONS = [
  'SFR',
  'SFR w/ Accessory Units',
  'Attached Units',
  'Cottages',
];

// v1's tag dropdown (index.html line 9377). Matches v1's `array.includes`
// predicate on each row's project_tags array.
const TAG_OPTIONS = ['ECA', 'SIP', 'TRAL', 'LBA', 'Short Plat'];

export default function LibraryMatrix() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();

  const error = projectsQ.error ?? permitsQ.error;
  if (error) {
    return (
      <QueryError
        title="Library failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
        }}
      />
    );
  }
  if (projectsQ.isLoading || permitsQ.isLoading) {
    return <SkeletonRows count={8} rowClassName="h-9" />;
  }

  return (
    <Body projects={projectsQ.data ?? []} permits={permitsQ.data ?? []} />
  );
}

interface BodyProps {
  projects: Project[];
  permits: PermitWithCycles[];
}
function Body({ projects, permits }: BodyProps) {
  const [filters, setFilters] = useState<LibraryFilters>({
    search: '',
    lotwMin: null,
    lotwMax: null,
    lotwBuf: 2,
    lotdMin: null,
    lotdMax: null,
    lotdBuf: 2,
    zone: '',
    alley: '',
    productType: '',
    tag: '',
    juris: '',
  });
  const [sort, setSort] = useState<SortState>({ col: 'address', asc: true });

  const allRows = useMemo(
    () => buildLibraryRows(projects, permits),
    [projects, permits],
  );

  const jurisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (r.juris) set.add(r.juris);
    return Array.from(set).sort();
  }, [allRows]);

  const filtered = useMemo(
    () => filterLibraryRows(allRows, filters),
    [allRows, filters],
  );
  const sorted = useMemo(
    () => sortLibraryRows(filtered, sort),
    [filtered, sort],
  );

  function toggleSort(col: SortableColumn) {
    setSort((prev) =>
      prev.col === col ? { col, asc: !prev.asc } : { col, asc: true },
    );
  }

  function update<K extends keyof LibraryFilters>(key: K, val: LibraryFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: val }));
  }
  function clearFilters() {
    setFilters({
      search: '',
      lotwMin: null,
      lotwMax: null,
      lotwBuf: 2,
      lotdMin: null,
      lotdMax: null,
      lotdBuf: 2,
      zone: '',
      alley: '',
      productType: '',
      tag: '',
      juris: '',
    });
  }

  return (
    <div className="space-y-3" data-testid="library-matrix">
      {/* Search bar */}
      <input
        type="text"
        value={filters.search}
        onChange={(e) => update('search', e.target.value)}
        placeholder="Search by address (space/comma separated tokens)…"
        className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
        data-testid="library-search"
      />

      {/* Filter bar */}
      <div className="bg-s2 border border-border rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div className="text-[10px] font-display font-extrabold text-text uppercase tracking-wide w-full -mb-1">
          Filter Projects
        </div>

        <DimRange
          label="Lot Width (ft)"
          min={filters.lotwMin}
          max={filters.lotwMax}
          buf={filters.lotwBuf}
          onMin={(v) => update('lotwMin', v)}
          onMax={(v) => update('lotwMax', v)}
          onBuf={(v) => update('lotwBuf', v)}
          testIdPrefix="lotw"
        />
        <DimRange
          label="Lot Depth (ft)"
          min={filters.lotdMin}
          max={filters.lotdMax}
          buf={filters.lotdBuf}
          onMin={(v) => update('lotdMin', v)}
          onMax={(v) => update('lotdMax', v)}
          onBuf={(v) => update('lotdBuf', v)}
          testIdPrefix="lotd"
        />

        <FieldLabel label="Zone">
          <input
            type="text"
            value={filters.zone}
            onChange={(e) => update('zone', e.target.value)}
            placeholder="e.g. NR"
            className="w-20 bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid="filter-zone"
          />
        </FieldLabel>

        <FieldLabel label="Alley">
          <select
            value={filters.alley}
            onChange={(e) => update('alley', e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid="filter-alley"
          >
            <option value="">Any</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </FieldLabel>

        <FieldLabel label="Unit Type">
          <select
            value={filters.productType}
            onChange={(e) => update('productType', e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid="filter-product-type"
          >
            <option value="">Any</option>
            {PRODUCT_TYPE_OPTIONS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FieldLabel>

        <FieldLabel label="Tag">
          <select
            value={filters.tag}
            onChange={(e) => update('tag', e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid="filter-tag"
          >
            <option value="">Any</option>
            {TAG_OPTIONS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FieldLabel>

        <FieldLabel label="Jurisdiction">
          <select
            value={filters.juris}
            onChange={(e) => update('juris', e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid="filter-juris"
          >
            <option value="">Any</option>
            {jurisOptions.map((j) => (
              <option key={j}>{j}</option>
            ))}
          </select>
        </FieldLabel>

        <button
          type="button"
          onClick={clearFilters}
          className="text-xs px-3 py-1 rounded border border-border bg-surface text-muted hover:bg-bg transition font-display"
          data-testid="filter-clear"
        >
          Clear
        </button>
        <span
          className="text-[11px] text-dim font-mono ml-auto"
          data-testid="library-count"
        >
          {sorted.length} project{sorted.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Matrix table */}
      <div className="bg-surface border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-xs" data-testid="library-table">
          <thead>
            <tr className="bg-s2 border-b-2 border-border">
              <Th sort={sort} col="address" onClick={toggleSort} align="left">Address</Th>
              <Th sort={sort} col="juris" onClick={toggleSort} align="left">Juris</Th>
              <Th sort={sort} col="productType" onClick={toggleSort} align="left">Type</Th>
              <Th sort={sort} col="units" onClick={toggleSort} align="center">Units</Th>
              <Th sort={sort} col="zone" onClick={toggleSort} align="center">Zone</Th>
              <Th sort={sort} col="lotWidth" onClick={toggleSort} align="center">Lot W×D</Th>
              <Th sort={sort} col="alley" onClick={toggleSort} align="center">Alley</Th>
              <th className="px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-text text-left">
                Tags
              </th>
              <Th sort={sort} col="stage" onClick={toggleSort} align="center">Stage</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row key={r.projectId} row={r} />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-xs text-dim italic"
                >
                  No projects match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  sort,
  col,
  onClick,
  align,
  children,
}: {
  sort: SortState;
  col: SortableColumn;
  onClick: (col: SortableColumn) => void;
  align: 'left' | 'center';
  children: React.ReactNode;
}) {
  const isActive = sort.col === col;
  const arrow = isActive ? (sort.asc ? '↑' : '↓') : '↕';
  const alignClass = align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      onClick={() => onClick(col)}
      className={`px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-text cursor-pointer select-none whitespace-nowrap ${alignClass} ${
        isActive ? 'text-text' : 'text-text/80'
      }`}
      data-testid={`library-th-${col}`}
    >
      {children} {arrow}
    </th>
  );
}

function Row({ row }: { row: LibraryRow }) {
  return (
    <tr
      className="border-b border-border hover:bg-s2 transition"
      data-testid={`library-row-${row.projectId}`}
    >
      <td className="px-2 py-1.5 font-display font-bold text-text">
        <Link
          to={`/project/${row.projectId}`}
          className="hover:underline"
        >
          {row.address}
        </Link>
      </td>
      <td className="px-2 py-1.5 text-muted">{row.juris || '—'}</td>
      <td className="px-2 py-1.5 text-text">{row.productType || '—'}</td>
      <td className="px-2 py-1.5 text-center font-mono font-bold text-text">
        {row.units || '—'}
      </td>
      <td className="px-2 py-1.5 text-center">
        {row.zone ? (
          <span className="font-mono text-text">{row.zone}</span>
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        {row.lotWidth && row.lotDepth ? (
          <span className="font-mono text-text">
            {fmtDim(row.lotWidth)}×{fmtDim(row.lotDepth)}
          </span>
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        {row.alley ? (
          <span className="font-mono text-text">{row.alley}</span>
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {row.tags.length === 0 ? (
          <span className="text-dim">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.tags.map((t) => (
              <span
                key={t}
                className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-de-bg text-de border border-de-border"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        <span
          className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border ${STAGE_BADGE[row.stage]}`}
        >
          {STAGE_LABEL[row.stage]}
        </span>
      </td>
    </tr>
  );
}

/** Trim trailing .00 on whole numbers; keep two decimals otherwise. */
function fmtDim(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] text-dim uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}

function DimRange({
  label,
  min,
  max,
  buf,
  onMin,
  onMax,
  onBuf,
  testIdPrefix,
}: {
  label: string;
  min: number | null;
  max: number | null;
  buf: number;
  onMin: (v: number | null) => void;
  onMax: (v: number | null) => void;
  onBuf: (v: number) => void;
  testIdPrefix: string;
}) {
  return (
    <FieldLabel label={label}>
      <div className="flex items-center gap-1 text-[10px] text-dim">
        <input
          type="number"
          min={0}
          value={min ?? ''}
          onChange={(e) =>
            onMin(e.target.value === '' ? null : Number(e.target.value))
          }
          placeholder="Min"
          className="w-14 bg-bg border border-border rounded px-1 py-1 text-[11px] text-text text-center focus:outline-none focus:border-de"
          data-testid={`${testIdPrefix}-min`}
        />
        <span>–</span>
        <input
          type="number"
          min={0}
          value={max ?? ''}
          onChange={(e) =>
            onMax(e.target.value === '' ? null : Number(e.target.value))
          }
          placeholder="Max"
          className="w-14 bg-bg border border-border rounded px-1 py-1 text-[11px] text-text text-center focus:outline-none focus:border-de"
          data-testid={`${testIdPrefix}-max`}
        />
        <span>±</span>
        <input
          type="number"
          min={0}
          value={buf}
          onChange={(e) => onBuf(Number(e.target.value) || 0)}
          className="w-10 bg-bg border border-border rounded px-1 py-1 text-[11px] text-text text-center focus:outline-none focus:border-de"
          data-testid={`${testIdPrefix}-buf`}
        />
      </div>
    </FieldLabel>
  );
}
