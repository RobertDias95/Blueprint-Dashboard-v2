import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useReportHub,
  useUpsertReportCategory,
  useDeleteReportCategory,
  useUpsertSavedReport,
  useDeleteSavedReport,
} from '../../hooks/useReportHub';
import { builtinReportDef } from '../../lib/builtinReports';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import type { ReportCategory, SavedReport } from '../../lib/database.types';

// fix-68: Reports hub — Settings -> Reporting (Phase 2). A tenant-owned
// category tree on the left + the selected category's saved reports on the
// right. The seeded "Weekly Updates" category holds the "Weekly DA Update"
// builtin, which Runs to /reports/weekly-da (same component + RPC as fix-67;
// just relocated here from the Reports top-nav tab).
//
// MVP scope (per the brief): up/down reorder (no drag-and-drop); "+ New
// Report" is present-but-disabled (Phase 3 freeform builder); builtins can't
// be deleted. Name entry / destructive confirms use window.prompt /
// window.confirm to keep the surface small — Phase 3 can upgrade to inline
// editors when the builder lands.

const ALL = '__all__';

interface Props {
  /** When rendered inside the Settings modal, the modal passes its onClose
   *  so running a report (which navigates) also dismisses the modal. Omitted
   *  on the standalone /settings/reporting route. */
  onAfterRun?: () => void;
}

export default function AdminReportingTab({ onAfterRun }: Props) {
  const hubQ = useReportHub();
  const upsertCategory = useUpsertReportCategory();
  const deleteCategory = useDeleteReportCategory();
  const upsertReport = useUpsertSavedReport();
  const deleteReport = useDeleteSavedReport();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<string>(ALL);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const categories = useMemo(
    () => hubQ.data?.categories ?? [],
    [hubQ.data],
  );
  const reports = useMemo(() => hubQ.data?.reports ?? [], [hubQ.data]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, ReportCategory[]>();
    for (const c of categories) {
      const key = c.parent_id;
      const list = m.get(key) ?? [];
      list.push(c);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    }
    return m;
  }, [categories]);

  // Reports for the selected category (ALL = uncategorized, category_id null).
  const visibleReports = useMemo(() => {
    const want = selected === ALL ? null : selected;
    return reports
      .filter((r) => (r.category_id ?? null) === want)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }, [reports, selected]);

  // Flattened category list for the Move dropdown (indent by depth). Declared
  // here (above the early returns) so the hook order stays stable.
  const flatForMove = useMemo(() => {
    const out: { id: string | null; label: string }[] = [
      { id: null, label: 'All Reports (uncategorized)' },
    ];
    function walk(parentId: string | null, depth: number) {
      for (const c of childrenOf.get(parentId) ?? []) {
        out.push({ id: c.id, label: `${'  '.repeat(depth)}${c.name}` });
        walk(c.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [childrenOf]);

  function nextPosition(siblingParent: string | null): number {
    const sibs = childrenOf.get(siblingParent) ?? [];
    return sibs.reduce((mx, c) => Math.max(mx, c.position), -1) + 1;
  }
  function nextReportPosition(categoryId: string | null): number {
    return reports
      .filter((r) => (r.category_id ?? null) === categoryId)
      .reduce((mx, r) => Math.max(mx, r.position), -1) + 1;
  }

  function addCategory(parentId: string | null) {
    const name = window.prompt(
      parentId ? 'New subcategory name:' : 'New category name:',
    );
    if (!name || !name.trim()) return;
    upsertCategory.mutate({
      parentId,
      name: name.trim(),
      position: nextPosition(parentId),
    });
  }

  function renameCategory(cat: ReportCategory) {
    const name = window.prompt('Rename category:', cat.name);
    if (!name || !name.trim()) return;
    upsertCategory.mutate({
      id: cat.id,
      parentId: cat.parent_id,
      name: name.trim(),
      position: cat.position,
    });
  }

  function removeCategory(cat: ReportCategory) {
    if (
      !window.confirm(
        `Delete category "${cat.name}"? Its reports + subcategories will move to the top level.`,
      )
    ) {
      return;
    }
    if (selected === cat.id) setSelected(ALL);
    deleteCategory.mutate({ id: cat.id });
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // --- report card actions --------------------------------------------------

  function runReport(r: SavedReport) {
    const def = builtinReportDef(r.builtin_key);
    if (!def) return; // custom reports run in Phase 3
    onAfterRun?.();
    navigate(def.route);
  }

  function renameReport(r: SavedReport) {
    const name = window.prompt('Rename report:', r.name);
    if (!name || !name.trim()) return;
    upsertReport.mutate({
      id: r.id,
      categoryId: r.category_id,
      name: name.trim(),
      description: r.description,
      position: r.position,
    });
  }

  function moveReport(r: SavedReport, categoryId: string | null) {
    upsertReport.mutate({
      id: r.id,
      categoryId,
      name: r.name,
      description: r.description,
      position: nextReportPosition(categoryId),
    });
  }

  function removeReport(r: SavedReport) {
    if (r.kind === 'builtin') return; // guarded in UI + server
    if (!window.confirm(`Delete report "${r.name}"?`)) return;
    deleteReport.mutate({ id: r.id });
  }

  // Swap a report's position with its neighbor in the current list.
  function reorder(index: number, dir: -1 | 1) {
    const a = visibleReports[index];
    const b = visibleReports[index + dir];
    if (!a || !b) return;
    upsertReport.mutate({
      id: a.id,
      categoryId: a.category_id,
      name: a.name,
      description: a.description,
      position: b.position,
    });
    upsertReport.mutate({
      id: b.id,
      categoryId: b.category_id,
      name: b.name,
      description: b.description,
      position: a.position,
    });
  }

  if (hubQ.error) {
    return (
      <QueryError
        title="Reporting hub failed to load"
        error={hubQ.error}
        onRetry={() => hubQ.refetch()}
      />
    );
  }
  if (hubQ.isLoading) {
    return <SkeletonRows count={3} rowClassName="h-24" />;
  }

  const selectedName =
    selected === ALL
      ? 'All Reports'
      : categories.find((c) => c.id === selected)?.name ?? 'All Reports';

  return (
    <div className="space-y-3" data-testid="reporting-hub">
      <p className="text-[11px] text-muted">
        Organize saved reports into folders. Click a report&apos;s{' '}
        <strong>Run</strong> to open it. Custom reports arrive in Phase 3.
      </p>

      <div className="flex gap-3 items-start">
        {/* LEFT: category tree */}
        <div
          className="flex-shrink-0 bg-surface border border-border rounded-lg p-2"
          style={{ width: 220 }}
          data-testid="reporting-categories"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-dim">
              Categories
            </span>
            <button
              type="button"
              onClick={() => addCategory(null)}
              className="text-[10px] font-display font-semibold px-1.5 py-0.5 rounded border border-de text-de bg-de/5 hover:bg-de/10 transition"
              data-testid="reporting-add-category"
            >
              + Category
            </button>
          </div>

          {/* All Reports virtual root */}
          <CategoryRow
            label="All Reports"
            depth={0}
            active={selected === ALL}
            onSelect={() => setSelected(ALL)}
            testid="reporting-cat-all"
          />

          {renderTree(null, 0)}
        </div>

        {/* RIGHT: reports in the selected category */}
        <div className="flex-1 min-w-0 bg-surface border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-display font-bold text-text">
              {selectedName}
            </h2>
            <span
              className="inline-block"
              title="Coming in Phase 3 (freeform builder)"
              data-testid="reporting-new-report-wrap"
            >
              <button
                type="button"
                disabled
                className="text-[11px] font-display font-semibold px-2.5 py-1 rounded border border-border bg-s2 text-dim cursor-not-allowed"
                data-testid="reporting-new-report"
              >
                + New Report
              </button>
            </span>
          </div>

          {visibleReports.length === 0 ? (
            <div
              className="text-xs text-dim italic px-3 py-6 bg-s2 border border-border rounded text-center"
              data-testid="reporting-empty"
            >
              No reports in this category.
            </div>
          ) : (
            <div className="space-y-2" data-testid="reporting-report-list">
              {visibleReports.map((r, i) => (
                <ReportCard
                  key={r.id}
                  report={r}
                  isFirst={i === 0}
                  isLast={i === visibleReports.length - 1}
                  runnable={!!builtinReportDef(r.builtin_key)}
                  moveOptions={flatForMove}
                  onRun={() => runReport(r)}
                  onRename={() => renameReport(r)}
                  onMove={(catId) => moveReport(r, catId)}
                  onDelete={() => removeReport(r)}
                  onUp={() => reorder(i, -1)}
                  onDown={() => reorder(i, 1)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Recursive category tree render (defined inline so it closes over state).
  function renderTree(parentId: string | null, depth: number): React.ReactNode {
    const rows = childrenOf.get(parentId) ?? [];
    return rows.map((cat) => {
      const hasChildren = (childrenOf.get(cat.id) ?? []).length > 0;
      const isCollapsed = collapsed.has(cat.id);
      return (
        <div key={cat.id}>
          <CategoryRow
            label={cat.name}
            depth={depth + 1}
            active={selected === cat.id}
            hasChildren={hasChildren}
            collapsed={isCollapsed}
            onToggle={hasChildren ? () => toggleCollapse(cat.id) : undefined}
            onSelect={() => setSelected(cat.id)}
            onAddSub={() => addCategory(cat.id)}
            onRename={() => renameCategory(cat)}
            onDelete={() => removeCategory(cat)}
            testid={`reporting-cat-${cat.id}`}
          />
          {hasChildren && !isCollapsed && renderTree(cat.id, depth + 1)}
        </div>
      );
    });
  }
}

function CategoryRow({
  label,
  depth,
  active,
  hasChildren,
  collapsed,
  onToggle,
  onSelect,
  onAddSub,
  onRename,
  onDelete,
  testid,
}: {
  label: string;
  depth: number;
  active: boolean;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  onAddSub?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  testid: string;
}) {
  return (
    <div
      className={`group flex items-center gap-1 rounded px-1 py-1 cursor-pointer transition ${
        active ? 'bg-de/10' : 'hover:bg-s2'
      }`}
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={onSelect}
      data-testid={testid}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className="text-[10px] text-dim w-3 flex-shrink-0"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      ) : (
        <span className="w-3 flex-shrink-0" />
      )}
      <span
        className={`flex-1 min-w-0 truncate text-[11px] ${
          active ? 'font-bold text-de' : 'text-text'
        }`}
      >
        {label}
      </span>
      {/* Per-row actions (hover-reveal). Absent on the All Reports root. */}
      {(onAddSub || onRename || onDelete) && (
        <span className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
          {onAddSub && (
            <ActionIcon title="Add subcategory" onClick={onAddSub} testid={`${testid}-addsub`}>
              ＋
            </ActionIcon>
          )}
          {onRename && (
            <ActionIcon title="Rename" onClick={onRename} testid={`${testid}-rename`}>
              ✎
            </ActionIcon>
          )}
          {onDelete && (
            <ActionIcon title="Delete" onClick={onDelete} testid={`${testid}-delete`} danger>
              ✕
            </ActionIcon>
          )}
        </span>
      )}
    </div>
  );
}

function ActionIcon({
  children,
  title,
  onClick,
  testid,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  testid: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`text-[10px] leading-none px-1 py-0.5 rounded border ${
        danger
          ? 'border-co-border text-co hover:bg-co-bg'
          : 'border-border text-muted hover:bg-s3'
      }`}
      data-testid={testid}
    >
      {children}
    </button>
  );
}

function ReportCard({
  report,
  isFirst,
  isLast,
  runnable,
  moveOptions,
  onRun,
  onRename,
  onMove,
  onDelete,
  onUp,
  onDown,
}: {
  report: SavedReport;
  isFirst: boolean;
  isLast: boolean;
  runnable: boolean;
  moveOptions: { id: string | null; label: string }[];
  onRun: () => void;
  onRename: () => void;
  onMove: (categoryId: string | null) => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const isBuiltin = report.kind === 'builtin';
  return (
    <div
      className="bg-s2 border border-border rounded-lg p-3"
      data-testid={`reporting-report-${report.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-text truncate">
              {report.name}
            </span>
            {isBuiltin && (
              <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-px rounded bg-de/10 text-de">
                Builtin
              </span>
            )}
          </div>
          {report.description && (
            <div className="text-[11px] text-muted mt-0.5 leading-snug">
              {report.description}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {/* Reorder */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onUp}
              disabled={isFirst}
              title="Move up"
              className="text-[10px] px-1 py-0.5 rounded border border-border text-muted hover:bg-s3 disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid={`reporting-report-${report.id}-up`}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={onDown}
              disabled={isLast}
              title="Move down"
              className="text-[10px] px-1 py-0.5 rounded border border-border text-muted hover:bg-s3 disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid={`reporting-report-${report.id}-down`}
            >
              ↓
            </button>
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <button
          type="button"
          onClick={onRun}
          disabled={!runnable}
          title={runnable ? 'Open this report' : 'Custom reports run in Phase 3'}
          className="text-[11px] font-display font-semibold px-2.5 py-1 rounded border border-de bg-de text-white hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid={`reporting-report-${report.id}-run`}
        >
          ▶ Run
        </button>
        <button
          type="button"
          onClick={onRename}
          className="text-[11px] px-2 py-1 rounded border border-border text-text hover:bg-s3"
          data-testid={`reporting-report-${report.id}-rename`}
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => setMoving((v) => !v)}
          className="text-[11px] px-2 py-1 rounded border border-border text-text hover:bg-s3"
          data-testid={`reporting-report-${report.id}-move`}
        >
          Move
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isBuiltin}
          title={isBuiltin ? 'Builtin reports cannot be deleted' : 'Delete report'}
          className="text-[11px] px-2 py-1 rounded border border-co-border bg-co-bg text-co hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid={`reporting-report-${report.id}-delete`}
        >
          Delete
        </button>
      </div>

      {moving && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10px] text-dim">Move to:</span>
          <select
            className="text-[11px] px-1.5 py-1 border border-border rounded bg-bg text-text outline-none"
            data-testid={`reporting-report-${report.id}-move-select`}
            defaultValue={report.category_id ?? ''}
            onChange={(e) => {
              onMove(e.target.value || null);
              setMoving(false);
            }}
          >
            {moveOptions.map((o) => (
              <option key={o.id ?? '__null__'} value={o.id ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
