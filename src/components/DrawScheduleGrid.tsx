import { useMemo, useState } from 'react';
import { useDrawSchedule } from '../hooks/useDrawSchedule';
import { useProjects } from '../hooks/useProjects';
import { useDmDaGroups } from '../hooks/useDmDaGroups';
import { useUpdateDrawSchedule } from '../hooks/useUpdateDrawSchedule';
import { useResolveDaOverlap } from '../hooks/useResolveDaOverlap';
import {
  DS_STATUS_COLORS,
  addWeeksToWeekKey,
  dateToWeekKey,
  decideDrop,
  getMonday,
  getQuarterLabel,
  getQuarterWeeks,
  jurisBorder,
  multiMatchAddress,
  type DropBlock,
} from '../lib/drawScheduleHelpers';
import { SkeletonRows } from './Skeleton';
import QueryError from './QueryError';
import OverlapPrompt from './OverlapPrompt';
import type { DrawScheduleRow, Project } from '../lib/database.types';

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

export default function DrawScheduleGrid() {
  const drawQ = useDrawSchedule();
  const projectsQ = useProjects();
  const groupsQ = useDmDaGroups();

  const [quarterOffset, setQuarterOffset] = useState(0);
  const [search, setSearch] = useState('');

  const error = drawQ.error ?? projectsQ.error ?? groupsQ.error;
  if (error) {
    return (
      <QueryError
        title="Draw schedule failed to load"
        error={error}
        onRetry={() => {
          drawQ.refetch();
          projectsQ.refetch();
          groupsQ.refetch();
        }}
      />
    );
  }

  const isLoading =
    drawQ.isLoading || projectsQ.isLoading || groupsQ.isLoading;
  if (isLoading) {
    return <SkeletonRows count={8} rowClassName="h-7" />;
  }

  return (
    <DrawScheduleBody
      draw={drawQ.data ?? []}
      projects={projectsQ.data ?? []}
      groups={groupsQ.groups}
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
  groups: { dm: string; das: string[] }[];
  quarterOffset: number;
  setQuarterOffset: (n: number) => void;
  search: string;
  setSearch: (s: string) => void;
}

function DrawScheduleBody({
  draw,
  projects,
  groups,
  quarterOffset,
  setQuarterOffset,
  search,
  setSearch,
}: BodyProps) {
  const weeks = useMemo(() => getQuarterWeeks(quarterOffset), [quarterOffset]);
  const currentWeek = useMemo(() => dateToWeekKey(getMonday(new Date())), []);

  const updateMutation = useUpdateDrawSchedule();
  const resolveMutation = useResolveDaOverlap();
  const [pendingOverlap, setPendingOverlap] = useState<PendingOverlap | null>(
    null,
  );
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
                  {/* Empty week cells — also serve as drop targets. */}
                  {weeks.map((wk) => (
                    <div
                      key={wk}
                      data-testid={`drop-cell-${da}-${wk}`}
                      style={{ height: ROW_H }}
                      className={`border-b border-border ${
                        wk === currentWeek ? 'bg-de/[0.04]' : ''
                      }`}
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
                    const status = row.status ?? 'Scheduled';
                    const sc = DS_STATUS_COLORS[status] ?? DS_STATUS_COLORS.Scheduled;
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
                        title={`${project.address} — ${status} (drag to move)`}
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
                          padding: '2px 4px',
                          overflow: 'hidden',
                          fontSize: 10,
                          fontWeight: 700,
                          lineHeight: 1.1,
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
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
                        }}
                      >
                        {project.address}
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
