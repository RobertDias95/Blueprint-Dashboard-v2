import { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TeamMember, DrawScheduleQuarterLayoutRow } from '../../lib/database.types';
import { deriveGroupSpans } from '../../lib/quarterLayoutHelpers';
import { useQuarterLayout } from '../../hooks/useQuarterLayout';
import { useUpsertQuarterLayoutRow } from '../../hooks/useUpsertQuarterLayoutRow';
import { useDeleteQuarterLayoutRow } from '../../hooks/useDeleteQuarterLayoutRow';
import {
  reorderLayoutIds,
  useReorderQuarterLayout,
} from '../../hooks/useReorderQuarterLayout';
import {
  useCloneQuarterLayout,
  useSeedQuarterLayoutFromCurrent,
} from '../../hooks/useBuildQuarterLayout';
import { useAppendQuarterLayoutColumn } from '../../hooks/useAddQuarterLayoutColumn';
import {
  buildQuarterOptions,
  isMemberActiveInQuarter,
  quarterOffsetToString,
  quarterStringToOffset,
} from '../../lib/teamQuarterHelpers';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';

// fix-182b: per-quarter Draw Schedule column-layout editor (Settings → Team).
// Builds/edits the saved column order for a quarter so historical quarters can
// be backfilled and future ones arranged. NOTHING here affects the live grid
// yet — Phase C wires the render. Reads/writes draw_schedule_quarter_layout via
// the Phase A RPCs (+ the Phase B seed helper).
//
// Each column is a DA (col_kind='da') or an OPEN placeholder lane
// (col_kind='open', no person). A free-text group_label is the manager header
// spanning the contiguous run of columns sharing it (blank = standalone). The
// preview strip mirrors the grid's span logic so the admin sees the grouping.

interface Props {
  /** role='da' members (active + former) for the DA dropdown. */
  das: TeamMember[];
  /** role='dm' members — datalist suggestions for the group header field. */
  dms: TeamMember[];
  readOnly?: boolean;
}

export default function QuarterLayoutEditor({ das, dms, readOnly = false }: Props) {
  const quarterOptions = useMemo(() => buildQuarterOptions(), []);
  const [quarter, setQuarter] = useState<string>(() => quarterOffsetToString(0));

  const layoutQ = useQuarterLayout(quarter);
  const upsert = useUpsertQuarterLayoutRow();
  const remove = useDeleteQuarterLayoutRow();
  const reorder = useReorderQuarterLayout();
  const clone = useCloneQuarterLayout();
  const seed = useSeedQuarterLayoutFromCurrent();
  const append = useAppendQuarterLayoutColumn();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const rows = layoutQ.rows;
  const groupSpans = useMemo(() => deriveGroupSpans(rows), [rows]);
  const prevQuarter = useMemo(
    () => quarterOffsetToString(quarterStringToOffset(quarter) - 1),
    [quarter],
  );

  // DA dropdown options: every role='da' name, plus any name already on a
  // column this quarter (so a departed DA on a backfilled quarter still shows).
  const daNames = useMemo(() => {
    const s = new Set<string>(das.map((d) => d.name));
    for (const r of rows) if (r.da_name) s.add(r.da_name);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [das, rows]);

  // Group-header suggestions: DM names + group_labels already in use.
  const groupSuggestions = useMemo(() => {
    const s = new Set<string>(dms.map((d) => d.name));
    for (const r of rows) if (r.group_label) s.add(r.group_label);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [dms, rows]);

  // fix-183: which DAs are inactive (per active-quarters) in the selected
  // quarter — so the editor flags a column the grid would dim, keeping the two
  // in agreement. A DA with no team_members row defaults active.
  const inactiveDaNames = useMemo(() => {
    const s = new Set<string>();
    for (const d of das) {
      if (d.role !== 'da') continue;
      if (
        !isMemberActiveInQuarter(
          d.active_start_quarter,
          d.active_end_quarter,
          quarter,
        )
      ) {
        s.add(d.name);
      }
    }
    return s;
  }, [das, quarter]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = reorderLayoutIds(
      rows.map((r) => r.id),
      String(active.id),
      String(over.id),
    );
    reorder.mutate({ quarter, ids: next });
  }

  // fix-182d: adds ALWAYS append server-side (position computed in the RPC),
  // never from rows.length — this is what prevents the rapid-double-add
  // duplicate-key collision.
  function addDaColumn(daName: string) {
    if (!daName) return;
    append.mutate({
      quarter,
      col: { col_kind: 'da', da_name: daName, group_label: null, label_override: null },
    });
  }

  function addOpenLane() {
    append.mutate({
      quarter,
      col: { col_kind: 'open', da_name: null, group_label: null, label_override: 'OPEN' },
    });
  }

  return (
    <div className="space-y-3" data-testid="quarter-layout-editor">
      <p className="text-xs text-muted">
        Build a saved column layout for a specific quarter — column order,
        manager grouping, and OPEN placeholder lanes. This does not change the
        live Draw Schedule yet; it captures how a quarter should look so past
        quarters can be reproduced exactly.
      </p>

      {/* Quarter picker */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wide text-dim">
          Quarter
        </label>
        <select
          value={quarter}
          onChange={(e) => setQuarter(e.target.value)}
          className="text-xs px-2 py-1 border border-border rounded bg-bg text-text"
          data-testid="ql-quarter-select"
        >
          {quarterOptions.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </div>

      {layoutQ.error ? (
        <QueryError
          title="Layout failed to load"
          error={layoutQ.error}
          onRetry={() => layoutQ.refetch()}
        />
      ) : layoutQ.isLoading ? (
        <SkeletonRows count={3} rowClassName="h-9" />
      ) : rows.length === 0 ? (
        <EmptyState
          quarter={quarter}
          prevQuarter={prevQuarter}
          readOnly={readOnly}
          busy={clone.isPending || seed.isPending}
          onDuplicatePrev={() =>
            clone.mutate({ from: prevQuarter, to: quarter })
          }
          onSeedCurrent={() => seed.mutate({ quarter })}
        />
      ) : (
        <>
          {/* Manager-group preview strip (mirrors the grid's header spans). */}
          <div
            className="flex gap-1 text-[10px] font-display"
            data-testid="ql-group-preview"
          >
            {groupSpans.map((g, i) => (
              <div
                key={`${g.label ?? '∅'}-${i}`}
                className={`px-2 py-1 rounded text-center border ${
                  g.label
                    ? 'bg-co-bg border-co-border text-co font-bold'
                    : 'bg-surface-2 border-border text-dim italic'
                }`}
                style={{ flex: `${g.count} 1 0` }}
                title={g.label ? `Manager: ${g.label}` : 'Standalone column'}
              >
                {g.label ?? 'standalone'}
              </div>
            ))}
          </div>

          {/* Single shared datalist for every row's manager-header field. */}
          <datalist id="ql-group-suggestions">
            {groupSuggestions.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={rows.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1.5">
                {rows.map((row) => (
                  <ColumnRow
                    key={row.id}
                    row={row}
                    readOnly={readOnly}
                    daNames={daNames}
                    inactiveInQuarter={
                      row.col_kind === 'da' &&
                      !!row.da_name &&
                      inactiveDaNames.has(row.da_name)
                    }
                    onChangeDa={(da) =>
                      da !== row.da_name &&
                      upsert.mutate({ op: 'update', row, patch: { da_name: da } })
                    }
                    onChangeGroup={(label) => {
                      const next = label.trim() === '' ? null : label.trim();
                      if (next !== row.group_label) {
                        upsert.mutate({ op: 'update', row, patch: { group_label: next } });
                      }
                    }}
                    onChangeLabel={(label) => {
                      const next = label.trim() === '' ? null : label.trim();
                      if (next !== row.label_override) {
                        upsert.mutate({
                          op: 'update',
                          row,
                          patch: { label_override: next },
                        });
                      }
                    }}
                    onRemove={() =>
                      remove.mutate({
                        id: row.id,
                        updated_at: row.updated_at,
                        quarter,
                      })
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {!readOnly && (
            <AddControls
              daNames={daNames}
              onAddDa={addDaColumn}
              onAddOpen={addOpenLane}
              disabled={append.isPending}
            />
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({
  quarter,
  prevQuarter,
  readOnly,
  busy,
  onDuplicatePrev,
  onSeedCurrent,
}: {
  quarter: string;
  prevQuarter: string;
  readOnly: boolean;
  busy: boolean;
  onDuplicatePrev: () => void;
  onSeedCurrent: () => void;
}) {
  return (
    <div
      className="bg-surface-2 border border-border rounded-lg p-4 space-y-3"
      data-testid="ql-empty-state"
    >
      <p className="text-xs text-muted">
        <span className="font-bold text-text">{quarter}</span> has no saved
        layout — the Draw Schedule uses the current/default team structure for
        this quarter. Create a layout to arrange it independently:
      </p>
      {readOnly ? (
        <p className="text-[11px] text-dim italic">
          You need tenant admin to create a layout.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onDuplicatePrev}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-md border border-de bg-de/10 text-de font-display font-bold disabled:opacity-50"
            data-testid="ql-duplicate-prev"
          >
            Duplicate {prevQuarter}
          </button>
          <button
            onClick={onSeedCurrent}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-md border border-border bg-bg text-text font-display disabled:opacity-50"
            data-testid="ql-seed-current"
          >
            Start from current team structure
          </button>
        </div>
      )}
    </div>
  );
}

function AddControls({
  daNames,
  onAddDa,
  onAddOpen,
  disabled,
}: {
  daNames: string[];
  onAddDa: (da: string) => void;
  onAddOpen: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <select
        defaultValue=""
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v) {
            onAddDa(v);
            e.currentTarget.value = '';
          }
        }}
        className="text-xs px-2 py-1 border border-border rounded bg-bg text-text disabled:opacity-50"
        data-testid="ql-add-da-select"
      >
        <option value="">+ Add DA column…</option>
        {daNames.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <button
        onClick={onAddOpen}
        disabled={disabled}
        className="px-3 py-1 text-xs rounded-md border border-border bg-bg text-dim font-display disabled:opacity-50"
        data-testid="ql-add-open"
      >
        + Insert OPEN lane
      </button>
    </div>
  );
}

function ColumnRow({
  row,
  readOnly,
  daNames,
  inactiveInQuarter,
  onChangeDa,
  onChangeGroup,
  onChangeLabel,
  onRemove,
}: {
  row: DrawScheduleQuarterLayoutRow;
  readOnly: boolean;
  daNames: string[];
  inactiveInQuarter: boolean;
  onChangeDa: (da: string) => void;
  onChangeGroup: (label: string) => void;
  onChangeLabel: (label: string) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled: readOnly });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isOpen = row.col_kind === 'open';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 bg-surface border border-border rounded-md px-2 py-1.5"
      data-testid={`ql-row-${row.id}`}
    >
      {!readOnly && (
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="text-dim hover:text-text cursor-grab active:cursor-grabbing leading-none px-1 touch-none"
          title="Drag to reorder"
          aria-label="Drag to reorder"
          data-testid={`ql-drag-${row.id}`}
        >
          ⠿
        </button>
      )}
      <span
        className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
          isOpen ? 'bg-surface-2 text-dim' : 'bg-co-bg text-co'
        }`}
      >
        {isOpen ? 'OPEN' : 'DA'}
      </span>

      {/* fix-183: flag a column whose DA isn't on the team in this quarter, so
          the editor agrees with the dimmed grid column. */}
      {inactiveInQuarter && (
        <span
          className="text-[9px] uppercase tracking-wide text-co font-bold whitespace-nowrap"
          title="Not on the team this quarter (per Active Quarters) — the Draw Schedule dims this column"
          data-testid={`ql-inactive-${row.id}`}
        >
          inactive
        </span>
      )}

      {isOpen ? (
        <input
          key={row.updated_at}
          defaultValue={row.label_override ?? ''}
          placeholder="OPEN"
          disabled={readOnly}
          onBlur={(e) => onChangeLabel(e.target.value)}
          className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1 min-w-0 disabled:opacity-50"
          data-testid={`ql-label-${row.id}`}
        />
      ) : (
        <select
          value={row.da_name ?? ''}
          disabled={readOnly}
          onChange={(e) => onChangeDa(e.target.value)}
          className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1 min-w-0 disabled:opacity-50"
          data-testid={`ql-da-${row.id}`}
        >
          {daNames.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )}

      <input
        key={`grp-${row.updated_at}`}
        list="ql-group-suggestions"
        defaultValue={row.group_label ?? ''}
        placeholder="Manager (blank = standalone)"
        disabled={readOnly}
        onBlur={(e) => onChangeGroup(e.target.value)}
        className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1 min-w-0 disabled:opacity-50"
        data-testid={`ql-group-${row.id}`}
      />

      {!readOnly && (
        <button
          onClick={onRemove}
          className="text-dim hover:text-co text-sm leading-none px-1"
          title="Remove column"
          data-testid={`ql-remove-${row.id}`}
        >
          ×
        </button>
      )}
    </div>
  );
}
