import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import {
  buildLibraryRows,
  filterLibraryRows,
  matchingUnitIndices,
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
import { STAGE_LABEL } from '../lib/stageLabel';
import { resolveUnitLabel } from '../lib/unitTypeNaming';
import { SkeletonRows } from './Skeleton';
import QueryError from './QueryError';

// Q6.3.a: Library matrix view (Settings → Library tab). Per-project
// lot/unit-dim matrix used to match new lots against past projects.
// Mirrors v1's renderMatrix layout (index.html lines 5717-5772) minus
// the dead-code Unit W×D column + unit-width filter (spike confirmed
// no DB column, no JSON data, orphan form fields in v1).

// fix-105: STAGE_LABEL is the shared map from src/lib/stageLabel.ts.

const STAGE_BADGE: Record<Stage, string> = {
  de: 'bg-de-bg text-de border-de-border',
  pm: 'bg-pm-bg text-pm border-pm-border',
  co: 'bg-co-bg text-co border-co-border',
  ap: 'bg-jv-bg text-jv border-jv-border',
  is: 'bg-is-bg text-is border-is-border',
};

// v1's Product Type dropdown options (index.html line 9365). Filter is
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
const INITIAL_FILTERS: LibraryFilters = {
  search: '',
  lotwTarget: null,
  lotwBuf: 2,
  lotdTarget: null,
  lotdBuf: 2,
  unitwTarget: null,
  unitwBuf: 2,
  unitdTarget: null,
  unitdBuf: 2,
  zone: '',
  alley: '',
  productTypes: [],
  tag: '',
  juris: '',
  // fix-122: new Library filters. numLots is exact-match (Bobby's
  // "show me 5-lot subdivisions" workflow); isCornerLot is tri-state.
  numLots: null,
  isCornerLot: '',
  // fix-205: Stories tier filter on a project's unit_types.
  stories: '',
};

function Body({ projects, permits }: BodyProps) {
  const [filters, setFilters] = useState<LibraryFilters>(INITIAL_FILTERS);
  const [sort, setSort] = useState<SortState>({ col: 'address', asc: true });
  // fix-81: per-row caret state. Map value: true=explicitly open,
  // false=explicitly closed. Missing key = "auto" (driven by unit
  // filter). Component-local; expansion isn't precious enough to
  // persist to localStorage.
  const [expandedById, setExpandedById] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const unitFilterActive =
    filters.unitwTarget !== null ||
    filters.unitdTarget !== null ||
    filters.stories !== '';

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
    setFilters(INITIAL_FILTERS);
  }

  function isExpanded(projectId: string): boolean {
    const explicit = expandedById.get(projectId);
    if (explicit !== undefined) return explicit;
    return unitFilterActive;
  }
  function toggleExpanded(projectId: string) {
    setExpandedById((prev) => {
      const next = new Map(prev);
      next.set(projectId, !isExpanded(projectId));
      return next;
    });
  }

  return (
    <div className="space-y-3" data-testid="library-matrix">
      {/* Search bar */}
      <input
        type="text"
        value={filters.search}
        onChange={(e) => update('search', e.target.value)}
        placeholder="Search by address or unit type name (space/comma separated tokens)…"
        className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
        data-testid="library-search"
      />

      {/* Filter bar */}
      <div className="bg-s2 border border-border rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div className="text-[10px] font-display font-extrabold text-text uppercase tracking-wide w-full -mb-1">
          Filter Projects
        </div>

        <TargetRange
          label="Lot Width (ft)"
          target={filters.lotwTarget}
          buf={filters.lotwBuf}
          onTarget={(v) => update('lotwTarget', v)}
          onBuf={(v) => update('lotwBuf', v)}
          testIdPrefix="lotw"
        />
        <TargetRange
          label="Lot Depth (ft)"
          target={filters.lotdTarget}
          buf={filters.lotdBuf}
          onTarget={(v) => update('lotdTarget', v)}
          onBuf={(v) => update('lotdBuf', v)}
          testIdPrefix="lotd"
        />

        <TargetRange
          label="Unit Width (ft)"
          target={filters.unitwTarget}
          buf={filters.unitwBuf}
          onTarget={(v) => update('unitwTarget', v)}
          onBuf={(v) => update('unitwBuf', v)}
          testIdPrefix="unitw"
        />
        <TargetRange
          label="Unit Depth (ft)"
          target={filters.unitdTarget}
          buf={filters.unitdBuf}
          onTarget={(v) => update('unitdTarget', v)}
          onBuf={(v) => update('unitdBuf', v)}
          testIdPrefix="unitd"
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

        {/* fix-122: Number of Lots filter — exact match against the
            projects.num_lots column. Blank = no filter; picking 1-20
            shows only projects whose num_lots equals the picked value.
            NULL num_lots rows fall out under any pick (intentional —
            Bobby's "apples-to-apples subdivision" workflow). */}
        <FieldLabel label="Lots">
          <select
            value={filters.numLots === null ? '' : String(filters.numLots)}
            onChange={(e) => {
              const v = e.target.value;
              update('numLots', v === '' ? null : Number(v));
            }}
            className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid="filter-num-lots"
          >
            <option value="">Any</option>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </FieldLabel>

        {/* fix-122: Corner Lot filter — tri-state mirroring Alley. */}
        <FieldLabel label="Corner">
          <select
            value={filters.isCornerLot}
            onChange={(e) =>
              update(
                'isCornerLot',
                e.target.value as '' | 'Yes' | 'No',
              )
            }
            className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid="filter-corner"
          >
            <option value="">Any</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </FieldLabel>

        {/* fix-205: Stories tier filter — matches a project that has at least
            one unit_type with the picked stories (4+ = 4 or more). Highlights
            the matching unit rows in the expand, like the W/D filters. */}
        <FieldLabel label="Stories">
          <select
            value={filters.stories}
            onChange={(e) =>
              update(
                'stories',
                e.target.value as LibraryFilters['stories'],
              )
            }
            className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
            data-testid="filter-stories"
          >
            <option value="">Any</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4+">4+</option>
          </select>
        </FieldLabel>

        <FieldLabel label="Product Type">
          {/* fix-91: multi-select. Pick adds a chip; chip × removes it.
              Matching is any-of in libraryHelpers.filterLibraryRows. */}
          <div className="flex flex-wrap items-center gap-1">
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (filters.productTypes.includes(v)) return;
                update('productTypes', [...filters.productTypes, v]);
                e.currentTarget.value = '';
              }}
              className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
              data-testid="filter-product-type"
            >
              <option value="">Any</option>
              {PRODUCT_TYPE_OPTIONS.filter(
                (t) => !filters.productTypes.includes(t),
              ).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {filters.productTypes.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-bg border border-border"
                data-testid={`filter-product-type-chip-${t}`}
              >
                {t}
                <button
                  type="button"
                  onClick={() =>
                    update(
                      'productTypes',
                      filters.productTypes.filter((x) => x !== t),
                    )
                  }
                  className="text-dim hover:text-text leading-none"
                  title={`Remove ${t}`}
                  data-testid={`filter-product-type-remove-${t}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
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
              <th
                className="px-1 py-1.5 w-6"
                aria-label="Expand row"
              />
              <Th sort={sort} col="address" onClick={toggleSort} align="left">Address</Th>
              <Th sort={sort} col="juris" onClick={toggleSort} align="left">Juris</Th>
              <Th sort={sort} col="productTypes" onClick={toggleSort} align="left">Type</Th>
              <Th sort={sort} col="units" onClick={toggleSort} align="center">Units</Th>
              {/* fix-122: Number of Lots — distinct from Units (a 5-lot
                  subdivision can yield 20 units). */}
              <Th sort={sort} col="numLots" onClick={toggleSort} align="center">Lots</Th>
              <Th sort={sort} col="zone" onClick={toggleSort} align="center">Zone</Th>
              <Th sort={sort} col="lotWidth" onClick={toggleSort} align="center">Lot W×D</Th>
              <Th sort={sort} col="alley" onClick={toggleSort} align="center">Alley</Th>
              {/* fix-122: Corner Lot — same dimensions feel very
                  different on a corner. */}
              <Th sort={sort} col="isCornerLot" onClick={toggleSort} align="center">Corner</Th>
              <th className="px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-text text-left">
                Tags
              </th>
              <Th sort={sort} col="stage" onClick={toggleSort} align="center">Stage</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row
                key={r.projectId}
                row={r}
                expanded={isExpanded(r.projectId)}
                onToggle={() => toggleExpanded(r.projectId)}
                matchedUnitIndices={
                  unitFilterActive
                    ? matchingUnitIndices(r, filters)
                    : null
                }
              />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={12}
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

interface RowProps {
  row: LibraryRow;
  expanded: boolean;
  onToggle: () => void;
  /** When a unit filter is active, this is the list of unit_type
   * indices that satisfied the filter — the nested table highlights
   * exactly those rows. Null when no unit filter is active (in which
   * case nothing gets highlighted). */
  matchedUnitIndices: number[] | null;
}
function Row({ row, expanded, onToggle, matchedUnitIndices }: RowProps) {
  const hasUnits = row.unitTypes.length > 0;
  return (
    <>
      <tr
        className="border-b border-border hover:bg-s2 transition"
        data-testid={`library-row-${row.projectId}`}
      >
        <td className="px-1 py-1.5 text-center align-middle">
          {hasUnits ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse unit types' : 'Expand unit types'}
              className="text-dim hover:text-text font-mono leading-none px-1 select-none"
              data-testid={`library-caret-${row.projectId}`}
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="text-dim/40" aria-hidden>
              ·
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 font-display font-bold text-text">
          <Link
            to={`/project/${row.projectId}`}
            className="hover:underline"
          >
            {row.address}
          </Link>
        </td>
        <td className="px-2 py-1.5 text-muted">{row.juris || '—'}</td>
        <td className="px-2 py-1.5 text-text">
          {row.productTypes.length === 0 ? (
            <span className="text-dim">—</span>
          ) : (
            row.productTypes.join(', ')
          )}
        </td>
        <td className="px-2 py-1.5 text-center font-mono font-bold text-text">
          {row.units || '—'}
        </td>
        {/* fix-122: Number of Lots column. NULL renders as the dim em
            dash same as other unset numerics. */}
        <td
          className="px-2 py-1.5 text-center font-mono text-text"
          data-testid={`library-num-lots-${row.projectId}`}
        >
          {row.numLots != null ? (
            row.numLots
          ) : (
            <span className="text-dim">—</span>
          )}
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
        {/* fix-122: Corner column. Tri-state — NULL renders as the dim
            em dash so unanswered rows are visually distinct from a
            confirmed No. */}
        <td
          className="px-2 py-1.5 text-center"
          data-testid={`library-corner-${row.projectId}`}
        >
          {row.isCornerLot === true ? (
            <span className="font-mono text-text">Yes</span>
          ) : row.isCornerLot === false ? (
            <span className="font-mono text-text">No</span>
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
      {expanded && hasUnits && (
        <tr
          className="border-b border-border bg-bg/40"
          data-testid={`library-expansion-${row.projectId}`}
        >
          <td />
          <td colSpan={11} className="px-2 pb-2 pt-1">
            <UnitTypeMiniTable
              projectId={row.projectId}
              unitTypes={row.unitTypes}
              productTypes={row.productTypes}
              matchedIndices={matchedUnitIndices}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function UnitTypeMiniTable({
  projectId,
  unitTypes,
  productTypes,
  matchedIndices,
}: {
  projectId: string;
  unitTypes: LibraryRow['unitTypes'];
  /** fix-205: drives the "unnamed" → single-product-type fallback for a
   *  blank-label row. */
  productTypes: string[];
  matchedIndices: number[] | null;
}) {
  const matchSet = matchedIndices ? new Set(matchedIndices) : null;
  return (
    <table
      className="w-full text-[11px]"
      data-testid={`library-unit-table-${projectId}`}
    >
      <thead>
        <tr className="text-dim">
          <th className="px-2 py-0.5 text-left text-[9px] font-extrabold uppercase tracking-wide">
            Type
          </th>
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Width
          </th>
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Depth
          </th>
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Qty
          </th>
          {/* fix-205: Stories column alongside Width/Depth/Qty. */}
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Stories
          </th>
        </tr>
      </thead>
      <tbody>
        {unitTypes.map((u, i) => {
          const matched = matchSet?.has(i) ?? false;
          // fix-205: a blank label resolves to the project's single product
          // type (so "unnamed" only shows when it genuinely can't be inferred).
          const resolvedLabel = resolveUnitLabel(u.label, productTypes);
          return (
            <tr
              key={i}
              data-testid={`library-unit-row-${projectId}-${i}`}
              data-matched={matched ? 'true' : undefined}
              className={
                matched
                  ? 'bg-de-bg/40 border-l-2 border-de'
                  : ''
              }
            >
              <td className="px-2 py-0.5 font-mono text-text">
                {resolvedLabel || (
                  <span className="text-dim italic">unnamed</span>
                )}
              </td>
              <td className="px-2 py-0.5 text-center font-mono text-text">
                {u.width_ft != null ? fmtDim(u.width_ft) : <span className="text-dim">—</span>}
              </td>
              <td className="px-2 py-0.5 text-center font-mono text-text">
                {u.depth_ft != null ? fmtDim(u.depth_ft) : <span className="text-dim">—</span>}
              </td>
              <td className="px-2 py-0.5 text-center font-mono text-text">
                {u.qty || <span className="text-dim">—</span>}
              </td>
              <td className="px-2 py-0.5 text-center font-mono text-text">
                {u.stories != null ? u.stories : <span className="text-dim">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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

function TargetRange({
  label,
  target,
  buf,
  onTarget,
  onBuf,
  testIdPrefix,
}: {
  label: string;
  target: number | null;
  buf: number;
  onTarget: (v: number | null) => void;
  onBuf: (v: number) => void;
  testIdPrefix: string;
}) {
  return (
    <FieldLabel label={label}>
      <div className="flex items-center gap-1 text-[10px] text-dim">
        <input
          type="number"
          min={0}
          value={target ?? ''}
          onChange={(e) =>
            onTarget(e.target.value === '' ? null : Number(e.target.value))
          }
          placeholder="Target"
          className="w-16 bg-bg border border-border rounded px-1 py-1 text-[11px] text-text text-center focus:outline-none focus:border-de"
          data-testid={`${testIdPrefix}-target`}
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
