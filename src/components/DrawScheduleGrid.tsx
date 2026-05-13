import { useMemo, useState } from 'react';
import { useDrawSchedule } from '../hooks/useDrawSchedule';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useDmDaGroups } from '../hooks/useDmDaGroups';
import { useUpdateDrawSchedule } from '../hooks/useUpdateDrawSchedule';
import { useResolveDaOverlap } from '../hooks/useResolveDaOverlap';
import { useDaTimeBlocks } from '../hooks/useDaTimeBlocks';
import { useUpsertDaTimeBlock } from '../hooks/useUpsertDaTimeBlock';
import { useDeleteDaTimeBlock } from '../hooks/useDeleteDaTimeBlock';
import NpBlockEditPopup from './NpBlockEditPopup';
import ProjectBlockPopup from './DrawSchedule/ProjectBlockPopup';
import {
  DS_STATUS_COLORS,
  NP_BLOCK_COLOR,
  addWeeksToWeekKey,
  computeNpSegments,
  dateToWeekKey,
  decideDrop,
  findNpConflictsForDrop,
  getMonday,
  getQuarterLabel,
  getQuarterWeeks,
  jurisBorder,
  multiMatchAddress,
  type DropBlock,
  type NpConflict,
} from '../lib/drawScheduleHelpers';
import { SkeletonRows } from './Skeleton';
import QueryError from './QueryError';
import OverlapPrompt from './OverlapPrompt';
import NpWarningPrompt, { type NpWarningEntry } from './NpWarningPrompt';
import type {
  DaTimeBlock,
  DrawScheduleRow,
  Permit,
  PermitCycle,
  Project,
} from '../lib/database.types';
import { deriveBlockStatus } from '../lib/drawScheduleStatus';

// Q6.1: read-only render of all draw_schedule rows. Mirrors v1's
// renderDrawSchedule layout (index.html lines 7875-8090):
//   - DM header row (sticky), DA header row (sticky)
//   - Body: week labels column (left) + one column per DA
//   - Project blocks absolutely positioned in their DA column, spanning
//     [startWeek..endWeek] vertically
//   - Quarter navigator + search at top
//   - Unscheduled lane below the grid
//
// Q6.2: drag-to-edit. Drop on (DA, week) → preserves duration → either saves
// silently (no overlap) or surfaces the Option B conflict prompt with the
// list of blocked projects. Cascade RPC ("Push Down") ships in Q6.2.b.

const ROW_H = 28;
const LABEL_W = 64;
/** What we ship in the HTML5 drag's dataTransfer payload. JSON-encoded so
 * jsdom + browsers both round-trip it cleanly via getData/setData. */
interface DragPayload {
  projectId: string;
  durationWeeks: number;
  expectedUpdatedAt: string;
  status: string | null;
}
interface PendingOverlap {
  /** Absolute address of the dragged project, for the prompt header. */
  anchorAddress: string;
  /** Addresses of the projects that would be displaced. */
  conflictingAddresses: string[];
  /** Count for the prompt heading. */
  conflictCount: number;
  /** Captured at drop time so onConfirm can call bp_resolve_da_overlap with
   * the same target the user just released over. */
  anchorProjectId: string;
  expectedUpdatedAt: string;
  daAssigned: string;
  startWeek: string;
  endWeek: string;
  scheduleStatus: string | null;
}

/** Q6.2.f: popover state for the add-NP / edit-NP flow. Position is
 * captured at click-time so the popup floats next to the source cell. */
type NpPopupState =
  | { mode: 'add'; daName: string; weekKey: string; x: number; y: number }
  | { mode: 'edit'; block: DaTimeBlock; x: number; y: number }
  | null;

interface PendingNpWarning {
  anchorAddress: string;
  daName: string;
  conflicts: NpWarningEntry[];
  /** Same target context as the project-overlap path, since "Save anyway"
   * fires the silent useUpdateDrawSchedule path with these args. */
  anchorProjectId: string;
  expectedUpdatedAt: string;
  daAssigned: string;
  startWeek: string;
  endWeek: string;
  scheduleStatus: string | null;
}

export default function DrawScheduleGrid() {
  const drawQ = useDrawSchedule();
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const groupsQ = useDmDaGroups();
  const npBlocksQ = useDaTimeBlocks();

  const [quarterOffset, setQuarterOffset] = useState(0);
  const [search, setSearch] = useState('');

  const error =
    drawQ.error ?? projectsQ.error ?? groupsQ.error ?? npBlocksQ.error;
  if (error) {
    return (
      <QueryError
        title="Draw schedule failed to load"
        error={error}
        onRetry={() => {
          drawQ.refetch();
          projectsQ.refetch();
          groupsQ.refetch();
          npBlocksQ.refetch();
        }}
      />
    );
  }

  const isLoading =
    drawQ.isLoading ||
    projectsQ.isLoading ||
    groupsQ.isLoading ||
    npBlocksQ.isLoading;
  if (isLoading) {
    return <SkeletonRows count={8} rowClassName="h-7" />;
  }

  return (
    <DrawScheduleBody
      draw={drawQ.data ?? []}
      projects={projectsQ.data ?? []}
      permits={permitsQ.data ?? []}
      groups={groupsQ.groups}
      npBlocks={npBlocksQ.data ?? []}
      quarterOffset={quarterOffset}
      setQuarterOffset={setQuarterOffset}
      search={search}
      setSearch={setSearch}
    />
  );
}

interface BodyProps {
  draw: DrawScheduleRow[];
  projects: Project[];
  permits: (Permit & { permit_cycles?: PermitCycle[] })[];
  groups: { dm: string; das: string[] }[];
  npBlocks: DaTimeBlock[];
  quarterOffset: number;
  setQuarterOffset: (n: number) => void;
  search: string;
  setSearch: (s: string) => void;
}

function DrawScheduleBody({
  draw,
  projects,
  permits,
  groups,
  npBlocks,
  quarterOffset,
  setQuarterOffset,
  search,
  setSearch,
}: BodyProps) {
  // Q9.5.g: lookup tables for deriveBlockStatus per block render.
  // permitsByProjectId groups permits at each project (deriveBlockStatus
  // filters to BPs internally). cyclesByPermit indexes the cycles array
  // attached via the usePermits .select('*, permit_cycles(*)') nested query.
  const permitsByProjectId = useMemo(() => {
    const m = new Map<string, Permit[]>();
    for (const p of permits) {
      const list = m.get(p.project_id) ?? [];
      list.push(p);
      m.set(p.project_id, list);
    }
    return m;
  }, [permits]);

  const cyclesByPermit = useMemo(() => {
    const m = new Map<number, PermitCycle[]>();
    for (const p of permits) {
      m.set(p.id, p.permit_cycles ?? []);
    }
    return m;
  }, [permits]);
  const weeks = useMemo(() => getQuarterWeeks(quarterOffset), [quarterOffset]);
  const currentWeek = useMemo(() => dateToWeekKey(getMonday(new Date())), []);

  const updateMutation = useUpdateDrawSchedule();
  const resolveMutation = useResolveDaOverlap();
  const upsertNp = useUpsertDaTimeBlock();
  const deleteNp = useDeleteDaTimeBlock();
  const [pendingOverlap, setPendingOverlap] = useState<PendingOverlap | null>(
    null,
  );
  const [pendingNpWarning, setPendingNpWarning] =
    useState<PendingNpWarning | null>(null);
  const [npPopup, setNpPopup] = useState<NpPopupState>(null);
  // Bug A (siblings only): while a drag is active, SIBLING blocks become
  // pointer-events:none so drops aren't intercepted by the project block
  // underneath the cursor. The dragged source MUST keep pointer-events:auto
  // — putting pointer-events:none on the source cancels the drag in real
  // browsers (jsdom doesn't simulate this; it had to be caught by smoke).
  // Tracking the source by project_id (not a boolean) lets us flip just
  // the siblings.
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(
    null,
  );
  // Q9.5.g: project-block popup. Opens on click (gated on !draggingProjectId
  // so the click that ends a drag doesn't fire the popup). State holds the
  // project_id of the block currently showing the popup, or null.
  const [popupProjectId, setPopupProjectId] = useState<string | null>(null);

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  // All blocks (across DAs), keyed by da. Used by drop handler to detect
  // overlap on the target DA. Different from blocksByDa (which is filtered
  // to the current quarter + search) — overlap detection should consider
  // every existing block, not just the visible ones.
  const blocksByDaForOverlap = useMemo(() => {
    const m = new Map<string, DropBlock[]>();
    for (const row of draw) {
      if (!row.da_assigned || !row.start_week || !row.end_week) continue;
      const list = m.get(row.da_assigned) ?? [];
      list.push({
        projectId: row.project_id,
        startWeek: row.start_week,
        endWeek: row.end_week,
      });
      m.set(row.da_assigned, list);
    }
    return m;
  }, [draw]);

  function handleDrop(targetDa: string, targetStartWeek: string, payload: DragPayload) {
    const targetEndWeek = addWeeksToWeekKey(
      targetStartWeek,
      payload.durationWeeks - 1,
    );
    const blocks = blocksByDaForOverlap.get(targetDa) ?? [];
    const decision = decideDrop(
      blocks,
      payload.projectId,
      targetStartWeek,
      targetEndWeek,
    );

    if (decision.kind === 'save') {
      // Q6.2.d: project overlap is clean, but check NP conflicts before
      // saving silently. Project overlap takes precedence (already handled
      // above) — NP warning is only reachable from the no-project-overlap
      // path, so the two prompts can never be on screen simultaneously.
      // Q6.2.d: filter NP blocks for the target DA inline. 26 NP rows
      // max across all DAs in production — per-drop cost is trivial, and
      // doing it without a useMemo avoids a React Compiler grumble about
      // un-preservable `new Map()` memoization.
      const npCandidates: NpConflict[] = npBlocks
        .filter((b) => b.da_name === targetDa)
        .map((b) => ({
          id: b.id,
          daName: b.da_name,
          type: b.type,
          label: b.label,
          startWeek: b.start_week,
          endWeek: b.end_week,
        }));
      const npConflicts = findNpConflictsForDrop(
        npCandidates,
        targetStartWeek,
        targetEndWeek,
      );
      if (npConflicts.length > 0) {
        const anchorAddr =
          projectById.get(payload.projectId)?.address ?? payload.projectId;
        setPendingNpWarning({
          anchorAddress: anchorAddr,
          daName: targetDa,
          conflicts: npConflicts.map((c) => ({
            id: c.id,
            type: c.type,
            label: c.label,
            startWeek: c.startWeek,
            endWeek: c.endWeek,
          })),
          anchorProjectId: payload.projectId,
          expectedUpdatedAt: payload.expectedUpdatedAt,
          daAssigned: targetDa,
          startWeek: targetStartWeek,
          endWeek: targetEndWeek,
          scheduleStatus: payload.status,
        });
        return;
      }

      updateMutation.mutate({
        projectId: payload.projectId,
        expectedUpdatedAt: payload.expectedUpdatedAt,
        daAssigned: targetDa,
        startWeek: targetStartWeek,
        endWeek: targetEndWeek,
        scheduleStatus: payload.status,
      });
      return;
    }

    // Overlap → surface the Option B prompt. Map the conflicting project ids
    // back to addresses for human-readable display. Capture the full target
    // context so onConfirm (Push Down) can fire bp_resolve_da_overlap with
    // the exact same intent the user released over.
    const conflictAddrs = decision.conflictingProjectIds
      .map((pid) => projectById.get(pid)?.address ?? pid)
      .sort();
    const anchorAddr =
      projectById.get(payload.projectId)?.address ?? payload.projectId;
    setPendingOverlap({
      anchorAddress: anchorAddr,
      conflictingAddresses: conflictAddrs,
      conflictCount: decision.conflictingProjectIds.length,
      anchorProjectId: payload.projectId,
      expectedUpdatedAt: payload.expectedUpdatedAt,
      daAssigned: targetDa,
      startWeek: targetStartWeek,
      endWeek: targetEndWeek,
      scheduleStatus: payload.status,
    });
  }
  // Per-DA list of project blocks visible this quarter, after search filter.
  const blocksByDa = useMemo(() => {
    const allDas = groups.flatMap((g) => g.das);
    const map = new Map<string, { row: DrawScheduleRow; project: Project }[]>();
    for (const da of allDas) map.set(da, []);
    for (const row of draw) {
      const da = row.da_assigned;
      if (!da || !map.has(da)) continue;
      if (!row.start_week || !row.end_week) continue;
      // Quarter overlap (inclusive both ends).
      const overlapsQ =
        row.start_week <= weeks[weeks.length - 1] &&
        row.end_week >= weeks[0];
      if (!overlapsQ) continue;
      const project = projectById.get(row.project_id);
      if (!project) continue;
      if (search.trim() && !multiMatchAddress(search, project.address)) continue;
      map.get(da)!.push({ row, project });
    }
    // Sort each DA's blocks by start_week.
    for (const list of map.values()) {
      list.sort((a, b) =>
        (a.row.start_week ?? '').localeCompare(b.row.start_week ?? ''),
      );
    }
    return map;
  }, [draw, projectById, groups, weeks, search]);

  // Q6.2.c: NP blocks grouped by DA, filtered to current quarter. Same
  // overlap predicate as project blocks; render-only (no drag, no drop).
  const npBlocksByDa = useMemo(() => {
    const map = new Map<string, DaTimeBlock[]>();
    for (const b of npBlocks) {
      const overlapsQ =
        b.start_week <= weeks[weeks.length - 1] && b.end_week >= weeks[0];
      if (!overlapsQ) continue;
      const list = map.get(b.da_name) ?? [];
      list.push(b);
      map.set(b.da_name, list);
    }
    return map;
  }, [npBlocks, weeks]);


  // "Unscheduled": projects with no DA or no week range, optionally filtered.
  const unscheduled = useMemo(() => {
    return draw
      .filter((row) => !row.da_assigned || !row.start_week || !row.end_week)
      .map((row) => ({ row, project: projectById.get(row.project_id) }))
      .filter((x): x is { row: DrawScheduleRow; project: Project } => !!x.project)
      .filter(
        ({ project }) =>
          !search.trim() || multiMatchAddress(search, project.address),
      )
      .sort((a, b) => a.project.address.localeCompare(b.project.address));
  }, [draw, projectById, search]);

  return (
    <div className="space-y-3">
      <Toolbar
        quarterOffset={quarterOffset}
        setQuarterOffset={setQuarterOffset}
        search={search}
        setSearch={setSearch}
      />

      <div
        className="bg-surface border border-border rounded-xl overflow-x-auto"
        data-testid="draw-schedule-grid"
      >
        {/* DM header row */}
        <div className="flex sticky top-0 z-20 bg-s2 border-b border-border">
          <div
            style={{ width: LABEL_W, minWidth: LABEL_W }}
            className="border-r border-border"
          />
          {groups.map((g) => (
            <div
              key={g.dm}
              style={{ flex: g.das.length }}
              className="text-center px-1 py-1 border-r-2 border-border text-[11px] font-extrabold uppercase truncate text-text"
            >
              {g.dm}
            </div>
          ))}
        </div>

        {/* DA header row */}
        <div className="flex sticky top-[26px] z-[19] bg-s2 border-b-2 border-border">
          <div
            style={{ width: LABEL_W, minWidth: LABEL_W }}
            className="border-r border-border"
          />
          {groups.flatMap((g) =>
            g.das.map((da, i) => (
              <div
                key={`${g.dm}-${da}`}
                className={`flex-1 text-center px-1 py-1 text-[10px] font-bold truncate ${
                  i === g.das.length - 1
                    ? 'border-r-2 border-border'
                    : 'border-r border-border'
                }`}
              >
                {da}
              </div>
            )),
          )}
        </div>

        {/* Body grid */}
        <div className="flex relative">
          {/* Week labels column */}
          <div
            style={{ width: LABEL_W, minWidth: LABEL_W }}
            className="border-r border-border"
          >
            {weeks.map((wk) => {
              const d = new Date(`${wk}T12:00:00`);
              const isCurrent = wk === currentWeek;
              return (
                <div
                  key={wk}
                  data-testid={`week-label-${wk}`}
                  style={{ height: ROW_H }}
                  className={`flex items-center justify-end pr-1.5 border-b border-border text-[9px] font-mono ${
                    isCurrent ? 'text-de font-bold' : 'text-dim'
                  }`}
                >
                  {isCurrent ? '▸ ' : ''}
                  {d.getMonth() + 1}/{d.getDate()}
                </div>
              );
            })}
          </div>

          {/* DA columns */}
          {groups.flatMap((g) =>
            g.das.map((da, daIdx) => {
              const isLast = daIdx === g.das.length - 1;
              const blocks = blocksByDa.get(da) ?? [];
              const daNpBlocks = npBlocksByDa.get(da) ?? [];
              return (
                <div
                  key={`${g.dm}-${da}-col`}
                  data-testid={`da-col-${da}`}
                  className={`flex-1 min-w-0 relative ${
                    isLast
                      ? 'border-r-2 border-border'
                      : 'border-r border-border'
                  }`}
                >
                  {/* Empty week cells — drop target for drags AND click
                      target for Q6.2.f's add-NP popup. The popup only opens
                      on a real click; HTML5 drag suppresses onClick when a
                      drop completes, so the two interactions don't fight. */}
                  {weeks.map((wk) => (
                    <div
                      key={wk}
                      data-testid={`drop-cell-${da}-${wk}`}
                      style={{ height: ROW_H }}
                      className={`border-b border-border cursor-pointer ${
                        wk === currentWeek ? 'bg-de/[0.04]' : ''
                      }`}
                      onClick={(e) => {
                        // Ignore clicks while a drag is active (the drop
                        // handler already fired) — opening the popup mid-drag
                        // is jarring.
                        if (draggingProjectId !== null) return;
                        setNpPopup({
                          mode: 'add',
                          daName: da,
                          weekKey: wk,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                      onDragOver={(e) => {
                        // preventDefault is what tells the browser this is a
                        // valid drop target. Without it, onDrop never fires.
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const raw = e.dataTransfer.getData('application/json');
                        if (!raw) return;
                        let payload: DragPayload;
                        try {
                          payload = JSON.parse(raw) as DragPayload;
                        } catch {
                          return;
                        }
                        handleDrop(da, wk, payload);
                      }}
                    />
                  ))}

                  {/* NP blocks (vacation/training/etc.). Q6.2.e: clipped
                      around project blocks on the same DA — render one
                      rectangle per visible (uncovered) segment, so users
                      can still read e.g. "vacation ends week X" even when
                      part of the NP range is covered by a project. */}
                  {daNpBlocks.flatMap((np) => {
                    const projectRanges = blocks
                      .filter((b) => b.row.start_week && b.row.end_week)
                      .map((b) => ({
                        startWeek: b.row.start_week as string,
                        endWeek: b.row.end_week as string,
                      }));
                    const segments = computeNpSegments(
                      np.start_week,
                      np.end_week,
                      projectRanges,
                      weeks,
                    );
                    if (segments.length === 0) return [];
                    const labelText = np.label?.trim() || np.type;
                    const tooltipText = `${np.type}${np.label && np.label !== np.type ? ` — ${np.label}` : ''} (${np.start_week} → ${np.end_week})`;
                    return segments.map((seg, segIdx) => {
                      const si = weeks.indexOf(seg.startWeek);
                      const ei = weeks.indexOf(seg.endWeek);
                      if (si < 0 || ei < 0) return null;
                      const top = si * ROW_H;
                      const height = (ei - si + 1) * ROW_H - 2;
                      return (
                        <div
                          key={`${np.id}-seg-${segIdx}`}
                          data-testid={`np-block-${np.id}-seg-${segIdx}`}
                          title={tooltipText}
                          onClick={(e) => {
                            // Open edit popup. stopPropagation so the click
                            // doesn't bubble to the underlying empty-cell
                            // add-popup handler.
                            e.stopPropagation();
                            if (draggingProjectId !== null) return;
                            setNpPopup({
                              mode: 'edit',
                              block: np,
                              x: e.clientX,
                              y: e.clientY,
                            });
                          }}
                          style={{
                            position: 'absolute',
                            top,
                            left: 2,
                            right: 2,
                            height,
                            background: NP_BLOCK_COLOR.bg,
                            color: NP_BLOCK_COLOR.text,
                            border: `1px solid ${NP_BLOCK_COLOR.border}`,
                            borderRadius: 4,
                            padding: '2px 4px',
                            overflow: 'hidden',
                            fontSize: 9,
                            fontWeight: 700,
                            lineHeight: 1.1,
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            textAlign: 'center',
                            zIndex: 3,
                            cursor: 'pointer',
                            // Same pointer-events contract as before:
                            // auto for hover, none during drag.
                            pointerEvents:
                              draggingProjectId === null ? 'auto' : 'none',
                          }}
                        >
                          {labelText}
                        </div>
                      );
                    });
                  })}

                  {/* Project blocks */}
                  {blocks.map(({ row, project }) => {
                    const startIdx = weeks.indexOf(row.start_week ?? '');
                    const endIdx = weeks.indexOf(row.end_week ?? '');
                    if (startIdx < 0 && endIdx < 0) return null;
                    const si = startIdx >= 0 ? startIdx : 0;
                    const ei = endIdx >= 0 ? endIdx : weeks.length - 1;
                    const top = si * ROW_H;
                    const height =
                      Math.min((ei - si + 1) * ROW_H, (weeks.length - si) * ROW_H) - 3;
                    // Q9.5.g: derive status from live permit/cycle data via
                    // dsAutoStatus precedence (Corrections > Approved > Under
                    // Review > DD-phase date math). The stored row.status is
                    // only respected when manual_status is true AND the auto
                    // derive is in the DD phase — the three permit-data
                    // branches always win.
                    const { status: derivedStatus } = deriveBlockStatus({
                      permits: permitsByProjectId.get(row.project_id) ?? [],
                      cyclesByPermit,
                      currentStatus: row.status,
                      manualStatus: row.manual_status === true,
                    });
                    const sc = DS_STATUS_COLORS[derivedStatus] ?? DS_STATUS_COLORS.Scheduled;
                    const borderColor = jurisBorder(project.juris);
                    // Duration in weeks is end..start inclusive.
                    const durationWeeks = Math.max(
                      1,
                      Math.round(
                        (new Date(`${row.end_week}T12:00:00Z`).getTime() -
                          new Date(`${row.start_week}T12:00:00Z`).getTime()) /
                          (7 * 86400000),
                      ) + 1,
                    );
                    return (
                      <div
                        key={row.project_id}
                        data-testid={`block-${row.project_id}`}
                        title={`${project.address} — ${derivedStatus} (drag to move, click to edit)`}
                        draggable
                        onDragStart={(e) => {
                          const payload: DragPayload = {
                            projectId: row.project_id,
                            durationWeeks,
                            expectedUpdatedAt: row.updated_at,
                            status: row.status,
                          };
                          e.dataTransfer.setData(
                            'application/json',
                            JSON.stringify(payload),
                          );
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggingProjectId(row.project_id);
                        }}
                        onDragEnd={() => setDraggingProjectId(null)}
                        onClick={(e) => {
                          // Q9.5.g: gate the click on !draggingProjectId so
                          // the drag-release click (HTML5 DnD fires both
                          // dragend AND click on the source) doesn't open
                          // the popup the moment a drop lands.
                          if (draggingProjectId !== null) return;
                          e.stopPropagation();
                          setPopupProjectId(row.project_id);
                        }}
                        style={{
                          position: 'absolute',
                          top,
                          left: 2,
                          right: 2,
                          height,
                          background: sc.bg,
                          color: sc.text,
                          border: `2px solid ${borderColor}`,
                          borderRadius: 4,
                          overflow: 'hidden',
                          zIndex: 5,
                          cursor: 'grab',
                          // Bug A: during a drag, SIBLING blocks let drops
                          // pass through to the cell underneath. The drag
                          // source keeps pointer-events:auto — setting it to
                          // 'none' on the source cancels the drag in real
                          // browsers (jsdom doesn't catch this). Tracking
                          // draggingProjectId (vs a boolean) lets us flip
                          // just the siblings.
                          pointerEvents:
                            draggingProjectId !== null &&
                            draggingProjectId !== row.project_id
                              ? 'none'
                              : 'auto',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          justifyContent: 'center',
                          gap: 2,
                          padding: '2px 6px',
                        }}
                      >
                        {/* Q9.5.f Item 4: 4-tier block content per v1
                            :8097-8121. Each tier appears only if block
                            height permits, so short blocks degrade
                            gracefully and tall blocks show full detail. */}
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            lineHeight: 1.1,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                            color: sc.text,
                          }}
                        >
                          {project.address.split(',')[0]}
                        </span>
                        {height >= 22 && project.juris && (
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 500,
                              lineHeight: 1.1,
                              opacity: 0.75,
                              color: sc.text,
                            }}
                          >
                            {project.juris}
                          </span>
                        )}
                        {height >= 32 && (
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: 3,
                              background: 'rgba(255,255,255,0.55)',
                              color: sc.border,
                              border: `1px solid ${sc.border}`,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {derivedStatus}
                          </span>
                        )}
                        {height >= 60 &&
                          (() => {
                            // Est. Approval projection: prefer actual data
                            // when present, fall back to expected_issue.
                            // Pulls from the BP at this project; gracefully
                            // omits the line if nothing is available.
                            const bp =
                              (permitsByProjectId.get(row.project_id) ?? [])
                                .find((p) => p.type === 'Building Permit') ??
                              (permitsByProjectId.get(row.project_id) ?? [])[0];
                            const projDate =
                              bp?.actual_issue ??
                              bp?.approval_date ??
                              bp?.expected_issue ??
                              null;
                            if (!projDate) return null;
                            return (
                              <span
                                style={{
                                  fontSize: 8,
                                  fontWeight: 800,
                                  lineHeight: 1.1,
                                  color: sc.text,
                                  opacity: 0.9,
                                }}
                                title={`Est. Approval — ${projDate}`}
                              >
                                Est. Approval · {projDate}
                              </span>
                            );
                          })()}
                      </div>
                    );
                  })}
                </div>
              );
            }),
          )}
        </div>
      </div>

      {/* Unscheduled lane */}
      <UnscheduledLane items={unscheduled} />

      {/* Q9.5.g: project block popup. Rendered as a portal-like sibling of
          the grid so its fixed positioning isn't trapped inside any
          transformed/overflow:hidden parent. */}
      {popupProjectId &&
        (() => {
          const row = draw.find((r) => r.project_id === popupProjectId);
          const project = projectById.get(popupProjectId);
          if (!row || !project) return null;
          const projectPermits = permitsByProjectId.get(popupProjectId) ?? [];
          const { status: derivedStatus, isAuto } = deriveBlockStatus({
            permits: projectPermits,
            cyclesByPermit,
            currentStatus: row.status,
            manualStatus: row.manual_status === true,
          });
          return (
            <ProjectBlockPopup
              row={row}
              address={project.address}
              permits={projectPermits}
              displayedStatus={derivedStatus}
              isAutoDerived={isAuto}
              onClose={() => setPopupProjectId(null)}
            />
          );
        })()}

      {pendingNpWarning && (
        <NpWarningPrompt
          anchorAddress={pendingNpWarning.anchorAddress}
          daName={pendingNpWarning.daName}
          conflicts={pendingNpWarning.conflicts}
          pending={updateMutation.isPending}
          onCancel={() => setPendingNpWarning(null)}
          onConfirm={() => {
            updateMutation.mutate(
              {
                projectId: pendingNpWarning.anchorProjectId,
                expectedUpdatedAt: pendingNpWarning.expectedUpdatedAt,
                daAssigned: pendingNpWarning.daAssigned,
                startWeek: pendingNpWarning.startWeek,
                endWeek: pendingNpWarning.endWeek,
                scheduleStatus: pendingNpWarning.scheduleStatus,
              },
              { onSuccess: () => setPendingNpWarning(null) },
            );
          }}
        />
      )}

      {pendingOverlap && (
        <OverlapPrompt
          anchorAddress={pendingOverlap.anchorAddress}
          conflictingAddresses={pendingOverlap.conflictingAddresses}
          conflictCount={pendingOverlap.conflictCount}
          pending={resolveMutation.isPending}
          onCancel={() => setPendingOverlap(null)}
          onConfirm={() => {
            resolveMutation.mutate(
              {
                anchorProjectId: pendingOverlap.anchorProjectId,
                expectedUpdatedAt: pendingOverlap.expectedUpdatedAt,
                daAssigned: pendingOverlap.daAssigned,
                startWeek: pendingOverlap.startWeek,
                endWeek: pendingOverlap.endWeek,
                scheduleStatus: pendingOverlap.scheduleStatus,
              },
              {
                // Close the prompt only on success — leave it open on error
                // so the user can see the toast + retry/cancel.
                onSuccess: () => setPendingOverlap(null),
              },
            );
          }}
        />
      )}

      {/* Q6.2.f: NP edit/add popup. Backdrop catches outside clicks. */}
      {npPopup && (
        <>
          <div
            data-testid="np-popup-backdrop"
            onClick={() => setNpPopup(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9998,
              background: 'transparent',
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: Math.min(npPopup.x, window.innerWidth - 230),
              top: Math.min(npPopup.y, window.innerHeight - 320),
              zIndex: 9999,
            }}
          >
            {npPopup.mode === 'add' ? (
              <NpBlockEditPopup
                mode="add"
                daName={npPopup.daName}
                weekKey={npPopup.weekKey}
                onAdd={(type, label) => {
                  const id =
                    'np_' +
                    Date.now() +
                    '_' +
                    Math.random().toString(36).slice(2, 6);
                  upsertNp.mutate({
                    op: 'insert',
                    id,
                    patch: {
                      da_name: npPopup.daName,
                      type,
                      label: label || type,
                      start_week: npPopup.weekKey,
                      end_week: npPopup.weekKey,
                    },
                  });
                }}
                onClose={() => setNpPopup(null)}
              />
            ) : (
              <NpBlockEditPopup
                mode="edit"
                block={npPopup.block}
                onUpdate={(type, label) => {
                  upsertNp.mutate({
                    op: 'update',
                    block: npPopup.block,
                    patch: { type, label: label || type },
                  });
                }}
                onRemove={() => {
                  deleteNp.mutate({
                    id: npPopup.block.id,
                    updated_at: npPopup.block.updated_at,
                  });
                }}
                onClose={() => setNpPopup(null)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Toolbar({
  quarterOffset,
  setQuarterOffset,
  search,
  setSearch,
}: {
  quarterOffset: number;
  setQuarterOffset: (n: number) => void;
  search: string;
  setSearch: (s: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setQuarterOffset(quarterOffset - 1)}
          className="text-xs px-2 py-1 rounded-md border border-border bg-bg hover:bg-s2 transition"
          data-testid="quarter-prev"
          title="Previous quarter"
        >
          ◂
        </button>
        <button
          type="button"
          onClick={() => setQuarterOffset(0)}
          className="text-xs px-2 py-1 rounded-md border border-border bg-bg hover:bg-s2 transition font-display font-semibold"
          data-testid="quarter-today"
          title="Jump to current quarter"
        >
          {getQuarterLabel(quarterOffset)}
        </button>
        <button
          type="button"
          onClick={() => setQuarterOffset(quarterOffset + 1)}
          className="text-xs px-2 py-1 rounded-md border border-border bg-bg hover:bg-s2 transition"
          data-testid="quarter-next"
          title="Next quarter"
        >
          ▸
        </button>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search projects…"
        className="bg-bg border border-border rounded-md px-3 py-1 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de min-w-[220px]"
        data-testid="schedule-search"
      />

      <span className="text-[10px] text-muted font-mono ml-auto">
        Drag a project block to move it. Push-down on overlap ships in Q6.2.b.
      </span>
    </div>
  );
}

function UnscheduledLane({
  items,
}: {
  items: { row: DrawScheduleRow; project: Project }[];
}) {
  if (items.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl px-4 py-2 text-[11px] text-dim italic">
        No unscheduled projects.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3 space-y-2">
      <div className="text-[11px] font-display font-bold uppercase text-muted tracking-wide">
        Unscheduled ({items.length})
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map(({ row, project }) => (
          <span
            key={row.project_id}
            data-testid={`unscheduled-${row.project_id}`}
            className="text-[11px] px-2 py-1 rounded border border-border bg-bg text-text font-mono"
            title={`${row.da_assigned ?? 'no DA'} · ${row.start_week ?? 'no week'}`}
          >
            {project.address}
          </span>
        ))}
      </div>
    </div>
  );
}
