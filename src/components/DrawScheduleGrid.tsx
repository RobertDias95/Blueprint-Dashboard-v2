import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useDrawSchedule } from '../hooks/useDrawSchedule';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useDmDaGroups } from '../hooks/useDmDaGroups';
import { useUpdateDrawSchedule } from '../hooks/useUpdateDrawSchedule';
import { useResolveDaOverlap } from '../hooks/useResolveDaOverlap';
import {
  useMoveDrawScheduleDa,
  type MoveDrawScheduleDaInput,
} from '../hooks/useMoveDrawScheduleDa';
import { useShiftDaBlocksUp } from '../hooks/useShiftDaBlocksUp';
import {
  lookupEntLeadForDa,
  useCascadeEntLead,
} from '../hooks/useDaTeamRouting';
import { useDaTimeBlocks } from '../hooks/useDaTimeBlocks';
import { useUpsertDaTimeBlock } from '../hooks/useUpsertDaTimeBlock';
import { useDeleteDaTimeBlock } from '../hooks/useDeleteDaTimeBlock';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useAllPermitCycleReviewers } from '../hooks/useAllPermitCycleReviewers';
import { useQuarterLayout } from '../hooks/useQuarterLayout';
import { buildDrawColumns } from '../lib/quarterLayoutHelpers';
import {
  isMemberActiveInQuarter,
  quarterOffsetToString,
} from '../lib/teamQuarterHelpers';
import {
  useResizeDaTimeBlock,
  type NpResizeProjectConflict,
  type NpResizeNpConflict,
} from '../hooks/useResizeDaTimeBlock';
import NpBlockEditPopup from './NpBlockEditPopup';
import NpResizeConflictPrompt from './NpResizeConflictPrompt';
import ProjectBlockPopup from './DrawSchedule/ProjectBlockPopup';
import GapFillPrompt from './GapFillPrompt';
import EntCascadePrompt from './EntCascadePrompt';
import {
  NP_BLOCK_COLOR,
  addWeeksToWeekKey,
  blockFontPx,
  blockOverflow,
  computeNpSegments,
  dateToWeekKey,
  decideDrop,
  findNpConflictsForDrop,
  formatProjectionDate,
  formatWeekRange,
  getMonday,
  getQuarterLabel,
  getQuarterWeeks,
  blockBorderColor,
  multiMatchAddress,
  weekKeyToQuarterOffset,
  type DropBlock,
  type NpConflict,
} from '../lib/drawScheduleHelpers';
import { computeProjectedApproval } from '../lib/projectedApproval';
import {
  computeLearnedSchedule,
  type LearnedEstimate,
} from '../lib/scheduleBenchmarks';
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
import { deriveLaneStatus, STATUS_PRESENTATION } from '../lib/drawScheduleStatus';

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

// fix-47: BASE (minimum) week-row height in px. The grid scales rows UP from
// this to fill the viewport height (see `rowH` in DrawScheduleBody) so the
// lanes/blocks/text grow into the available space. BASE_ROW_H is the floor:
// on short viewports the grid scrolls vertically rather than shrinking below
// this. When the viewport is unmeasured (initial render / jsdom) rowH === this,
// so block-position + drag-resize math are unchanged in tests.
const BASE_ROW_H = 28;
// fix-25-feat-c: bumped from 64 → 88 to fit the Mon-Fri "M/D — M/D"
// range label (widest case "▸ 12/29 — 12/31" at 9px font-mono).
// fix-48: this is the BASE label-gutter width (at textScale === 1). The
// rendered width is `labelW = round(LABEL_W * textScale)` so the gutter grows
// with fix-47's enlarged date font and the "M/D – M/D" range never wraps.
const LABEL_W = 88;
// fix-48: minimum DA (design-associate) column width. DA columns flex to
// share the available width (few DAs fill it, no empty gutter) but never
// shrink below this, so a project block's address stays legible; once the
// columns hit this floor the grid scrolls horizontally as one unit.
// fix-DS-fit-and-wrap: lowered 150 → 90 so a full DA roster (~12-15 DAs) fits
// a typical ~1400-1600px viewport without horizontal scroll. The block content
// already copes with narrow columns (single-line ellipsis address + hover
// title, compact-rule stack), so 90px stays legible; scroll only resumes once
// daCount × 90 truly exceeds the viewport.
const DA_MIN_W = 90;
/** What we ship in the HTML5 drag's dataTransfer payload. JSON-encoded so
 * jsdom + browsers both round-trip it cleanly via getData/setData.
 * Q9.5.f-fix-20: added currentDa + originalStart/EndWeek so the drop handler
 * can detect DA changes (route to bp_move_draw_schedule_da for propagation)
 * and gap-fill anchor (original vacated slot) without re-reading row state. */
interface DragPayload {
  projectId: string;
  durationWeeks: number;
  expectedUpdatedAt: string;
  status: string | null;
  currentDa: string | null;
  originalStartWeek: string | null;
  originalEndWeek: string | null;
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
  // fix-32: reviewer-corrections feeds into each BP's projected
  // approval date used by the grid's block rendering.
  const reviewersQ = useAllPermitCycleReviewers();

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
      reviewers={reviewersQ.data ?? []}
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
  reviewers: import('../lib/database.types').PermitCycleReviewer[];
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
  reviewers,
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
  const projectsById = useMemo(
    () => new Map(projects.map((pr) => [pr.id, pr])),
    [projects],
  );
  // fix-32: index reviewers by permit_id once per render so the BP
  // projection picks up the per-permit slice without repeated filters.
  const reviewersByPermitId = useMemo(() => {
    const m = new Map<number, import('../lib/database.types').PermitCycleReviewer[]>();
    for (const r of reviewers) {
      const list = m.get(r.permit_id) ?? [];
      list.push(r);
      m.set(r.permit_id, list);
    }
    return m;
  }, [reviewers]);
  // Q9.5.f-fix-17.5 C: bidirectional projection — Draw Schedule block's
  // "Est. Approval" line must call computeProjectedApproval with the BP's
  // scheduleCycleOverride so it matches Schedule Estimator / Schedule
  // Health. Cached as one Map<projectId, projection> per render.
  //
  // fix-100: now also stores isActual so the block can switch from
  // "Est. Approval" → "Approval" once the BP is actually approved.
  // computeProjectedApproval already returns isActual=true when the
  // permit carries an approval_date or actual_issue; we just thread
  // that flag through the cache instead of dropping it on the floor.
  const projectionByProjectId = useMemo(() => {
    type WithCycles = Permit & { permit_cycles?: PermitCycle[] | null };
    const permitsWithCycles = permits as WithCycles[];
    const m = new Map<
      string,
      { projection: string; isActual: boolean } | null
    >();
    const learnedCache = new Map<string, LearnedEstimate | null>();
    function getLearned(type: string, juris: string): LearnedEstimate | null {
      const key = `${type}|${juris}`;
      if (learnedCache.has(key)) return learnedCache.get(key) ?? null;
      const est = type && juris
        ? computeLearnedSchedule(
            permitsWithCycles.map((p) => ({ ...p, permit_cycles: p.permit_cycles ?? [] })),
            type,
            juris,
            projectsById,
          )
        : null;
      learnedCache.set(key, est);
      return est;
    }
    for (const project of projects) {
      const projectPermits = permitsByProjectId.get(project.id) ?? [];
      const bp = ((projectPermits.find((p) => p.type === 'Building Permit') ??
        projectPermits[0]) as WithCycles | undefined);
      if (!bp) {
        m.set(project.id, null);
        continue;
      }
      const juris = project.juris ?? '';
      const learned = bp.type ? getLearned(bp.type, juris) : null;
      const extras = (bp.extras ?? {}) as Record<string, unknown>;
      const raw = extras.scheduleCycleOverride;
      const cycleOverride =
        typeof raw === 'number' && raw >= 1 && raw <= 8 ? raw : null;
      const siblingCyclesByPermitId = new Map<number, PermitCycle[]>();
      const siblingLearnedByPermitId = new Map<number, LearnedEstimate | null>();
      for (const s of projectPermits as WithCycles[]) {
        siblingCyclesByPermitId.set(s.id, s.permit_cycles ?? []);
        siblingLearnedByPermitId.set(
          s.id,
          s.type ? getLearned(s.type, juris) : null,
        );
      }
      const bpCycles = (bp.permit_cycles ?? []) as PermitCycle[];
      const result = computeProjectedApproval({
        permit: bp,
        cycles: bpCycles
          .filter((c) => c.cycle_index !== 0)
          .sort((a, b) => a.cycle_index - b.cycle_index),
        // fix-53: cycle 0's intake_accepted anchors cycle-1 review at intake.
        cycle0IntakeAccepted:
          bpCycles.find((c) => c.cycle_index === 0)?.intake_accepted ?? null,
        learnedEstimate: learned,
        projectGoDate: project.go_date ?? null,
        siblingPermits: projectPermits,
        siblingCyclesByPermitId,
        siblingLearnedByPermitId,
        targetCycleOverride: cycleOverride,
        // fix-32: reviewer-corrections rule on the BP feeds into the
        // grid block's projected approval date.
        permitReviewers: reviewersByPermitId.get(bp.id) ?? [],
      });
      m.set(
        project.id,
        result.projection
          ? { projection: result.projection, isActual: !!result.isActual }
          : null,
      );
    }
    return m;
  }, [projects, permits, permitsByProjectId, projectsById, reviewersByPermitId]);
  const weeks = useMemo(() => getQuarterWeeks(quarterOffset), [quarterOffset]);
  const currentWeek = useMemo(() => dateToWeekKey(getMonday(new Date())), []);

  // fix-47: stretch the week rows to fill the viewport height. The grid's
  // vertical extent is weeks.length * rowH, which previously only covered the
  // top ~360px and left the rest of the screen gray. We measure the scroll
  // card's visible height minus the sticky header rows (the body grid's
  // offsetTop within the position:relative card), then divide by the week
  // count so the rows — and the blocks + text inside them — grow to fill the
  // space. BASE_ROW_H is the floor; on a short viewport the card scrolls
  // vertically (sticky headers stay pinned) instead of shrinking below it.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const bodyGridRef = useRef<HTMLDivElement>(null);
  const [rowsAreaH, setRowsAreaH] = useState(0);
  useEffect(() => {
    const card = gridScrollRef.current;
    const body = bodyGridRef.current;
    if (!card || !body) return;
    const measure = () => {
      // clientHeight excludes the horizontal scrollbar; body.offsetTop is the
      // combined sticky-header height (card is position:relative).
      setRowsAreaH(Math.max(0, card.clientHeight - body.offsetTop));
    };
    measure();
    // jsdom has no ResizeObserver and reports 0 heights — guard so tests keep
    // rowH === BASE_ROW_H (block-position + resize math unchanged).
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  const rowH = useMemo(() => {
    if (weeks.length === 0 || rowsAreaH <= 0) return BASE_ROW_H;
    return Math.max(BASE_ROW_H, Math.floor(rowsAreaH / weeks.length));
  }, [rowsAreaH, weeks.length]);
  // Window-level resize listeners (drag-to-resize) read the live rowH via a
  // ref so they don't re-attach on every viewport change. Mirrors the
  // resizingRef render-time-sync pattern used below.
  const rowHRef = useRef(rowH);
  // eslint-disable-next-line react-hooks/refs
  rowHRef.current = rowH;
  // fix-47: scale block + date-label text up with the row height so the extra
  // space reads as bigger, more legible type (not just taller empty blocks).
  // Clamped so it never shrinks below the original sizes (factor >= 1) and
  // doesn't balloon on very tall monitors.
  const textScale = Math.min(1.7, Math.max(1, rowH / BASE_ROW_H));
  // fix-48: the left week-label gutter scales with the date font so the
  // "M/D – M/D" range stops squishing/wrapping at large textScale. A single
  // derived value drives the DM-header spacer, the DA-header spacer, and the
  // body label column so they stay in lockstep. At textScale === 1 (unmeasured
  // / jsdom) this is exactly the original LABEL_W (88) — layout unchanged.
  const labelW = Math.round(LABEL_W * textScale);

  const updateMutation = useUpdateDrawSchedule();
  const moveDaMutation = useMoveDrawScheduleDa();
  const cascadeEntLead = useCascadeEntLead();
  const shiftUpMutation = useShiftDaBlocksUp();
  const resolveMutation = useResolveDaOverlap();
  const upsertNp = useUpsertDaTimeBlock();
  const deleteNp = useDeleteDaTimeBlock();

  // fix-25-feat-b: filter DA lanes by the viewed quarter's activity range.
  // A DA's lane is visible iff their team_members range covers the viewed
  // quarter OR they have a project block on the lane overlapping the
  // viewed weeks (forced visibility — old work doesn't vanish when the
  // person leaves). DAs with no team_members row default to visible
  // (matches today's behavior where dm_da_groups is the source of truth).
  const teamMembersQ = useTeamMembers();
  const currentQuarter = useMemo(
    () => quarterOffsetToString(quarterOffset),
    [quarterOffset],
  );
  const daMemberByName = useMemo(() => {
    const m = new Map<
      string,
      { active_start_quarter: string | null; active_end_quarter: string | null }
    >();
    for (const tm of teamMembersQ.all) {
      if (tm.role === 'da') {
        m.set(tm.name, {
          active_start_quarter: tm.active_start_quarter,
          active_end_quarter: tm.active_end_quarter,
        });
      }
    }
    return m;
  }, [teamMembersQ.all]);
  const forcedDAs = useMemo(() => {
    const set = new Set<string>();
    if (weeks.length === 0) return set;
    const firstWeek = weeks[0];
    const lastWeek = weeks[weeks.length - 1];
    for (const row of draw) {
      if (!row.da_assigned || !row.start_week || !row.end_week) continue;
      if (row.start_week <= lastWeek && row.end_week >= firstWeek) {
        set.add(row.da_assigned);
      }
    }
    return set;
  }, [draw, weeks]);
  const filteredGroups = useMemo(() => {
    return groups
      .map((g) => ({
        dm: g.dm,
        das: g.das.filter((daName) => {
          const tm = daMemberByName.get(daName);
          if (!tm) return true; // no team_member record -> default visible
          const active = isMemberActiveInQuarter(
            tm.active_start_quarter,
            tm.active_end_quarter,
            currentQuarter,
          );
          return active || forcedDAs.has(daName);
        }),
      }))
      .filter((g) => g.das.length > 0);
  }, [groups, daMemberByName, currentQuarter, forcedDAs]);
  /** DAs kept visible only because they have a block this quarter — render
   *  their header label italic + dimmed so the user can tell they're not on
   *  the current roster. */
  const inactiveButForcedDAs = useMemo(() => {
    const set = new Set<string>();
    for (const g of filteredGroups) {
      for (const daName of g.das) {
        const tm = daMemberByName.get(daName);
        if (!tm) continue;
        const active = isMemberActiveInQuarter(
          tm.active_start_quarter,
          tm.active_end_quarter,
          currentQuarter,
        );
        if (!active) set.add(daName);
      }
    }
    return set;
  }, [filteredGroups, daMemberByName, currentQuarter]);

  // Q9.5.f-fix-20: reverse lookup DM by DA name. Used when routing a DA
  // move through bp_move_draw_schedule_da, which writes permits.dm to keep
  // the dashboard's DM groupings coherent.
  // fix-182c (locked decision #6): dmByDa + the move/ent cascade ALWAYS read
  // the CURRENT structure (dm_da_groups / da_team_routing), never the
  // per-quarter layout. A drag-move reflects who manages a DA *today* (the move
  // writes permits.dm/ent_lead for live routing); the per-quarter layout is a
  // frozen visual snapshot, not a routing source. So this stays on `groups`.
  const dmByDa = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      for (const da of g.das) m.set(da, g.dm);
    }
    return m;
  }, [groups]);

  // fix-182c: per-quarter saved layout. If the viewed quarter has >=1 saved
  // rows -> LAYOUT MODE (columns/headers/order come from the layout); else the
  // existing dm_da_groups + active-quarter path is used UNCHANGED.
  const layoutQ = useQuarterLayout(currentQuarter);
  const layoutRows = layoutQ.rows;
  const isLayoutMode = layoutRows.length > 0;

  // fix-183: "is this DA on the team in the viewed quarter?" — the same
  // membership predicate the fallback filter uses (a DA with no team_members
  // row defaults active). Reuses daMemberByName + currentQuarter; no new query.
  const isDaActiveInQuarter = useMemo(() => {
    return (daName: string): boolean => {
      const tm = daMemberByName.get(daName);
      if (!tm) return true;
      return isMemberActiveInQuarter(
        tm.active_start_quarter,
        tm.active_end_quarter,
        currentQuarter,
      );
    };
  }, [daMemberByName, currentQuarter]);

  // Unified column model consumed by all three render bands (DM header, DA
  // header, DA columns). buildDrawColumns produces the same shape for both
  // modes; the fallback path renders byte-for-byte as before. In layout mode a
  // 'da' column whose DA is inactive that quarter is dimmed (fix-183) so the
  // grid can't contradict the active-quarters editor.
  const { renderGroups, renderColumns } = useMemo(
    () =>
      buildDrawColumns({
        isLayoutMode,
        layoutRows,
        fallbackGroups: filteredGroups,
        inactiveDas: inactiveButForcedDAs,
        forcedDas: forcedDAs,
        isDaActiveInQuarter,
      }),
    [
      isLayoutMode,
      layoutRows,
      filteredGroups,
      inactiveButForcedDAs,
      forcedDAs,
      isDaActiveInQuarter,
    ],
  );

  // DA names that actually have a rendered column this quarter (drives
  // blocksByDa). In layout mode this is the layout's DA set + orphan lanes; in
  // fallback it's filteredGroups' DAs — identical to the prior `allDas`.
  const visibleDaNames = useMemo(
    () =>
      renderColumns
        // fix-190a: include 'dm' (solo-DM) lanes too — they hold blocks matched
        // by their lane-owner name (da_name = the DM) exactly like 'da' lanes.
        // OPEN lanes (daName === null) are excluded.
        .filter((c) => c.daName != null)
        .map((c) => c.daName as string),
    [renderColumns],
  );

  // Q9.5.f-fix-20: pending gap-fill prompt. Set after a successful DA-move
  // when downstream blocks on the OLD DA remained.
  interface PendingGapFill {
    daName: string;
    movedAddress: string;
    downstreamCount: number;
    gapStartWeek: string;
    gapEndWeek: string;
  }
  const [pendingGapFill, setPendingGapFill] = useState<PendingGapFill | null>(
    null,
  );
  // fix-72: a DA move that implies an Entitlement Lead (ent_lead)
  // change parks here until the user confirms via EntCascadePrompt.
  // moveArgs is the exact payload for bp_move_draw_schedule_da; the
  // prompt's buttons then move (+ optionally cascade ent_lead) or
  // cancel. fix-102: renamed from PendingDmCascade — the cascade is
  // ENT, not DM (DMs route through dm_da_groups, not da_team_routing).
  interface PendingEntCascade {
    moveArgs: MoveDrawScheduleDaInput;
    payload: DragPayload;
    movedAddress: string;
    fromLead: string | null;
    toLead: string;
  }
  const [pendingEntCascade, setPendingEntCascade] =
    useState<PendingEntCascade | null>(null);
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

  // Q9.5.f-fix-20: hover-week highlight. When the cursor is over a project
  // block, light up every week in its [start_week .. end_week] range in the
  // left week-label column. When over an empty cell, light up that single
  // week. Clears on mouseleave at the body-grid boundary. Set is keyed by
  // week_key (YYYY-MM-DD Monday) so the per-week label render is O(1).
  const [hoveredWeeks, setHoveredWeeks] = useState<Set<string>>(
    () => new Set(),
  );

  // Q9.5.f-fix-20: drag-to-resize bottom edge. While resizing, we attach
  // window-level mousemove/mouseup so the gesture continues if the cursor
  // leaves the block (or even the grid). The block's rendered height is
  // re-derived from previewEndWeek, so the user sees a live preview. On
  // mouseup we apply the same overlap/conflict pipeline as drag-to-move,
  // reusing OverlapPrompt for resize-into-collision cases.
  interface ResizeState {
    projectId: string;
    daAssigned: string;
    startWeek: string;
    /** The block's end_week at the moment resize began. Used as the anchor
     *  for delta math + as the rollback target if the user cancels. */
    originalEndWeek: string;
    /** Live preview end_week while the cursor moves. Equals originalEndWeek
     *  before the first mousemove crosses a row boundary. */
    previewEndWeek: string;
    /** Mouse Y at mousedown — delta is computed from current Y. */
    startMouseY: number;
    expectedUpdatedAt: string;
    status: string | null;
  }
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  // Stable ref so the window listeners (which close over `resizing` at
  // attach time) can read the latest state without re-attaching on every
  // mousemove tick.
  const resizingRef = useRef<ResizeState | null>(null);
  // Sync ref during render so window listeners (attached once when
  // resize starts) read the freshest resize state without re-attaching.
  // eslint-disable-next-line react-hooks/refs
  resizingRef.current = resizing;
  // Q9.5.f-fix-20: window listeners for active resize. Attaching at the
  // window level (not on the block) lets the gesture continue if the
  // pointer leaves the grid or moves faster than React can re-render.
  // Listeners auto-clean when resizing returns to null, so there's no
  // leak when the user releases.
  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      const r = resizingRef.current;
      if (!r) return;
      const deltaPx = e.clientY - r.startMouseY;
      const deltaWeeks = Math.round(deltaPx / rowHRef.current);
      // Clamp: end_week must be >= start_week (block can't go below 1 wk).
      // addWeeksToWeekKey accepts negative deltas, so we can shrink past
      // originalEndWeek but not before startWeek.
      let candidate = addWeeksToWeekKey(r.originalEndWeek, deltaWeeks);
      if (candidate < r.startWeek) candidate = r.startWeek;
      if (candidate === r.previewEndWeek) return; // dedupe no-op moves
      setResizing({ ...r, previewEndWeek: candidate });
    }
    function onUp() {
      const r = resizingRef.current;
      setResizing(null); // detach + clear preview
      if (!r) return;
      // If user released at the same week they started, no-op (avoids
      // firing an RPC for an idle gesture).
      if (r.previewEndWeek === r.originalEndWeek) return;
      // Reuse the drop pipeline's overlap detection: a resize is just a
      // move to (same DA, same startWeek, new endWeek). Excludes self
      // from overlap candidates so growing a block doesn't conflict
      // with itself. (blocksByDaForOverlap is declared after this effect
      // but read inside an event handler that fires post-render — react
      // compiler's hoisting check is a false positive here.)
      // eslint-disable-next-line react-hooks/immutability
      const blocks = blocksByDaForOverlap.get(r.daAssigned) ?? [];
      const decision = decideDrop(
        blocks,
        r.projectId,
        r.startWeek,
        r.previewEndWeek,
      );
      if (decision.kind === 'save') {
        updateMutation.mutate({
          projectId: r.projectId,
          expectedUpdatedAt: r.expectedUpdatedAt,
          daAssigned: r.daAssigned,
          startWeek: r.startWeek,
          endWeek: r.previewEndWeek,
          scheduleStatus: r.status,
        });
        return;
      }
      // Resize-into-overlap → surface the same Option B prompt the
      // drag-to-move path uses. Push-down cascades downstream blocks.
      // (projectById declared later but read here inside a handler.)
      const conflictAddrs = decision.conflictingProjectIds
        // eslint-disable-next-line react-hooks/immutability
        .map((pid) => projectById.get(pid)?.address ?? pid)
        .sort();
      const anchorAddr = projectById.get(r.projectId)?.address ?? r.projectId;
      setPendingOverlap({
        anchorAddress: anchorAddr,
        conflictingAddresses: conflictAddrs,
        conflictCount: decision.conflictingProjectIds.length,
        anchorProjectId: r.projectId,
        expectedUpdatedAt: r.expectedUpdatedAt,
        daAssigned: r.daAssigned,
        startWeek: r.startWeek,
        endWeek: r.previewEndWeek,
        scheduleStatus: r.status,
      });
    }
    function onKey(e: KeyboardEvent) {
      // Escape cancels an in-flight resize without committing.
      if (e.key === 'Escape') setResizing(null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // resizing is the trigger; the listeners read resizingRef.current so
    // they don't need to re-attach on every state tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing !== null]);

  // fix-25-feat-a: drag-to-resize NP blocks (vacation / training / etc.)
  // on BOTH edges. Top handle moves start_week; bottom handle moves
  // end_week. Same window-listener pattern as project-block resize.
  // Overlap is checked server-side and surfaced via the conflict prompt.
  interface NpResizeState {
    blockId: string;
    daName: string;
    edge: 'top' | 'bottom';
    /** Captured at mousedown — used as the rollback anchor. */
    originalStartWeek: string;
    originalEndWeek: string;
    /** Live preview, mutated by mousemove. The non-active edge stays
     *  pinned to its original value. */
    previewStartWeek: string;
    previewEndWeek: string;
    startMouseY: number;
    expectedUpdatedAt: string;
    /** Display label for the conflict prompt header. */
    anchorLabel: string;
  }
  interface PendingNpResizeConflict {
    blockId: string;
    daName: string;
    anchorLabel: string;
    expectedUpdatedAt: string;
    newStartWeek: string;
    newEndWeek: string;
    kind: 'project' | 'np';
    conflicts: Array<
      | { kind: 'project'; address: string; startWeek: string; endWeek: string }
      | {
          kind: 'np';
          type: string;
          label: string | null;
          startWeek: string;
          endWeek: string;
        }
    >;
  }
  const resizeNpMutation = useResizeDaTimeBlock();
  const [npResizing, setNpResizing] = useState<NpResizeState | null>(null);
  const npResizingRef = useRef<NpResizeState | null>(null);
  // Same render-time-ref pattern as resizingRef above.
  // eslint-disable-next-line react-hooks/refs
  npResizingRef.current = npResizing;
  const [pendingNpConflict, setPendingNpConflict] =
    useState<PendingNpResizeConflict | null>(null);

  /** Commit an NP resize via the RPC. Used by both the mouseup
   *  handler (initial commit) and the conflict prompt's confirm
   *  callback (force=true retry). */
  function commitNpResize(args: {
    blockId: string;
    daName: string;
    anchorLabel: string;
    expectedUpdatedAt: string;
    newStartWeek: string;
    newEndWeek: string;
    force?: boolean;
  }) {
    resizeNpMutation.mutate(
      {
        blockId: args.blockId,
        newStartWeek: args.newStartWeek,
        newEndWeek: args.newEndWeek,
        expectedUpdatedAt: args.expectedUpdatedAt,
        force: args.force ?? false,
      },
      {
        onSuccess: (result) => {
          if (result.overlapKind === 'project') {
            const items = (result.overlapConflicts as
              | NpResizeProjectConflict[]
              | null) ?? [];
            setPendingNpConflict({
              blockId: args.blockId,
              daName: args.daName,
              anchorLabel: args.anchorLabel,
              expectedUpdatedAt: args.expectedUpdatedAt,
              newStartWeek: args.newStartWeek,
              newEndWeek: args.newEndWeek,
              kind: 'project',
              conflicts: items.map((c) => ({
                kind: 'project',
                address: c.address,
                startWeek: c.start_week,
                endWeek: c.end_week,
              })),
            });
          } else if (result.overlapKind === 'np') {
            const items = (result.overlapConflicts as
              | NpResizeNpConflict[]
              | null) ?? [];
            setPendingNpConflict({
              blockId: args.blockId,
              daName: args.daName,
              anchorLabel: args.anchorLabel,
              expectedUpdatedAt: args.expectedUpdatedAt,
              newStartWeek: args.newStartWeek,
              newEndWeek: args.newEndWeek,
              kind: 'np',
              conflicts: items.map((c) => ({
                kind: 'np',
                type: c.type,
                label: c.label,
                startWeek: c.start_week,
                endWeek: c.end_week,
              })),
            });
          }
        },
      },
    );
  }

  useEffect(() => {
    if (!npResizing) return;
    function onMove(e: MouseEvent) {
      const r = npResizingRef.current;
      if (!r) return;
      const deltaPx = e.clientY - r.startMouseY;
      const deltaWeeks = Math.round(deltaPx / rowHRef.current);
      if (r.edge === 'bottom') {
        let candidate = addWeeksToWeekKey(r.originalEndWeek, deltaWeeks);
        if (candidate < r.previewStartWeek) candidate = r.previewStartWeek;
        if (candidate === r.previewEndWeek) return;
        setNpResizing({ ...r, previewEndWeek: candidate });
      } else {
        let candidate = addWeeksToWeekKey(r.originalStartWeek, deltaWeeks);
        if (candidate > r.previewEndWeek) candidate = r.previewEndWeek;
        if (candidate === r.previewStartWeek) return;
        setNpResizing({ ...r, previewStartWeek: candidate });
      }
    }
    function onUp() {
      const r = npResizingRef.current;
      setNpResizing(null);
      if (!r) return;
      // No-op if the user released at the same range they started.
      if (
        r.previewStartWeek === r.originalStartWeek &&
        r.previewEndWeek === r.originalEndWeek
      ) {
        return;
      }
      commitNpResize({
        blockId: r.blockId,
        daName: r.daName,
        anchorLabel: r.anchorLabel,
        expectedUpdatedAt: r.expectedUpdatedAt,
        newStartWeek: r.previewStartWeek,
        newEndWeek: r.previewEndWeek,
      });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNpResizing(null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [npResizing !== null]);

  function hoverRange(startWeek: string, endWeek: string) {
    // weeks already covers the current quarter — intersect against it so we
    // don't store off-screen keys (cheap; <=14 entries).
    const next = new Set<string>();
    for (const w of weeks) {
      if (w >= startWeek && w <= endWeek) next.add(w);
    }
    setHoveredWeeks(next);
  }
  function clearHover() {
    setHoveredWeeks((prev) => (prev.size === 0 ? prev : new Set()));
  }

  // react-compiler complains it can't preserve this memoization; the
  // useMemo is intentional caching across renders for downstream
  // address lookups. Disable to allow the manual memoization to stand.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  // fix-23b B1: auto-snap quarterOffset to the earliest matched project's
  // start_week when search is active. Without this, a user navigating
  // forward two quarters and typing an address whose block lives in today's
  // quarter sees an empty grid with no hint where the match is.
  //
  // Guarded by lastSnappedSearchRef so we fire exactly once per search
  // string (effect deps also include `draw` so a late-arriving fetch can
  // trigger the snap retroactively; without the ref, a re-render with the
  // same search would re-snap and potentially fight the user's manual
  // quarter arrow click).
  //
  // Clearing search resets the ref but does NOT snap back — the user keeps
  // whatever quarter they last navigated to (matches the spec).
  const lastSnappedSearchRef = useRef<string>('');
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === '') {
      lastSnappedSearchRef.current = '';
      return;
    }
    if (trimmed === lastSnappedSearchRef.current) return;
    let earliestStart: string | null = null;
    for (const row of draw) {
      if (!row.start_week) continue;
      const project = projectById.get(row.project_id);
      if (!project) continue;
      if (!multiMatchAddress(trimmed, project.address)) continue;
      if (earliestStart === null || row.start_week < earliestStart) {
        earliestStart = row.start_week;
      }
    }
    lastSnappedSearchRef.current = trimmed;
    if (earliestStart === null) return; // no scheduled project matched; stay put
    setQuarterOffset(weekKeyToQuarterOffset(earliestStart));
  }, [search, draw, projectById, setQuarterOffset]);

  // All blocks (across DAs), keyed by da. Used by drop handler to detect
  // overlap on the target DA. Different from blocksByDa (which is filtered
  // to the current quarter + search) — overlap detection should consider
  // every existing block, not just the visible ones.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
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

  /** Q9.5.f-fix-20: dispatch a "silent save" drop (no overlap, no NP).
   *  When the DA differs from the source, route through
   *  bp_move_draw_schedule_da so permits + tasks rewrite atomically with
   *  the schedule change. Same-DA moves stay on the original RPC.
   *  After a DA move that leaves downstream blocks behind, the result
   *  carries gap_exists=true and we open GapFillPrompt. */
  /** Fire bp_move_draw_schedule_da, then (when the user confirmed a DM change)
   *  cascade ent_lead on the moved project. Preserves the gap-fill prompt. */
  function doMove(
    moveArgs: MoveDrawScheduleDaInput,
    payload: DragPayload,
    cascadeDm: boolean,
  ) {
    moveDaMutation.mutate(moveArgs, {
      onSuccess: (result) => {
        // fix-72: the move tx has committed (permits.da settled), so cascading
        // ent_lead now routes from the new DA. ENT task primary follows by
        // derivation (fix-70) — no permit_task_assignees edits.
        if (cascadeDm) {
          cascadeEntLead.mutate({ projectId: payload.projectId });
        }
        if (
          result.gapExists &&
          result.gapDownstreamCount > 0 &&
          result.oldDa &&
          payload.originalStartWeek &&
          payload.originalEndWeek
        ) {
          const addr =
            projectById.get(payload.projectId)?.address ?? payload.projectId;
          setPendingGapFill({
            daName: result.oldDa,
            movedAddress: addr,
            downstreamCount: result.gapDownstreamCount,
            gapStartWeek: payload.originalStartWeek,
            gapEndWeek: payload.originalEndWeek,
          });
        }
      },
    });
  }

  async function commitMove(
    payload: DragPayload,
    targetDa: string,
    targetStartWeek: string,
    targetEndWeek: string,
  ) {
    const isDaChange =
      payload.currentDa !== null && payload.currentDa !== targetDa;
    if (!isDaChange) {
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
    const moveArgs: MoveDrawScheduleDaInput = {
      projectId: payload.projectId,
      newDa: targetDa,
      newDm: dmByDa.get(targetDa) ?? null,
      startWeek: targetStartWeek,
      endWeek: targetEndWeek,
      scheduleStatus: payload.status,
      expectedUpdatedAt: payload.expectedUpdatedAt,
    };

    // fix-72: does this move imply a DM (ent_lead) change per the team routing?
    // juris lives on the project; current DM = the BP permit's ent_lead.
    const project = projectById.get(payload.projectId);
    const juris = project?.juris ?? null;
    const projPermits = permitsByProjectId.get(payload.projectId) ?? [];
    const bp =
      projPermits.find((p) => p.type === 'Building Permit') ??
      projPermits[0] ??
      null;
    const currentEntLead = bp?.ent_lead ?? null;

    let projected: string | null;
    try {
      projected = await lookupEntLeadForDa(targetDa, juris);
    } catch {
      // Routing lookup failed — don't block the move; just skip the cascade.
      projected = null;
    }

    if (projected !== null && projected !== currentEntLead) {
      // Implied Entitlement Lead change — ask before applying
      // (Update Entitlement Lead / Keep / Cancel).
      setPendingEntCascade({
        moveArgs,
        payload,
        movedAddress: project?.address ?? payload.projectId,
        fromLead: currentEntLead,
        toLead: projected,
      });
      return;
    }

    // No implied change (projected matches), OR the DA isn't in the routing
    // table (null) → move without touching ent_lead (manual override stays
    // put).
    doMove(moveArgs, payload, false);
  }

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

      // Q9.5.f-fix-20: dispatch through commitMove — picks
      // bp_move_draw_schedule_da when DA changed, bp_update_draw_schedule_with_dd_sync
      // for same-DA reposition. Also opens GapFillPrompt if the move
      // stranded downstream blocks on the old DA.
      void commitMove(payload, targetDa, targetStartWeek, targetEndWeek);
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
    const map = new Map<string, { row: DrawScheduleRow; project: Project }[]>();
    for (const da of visibleDaNames) map.set(da, []);
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
  }, [draw, projectById, visibleDaNames, weeks, search]);

  // Q6.2.c: NP blocks grouped by DA, filtered to current quarter. Same
  // overlap predicate as project blocks; render-only (no drag, no drop).
  //
  // fix-23b B2: also filter by search. Suppress NP blocks whose label and
  // type both fail the active query, matching the project-block filter at
  // blocksByDa (same multiMatchAddress matcher). Without this, NP overlays
  // (vacation / training / etc.) leaked through during search and cluttered
  // the otherwise-narrowed grid.
  const npBlocksByDa = useMemo(() => {
    const trimmed = search.trim();
    const map = new Map<string, DaTimeBlock[]>();
    for (const b of npBlocks) {
      const overlapsQ =
        b.start_week <= weeks[weeks.length - 1] && b.end_week >= weeks[0];
      if (!overlapsQ) continue;
      if (trimmed !== '') {
        const labelMatch =
          b.label != null && multiMatchAddress(trimmed, b.label);
        const typeMatch = multiMatchAddress(trimmed, b.type);
        if (!labelMatch && !typeMatch) continue;
      }
      const list = map.get(b.da_name) ?? [];
      list.push(b);
      map.set(b.da_name, list);
    }
    return map;
  }, [npBlocks, weeks, search]);


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

  // fix-182d: all three render bands (DM header, DA header, body columns) share
  // ONE grid-template-columns so column/group boundaries align pixel-perfectly.
  // Under the old per-band flex layout the DM-header band had one border per
  // GROUP while the columns band had one per COLUMN, so flex-basis:0 distributed
  // free space differently and group boundaries drifted (worsening left→right).
  // A track per column (minmax(DA_MIN_W, 1fr)) makes track lines identical in
  // every band regardless of borders; `width:max-content` + `minWidth:100%`
  // reproduces the old "fill when few columns, scroll when many" behavior.
  const gridBandStyle = useMemo<CSSProperties>(() => {
    const n = renderColumns.length;
    return {
      display: 'grid',
      gridTemplateColumns:
        n > 0
          ? `${labelW}px repeat(${n}, minmax(${DA_MIN_W}px, 1fr))`
          : `${labelW}px`,
      width: 'max-content',
      minWidth: '100%',
    };
  }, [renderColumns.length, labelW]);

  return (
    // fix-47: fill the parent's height as a flex column so the grid card can
    // flex-1 into the available space (Toolbar + Unscheduled stay their
    // natural height; the card absorbs the rest and scrolls if needed).
    <div className="flex flex-col h-full min-h-0 gap-3">
      <Toolbar
        quarterOffset={quarterOffset}
        setQuarterOffset={setQuarterOffset}
        search={search}
        setSearch={setSearch}
        isLayoutMode={isLayoutMode}
      />

      <div
        ref={gridScrollRef}
        className="relative bg-surface border border-border rounded-xl overflow-auto flex-1 min-h-0"
        data-testid="draw-schedule-grid"
      >
        {/* DM (manager-header) band. fix-182d: a CSS grid sharing
            gridBandStyle with the DA-header + body bands so a group's right
            edge always lands on the same track line as its last DA column. Each
            group cell spans `colCount` tracks. A null header (standalone /
            orphan lane) renders a blank cell so alignment is preserved. */}
        <div
          data-testid="ds-band-dm"
          style={gridBandStyle}
          className="sticky top-0 z-20 bg-s2 border-b border-border"
        >
          <div className="border-r border-border" />
          {renderGroups.map((g, gi) => (
            <div
              key={g.key}
              data-testid={`ds-group-${gi}`}
              data-span={g.colCount}
              style={{ gridColumn: `span ${g.colCount}` }}
              className="text-center px-1 py-1 border-r-2 border-border text-[11px] font-extrabold uppercase truncate text-text"
            >
              {g.header ?? ''}
            </div>
          ))}
        </div>

        {/* DA (column-header) band — same shared grid template. */}
        <div
          data-testid="ds-band-da"
          style={gridBandStyle}
          className="sticky top-[26px] z-[19] bg-s2 border-b-2 border-border"
        >
          <div className="border-r border-border" />
          {renderColumns.map((c) => {
            const isInactive = c.inactive;
            return (
              <div
                key={c.key}
                data-testid={
                  c.daName ? `da-header-${c.daName}` : `da-header-open-${c.key}`
                }
                data-inactive={isInactive ? 'true' : undefined}
                title={
                  isInactive
                    ? `${c.label} is not active this quarter — visible because they have a block here`
                    : c.label
                }
                // fix-182d: width comes from the shared grid track (one per
                // column); no per-cell flex sizing.
                className={`text-center px-1 py-1 text-[10px] font-bold truncate ${
                  c.isLastInGroup
                    ? 'border-r-2 border-border'
                    : 'border-r border-border'
                } ${isInactive ? 'italic opacity-60' : ''}`}
              >
                {c.label}
              </div>
            );
          })}
        </div>

        {/* Body grid. onMouseLeave clears the hover-week highlight when the
            cursor exits the whole grid — child mouseenter handlers (blocks +
            empty cells) drive the active range while inside. */}
        <div
          ref={bodyGridRef}
          data-testid="ds-band-body"
          style={{ ...gridBandStyle, position: 'relative' }}
          onMouseLeave={clearHover}
        >
          {/* Week labels column (grid track 1) */}
          <div
            data-testid="week-label-col"
            className="border-r border-border"
          >
            {weeks.map((wk) => {
              const isCurrent = wk === currentWeek;
              // Q9.5.f-fix-20: highlight when a project block or empty cell
              // at this week is hovered. Hover wins over the muted current-
              // week styling so the user sees a coherent range while moving
              // the mouse — current-week chevron still shows.
              const isHovered = hoveredWeeks.has(wk);
              return (
                <div
                  key={wk}
                  data-testid={`week-label-${wk}`}
                  data-hovered={isHovered ? 'true' : undefined}
                  style={{
                    height: rowH,
                    fontSize: Math.round(9 * textScale),
                    // fix-48: never let the M/D – M/D range wrap to a 2nd line.
                    whiteSpace: 'nowrap',
                  }}
                  className={`flex items-center justify-end pr-1.5 border-b border-border font-mono transition-colors ${
                    isHovered
                      ? 'bg-de/[0.18] text-text font-bold'
                      : isCurrent
                        ? 'text-de font-bold'
                        : 'text-dim'
                  }`}
                >
                  {isCurrent ? '▸ ' : ''}
                  {formatWeekRange(wk)}
                </div>
              );
            })}
          </div>

          {/* DA columns */}
          {renderColumns.map((col) => {
            const isLast = col.isLastInGroup;
            // fix-182c: OPEN placeholder lane — empty column, holds no blocks
            // and is not a drop target (no DA to assign; locked #8). Week cells
            // render for grid alignment only.
            if (col.kind === 'open' || col.daName === null) {
              return (
                <div
                  key={col.key}
                  data-testid={`da-col-open-${col.key}`}
                  // fix-182d: width from the shared grid track.
                  className={`relative ${
                    isLast ? 'border-r-2 border-border' : 'border-r border-border'
                  }`}
                >
                  {weeks.map((wk) => (
                    <div
                      key={wk}
                      style={{ height: rowH }}
                      className={`border-b border-border ${
                        wk === currentWeek ? 'bg-de/[0.04]' : ''
                      }`}
                    />
                  ))}
                </div>
              );
            }
            const da = col.daName;
            const blocks = blocksByDa.get(da) ?? [];
            const daNpBlocks = npBlocksByDa.get(da) ?? [];
            return (
                <div
                  key={col.key}
                  data-testid={`da-col-${da}`}
                  // fix-182d: width comes from the shared grid track (one per
                  // column) so the body column lines up with its header.
                  className={`relative ${
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
                      style={{ height: rowH }}
                      className={`border-b border-border cursor-pointer ${
                        wk === currentWeek ? 'bg-de/[0.04]' : ''
                      }`}
                      onMouseEnter={() => hoverRange(wk, wk)}
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
                      part of the NP range is covered by a project.
                      fix-25-feat-a: each segment carries top + bottom
                      drag handles for resize. While a resize is in
                      flight, the segment math uses the preview range so
                      the user gets live height feedback. */}
                  {daNpBlocks.flatMap((np) => {
                    const isResizingThis =
                      npResizing?.blockId === np.id;
                    const effectiveStart = isResizingThis
                      ? npResizing!.previewStartWeek
                      : np.start_week;
                    const effectiveEnd = isResizingThis
                      ? npResizing!.previewEndWeek
                      : np.end_week;
                    const projectRanges = blocks
                      .filter((b) => b.row.start_week && b.row.end_week)
                      .map((b) => ({
                        startWeek: b.row.start_week as string,
                        endWeek: b.row.end_week as string,
                      }));
                    const segments = computeNpSegments(
                      effectiveStart,
                      effectiveEnd,
                      projectRanges,
                      weeks,
                    );
                    if (segments.length === 0) return [];
                    const labelText = np.label?.trim() || np.type;
                    const tooltipText = `${np.type}${np.label && np.label !== np.type ? ` — ${np.label}` : ''} (${effectiveStart} → ${effectiveEnd}) — drag edges to resize`;
                    return segments.map((seg, segIdx) => {
                      const si = weeks.indexOf(seg.startWeek);
                      const ei = weeks.indexOf(seg.endWeek);
                      if (si < 0 || ei < 0) return null;
                      const top = si * rowH;
                      const height = (ei - si + 1) * rowH - 2;
                      // fix-25-feat-a: attach the top handle to the first
                      // visible segment and the bottom handle to the last.
                      // When the true start/end of the NP is covered by a
                      // project block the user wouldn't otherwise have a
                      // grabbable edge — anchoring to the visible segments
                      // keeps resize reachable even when the NP is clipped.
                      const isFirstSegment = segIdx === 0;
                      const isLastSegment = segIdx === segments.length - 1;
                      return (
                        <div
                          key={`${np.id}-seg-${segIdx}`}
                          data-testid={`np-block-${np.id}-seg-${segIdx}`}
                          title={tooltipText}
                          onMouseEnter={() =>
                            hoverRange(seg.startWeek, seg.endWeek)
                          }
                          onClick={(e) => {
                            // Open edit popup. stopPropagation so the click
                            // doesn't bubble to the underlying empty-cell
                            // add-popup handler. Suppressed during drag /
                            // resize so the release click doesn't reopen.
                            e.stopPropagation();
                            if (draggingProjectId !== null) return;
                            if (npResizing !== null) return;
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
                            // fix-DS-tail-and-fit: center the NP label both axes
                            // (matches the project blocks) — Bobby wanted the
                            // Vacation / Corrections / etc. text centered in the
                            // pill rather than pinned to the top. Resize handles
                            // are position:absolute so they're unaffected.
                            // fix-DS-fit-and-wrap: the label now wraps (see the
                            // inner span) instead of clipping mid-word, so the
                            // container no longer forces nowrap/ellipsis.
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: Math.round(9 * textScale),
                            fontWeight: 700,
                            lineHeight: 1.1,
                            textAlign: 'center',
                            zIndex: 3,
                            cursor: 'pointer',
                            pointerEvents:
                              draggingProjectId === null ? 'auto' : 'none',
                          }}
                        >
                          {/* fix-DS-fit-and-wrap: let a long NP label (e.g.
                              "Cancelled Project (9022 36th Ave NE)") wrap onto
                              multiple lines instead of clipping mid-word. The
                              outer block keeps overflow:hidden so an extreme
                              label still can't burst out vertically. */}
                          <span
                            data-testid={`np-label-${np.id}`}
                            style={{
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              overflowWrap: 'anywhere',
                              textAlign: 'center',
                            }}
                          >
                            {labelText}
                          </span>
                          {/* fix-25-feat-a: top edge resize handle (start_week) */}
                          {isFirstSegment && (
                            <div
                              data-testid={`np-resize-top-${np.id}`}
                              draggable={false}
                              onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                e.stopPropagation();
                                e.preventDefault();
                                setNpResizing({
                                  blockId: np.id,
                                  daName: np.da_name,
                                  edge: 'top',
                                  originalStartWeek: np.start_week,
                                  originalEndWeek: np.end_week,
                                  previewStartWeek: np.start_week,
                                  previewEndWeek: np.end_week,
                                  startMouseY: e.clientY,
                                  expectedUpdatedAt: np.updated_at,
                                  anchorLabel: labelText,
                                });
                              }}
                              style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                top: 0,
                                height: 6,
                                cursor: 'ns-resize',
                                background:
                                  isResizingThis && npResizing!.edge === 'top'
                                    ? 'rgba(0,0,0,0.25)'
                                    : 'rgba(0,0,0,0.10)',
                                pointerEvents:
                                  draggingProjectId !== null ? 'none' : 'auto',
                              }}
                            />
                          )}
                          {/* fix-25-feat-a: bottom edge resize handle (end_week) */}
                          {isLastSegment && (
                            <div
                              data-testid={`np-resize-bottom-${np.id}`}
                              draggable={false}
                              onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                e.stopPropagation();
                                e.preventDefault();
                                setNpResizing({
                                  blockId: np.id,
                                  daName: np.da_name,
                                  edge: 'bottom',
                                  originalStartWeek: np.start_week,
                                  originalEndWeek: np.end_week,
                                  previewStartWeek: np.start_week,
                                  previewEndWeek: np.end_week,
                                  startMouseY: e.clientY,
                                  expectedUpdatedAt: np.updated_at,
                                  anchorLabel: labelText,
                                });
                              }}
                              style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                bottom: 0,
                                height: 6,
                                cursor: 'ns-resize',
                                background:
                                  isResizingThis && npResizing!.edge === 'bottom'
                                    ? 'rgba(0,0,0,0.25)'
                                    : 'rgba(0,0,0,0.10)',
                                pointerEvents:
                                  draggingProjectId !== null ? 'none' : 'auto',
                              }}
                            />
                          )}
                        </div>
                      );
                    });
                  })}

                  {/* Project blocks */}
                  {blocks.map(({ row, project }) => {
                    const startIdx = weeks.indexOf(row.start_week ?? '');
                    // Q9.5.f-fix-20: while THIS block is being resized, the
                    // visible end_week comes from the preview state (live
                    // height feedback). Otherwise use the stored end_week.
                    // Non-resized blocks render identically to before.
                    const effectiveEndWeek =
                      resizing?.projectId === row.project_id
                        ? resizing.previewEndWeek
                        : row.end_week ?? '';
                    const endIdx = weeks.indexOf(effectiveEndWeek);
                    if (startIdx < 0 && endIdx < 0) return null;
                    const si = startIdx >= 0 ? startIdx : 0;
                    const ei = endIdx >= 0 ? endIdx : weeks.length - 1;
                    const top = si * rowH;
                    const height =
                      Math.min((ei - si + 1) * rowH, (weeks.length - si) * rowH) - 3;
                    // Q9.5.g: derive status from live permit/cycle data via
                    // dsAutoStatus precedence (Corrections > Approved > Under
                    // Review > DD-phase date math). The stored row.status is
                    // only respected when manual_status is true AND the auto
                    // derive is in the DD phase — the three permit-data
                    // branches always win.
                    // fix-150: reuse-redesign lanes (no own permits) chase to
                    // the parent project's BP so they show the same derived
                    // status as the parent instead of raw 'Scheduled'.
                    const { status: derivedStatus } = deriveLaneStatus({
                      project,
                      permitsByProjectId,
                      cyclesByPermit,
                      currentStatus: row.status,
                      manualStatus: row.manual_status === true,
                    });
                    // fix-160: label AND color come from the ONE presentation
                    // record keyed by the single derived status — so the block's
                    // text and its shade can never disagree.
                    const pres =
                      STATUS_PRESENTATION[derivedStatus] ??
                      STATUS_PRESENTATION.Scheduled;
                    const sc = pres.colors;
                    // fix-126: redesign blocks get a yellow border to
                    // distinguish them from juris-colored normals. The
                    // helper falls back to jurisBorder when the FK is
                    // null, so non-redesign blocks render identically.
                    const borderColor = blockBorderColor(
                      project.juris,
                      project.redesign_of_project_id,
                    );
                    // fix-DS-uniform-layout: every non-tail block renders the
                    // same 5-line stack — the visible span only feeds the font
                    // ramp (blockFontPx), not which fields show. Whether the
                    // block spills past the quarter window still drives the
                    // compact overflow variant (tail + ← nav affordance).
                    const visibleSpan = ei - si + 1;
                    const overflow = blockOverflow(
                      row.start_week ?? '',
                      effectiveEndWeek,
                      weeks,
                    );
                    // fix-DS-compact-rule: a block is "compact" when it can't
                    // fit the full 5-line stack — either a cross-quarter slice
                    // (overflow) or a 1-week non-overflow block. Compact blocks
                    // render minimal content (address + Est. Approval) anchored
                    // to the top so the address never clips; taller non-overflow
                    // blocks render the full stack, centered.
                    const isCompact = !!overflow || visibleSpan <= 1;
                    // fix-DS-fluid-sizing: fluid base font from the visible
                    // span, then textScale (fix-47 row-height scaling) on top.
                    // Address renders one step larger (base + 1, bold); juris /
                    // Est. Approval one step smaller (base − 1).
                    const baseFontPx = blockFontPx(visibleSpan);
                    const addrFont = Math.round((baseFontPx + 1) * textScale);
                    const detailFont = Math.round((baseFontPx - 1) * textScale);
                    const shortLabel = project.address.split(',')[0];
                    // Duration in weeks is end..start inclusive.
                    const durationWeeks = Math.max(
                      1,
                      Math.round(
                        (new Date(`${row.end_week}T12:00:00Z`).getTime() -
                          new Date(`${row.start_week}T12:00:00Z`).getTime()) /
                          (7 * 86400000),
                      ) + 1,
                    );
                    // fix-126: redesign blocks reveal the original
                    // address in the browser tooltip ("Redesign of
                    // [original]"). A small "R" badge could go in a
                    // corner but blocks are routinely cramped (1-week
                    // overflow tails); skip the badge in favor of the
                    // tooltip + yellow border, per Bobby's "if it
                    // doesn't fit, skip" call.
                    const isRedesign = !!project.redesign_of_project_id;
                    const originalAddress = isRedesign
                      ? projectsById.get(project.redesign_of_project_id ?? '')
                          ?.address ?? null
                      : null;
                    const redesignTitleSuffix =
                      isRedesign && originalAddress
                        ? ` · Redesign of ${originalAddress}`
                        : isRedesign
                          ? ' · Redesign'
                          : '';
                    return (
                      <div
                        key={row.project_id}
                        data-testid={`block-${row.project_id}`}
                        data-tier="default"
                        data-overflow={overflow === 'tail' ? 'tail' : undefined}
                        data-redesign={isRedesign ? 'true' : undefined}
                        title={`${project.address} — ${derivedStatus}${redesignTitleSuffix} (drag to move, click to edit)`}
                        draggable
                        onMouseEnter={() => {
                          // Q9.5.f-fix-20: highlight every week the block
                          // spans in the left column. Range is the row's
                          // own start_week..end_week (storage truth), not
                          // the clipped visible range, so hovering a block
                          // that extends past the quarter still lights up
                          // the in-quarter weeks correctly.
                          if (row.start_week && row.end_week) {
                            hoverRange(row.start_week, row.end_week);
                          }
                        }}
                        onDragStart={(e) => {
                          const payload: DragPayload = {
                            projectId: row.project_id,
                            durationWeeks,
                            expectedUpdatedAt: row.updated_at,
                            status: row.status,
                            currentDa: row.da_assigned,
                            originalStartWeek: row.start_week,
                            originalEndWeek: row.end_week,
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
                          // fix-DS-compact-rule: compact blocks (overflow slices
                          // or 1-week non-overflow) top-anchor so the address —
                          // the first child — can never clip (centering would
                          // let overflow:hidden trim the top half on a too-tall
                          // stack, per fix-DS-address-anchor). Taller non-overflow
                          // blocks have room for the full stack, so they center
                          // (Bobby's preferred look). gap/padding stay tight so
                          // even a centered 2-week block doesn't clip.
                          alignItems: 'center',
                          justifyContent: isCompact ? 'flex-start' : 'center',
                          textAlign: 'center',
                          gap: 1,
                          padding: '1px 6px',
                        }}
                      >
                        {/* fix-DS-uniform-layout: block content.
                            - tail overflow slice → address + ← nav glyph.
                            - every other block → the SAME 5-line stack
                              (address / juris / status / Est. Approval label /
                              date), fluid-sized via blockFontPx.
                            The address is a single line that truncates with an
                            ellipsis (full address in the title tooltip) so the
                            grid keeps a uniform per-block rhythm. */}
                        <span
                          style={{
                            fontSize: addrFont,
                            fontWeight: 800,
                            lineHeight: 1.1,
                            // fix-DS-uniform-layout: single line + ellipsis (full
                            // address lives in `title`) so every block's address
                            // is exactly one row tall — restores the rhythm the
                            // 2-line wrap broke.
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                            color: sc.text,
                          }}
                          title={project.address}
                          data-testid={`block-address-${row.project_id}`}
                        >
                          {shortLabel}
                        </span>

                        {/* fix-DS-tail-and-fit: a tail slice (block started in
                            an earlier quarter) no longer renders compact. It
                            shows the SAME full stack as any other block; the
                            "starts earlier" cue is demoted to a small ← button
                            pinned to the top-left corner. It's absolutely
                            positioned so it doesn't push the vertically-centered
                            stack off-center. Clicking it jumps to the start
                            quarter. (HEAD slices never get an arrow — the
                            start/home quarter is where they render in full.) */}
                        {overflow === 'tail' && (
                          <button
                            type="button"
                            data-testid={`block-overflow-nav-${row.project_id}`}
                            aria-label={`${shortLabel} starts earlier — go to its quarter`}
                            title="Continues from an earlier quarter — click to jump there"
                            onClick={(e) => {
                              // Don't let the nav click open the block popup or
                              // start a drag — it's its own affordance.
                              e.stopPropagation();
                              if (draggingProjectId !== null) return;
                              setQuarterOffset(
                                weekKeyToQuarterOffset(row.start_week ?? ''),
                              );
                            }}
                            style={{
                              position: 'absolute',
                              top: 1,
                              left: 3,
                              fontSize: Math.round(9 * textScale),
                              fontWeight: 800,
                              lineHeight: 1,
                              color: sc.text,
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              zIndex: 6,
                            }}
                          >
                            ←
                          </button>
                        )}
                        {/* fix-DS-uniform-layout: the SAME 5-line stack for
                            every block — address (above) / juris / status /
                            Est. Approval label / date. juris and the status pill
                            each get their own line so the rhythm is uniform
                            across blocks. Sized via blockFontPx; everything fits
                            even a 1-week row at the low font cap, so there are no
                            height gates. */}
                        <>
                          {/* fix-DS-overflow-minimal / fix-DS-compact-rule: drop
                              juris on every compact block (overflow slices AND
                              1-week non-overflow blocks). A constrained slice
                              renders only address + Est. Approval; the full juris
                              still shows in the home quarter, so nothing is lost
                              — the view just declutters to the most pertinent
                              fields. Taller non-overflow blocks keep juris. */}
                          {!isCompact && project.juris && (
                            <span
                              style={{
                                fontSize: detailFont,
                                fontWeight: 500,
                                lineHeight: 1.1,
                                opacity: 0.75,
                                color: sc.text,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: '100%',
                              }}
                              data-testid={`block-juris-${row.project_id}`}
                            >
                              {project.juris}
                            </span>
                          )}
                          {/* fix-DS-overflow-no-pill / fix-DS-compact-rule: drop
                              the status pill on every compact block (overflow
                              slices AND 1-week non-overflow blocks). The block
                              fill color already encodes status, and the freed
                              space lets the address — the most identifying field
                              — show instead. Taller non-overflow blocks keep the
                              pill (helps users still learning the color code,
                              and they have room for it). */}
                          {!isCompact && (
                            <span
                              style={{
                                // fix-DS-pill-and-date: shrink the status pill
                                // ~25% (8 -> 6px font) with tighter padding +
                                // corner radius so it stops dominating small
                                // blocks — the bold address on top now reads
                                // first. Still keeps the colored border + bg.
                                fontSize: Math.round(6 * textScale),
                                fontWeight: 700,
                                padding: '0px 3px',
                                borderRadius: 2,
                                background: 'rgba(255,255,255,0.55)',
                                color: sc.border,
                                border: `1px solid ${sc.border}`,
                                whiteSpace: 'nowrap',
                              }}
                              data-testid={`block-status-${row.project_id}`}
                            >
                              {pres.label}
                            </span>
                          )}
                          {(() => {
                            // Q9.5.f-fix-17.5 C: Est. Approval uses the same
                            // computeProjectedApproval pipeline as Schedule
                            // Estimator / Schedule Health (pre-computed per
                            // project at body scope). fix-DS-fluid-sizing:
                            // label + date split onto two lines.
                            // fix-100: once the BP's approval_date is set,
                            // computeProjectedApproval returns isActual=true
                            // and the projection IS the real approval date —
                            // drop the "Est." prefix. The shorter label also
                            // helps in space-constrained compact blocks.
                            const projection = projectionByProjectId.get(
                              row.project_id,
                            );
                            if (!projection) return null;
                            const label = projection.isActual
                              ? 'Approval'
                              : 'Est. Approval';
                            return (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  lineHeight: 1.1,
                                  color: sc.text,
                                }}
                                data-testid={`block-est-approval-${row.project_id}`}
                                data-actual={projection.isActual ? 'true' : 'false'}
                                title={`${label} — ${projection.projection}`}
                              >
                                <span
                                  style={{
                                    fontSize: Math.max(7, detailFont - 1),
                                    fontWeight: 600,
                                    opacity: 0.7,
                                  }}
                                >
                                  {label}
                                </span>
                                <span
                                  style={{
                                    fontSize: detailFont,
                                    fontWeight: 800,
                                    opacity: 0.95,
                                  }}
                                >
                                  {formatProjectionDate(projection.projection)}
                                </span>
                              </div>
                            );
                          })()}
                        </>
                        {/* Q9.5.f-fix-20: resize handle on the bottom edge.
                            6px tall, full-width, ns-resize cursor. Captures
                            mousedown to start the resize gesture; the actual
                            move/up listeners live on window so the cursor
                            can leave the block without canceling. The
                            handle itself is not draggable, and we stop
                            propagation so it doesn't trigger the parent's
                            HTML5 drag. */}
                        <div
                          data-testid={`resize-handle-${row.project_id}`}
                          draggable={false}
                          onMouseDown={(e) => {
                            // Only left-button initiates a resize.
                            if (e.button !== 0) return;
                            if (!row.start_week || !row.end_week || !row.da_assigned) {
                              return;
                            }
                            e.stopPropagation();
                            e.preventDefault();
                            setResizing({
                              projectId: row.project_id,
                              daAssigned: row.da_assigned,
                              startWeek: row.start_week,
                              originalEndWeek: row.end_week,
                              previewEndWeek: row.end_week,
                              startMouseY: e.clientY,
                              expectedUpdatedAt: row.updated_at,
                              status: row.status,
                            });
                          }}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: 6,
                            cursor: 'ns-resize',
                            // Subtle visual affordance: a slightly darker
                            // band at the bottom edge. Becomes more visible
                            // when the user hovers the handle directly.
                            background:
                              resizing?.projectId === row.project_id
                                ? 'rgba(0,0,0,0.25)'
                                : 'rgba(0,0,0,0.10)',
                            // Prevent the handle from blocking pointer
                            // events on sibling blocks during another
                            // block's drag (mirrors the existing
                            // pointer-events contract for siblings).
                            pointerEvents:
                              draggingProjectId !== null &&
                              draggingProjectId !== row.project_id
                                ? 'none'
                                : 'auto',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
          })}
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
          // fix-150: same parent-chase as the grid blocks so the popup's
          // displayed status matches the lane for a reuse-redesign.
          const { status: derivedStatus, isAuto } = deriveLaneStatus({
            project,
            permitsByProjectId,
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
          pending={updateMutation.isPending || moveDaMutation.isPending}
          onCancel={() => setPendingNpWarning(null)}
          onConfirm={() => {
            // Q9.5.f-fix-20: NP-warning "Save anyway" still needs to
            // propagate DA changes to permits + tasks. Synthesize a
            // DragPayload from the pending NP state so commitMove can
            // decide between the move RPC and the same-DA RPC. We don't
            // have currentDa here, so look it up from the latest draw
            // row (Bug-B: draft cache may still reflect a stale DA,
            // but invalidateQueries on success makes this self-healing).
            const row = draw.find(
              (r) => r.project_id === pendingNpWarning.anchorProjectId,
            );
            void commitMove(
              {
                projectId: pendingNpWarning.anchorProjectId,
                durationWeeks: 0,
                expectedUpdatedAt: pendingNpWarning.expectedUpdatedAt,
                status: pendingNpWarning.scheduleStatus,
                currentDa: row?.da_assigned ?? null,
                originalStartWeek: row?.start_week ?? null,
                originalEndWeek: row?.end_week ?? null,
              },
              pendingNpWarning.daAssigned,
              pendingNpWarning.startWeek,
              pendingNpWarning.endWeek,
            );
            setPendingNpWarning(null);
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

      {/* fix-25-feat-a: NP resize conflict prompt. Both project and NP
          overlaps are soft — confirm fires the resize again with
          force=true; cancel discards. */}
      {pendingNpConflict && (
        <NpResizeConflictPrompt
          anchorLabel={pendingNpConflict.anchorLabel}
          daName={pendingNpConflict.daName}
          conflictKind={pendingNpConflict.kind}
          conflicts={pendingNpConflict.conflicts}
          pending={resizeNpMutation.isPending}
          onCancel={() => setPendingNpConflict(null)}
          onConfirm={() => {
            const c = pendingNpConflict;
            setPendingNpConflict(null);
            commitNpResize({
              blockId: c.blockId,
              daName: c.daName,
              anchorLabel: c.anchorLabel,
              expectedUpdatedAt: c.expectedUpdatedAt,
              newStartWeek: c.newStartWeek,
              newEndWeek: c.newEndWeek,
              force: true,
            });
          }}
        />
      )}

      {/* Q9.5.f-fix-20: gap-fill prompt. Opens after a successful DA move
          when downstream blocks remained on the OLD DA. Shift Up fires
          bp_shift_da_blocks_up; Leave Gap dismisses without action. */}
      {pendingGapFill && (
        <GapFillPrompt
          daName={pendingGapFill.daName}
          downstreamCount={pendingGapFill.downstreamCount}
          movedAddress={pendingGapFill.movedAddress}
          pending={shiftUpMutation.isPending}
          onLeaveGap={() => setPendingGapFill(null)}
          onShiftUp={() => {
            shiftUpMutation.mutate(
              {
                daName: pendingGapFill.daName,
                gapStartWeek: pendingGapFill.gapStartWeek,
                gapEndWeek: pendingGapFill.gapEndWeek,
              },
              { onSuccess: () => setPendingGapFill(null) },
            );
          }}
        />
      )}

      {/* fix-72 / fix-102: DA → Entitlement Lead cascade prompt. Opens
          before a DA move when the team routing implies a different
          ent_lead. Update Entitlement Lead = move + cascade ent_lead;
          Keep current Entitlement Lead = move only; Cancel move = abort. */}
      {pendingEntCascade && (
        <EntCascadePrompt
          movedAddress={pendingEntCascade.movedAddress}
          newDa={pendingEntCascade.moveArgs.newDa}
          fromLead={pendingEntCascade.fromLead}
          toLead={pendingEntCascade.toLead}
          pending={moveDaMutation.isPending || cascadeEntLead.isPending}
          onUpdateEntLead={() => {
            doMove(pendingEntCascade.moveArgs, pendingEntCascade.payload, true);
            setPendingEntCascade(null);
          }}
          onKeepEntLead={() => {
            doMove(pendingEntCascade.moveArgs, pendingEntCascade.payload, false);
            setPendingEntCascade(null);
          }}
          onCancel={() => setPendingEntCascade(null)}
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
  isLayoutMode,
}: {
  quarterOffset: number;
  setQuarterOffset: (n: number) => void;
  search: string;
  setSearch: (s: string) => void;
  isLayoutMode: boolean;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
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
        {/* fix-182c: flag quarters rendered from a saved per-quarter layout
            vs the current/default team structure. */}
        {isLayoutMode && (
          <span
            data-testid="quarter-layout-tag"
            title="This quarter renders a saved layout (Settings → Team → Draw Schedule Layout)"
            className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-de/40 bg-de/10 text-de font-display font-bold"
          >
            saved layout
          </span>
        )}
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
        Drag a block to move it. Drag the bottom edge to resize.
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
      <div className="flex-shrink-0 bg-surface border border-border rounded-xl px-4 py-2 text-[11px] text-dim italic">
        No unscheduled projects.
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 bg-surface border border-border rounded-xl px-4 py-3 space-y-2 max-h-[20vh] overflow-y-auto">
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
