import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import NewProjectWizard from '../components/NewProjectWizard';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useAllPermitCycleReviewers } from '../hooks/useAllPermitCycleReviewers';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  buildProjectRows,
  filterProjectRows,
  sortProjectRows,
  loadFilters,
  saveFilters,
  loadSort,
  saveSort,
  DEFAULT_FILTERS,
  STAGE_BADGE,
  STAGE_LABEL,
  STAGE_ORDER,
  type ProjectRow,
  type ProjectViewFilters,
  type SortState,
  type SortableColumn,
} from '../lib/projectViewHelpers';
import type { Stage, TeamMember } from '../lib/database.types';

// fix-90: Project View overhaul. Bobby's Monday triage workspace.
//
// Surface a filterable + sortable project list, with per-row caret
// expansion that shows every permit on the project + its stage + a
// reviewer rollup. The default tabs/filters are tuned for "any permit
// in corrections" since that's the primary use case (Monday meeting
// with Miles + Bri reviews every project with a corrections-stage
// permit AND looks at the rest of the permits on each one).
//
// Filter + sort state persist to localStorage so a refresh keeps the
// triage view intact; expansion state is component-local on purpose
// (expansion isn't precious enough to persist).

const QUICK_STAGES: Stage[] = ['de', 'pm', 'co', 'ap', 'is'];

export default function ProjectList() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const reviewersQ = useAllPermitCycleReviewers();
  const teamQ = useTeamMembers();

  const isLoading =
    projectsQ.isLoading || permitsQ.isLoading || reviewersQ.isLoading;
  const error = projectsQ.error ?? permitsQ.error ?? reviewersQ.error;

  const [filters, setFilters] = useState<ProjectViewFilters>(() => loadFilters());
  const [sort, setSort] = useState<SortState>(() => loadSort());
  const [expandedById, setExpandedById] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [wizardOpen, setWizardOpen] = useState(false);

  // Persist filter + sort changes immediately so a tab close mid-triage
  // doesn't lose state.
  useEffect(() => {
    saveFilters(filters);
  }, [filters]);
  useEffect(() => {
    saveSort(sort);
  }, [sort]);

  const allRows = useMemo(
    () =>
      buildProjectRows(
        projectsQ.data ?? [],
        permitsQ.data ?? [],
        reviewersQ.data ?? [],
      ),
    [projectsQ.data, permitsQ.data, reviewersQ.data],
  );
  const filtered = useMemo(
    () => filterProjectRows(allRows, filters),
    [allRows, filters],
  );
  const sorted = useMemo(() => sortProjectRows(filtered, sort), [filtered, sort]);

  const jurisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (r.project.juris) set.add(r.project.juris);
    return Array.from(set).sort();
  }, [allRows]);

  const entLeadOptions = useMemo(
    () => uniqueNamesByRole(teamQ.all ?? [], (r) => r === 'ent' || r === 'ent_lead'),
    [teamQ.all],
  );
  const daOptions = useMemo(
    () => uniqueNamesByRole(teamQ.all ?? [], (r) => r === 'da'),
    [teamQ.all],
  );

  function patch(p: Partial<ProjectViewFilters>) {
    setFilters((prev) => ({ ...prev, ...p }));
  }
  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  function toggleSort(col: SortableColumn) {
    setSort((prev) =>
      prev.col === col ? { col, asc: !prev.asc } : { col, asc: true },
    );
  }

  function toggleExpanded(projectId: string) {
    setExpandedById((prev) => {
      const next = new Map(prev);
      next.set(projectId, !(prev.get(projectId) ?? false));
      return next;
    });
  }

  if (error) {
    return (
      <QueryError
        title="Project View failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
          reviewersQ.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="project-view">
      <FilterRow
        filters={filters}
        jurisOptions={jurisOptions}
        entLeadOptions={entLeadOptions}
        daOptions={daOptions}
        onPatch={patch}
        onReset={resetFilters}
        totalCount={allRows.length}
        matchCount={sorted.length}
        onAddProject={() => setWizardOpen(true)}
      />
      <NewProjectWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {isLoading ? (
        <SkeletonRows count={6} rowClassName="h-12" />
      ) : sorted.length === 0 ? (
        <div
          className="text-sm text-dim italic px-2 py-12 text-center bg-surface border border-border rounded-xl"
          data-testid="project-view-empty"
        >
          No projects match your filters.{' '}
          <button
            type="button"
            onClick={resetFilters}
            className="underline text-de hover:opacity-80"
            data-testid="project-view-empty-reset"
          >
            Reset
          </button>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-xs" data-testid="project-view-table">
            <thead>
              <tr className="bg-s2 border-b-2 border-border">
                <th className="px-1 py-1.5 w-6" aria-label="Expand row" />
                <Th sort={sort} col="address" onClick={toggleSort} align="left">Address</Th>
                <Th sort={sort} col="juris" onClick={toggleSort} align="left">Juris</Th>
                <Th sort={sort} col="go_date" onClick={toggleSort} align="left">Go Date</Th>
                <Th sort={sort} col="ent_lead" onClick={toggleSort} align="left">Ent</Th>
                <Th sort={sort} col="da" onClick={toggleSort} align="left">DA</Th>
                <Th sort={sort} col="permits" onClick={toggleSort} align="center">Permits</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <ProjectRowView
                  key={row.project.id}
                  row={row}
                  expanded={expandedById.get(row.project.id) ?? false}
                  onToggle={() => toggleExpanded(row.project.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Filter row
// ============================================================

function FilterRow({
  filters,
  jurisOptions,
  entLeadOptions,
  daOptions,
  onPatch,
  onReset,
  totalCount,
  matchCount,
  onAddProject,
}: {
  filters: ProjectViewFilters;
  jurisOptions: string[];
  entLeadOptions: string[];
  daOptions: string[];
  onPatch: (p: Partial<ProjectViewFilters>) => void;
  onReset: () => void;
  totalCount: number;
  matchCount: number;
  onAddProject: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded border"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="project-view-filterrow"
    >
      <input
        type="text"
        value={filters.search}
        onChange={(e) => onPatch({ search: e.target.value })}
        placeholder="Search address, tags, notes…"
        className="text-[12px] px-2 py-1 border rounded outline-none min-w-[200px]"
        style={inputStyle()}
        data-testid="project-view-search"
      />

      {/* Stage chips — multi-select; click toggles in/out. Corrections is
          the Monday-triage primary; rendering it first keeps the most-
          used filter under the user's thumb. */}
      <div
        className="flex items-center gap-1"
        data-testid="project-view-stage-chips"
      >
        {QUICK_STAGES.map((s) => {
          const on = filters.stages.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => {
                onPatch({
                  stages: on
                    ? filters.stages.filter((x) => x !== s)
                    : [...filters.stages, s],
                });
              }}
              className="text-[11px] px-2 py-0.5 rounded border"
              style={chipStyle(on)}
              data-testid={`project-view-stage-chip-${s}`}
            >
              {STAGE_LABEL[s]}
            </button>
          );
        })}
      </div>

      <MultiSelect
        label="Ent"
        options={entLeadOptions}
        selected={filters.entLeads}
        onChange={(next) => onPatch({ entLeads: next })}
        testid="project-view-filter-ent"
      />
      <MultiSelect
        label="DA"
        options={daOptions}
        selected={filters.das}
        onChange={(next) => onPatch({ das: next })}
        testid="project-view-filter-da"
      />
      <MultiSelect
        label="Juris"
        options={jurisOptions}
        selected={filters.jurises}
        onChange={(next) => onPatch({ jurises: next })}
        testid="project-view-filter-juris"
      />

      <span
        className="text-[11px] text-muted font-mono ml-auto"
        data-testid="project-view-count"
      >
        {totalCount} total · {matchCount} match
      </span>
      <button
        type="button"
        onClick={onReset}
        className="text-[11px] px-2 py-1 rounded border"
        style={chipStyle(false)}
        data-testid="project-view-filter-reset"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={onAddProject}
        className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition"
        data-testid="project-view-new-project"
      >
        + Add New Project
      </button>
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  testid,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  testid: string;
}) {
  const available = options.filter((o) => !selected.includes(o));
  return (
    <div className="flex items-center gap-1" data-testid={testid}>
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          if (selected.includes(v)) return;
          onChange([...selected, v]);
          e.currentTarget.value = '';
        }}
        disabled={options.length === 0}
        className="text-[12px] px-2 py-1 border rounded"
        style={inputStyle()}
        data-testid={`${testid}-select`}
      >
        <option value="">{label}</option>
        {available.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {selected.map((n) => (
        <span
          key={n}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
          style={chipBg()}
          data-testid={`${testid}-chip-${n}`}
        >
          {n}
          <button
            type="button"
            onClick={() => onChange(selected.filter((x) => x !== n))}
            className="text-dim hover:text-text leading-none"
            title={`Remove ${n}`}
            data-testid={`${testid}-remove-${n}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

// ============================================================
// Table row + nested permits
// ============================================================

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
      data-testid={`project-view-th-${col}`}
    >
      {children} {arrow}
    </th>
  );
}

function ProjectRowView({
  row,
  expanded,
  onToggle,
}: {
  row: ProjectRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasPermits = row.permits.length > 0;
  return (
    <>
      <tr
        className="border-b border-border hover:bg-s2 transition"
        data-testid={`project-view-row-${row.project.id}`}
      >
        <td className="px-1 py-1.5 text-center align-middle">
          {hasPermits ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse permits' : 'Expand permits'}
              className="text-dim hover:text-text font-mono leading-none px-1 select-none"
              data-testid={`project-view-caret-${row.project.id}`}
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
            to={`/project/${row.project.id}`}
            className="hover:underline"
            data-testid={`project-view-link-${row.project.id}`}
          >
            {row.project.address}
          </Link>
        </td>
        <td className="px-2 py-1.5 text-muted">{row.project.juris ?? '—'}</td>
        <td className="px-2 py-1.5 font-mono text-text">
          {row.project.go_date ?? <span className="text-dim">—</span>}
        </td>
        <td className="px-2 py-1.5 text-text">
          {row.bpAnchor?.ent_lead ?? <span className="text-dim">—</span>}
        </td>
        <td className="px-2 py-1.5 text-text">
          {row.bpAnchor?.da ?? <span className="text-dim">—</span>}
        </td>
        <td className="px-2 py-1.5 text-center font-mono font-bold text-text">
          {row.permits.length || '—'}
        </td>
      </tr>
      {expanded && hasPermits && (
        <tr
          className="border-b border-border bg-bg/40"
          data-testid={`project-view-expansion-${row.project.id}`}
        >
          <td />
          <td colSpan={6} className="px-2 pb-2 pt-1">
            <PermitMiniTable row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function PermitMiniTable({ row }: { row: ProjectRow }) {
  return (
    <table
      className="w-full text-[11px]"
      data-testid={`project-view-permit-table-${row.project.id}`}
    >
      <thead>
        <tr className="text-dim">
          <th className="px-2 py-0.5 text-left text-[9px] font-extrabold uppercase tracking-wide">
            Permit
          </th>
          <th className="px-2 py-0.5 text-left text-[9px] font-extrabold uppercase tracking-wide">
            #
          </th>
          <th className="px-2 py-0.5 text-left text-[9px] font-extrabold uppercase tracking-wide">
            Stage
          </th>
          <th className="px-2 py-0.5 text-left text-[9px] font-extrabold uppercase tracking-wide">
            Reviewers
          </th>
        </tr>
      </thead>
      <tbody>
        {row.permits.map((p) => (
          <tr
            key={p.permit.id}
            data-testid={`project-view-permit-row-${row.project.id}-${p.permit.id}`}
          >
            <td className="px-2 py-0.5 text-text">
              <Link
                to={`/project/${row.project.id}?permit=${p.permit.id}`}
                className="hover:underline"
              >
                {p.permit.type ?? '—'}
              </Link>
            </td>
            <td className="px-2 py-0.5 font-mono text-muted">
              {p.permit.num ?? <span className="text-dim">—</span>}
            </td>
            <td className="px-2 py-0.5">
              {/* fix-90: same STAGE_BADGE palette as LibraryMatrix +
                  Schedule Health so the color reads consistently across
                  the app. */}
              {STAGE_ORDER.includes(p.stage) && (
                <span
                  className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border ${STAGE_BADGE[p.stage]}`}
                  data-testid={`project-view-stage-badge-${p.permit.id}`}
                >
                  {STAGE_LABEL[p.stage]}
                </span>
              )}
            </td>
            <td
              className="px-2 py-0.5 text-text"
              data-testid={`project-view-reviewer-${p.permit.id}`}
            >
              {p.reviewer.total === 0 ? (
                <span className="text-dim">no reviewers</span>
              ) : (
                <span className="font-mono">
                  {p.reviewer.approved} of {p.reviewer.total} signed off
                  {p.reviewer.correctionsRequired > 0 && (
                    <span className="text-co">
                      {' '}
                      · {p.reviewer.correctionsRequired}⚠
                    </span>
                  )}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// Helpers (page-local)
// ============================================================

function uniqueNamesByRole(
  members: TeamMember[],
  match: (role: TeamMember['role']) => boolean,
): string[] {
  const set = new Set<string>();
  for (const m of members) {
    if (!match(m.role)) continue;
    if (m.active === false) continue;
    set.add(m.name);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function inputStyle() {
  return {
    borderColor: 'var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  };
}
function chipBg() {
  return {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };
}
function chipStyle(active: boolean) {
  return {
    borderColor: active ? 'var(--color-de)' : 'var(--color-border)',
    background: active ? 'var(--color-de)' : 'var(--color-bg)',
    color: active ? '#fff' : 'var(--color-text)',
  };
}
