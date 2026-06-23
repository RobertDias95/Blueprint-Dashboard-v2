import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
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
import { reorderLayoutIds } from '../../hooks/useReorderQuarterLayout';
import {
  useCloneQuarterLayout,
  useSeedQuarterLayoutFromCurrent,
} from '../../hooks/useBuildQuarterLayout';
import {
  useReplaceQuarterLayout,
  isReplaceConflict,
  layoutFingerprint,
  type ReplaceColumn,
} from '../../hooks/useReplaceQuarterLayout';
import {
  buildQuarterOptions,
  isMemberActiveInQuarter,
  quarterOffsetToString,
  quarterStringToOffset,
} from '../../lib/teamQuarterHelpers';
import { pushToast } from '../../stores/toastStore';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';

// fix-182b: per-quarter Draw Schedule column-layout editor (Settings → Team).
// Builds/edits the saved column order for a quarter so historical quarters can
// be backfilled and future ones arranged.
//
// fix-190c: edits are BUFFERED. The editor copies the loaded server rows into a
// local DRAFT; every change (field edit, type/DA/DM/group/top, add, delete,
// drag-reorder) mutates the draft ONLY — no RPC. The whole quarter persists
// atomically on an explicit Save (bp_replace_quarter_layout), and the user is
// warned before leaving a quarter (or the page) with unsaved changes. This
// fixes the bug where sitting on the wrong quarter silently rewrote it via the
// old per-edit RPC writes.
//
// Each column is a DA (col_kind='da'), a solo DM (col_kind='dm', fix-190a), or
// an OPEN placeholder lane (col_kind='open', no person). group_label is the
// manager header; top_label (fix-190b) is the regional/ent tier above it.

interface Props {
  /** role='da' members (active + former) for the DA dropdown. */
  das: TeamMember[];
  /** role='dm' members — DM dropdown + group-header datalist. */
  dms: TeamMember[];
  /** fix-190b: role='ent' members — top-tier datalist suggestions. Optional. */
  ents?: TeamMember[];
  readOnly?: boolean;
}

/** A column being edited locally. Mirrors the persisted column fields; `id` is
 *  the server row id for loaded rows or a synthetic `tmp-N` for added ones
 *  (used only for React keys + drag identity — never sent to the server). */
interface DraftRow {
  id: string;
  col_kind: DrawScheduleQuarterLayoutRow['col_kind'];
  da_name: string | null;
  group_label: string | null;
  label_override: string | null;
  top_label: string | null;
}

function toDraftRow(r: DrawScheduleQuarterLayoutRow): DraftRow {
  return {
    id: r.id,
    col_kind: r.col_kind,
    da_name: r.da_name,
    group_label: r.group_label,
    label_override: r.label_override,
    top_label: r.top_label,
  };
}

/** Normalize a text field for comparison/save: trimmed, blank → null. */
function blankToNull(s: string | null): string | null {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
}

function toReplaceColumn(r: DraftRow): ReplaceColumn {
  return {
    col_kind: r.col_kind,
    da_name: blankToNull(r.da_name),
    group_label: blankToNull(r.group_label),
    label_override: blankToNull(r.label_override),
    top_label: blankToNull(r.top_label),
  };
}

/** Order-sensitive content signature (ignores ids/positions/updated_at) used for
 *  the dirty check. Normalizes text fields so "  " vs null isn't a phantom diff. */
function rowsSig(
  rows: Pick<
    DraftRow,
    'col_kind' | 'da_name' | 'group_label' | 'label_override' | 'top_label'
  >[],
): string {
  return JSON.stringify(
    rows.map((r) => [
      r.col_kind,
      (r.da_name ?? '').trim(),
      (r.group_label ?? '').trim(),
      (r.label_override ?? '').trim(),
      (r.top_label ?? '').trim(),
    ]),
  );
}

export default function QuarterLayoutEditor({ das, dms, ents = [], readOnly = false }: Props) {
  const quarterOptions = useMemo(() => buildQuarterOptions(), []);
  const [quarter, setQuarter] = useState<string>(() => quarterOffsetToString(0));

  const layoutQ = useQuarterLayout(quarter);
  const clone = useCloneQuarterLayout();
  const seed = useSeedQuarterLayoutFromCurrent();
  const replace = useReplaceQuarterLayout();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // fix-190c: local draft + the loaded snapshot signature / OCC fingerprint.
  const serverRows = layoutQ.rows;
  const [draft, setDraft] = useState<DraftRow[]>([]);
  // The loaded server snapshot's content signature. State (not a ref) so the
  // dirty check can read it during render without tripping the no-refs-in-render
  // rule, and so adopting a new snapshot re-renders the dirty UI.
  const [snapshotSig, setSnapshotSig] = useState<string>(() => rowsSig([]));
  const [loadedFingerprint, setLoadedFingerprint] = useState<string | null>(null);
  const tmpCounter = useRef(0);

  // Adopt server rows into the draft on quarter switch (always) or when a fresh
  // fetch lands while the draft is clean (post-save / clone / seed / refetch).
  // A dirty draft is NOT clobbered by a background refetch.
  const prevQuarterRef = useRef<string | null>(null);
  const prevDataUpdatedAtRef = useRef<number>(0);
  function adoptServer(rows: DrawScheduleQuarterLayoutRow[]) {
    setDraft(rows.map(toDraftRow));
    setSnapshotSig(rowsSig(rows));
    setLoadedFingerprint(layoutFingerprint(rows));
  }
  useEffect(() => {
    const quarterChanged = prevQuarterRef.current !== quarter;
    const dataChanged = layoutQ.dataUpdatedAt !== prevDataUpdatedAtRef.current;
    if (!quarterChanged && !dataChanged) return;
    const clean = rowsSig(draft) === snapshotSig;
    if (quarterChanged || clean) adoptServer(serverRows);
    prevQuarterRef.current = quarter;
    prevDataUpdatedAtRef.current = layoutQ.dataUpdatedAt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarter, layoutQ.dataUpdatedAt, serverRows, draft]);

  const dirty = !readOnly && rowsSig(draft) !== snapshotSig;

  const groupSpans = useMemo(() => deriveGroupSpans(draft), [draft]);
  const prevQuarter = useMemo(
    () => quarterOffsetToString(quarterStringToOffset(quarter) - 1),
    [quarter],
  );

  // Dropdown / datalist options: roster names + whatever the DRAFT already uses
  // (so a departed person on a backfilled quarter still shows).
  const daNames = useMemo(() => {
    const s = new Set<string>(das.map((d) => d.name));
    for (const r of draft) if (r.da_name) s.add(r.da_name);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [das, draft]);
  const groupSuggestions = useMemo(() => {
    const s = new Set<string>(dms.map((d) => d.name));
    for (const r of draft) if (r.group_label) s.add(r.group_label);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [dms, draft]);
  const topSuggestions = useMemo(() => {
    const s = new Set<string>();
    for (const e of ents) s.add(e.name);
    for (const d of dms) s.add(d.name);
    for (const r of draft) if (r.top_label) s.add(r.top_label);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [ents, dms, draft]);
  const dmNames = useMemo(() => {
    const s = new Set<string>(dms.map((d) => d.name));
    for (const r of draft) if (r.col_kind === 'dm' && r.da_name) s.add(r.da_name);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [dms, draft]);

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

  // ---- draft mutators (no RPC) -------------------------------------------
  function patchRow(id: string, patch: Partial<DraftRow>) {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setDraft((d) => d.filter((r) => r.id !== id));
  }
  function appendRow(col: Omit<DraftRow, 'id'>) {
    tmpCounter.current += 1;
    setDraft((d) => [...d, { id: `tmp-${tmpCounter.current}`, ...col }]);
  }
  function reorderDraft(activeId: string, overId: string) {
    setDraft((d) => {
      const ids = reorderLayoutIds(d.map((r) => r.id), activeId, overId);
      const byId = new Map(d.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id)!);
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderDraft(String(active.id), String(over.id));
  }

  function addDaColumn(daName: string) {
    if (!daName) return;
    appendRow({ col_kind: 'da', da_name: daName, group_label: null, label_override: null, top_label: null });
  }
  function addDmColumn(dmName: string) {
    if (!dmName) return;
    appendRow({ col_kind: 'dm', da_name: dmName, group_label: dmName, label_override: null, top_label: null });
  }
  function addOpenLane() {
    appendRow({ col_kind: 'open', da_name: null, group_label: null, label_override: 'OPEN', top_label: null });
  }

  // ---- save / discard -----------------------------------------------------
  function handleSave() {
    replace.mutate(
      {
        quarter,
        rows: draft.map(toReplaceColumn),
        expectedFingerprint: loadedFingerprint,
      },
      {
        onSuccess: async () => {
          pushToast('Saved Draw Schedule layout', 'success');
          // Adopt the freshly-saved server state as the new snapshot (new
          // updated_at → new OCC fingerprint) so the draft is clean again. The
          // adopt-effect's clean-gate won't do this on its own — the draft still
          // differs from the OLD snapshot until we reset it here.
          const res = await layoutQ.refetch();
          adoptServer(res.data ?? []);
        },
        onError: async (err) => {
          if (isReplaceConflict(err)) {
            pushToast(
              `${quarter} changed elsewhere — reloaded the latest version`,
              'warn',
            );
            const res = await layoutQ.refetch();
            adoptServer(res.data ?? []);
          } else {
            pushToast(`Could not save layout — ${err.message}`, 'error');
          }
        },
      },
    );
  }
  function handleDiscard() {
    adoptServer(serverRows);
  }

  // ---- unsaved-changes guards --------------------------------------------
  // (a) quarter switch while dirty → confirm; cancel keeps the current quarter.
  function handleQuarterChange(next: string) {
    if (next === quarter) return;
    if (dirty && !window.confirm(`Discard unsaved changes to ${quarter}?`)) {
      return; // controlled <select> snaps back to `quarter`
    }
    setQuarter(next);
  }
  // (b) tab close / reload while dirty.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  // (c) in-app route change while dirty (data router → useBlocker).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Discard unsaved Draw Schedule layout changes?')) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  const showBootstrap = draft.length === 0 && !dirty;

  return (
    <div className="space-y-3" data-testid="quarter-layout-editor">
      <p className="text-xs text-muted">
        Build a saved column layout for a specific quarter — column order,
        manager grouping, OPEN placeholder lanes, and the regional/ent top tier.
        Changes are staged locally and only take effect when you press{' '}
        <span className="font-bold text-text">Save</span>.
      </p>

      {/* Quarter picker + Save/Discard toolbar. */}
      <div className="flex items-center flex-wrap gap-2">
        <label className="text-[10px] uppercase tracking-wide text-dim">
          Quarter
        </label>
        <select
          value={quarter}
          onChange={(e) => handleQuarterChange(e.target.value)}
          className="text-xs px-2 py-1 border border-border rounded bg-bg text-text"
          data-testid="ql-quarter-select"
        >
          {quarterOptions.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
        <span className="text-sm font-bold text-text" data-testid="ql-quarter-label">
          {quarter}
        </span>
        {dirty && (
          <span
            className="text-[10px] font-bold text-co whitespace-nowrap"
            data-testid="ql-unsaved-indicator"
          >
            ● Unsaved changes
          </span>
        )}
        {!readOnly && (
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleDiscard}
              disabled={!dirty || replace.isPending}
              className="px-3 py-1 text-xs rounded-md border border-border bg-bg text-dim font-display disabled:opacity-40"
              data-testid="ql-discard"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || replace.isPending}
              className="px-3 py-1.5 text-xs rounded-md border border-de bg-de text-white font-display font-bold disabled:opacity-40"
              data-testid="ql-save"
            >
              {replace.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {layoutQ.error ? (
        <QueryError
          title="Layout failed to load"
          error={layoutQ.error}
          onRetry={() => layoutQ.refetch()}
        />
      ) : layoutQ.isLoading ? (
        <SkeletonRows count={3} rowClassName="h-9" />
      ) : showBootstrap ? (
        <EmptyState
          quarter={quarter}
          prevQuarter={prevQuarter}
          readOnly={readOnly}
          busy={clone.isPending || seed.isPending}
          onDuplicatePrev={() => clone.mutate({ from: prevQuarter, to: quarter })}
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

          <datalist id="ql-group-suggestions">
            {groupSuggestions.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <datalist id="ql-top-suggestions">
            {topSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={draft.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1.5">
                {draft.map((row) => (
                  <ColumnRow
                    key={row.id}
                    row={row}
                    readOnly={readOnly}
                    daNames={daNames}
                    dmNames={dmNames}
                    inactiveInQuarter={
                      row.col_kind === 'da' &&
                      !!row.da_name &&
                      inactiveDaNames.has(row.da_name)
                    }
                    onChangeType={(kind) => {
                      if (kind === row.col_kind) return;
                      if (kind === 'open') {
                        patchRow(row.id, { col_kind: 'open', da_name: null });
                      } else if (kind === 'da') {
                        const da =
                          row.da_name && daNames.includes(row.da_name)
                            ? row.da_name
                            : daNames[0];
                        if (da) patchRow(row.id, { col_kind: 'da', da_name: da });
                      } else {
                        const dm =
                          row.da_name && dmNames.includes(row.da_name)
                            ? row.da_name
                            : dmNames[0];
                        if (dm) {
                          patchRow(row.id, {
                            col_kind: 'dm',
                            da_name: dm,
                            group_label: dm,
                          });
                        }
                      }
                    }}
                    onChangeDm={(dm) =>
                      patchRow(row.id, {
                        col_kind: 'dm',
                        da_name: dm,
                        group_label: dm,
                      })
                    }
                    onChangeDa={(da) => patchRow(row.id, { da_name: da })}
                    onChangeGroup={(label) => patchRow(row.id, { group_label: label })}
                    onChangeTop={(label) => patchRow(row.id, { top_label: label })}
                    onChangeLabel={(label) => patchRow(row.id, { label_override: label })}
                    onRemove={() => removeRow(row.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {!readOnly && (
            <AddControls
              daNames={daNames}
              dmNames={dmNames}
              onAddDa={addDaColumn}
              onAddDm={addDmColumn}
              onAddOpen={addOpenLane}
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
  dmNames,
  onAddDa,
  onAddDm,
  onAddOpen,
}: {
  daNames: string[];
  dmNames: string[];
  onAddDa: (da: string) => void;
  onAddDm: (dm: string) => void;
  onAddOpen: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <select
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) {
            onAddDa(v);
            e.currentTarget.value = '';
          }
        }}
        className="text-xs px-2 py-1 border border-border rounded bg-bg text-text"
        data-testid="ql-add-da-select"
      >
        <option value="">+ Add DA column…</option>
        {daNames.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      {/* fix-190a: add a solo-DM column (a DM working a lane with no DA beneath). */}
      <select
        defaultValue=""
        disabled={dmNames.length === 0}
        onChange={(e) => {
          const v = e.target.value;
          if (v) {
            onAddDm(v);
            e.currentTarget.value = '';
          }
        }}
        className="text-xs px-2 py-1 border border-border rounded bg-bg text-text disabled:opacity-50"
        data-testid="ql-add-dm-select"
      >
        <option value="">+ Add DM (solo) column…</option>
        {dmNames.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <button
        onClick={onAddOpen}
        className="px-3 py-1 text-xs rounded-md border border-border bg-bg text-dim font-display"
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
  dmNames,
  inactiveInQuarter,
  onChangeType,
  onChangeDa,
  onChangeDm,
  onChangeGroup,
  onChangeTop,
  onChangeLabel,
  onRemove,
}: {
  row: DraftRow;
  readOnly: boolean;
  daNames: string[];
  dmNames: string[];
  inactiveInQuarter: boolean;
  onChangeType: (kind: DraftRow['col_kind']) => void;
  onChangeDa: (da: string) => void;
  onChangeDm: (dm: string) => void;
  onChangeGroup: (label: string) => void;
  onChangeTop: (label: string) => void;
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
  const isDm = row.col_kind === 'dm';

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
      {/* fix-190a: per-column TYPE control (DA / DM solo / OPEN). */}
      <select
        value={row.col_kind}
        disabled={readOnly}
        onChange={(e) => onChangeType(e.target.value as DraftRow['col_kind'])}
        className={`text-[9px] uppercase font-bold px-1 py-1 rounded border border-border bg-bg disabled:opacity-50 ${
          isOpen ? 'text-dim' : 'text-co'
        }`}
        title="Column type"
        data-testid={`ql-type-${row.id}`}
      >
        <option value="da">DA</option>
        <option value="dm">DM</option>
        <option value="open">OPEN</option>
      </select>

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
          value={row.label_override ?? ''}
          placeholder="OPEN"
          disabled={readOnly}
          onChange={(e) => onChangeLabel(e.target.value)}
          className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1 min-w-0 disabled:opacity-50"
          data-testid={`ql-label-${row.id}`}
        />
      ) : isDm ? (
        <select
          value={row.da_name ?? ''}
          disabled={readOnly}
          onChange={(e) => onChangeDm(e.target.value)}
          className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1 min-w-0 disabled:opacity-50"
          data-testid={`ql-dm-${row.id}`}
        >
          {dmNames.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
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
        list="ql-group-suggestions"
        value={row.group_label ?? ''}
        placeholder="Manager (blank = standalone)"
        disabled={readOnly}
        onChange={(e) => onChangeGroup(e.target.value)}
        className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1 min-w-0 disabled:opacity-50"
        data-testid={`ql-group-${row.id}`}
      />

      {/* fix-190b: top-tier (regional/ent) header — free text; blank = none. */}
      <input
        list="ql-top-suggestions"
        value={row.top_label ?? ''}
        placeholder="Top tier (blank = none)"
        disabled={readOnly}
        onChange={(e) => onChangeTop(e.target.value)}
        className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1 min-w-0 disabled:opacity-50"
        data-testid={`ql-top-${row.id}`}
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
