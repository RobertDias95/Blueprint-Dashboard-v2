// ★ fix-441 §D (P-091): one chipStyle, in lib/chipStyle. `'bg'` is
//   THIS file's inactive tint — the four originals were two different
//   implementations, not one repeated. See the note there.
import { chipStyle } from '../lib/chipStyle';
import { usePermits } from '../hooks/usePermits';
import { taskPermitSuffix } from '../lib/permitDiscriminator';
import { nestSubtasks, type TaskGroup } from '../lib/taskNesting';
// ★★★ fix-444 §A (P-048): the band vocabulary is fix-397's, reused — see
// lib/taskBands for why a second name for the same seven days is the drift
// this avoids.
import {
  bandRows,
  compareInBand,
  resolvedOrder,
  type Band,
  type BandableRow,
} from '../lib/taskBands';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
// ★ fix-446/fix-408: a milestone row navigates to its permit, and Previous
//   must bring the reader back to My Tasks.
import { useOriginState } from '../hooks/useOriginState';
import { PARAM_TASK } from '../lib/notificationTargets';
import WaitingOnView from '../components/MyTasks/WaitingOnView';
import BotBadge from '../components/shared/BotBadge';
import AutoClosedBadge from '../components/shared/AutoClosedBadge';
import { UNOWNED_LABEL, taskNeedsOwner } from '../lib/boardOwnership';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { isCurrentMember } from '../lib/roster';
import { useAllTasks } from '../hooks/useTaskTree';
// fix-303: the task detail editor moved to its own component so My Board can
// use the SAME one. Nothing about it changed in the move.
import TaskDetailEditor from '../components/TaskDetailEditor';
import { inputStyle } from '../lib/taskFieldStyles';
import {
  checkboxVisual,
  isTaskLive,
  isTaskCancelled,
  isTaskOverdue,
} from '../lib/taskStatus';
// ★★★ fix-434: the row's two status controls share ONE write path and ONE
// optimistic layer. See hooks/useSetTaskStatus for why the checkbox stopped
// calling useUpsertTask directly.
import { useSetTaskStatus } from '../hooks/useSetTaskStatus';
import TaskStatusChip from '../components/MyTasks/TaskStatusChip';
import { TaskStatusOverlayProvider } from '../lib/taskStatusOverlay';
import {
  applyStatusOverlay,
  useTaskStatusOverlay,
  useTaskStatusPending,
} from '../lib/taskStatusOverlayContext';
import {
  useAllProjectHolds,
  cancelledProjectIds,
} from '../hooks/useProjectHolds';
import { excludeCancelled } from '../lib/projectViewHelpers';
import { useAllPermitHolds } from '../hooks/usePermitHolds';
import {
  excludeHeldWork,
  heldSetsFrom,
  holdRowFor,
  holdRowIndex,
  type HoldChipRow,
} from '../lib/heldWork';
import { useShowHeldWork } from '../hooks/useShowHeldWork';
import ShowHeldWorkToggle from '../components/shared/ShowHeldWorkToggle';
import { HoldBadge } from '../components/shared/HoldBadge';
import { useScopeMode } from '../hooks/useSelfScope';
import { type ScopeMode } from '../lib/selfScope';
import { useTaskOwnership } from '../hooks/useTaskOwnership';
// ★★★ fix-446 (P-096): milestones join the list. The forecast comes from the
// SHARED BoardInput — BoardBell already runs this on every page, so the rows
// cost no request (see hooks/useBoardInput).
import { useBoardInput } from '../hooks/useBoardInput';
import { buildForecast, type ForecastItem } from '../lib/myBoard';
import {
  makeLegsFor,
  milestoneReach,
  type MilestoneReach,
} from '../lib/milestoneOwnership';
import { useDmDaGroups } from '../hooks/useDmDaGroups';
import { findDmForDa } from '../components/wizard/dmRouting';
import { useAckMilestone } from '../hooks/useMilestoneAcks';
import { useConfirmHandoff } from '../hooks/useConfirmHandoff';
import MilestoneCard from '../components/MyTasks/MilestoneCard';
// ★★★ fix-445 (ruling 4 / P-047): the Co-assigned switch and the mark that
// makes 'mine' and 'shared' distinguishable rather than blended.
import { useShowCoAssigned } from '../hooks/useShowCoAssigned';
import CoAssignedToggle from '../components/shared/CoAssignedToggle';
import {
  CoAssignedContext,
  NO_CO_ASSIGNED,
  useIsCoAssigned,
} from '../lib/coAssignedContext';
import ScopeToggle from '../components/shared/ScopeToggle';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  type MyTaskNode,
  type TeamMember,
} from '../lib/database.types';

// fix-80: My Tasks v1-layout rewrite. fix-78 reverted to "all tasks + filter
// chips"; this brief restores Bobby's v1 mental model — a three-pane kanban
// (D&E | Permitting | Task Detail) with Not Started / In Progress sub-columns
// per bucket, top counters, and a v1 filter row (search + ENT/DA/DM/Consultant
// dropdowns + Active only + By Due Date sort + Reset).
//
// fix-79 adds the lifecycle `bucket` column (de/pm) to permit_tasks; until
// that lands, MyTaskNode may not carry bucket on the wire. We read it
// defensively with a 'de' default so the page degrades cleanly on either
// base, and starts grouping correctly the moment fix-79's RPC ships the field.

/** Tasks we render. Adds a `bucket` field that may be absent on the pre-fix-79
 *  wire shape; missing values fall through to 'de'. */
type Task = MyTaskNode & {
  bucket?: 'de' | 'pm';
  /** ★ fix-409: the OPEN hold that explains why this task is parked, attached
   *  once in `MineTasks` so every card, column and counter below reads the same
   *  answer. Null on live work. Follows `bucket`'s precedent — a render-time
   *  field on the node, not a column. */
  hold?: HoldChipRow | null;
};

type DiagBucket = 'de' | 'pm';

interface RoleFilterState {
  ent: string[];
  da: string[];
  dm: string[];
  consultant: string[];
}

type RoleQuick = 'all' | 'ent' | 'da' | 'dm' | 'consultant';

interface FilterState {
  search: string;
  roles: RoleFilterState;
  /** Quick role-family chip ("All" / ENT / DA / DM / Consultant). */
  quickRole: RoleQuick;
  /** Multi-select on parent permit_type (the "All stages" v1 dropdown). */
  permitTypes: string[];
  /** When true (default) Resolved tasks are hidden from sub-columns. */
  activeOnly: boolean;
  /** ★★★ fix-444 §A3 — `byDueDate` IS GONE, AND IT WAS NOT A PREFERENCE.
   *
   *  It chose between "target_date asc, NULLS LAST" and "sort_order, then
   *  start_date desc" — but NOTHING IN THE APP LETS A PERSON ARRANGE TASKS.
   *  Checked, not assumed: no `onDragEnd`, no `draggable`, no `useSortable`
   *  anywhere near a permit task (the three DnD surfaces are the Draw Schedule
   *  grid, the Quarter Layout editor and the task TEMPLATE editor), and
   *  PermitDetailV2 only ever echoes a task's existing `sort_order` back on an
   *  edit. On prod, 1,557 of 1,643 tasks sit at `sort_order = 0`; the 86
   *  non-zero ones across 17 values are seeded by task templates.
   *
   *  So "off" was not manual order — it was a second, worse date order. The
   *  bands are the ordering now, and `sort_order` survives as the final
   *  tiebreak, which is what keeps a template's steps in their intended
   *  sequence. The key is left in the persisted shape (see loadFilters) so a
   *  stored `true`/`false` is simply ignored rather than breaking the parse. */
  /** fix-155: when true, show only lifecycle auto-tasks (is_auto_generated). */
  botOnly: boolean;
  /** fix-224 (Jade): when true, group the task list by PROJECT (one section per
   *  project address) instead of the D&E / Permitting kanban columns. */
  groupByProject: boolean;
}

const FILTER_STORAGE_KEY = 'mytasks.filters.v2';

const DEFAULT_FILTERS: FilterState = {
  search: '',
  roles: { ent: [], da: [], dm: [], consultant: [] },
  quickRole: 'all',
  permitTypes: [],
  activeOnly: true,
  botOnly: false,
  groupByProject: false,
};

const BUCKET_LABEL: Record<DiagBucket, string> = {
  de: 'D&E Tasks',
  pm: 'Permitting Tasks',
};
const BUCKET_ACCENT: Record<DiagBucket, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
};
const STATUS_BG: Record<Task['status'], string> = {
  Open: 'var(--color-s2)',
  'In Progress': 'var(--color-de)',
  Resolved: 'var(--color-pm)',
  // fix-262: parked by a project cancel — muted, never a live-work colour.
  Cancelled: 'var(--color-s2)',
};

function loadFilters(): FilterState {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterState> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_FILTERS;
    const roles = (parsed.roles ?? {}) as Partial<RoleFilterState>;
    return {
      ...DEFAULT_FILTERS,
      ...parsed,
      roles: {
        ent: Array.isArray(roles.ent)
          ? roles.ent.filter((s): s is string => typeof s === 'string')
          : [],
        da: Array.isArray(roles.da)
          ? roles.da.filter((s): s is string => typeof s === 'string')
          : [],
        dm: Array.isArray(roles.dm)
          ? roles.dm.filter((s): s is string => typeof s === 'string')
          : [],
        consultant: Array.isArray(roles.consultant)
          ? roles.consultant.filter((s): s is string => typeof s === 'string')
          : [],
      },
      permitTypes: Array.isArray(parsed.permitTypes)
        ? parsed.permitTypes.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** ★★ fix-446: a milestone as My Tasks renders it — the forecast's own item,
 *  plus the one thing the forecast cannot know: whether it reached THIS viewer
 *  directly or through the DM derivation (see lib/milestoneOwnership). */
interface MilestoneRow {
  item: ForecastItem;
  coAssigned: boolean;
}

/** ★★ fix-446: what a banded column holds now — a task, or a milestone.
 *
 *  ★★★ A DISCRIMINATED UNION rather than two parallel lists, because ruling 4
 *  puts both kinds in ONE band in ONE date order: *"Band: by the milestone's
 *  date through fix-444's taskBands — same headers, same order."* Two lists
 *  rendered one after the other would put every milestone below every task in
 *  the same band, which is a different (and wrong) order.
 *
 *  ★ It satisfies `BandableRow` structurally, so `bandRows` and
 *  `compareInBand` work on it unchanged — fix-444 typed them that way on
 *  purpose ("a task node and (later) a milestone item both satisfy it without
 *  either importing the other"). `priority` and `sort_order` are simply absent
 *  on a milestone, so it sorts by date alone, which is ruling 4's rule. */
type ColumnRow =
  | {
      kind: 'task';
      id: string;
      task: Task;
      target_date: string | null;
      priority?: boolean | null;
      sort_order?: number | null;
    }
  | {
      kind: 'milestone';
      id: string;
      milestone: MilestoneRow;
      target_date: string | null;
    };

/** ★★★ fix-446 RULING 2 — THE LANE IS THE LEG, AND THAT SUBSUMES THE LIST.
 *
 *  Bobby: *"design milestones → D&E; city milestones → Permitting … per
 *  MILESTONE_LEGS."*
 *
 *  ★★ The ruling's enumeration files `target_submit` under Permitting, but
 *  MILESTONE_LEGS — which the ruling names as the source of truth — makes it
 *  TWO-LEG, exactly like `corrections`: both raise a row on each leg with a
 *  different verb ("Finish the set" for design, "Submit" for the lead).
 *  Confirmed by Bobby, 2026-08-29: *"target_submit: two-leg like corrections —
 *  apply the leg rule as written."*
 *
 *  ★ So there is no per-kind table here. `buildForecast` emits ONE ITEM PER
 *  LEG (`key: m-<permit>-<kind>-<leg>`), and the leg it was emitted for is the
 *  lane. draw → design only; intake/reviewer_silent/fees/issuance → ent only;
 *  target_submit and corrections → whichever leg this row is. */
function milestoneLane(m: MilestoneRow): DiagBucket {
  return m.item.leg === 'design' ? 'de' : 'pm';
}

/** ★★★ fix-446 RULING 3 — WHICH FILTERS READ A MILESTONE, AND WHICH DO NOT.
 *
 *  Bobby: *"search, the ENT/DA/DM/Consultant people filters and My
 *  Work/Everyone still apply to a milestone (it belongs to a permit with
 *  people). Stage (permit type), BOT, Show held work and Co-assigned do not
 *  read milestone rows and LEAVE THEM VISIBLE. Active only: a milestone is
 *  always 'active' until acked."*
 *
 *  ★★ THE AMENDMENT MOVED ONE OF THEM. Co-assigned now DOES apply — but not
 *  here: it is applied where the reach is known, in the page, because only
 *  there is it known whether a row arrived through the DM derivation.
 *
 *  ★★★ "LEAVES THEM VISIBLE" IS THE HARD PART TO GET RIGHT. The instinct is to
 *  make an unmatched filter hide everything it cannot judge; that would mean
 *  switching on 🤖 BOT silently emptied the milestone rows, and the reader
 *  would read the absence as "no milestones", which is fix-370's mistake. A
 *  filter that cannot ask the question does not get to answer it. */
// ★ NOT exported: `react-refresh/only-export-components` is an ERROR in this
//   repo and a component file that also exports a function trips it — the same
//   rule lib/taskStatusOverlay documents. Covered through the rendered tests,
//   which is the honest level for it anyway: what matters is that switching on
//   🤖 BOT leaves the milestone rows alone on screen.
function filterMilestones(
  rows: MilestoneRow[],
  filters: FilterState,
  rolesByName: Map<string, Set<Exclude<RoleQuick, 'all'>>>,
): MilestoneRow[] {
  const q = filters.search.trim().toLowerCase();
  const roleNames = [
    ...filters.roles.ent,
    ...filters.roles.da,
    ...filters.roles.dm,
    ...filters.roles.consultant,
  ];
  return rows.filter((m) => {
    if (q !== '') {
      const hay = `${m.item.verb} ${m.item.where} ${m.item.why} ${m.item.permitLabel ?? ''}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    // ★ The people filters read the permit's OWN roles — a milestone has no
    //   assignee, but the permit it belongs to has a DA and an ENT lead, and
    //   those are the people the dropdowns name.
    if (roleNames.length > 0) {
      const people = milestonePeople(m);
      if (!roleNames.some((n) => people.has(n.trim().toLowerCase()))) {
        return false;
      }
    }
    if (filters.quickRole !== 'all') {
      const people = milestonePeople(m);
      let any = false;
      for (const person of people) {
        const roles = rolesByName.get(person);
        if (roles && roles.has(filters.quickRole)) any = true;
      }
      if (!any) return false;
    }
    return true;
  });
}

/** The permit's people, lowercased — the DA and the ENT lead, which is exactly
 *  the set `milestoneReach` decides ownership from. */
function milestonePeople(m: MilestoneRow): Set<string> {
  const out = new Set<string>();
  const da = (m.item.permitDa ?? '').trim().toLowerCase();
  const ent = (m.item.entLead ?? '').trim().toLowerCase();
  if (da) out.add(da);
  if (ent) out.add(ent);
  return out;
}

function bucketOf(t: Task): DiagBucket {
  return t.bucket === 'pm' ? 'pm' : 'de';
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isOverdue(t: Task, today: string): boolean {
  // ★ fix-326 moved the rule itself into lib/taskStatus so the collapsed My
  // Tasks bar on /board can ask the same question without mounting this panel.
  // This stays as the local name the file already reads well with.
  return isTaskOverdue(t, today);
}

// fix-140: the page is now a thin shell around a URL-backed view switcher.
// `?view=waiting-on` renders the Waiting On reporting view; anything else
// (default) renders the existing My Tasks board. The switcher chrome stays
// mounted across both; only the content area below it swaps.
export default function MyTasks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view: 'mine' | 'waiting-on' =
    searchParams.get('view') === 'waiting-on' ? 'waiting-on' : 'mine';

  function setView(next: 'mine' | 'waiting-on') {
    const params = new URLSearchParams(searchParams);
    if (next === 'mine') params.delete('view');
    else params.set('view', 'waiting-on');
    setSearchParams(params);
  }

  return (
    <div data-testid="mytasks-shell">
      <div className="px-3 pt-3">
        <ViewSwitcher view={view} onChange={setView} />
      </div>
      {view === 'waiting-on' ? <WaitingOnView /> : <MineTasks />}
    </div>
  );
}

/** fix-140: segmented control mirroring the FilterRow "All roles" chip group
 *  (chipStyle), URL-backed via the parent. */
function ViewSwitcher({
  view,
  onChange,
}: {
  view: 'mine' | 'waiting-on';
  onChange: (v: 'mine' | 'waiting-on') => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1"
      data-testid="my-tasks-view-switcher"
    >
      <button
        type="button"
        onClick={() => onChange('mine')}
        className="text-[11px] px-3 py-1 rounded border font-bold"
        style={chipStyle(view === 'mine', 'bg')}
        data-testid="my-tasks-view-mine"
        aria-pressed={view === 'mine'}
      >
        My Tasks
      </button>
      <button
        type="button"
        onClick={() => onChange('waiting-on')}
        className="text-[11px] px-3 py-1 rounded border font-bold"
        style={chipStyle(view === 'waiting-on', 'bg')}
        data-testid="my-tasks-view-waiting-on"
        aria-pressed={view === 'waiting-on'}
      >
        Waiting On
      </button>
    </div>
  );
}

/** ★ fix-318: exported so PersonalBoard can mount the grouped task list in
 *  /board's lower half. This is THE ONE STRUCTURAL CHANGE the merge needed, and
 *  it is an export keyword — no grouping, filter or behaviour was touched.
 *
 *  ★ Why MineTasks and not the MyTasks shell above it: that shell's only extra
 *  is the Mine / Waiting On view switcher, and fix-315 gave Waiting On its own
 *  route AND its own ribbon entry under Entitlements. Mounting the shell would
 *  give Waiting On a second home inside the board and re-create the duplication
 *  fix-317 has just finished removing from the Reports group. */
export function MineTasks() {
  // ★★★ fix-434: the optimistic layer wraps the WHOLE board, not the card.
  //
  // A row that has been ticked has to leave the "Not Started" column, drop out
  // of the OPEN counter and vanish under "Active only" — all of which are
  // derived from the one array `MineTasks` builds. An overlay applied inside
  // TaskCard would have moved the chip and left every number beside it saying
  // something else, which is fix-409's rule ("counts must agree with what is
  // displayed") broken in a new place.
  return (
    <TaskStatusOverlayProvider>
      <MineTasksBody />
    </TaskStatusOverlayProvider>
  );
}

function MineTasksBody() {
  const team = useTeamMembers();
  const tasksQ = useAllTasks();
  // fix-264: tasks on a CANCELLED project leave the board entirely. fix-262's
  // server-side sweep already flipped that project's Open / In Progress tasks to
  // 'Cancelled' (and the columns hide those), but it deliberately left RESOLVED
  // tasks alone — so a cancelled project could still surface a card under "show
  // resolved" and still count toward the "N projects" counter, which reads the
  // pre-column filtered set. Filtering at the PROJECT level here closes both,
  // and keeps this board on the same predicate as every other live-work surface
  // instead of inferring project state from task status.
  const holdsQ = useAllProjectHolds();
  // ★★ fix-409: the permit-scoped sibling. My Board has fetched this since
  // fix-390; My Tasks never did, which is precisely why its list disagreed with
  // the board's about what was paused. Holds are a handful per tenant and the
  // query is shared by key, so this costs nothing beyond the first fetch.
  const permitHoldsQ = useAllPermitHolds();
  const { showHeldWork } = useShowHeldWork();
  const cancelledIds = useMemo(
    () => cancelledProjectIds(holdsQ.data),
    [holdsQ.data],
  );
  // ★★★ fix-409 — THE FILTER LIVES HERE, ABOVE `Body`, AND THAT IS THE POINT.
  //
  // The brief's hard requirement is *"counts in headers, badges, and any 'N
  // open' summaries must agree with what is displayed"*. Every counter on this
  // screen is derived from the task array `Body` receives, so filtering the
  // array — rather than each list at render time — makes agreement structural.
  // A per-column filter would have left the OPEN / OVERDUE / PROJECTS counters
  // counting rows nobody can see, which is the fix-264 defect in a new coat.
  const liveTasks = useMemo(() => {
    const notCancelled = excludeCancelled(
      (tasksQ.data ?? []) as Task[],
      cancelledIds,
    );
    const sets = heldSetsFrom(holdsQ.data, permitHoldsQ.data);
    const chips = holdRowIndex(holdsQ.data, permitHoldsQ.data);
    const shown = excludeHeldWork(notCancelled, sets, showHeldWork);
    // ★ Only the SHOWN rows are decorated, and only when held work is on —
    //   with the switch off there is nothing held left to label, so the map is
    //   a no-op and the array passes through untouched.
    if (!showHeldWork) return shown as Task[];
    return shown.map((t) => ({ ...t, hold: holdRowFor(t, chips) }));
  }, [tasksQ.data, cancelledIds, holdsQ.data, permitHoldsQ.data, showHeldWork]);

  // ★★★ fix-434 — THE LAST STEP BEFORE ANYTHING IS COUNTED OR GROUPED.
  //
  // Applied after the cancel/hold filters so it cannot resurrect a row those
  // removed, and before `Body` so every column, sub-column and counter below
  // reads the same status the chip is showing. `applyStatusOverlay` returns the
  // SAME array when nothing is pending, which is the normal case, so the memo
  // chain underneath is untouched for everybody who is not mid-click.
  const overlay = useTaskStatusOverlay();
  // ★ THE ONLY SUBSCRIBER TO THE PENDING SNAPSHOT. The ACTIONS context never
  //   changes identity (see the two-context note in taskStatusOverlayContext),
  //   so this is the one component a click re-renders — and from here the new
  //   array flows down to the columns and the counters.
  const pendingStatuses = useTaskStatusPending();
  const shownTasks = useMemo(
    () => applyStatusOverlay(liveTasks, pendingStatuses),
    [liveTasks, pendingStatuses],
  );

  // ★★ Drop an intent the moment the refetched row agrees with it — see
  //    TaskStatusOverlay.reconcile for why agreement and not mutation success
  //    is the right moment. In an effect: mutating during render is what the
  //    React Compiler rejects and only lint catches (fix-426, fix-408).
  const reconcile = overlay.reconcile;
  useEffect(() => {
    reconcile((tasksQ.data ?? []) as Task[]);
  }, [tasksQ.data, reconcile]);

  const error = team.error ?? tasksQ.error;
  if (error) {
    return (
      <QueryError
        title="My Tasks failed to load"
        error={error}
        onRetry={() => {
          team.refetch();
          tasksQ.refetch();
        }}
      />
    );
  }
  if (team.isLoading || tasksQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-12" />;
  }

  return (
    <Body
      tasks={shownTasks}
      members={team.all}
    />
  );
}

function Body({
  tasks,
  members,
}: {
  tasks: Task[];
  members: TeamMember[];
}) {
  const [filters, setFilters] = useState<FilterState>(() => loadFilters());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ★★★ fix-362 §2 — A TASK NOTIFICATION OPENS THE TASK.
  //
  // Bobby: "and same thing, if in the task, does it take me automatically…
  // anytime you get a notification, you can click it and go to where that item
  // is occurring." Before this, a task notification could only take you to the
  // permit that holds it — a bar of tasks to read through, which is the work
  // the notification was supposed to save.
  //
  // ★★ `?task=<uuid>` and nowhere else. §2's rule: the destination has to work
  // from a cold browser load, so the selection lives in the URL rather than in
  // a store or a router state object.
  //
  // ★ Applied ONCE per id (the fix-217 in-render pattern), so clicking a
  // different card afterwards is not fought by the parameter.
  const [taskParams] = useSearchParams();
  const deepLinkTaskId = taskParams.get(PARAM_TASK);
  const [appliedTaskParam, setAppliedTaskParam] = useState<string | null>(null);
  if (deepLinkTaskId && deepLinkTaskId !== appliedTaskParam) {
    setAppliedTaskParam(deepLinkTaskId);
    setSelectedId(deepLinkTaskId);
  }
  // fix-176: default the My tab to the logged-in user's own tasks (assignee or
  // co-assignee), switchable to Everyone + remembered per-user. Role-agnostic
  // here — "mine" on the My tab is "tasks assigned to me" for ent/dm/da alike.
  const { mode: scopeMode, setMode: setScopeMode, identity } =
    useScopeMode('mytasks');
  // fix-238: ownership resolver — resolves each task's assigned_to role
  // placeholder (Design Manager / Schematic Team / …) to a person the same way
  // the task chip does, so "Mine" routes a role-assigned task to the right list.
  const { matches: taskMatches, isCoAssigned: taskIsCoAssigned } =
    useTaskOwnership();
  const { showCoAssigned } = useShowCoAssigned();
  const navigate = useNavigate();
  const originState = useOriginState();

  // fix-380: struct_address per permit, for the search haystack. The task rows
  // are the bp_list_tasks projection (project_address only); the permit's own
  // structure address lives in the app-wide permits cache, keyed by the
  // task's permit_id — Bobby: "Maybe I don't know the project by the project
  // address, but I know it by the structure address."
  const permitsQ = usePermits();
  const structByPermitId = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of permitsQ.data ?? []) {
      const s = (p.struct_address ?? '').trim();
      if (s !== '') m.set(p.id, s);
    }
    return m;
  }, [permitsQ.data]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify(filters),
      );
    } catch {
      // localStorage unavailable — silently skip.
    }
  }, [filters]);

  function patch(p: Partial<FilterState>) {
    setFilters((f) => ({ ...f, ...p }));
  }
  function resetAll() {
    setFilters(DEFAULT_FILTERS);
  }

  // Members grouped by role family — feeds the per-role dropdowns + the
  // role-family filter math. Bobby is in as both 'ent' and 'ent_lead' in some
  // tenants; dedup by name within each family. CONSULTANT bucket is derived:
  // any name that appears as a co_assignee on at least one task and is NOT in
  // the rostered ent/da/dm sets (fix-80 has no 'consultant' role in
  // TeamRole — that's the cleanest mapping until the schema gets one).
  const rosterByRole = useMemo(() => {
    const ent = uniqueNamesByRole(members, (r) => r === 'ent' || r === 'ent_lead');
    const da = uniqueNamesByRole(members, (r) => r === 'da');
    const dm = uniqueNamesByRole(members, (r) => r === 'dm');
    const rostered = new Set<string>([...ent, ...da, ...dm]);
    const coNames = new Set<string>();
    for (const t of tasks) {
      for (const a of t.co_assignees) {
        if (!rostered.has(a)) coNames.add(a);
      }
    }
    const consultant = [...coNames].sort((a, b) => a.localeCompare(b));
    return { ent, da, dm, consultant };
  }, [members, tasks]);

  // The pool of names each role family can match against (rostered union
  // co-assignee names, depending on the family).
  const rolesByName = useMemo(() => {
    const map = new Map<string, Set<'ent' | 'da' | 'dm' | 'consultant'>>();
    function add(name: string, role: 'ent' | 'da' | 'dm' | 'consultant') {
      const set = map.get(name) ?? new Set();
      set.add(role);
      map.set(name, set);
    }
    for (const m of members) {
      if (m.role === 'ent' || m.role === 'ent_lead') add(m.name, 'ent');
      else if (m.role === 'da') add(m.name, 'da');
      else if (m.role === 'dm') add(m.name, 'dm');
    }
    for (const n of rosterByRole.consultant) add(n, 'consultant');
    return map;
  }, [members, rosterByRole.consultant]);

  // All filter math runs over the FULL task set; the result drives the
  // counters AND the column rendering below. Counters that need "total"
  // semantics use the full filtered set; the column rendering further
  // narrows by status (Active only).
  // fix-176: narrow to the user's own tasks first when "My work" is active,
  // then apply the manual filters. Roster/permit-type option lists upstream
  // still read the FULL task set so the dropdowns don't collapse.
  const scopedTasks = useMemo(() => {
    const name = identity.name;
    if (scopeMode !== 'mine' || !name) return tasks;
    // ★★★ fix-445 §A2/§A4 — THE SWITCH APPLIES HERE, AND NOWHERE ELSE.
    //
    // This is the one place "mine" is decided, so narrowing it is all the
    // ticket needs: the counters, the bands, the by-project view and the
    // Waiting-On tab all read downstream of `scopedTasks`, which is why §A4
    // ("counters follow the toggle") needs no separate code. A second filter
    // further down would be a second definition of the same word.
    //
    // ★★ The switch is MEANINGLESS UNDER "EVERYONE" — that list is not
    // defined by ownership at all — so it is only consulted in `mine`, which
    // this early return already guarantees.
    if (showCoAssigned) return tasks.filter((t) => taskMatches(t, name));
    return tasks.filter((t) => taskMatches(t, name) && !taskIsCoAssigned(t, name));
  }, [
    tasks,
    scopeMode,
    identity.name,
    taskMatches,
    taskIsCoAssigned,
    showCoAssigned,
  ]);

  // ★★★ fix-445 §A3 — is THIS row shared rather than mine?
  //
  // A PREDICATE, not a precomputed set — see lib/coAssignedContext for the
  // fix-434 pin that forced it. Its identity depends only on the resolver, the
  // scope and the viewer's name, none of which move when a task's status does,
  // so ticking a checkbox does not re-render the board.
  //
  // ★★ Under "Everyone" it answers no to everything: a mark reading
  // "co-assigned to you" would be a lie on somebody else's task.
  // ★★★ TWO STEPS, AND THE SECOND ONE IS THE POINT. The key recomputes freely;
  //     the Set — the thing 50 memoised cards subscribe to — is derived from
  //     the key alone, so its identity moves only when the ANSWER moves. See
  //     lib/coAssignedContext for the two versions of this that failed
  //     fix-434 §B1.
  //
  // ★★ Under "Everyone" it is empty: a mark reading "co-assigned to you" would
  //    be a lie on somebody else's task.
  const coAssignedKey = useMemo(() => {
    const name = identity.name;
    if (scopeMode !== 'mine' || !name) return '';
    const ids: string[] = [];
    for (const t of scopedTasks) {
      if (taskIsCoAssigned(t, name)) ids.push(t.id);
    }
    return ids.sort().join('|');
  }, [scopedTasks, scopeMode, identity.name, taskIsCoAssigned]);
  const coAssignedIds = useMemo(
    () => (coAssignedKey === '' ? NO_CO_ASSIGNED : new Set(coAssignedKey.split('|'))),
    [coAssignedKey],
  );
  const filtered = useMemo(
    () => filterTasks(scopedTasks, filters, rolesByName, taskMatches, structByPermitId),
    [scopedTasks, filters, rolesByName, taskMatches, structByPermitId],
  );
  const today = useMemo(() => todayIso(), []);

  // =======================================================================
  // ★★★ fix-446 (P-096) — MILESTONES, THE OTHER HALF OF "MY TASKS IS
  //     EVERYTHING"
  // =======================================================================
  //
  // Bobby, 2026-08-29: *"My Tasks = the COMPLETE list of everything you own"*,
  // and milestones were the half fix-444 deferred.
  //
  // ★★★ NO NEW REQUEST. `useBoardInput` is the assembly BoardBell already
  // mounts in `Chrome.tsx` on every page; React Query dedupes it by key. That
  // is the whole reason this ships without widening `bp_list_tasks`, which
  // returns the entire tenant (~1.1 MB) on every refetch.
  const { input: boardInput } = useBoardInput();
  const dmRows = useDmDaGroups().data;

  // ★★ THE WIDENING, AND ITS ONE MEMBER. Bobby: *"a design-leg milestone
  //    reaches the DA and the DM (DM derived from the DA via dm_da_groups,
  //    exactly as tasks do). NOT the schematic designer."* Everything about
  //    who-gets-what lives in lib/milestoneOwnership, including the prod
  //    numbers that made the widening necessary.
  const dmForDa = useCallback(
    (da: string) => findDmForDa(da, dmRows ?? []),
    [dmRows],
  );
  const reachCtx = useMemo(
    () => ({
      name: identity.name,
      dmForDa,
      everyone: scopeMode !== 'mine',
    }),
    [identity.name, dmForDa, scopeMode],
  );
  const milestoneForecast = useMemo(
    () => buildForecast({ ...boardInput, legsFor: makeLegsFor(reachCtx) }),
    [boardInput, reachCtx],
  );

  // ★★ EVERY BUCKET, UNCAPPED, PLUS THE HANDED-OFF ROWS. `.all` rather than
  //    `.items` because the caps are the BOARD's reading aid for a short
  //    snapshot; this list is meant to be complete. `later` is the section
  //    fix-446 had to start returning at all — see lib/myBoard.
  const milestoneRows = useMemo<MilestoneRow[]>(() => {
    const f = milestoneForecast;
    const all = [
      ...f.past_due.all,
      ...f.today.all,
      ...f.tomorrow.all,
      ...f.this_week.all,
      ...f.next_week.all,
      ...f.later.all,
      // ★ Outgoing relay rows: design finished and the lead now holds it. They
      //   are un-acked and still real, so they belong on the complete list —
      //   non-actionable, which renders them greyed with no checkbox.
      ...f.handed_off,
    ];
    const out: MilestoneRow[] = [];
    for (const item of all) {
      if (item.source !== 'milestone') continue;
      // ★ The permit's people ride ON THE ITEM (fix-446 added `permitDa`
      //   beside `entLead`), so ownership is resolved from the same row the
      //   forecast built — never from a second lookup that could disagree.
      const reach: MilestoneReach = milestoneReach(
        { da: item.permitDa, ent_lead: item.entLead },
        item.leg ?? 'entitlement',
        reachCtx,
      );
      if (reach === 'none') continue;
      // ★★★ THE AMENDMENT TO RULING 3. Bobby: *"A milestone that reaches the
      //     viewer only through the DM derivation is 'co-assigned' — hidden
      //     when the toggle is OFF."* One switch, both kinds of shared work:
      //     a DM's DA's tasks AND that DA's milestones.
      if (reach === 'co' && !showCoAssigned && scopeMode === 'mine') continue;
      out.push({ item, coAssigned: reach === 'co' && scopeMode === 'mine' });
    }
    return out;
  }, [milestoneForecast, reachCtx, showCoAssigned, scopeMode]);

  // ★★ RULING 3, AND WHAT IT DELIBERATELY LEAVES ALONE. Search and the people
  //    filters apply — a milestone belongs to a permit with people on it.
  //    Stage (permit type), BOT and Show held work do NOT read milestone rows
  //    and leave them visible; "Active only" is always true of a milestone,
  //    because an acked one has already left the forecast.
  const visibleMilestones = useMemo(
    () => filterMilestones(milestoneRows, filters, rolesByName),
    [milestoneRows, filters, rolesByName],
  );
  const counters = useMemo(() => {
    let open = 0;
    let overdue = 0;
    let resolved = 0;
    let cancelled = 0;
    const projects = new Set<string>();
    for (const t of filtered) {
      projects.add(t.project_id);
      // fix-262: a cancelled task counts as neither open nor resolved — it is
      // excluded from the done-% denominator below too, so the percentage keeps
      // meaning "of the work still on the books, how much is finished".
      if (isTaskCancelled(t.status)) {
        cancelled += 1;
      } else if (t.status === 'Resolved') {
        resolved += 1;
      } else {
        open += 1;
        if (isOverdue(t, today)) overdue += 1;
      }
    }
    // ★★ fix-446 §A3: milestone rows are OPEN work and count as such — an
    //    acked one has already left the forecast, so every row here is
    //    outstanding. Their projects count towards PROJECTS too.
    for (const m of visibleMilestones) {
      open += 1;
      if (m.item.daysLate > 0) overdue += 1;
      if (m.item.projectId) projects.add(m.item.projectId);
    }
    const total = filtered.length - cancelled + visibleMilestones.length;
    const pct = total === 0 ? 0 : Math.round((resolved / total) * 100);
    return {
      open,
      overdue,
      projects: projects.size,
      resolved,
      cancelled,
      total,
      pct,
    };
  }, [filtered, today, visibleMilestones]);

  // ★★★ fix-446 §A2 — TICKING A MILESTONE DOES EXACTLY WHAT THE BOARD DOES.
  //
  // Not "something equivalent": the same two hooks, the same arguments, in the
  // same order My Board's `onTick` chooses them (MyBoard.tsx ~1154). A
  // milestone row never carries a task, so 'resolve-task' cannot arise here —
  // task rows are their own cards on this page and always were.
  const ackMilestone = useAckMilestone();
  const handoff = useConfirmHandoff();
  const milestoneBusy = ackMilestone.isPending || handoff.isPending;

  const onMilestoneTick = useCallback(
    (item: ForecastItem) => {
      if (!item.actionable || item.permitId == null) return;
      if (item.action === 'handoff') {
        void handoff.confirm({
          permitId: item.permitId,
          cycleIndex: item.cycleIndex,
          entLead: item.entLead,
          byName: identity.name,
        });
        return;
      }
      ackMilestone.mutate({
        permitId: item.permitId,
        milestone: item.milestoneKind ?? 'unknown',
        anchor: item.anchor,
        ackedByName: identity.name,
      });
    },
    [ackMilestone, handoff, identity.name],
  );

  // ★ The same destination the Board's row goes to — the permit, on its
  //   project page. A milestone has no detail pane of its own here; Project
  //   Overview is where it lives and keeps living after it is acked.
  const onMilestoneOpen = useCallback(
    (item: ForecastItem) => {
      if (!item.projectId) return;
      navigate(
        item.permitId != null
          ? `/project/${item.projectId}?permit=${item.permitId}`
          : `/project/${item.projectId}`,
        { state: originState() },
      );
    },
    [navigate, originState],
  );

  // The visible-in-columns set excludes Resolved when activeOnly is ON. The
  // counters above already used the unrestricted filtered set so the done %
  // stays meaningful even when Resolved cards are hidden.
  const visible = useMemo(
    () =>
      // fix-262: cancelled tasks are hidden from the working columns in BOTH
      // modes. "Show resolved" reveals finished work, not abandoned work; a
      // cancelled task returns when the project is brought back.
      filters.activeOnly
        ? filtered.filter((t) => isTaskLive(t.status))
        : filtered.filter((t) => !isTaskCancelled(t.status)),
    [filtered, filters.activeOnly],
  );

  const permitTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.permit_type) set.add(t.permit_type);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  // ★★★ fix-362 §3 — A CLOSED TASK IS STILL REACHABLE, and a filter is not a
  // deletion.
  //
  // `filtered` is the board's own view: the scope toggle, "active only", the
  // role and permit-type chips. A deep-linked task can fail every one of them
  // and still be exactly the task the notification was about — fix-355 closed
  // 56 of them, and the brief is explicit that closed is not gone. So the
  // deep-linked id resolves against ALL of this board's tasks, and only the
  // ordinary click path is bound to the filtered list.
  const selected = useMemo(() => {
    if (!selectedId) return null;
    const inView = filtered.find((t) => t.id === selectedId);
    if (inView) return inView;
    if (selectedId === deepLinkTaskId) {
      return tasks.find((t) => t.id === selectedId) ?? null;
    }
    return null;
  }, [filtered, tasks, selectedId, deepLinkTaskId]);

  // ★★ …and when it is not in `tasks` either, it is genuinely gone — deleted,
  // or on a project fix-264 has cancelled off every live-work surface. That is
  // a NORMAL path (§3): the board still renders, the pane says so, and nothing
  // throws, 404s or spins.
  const deepLinkMissing =
    !!deepLinkTaskId &&
    selectedId === deepLinkTaskId &&
    !tasks.some((t) => t.id === deepLinkTaskId);

  return (
    // ★★★ fix-445 §A3: which rows are shared rather than mine, published once
    //     for the cards four levels down. See lib/coAssignedContext.
    <CoAssignedContext.Provider value={coAssignedIds}>
    <div className="space-y-3 p-3" data-testid="mytasks-page">
      <Counters c={counters} />
      <FilterRow
        filters={filters}
        roster={rosterByRole}
        permitTypeOptions={permitTypeOptions}
        onPatch={patch}
        onReset={resetAll}
        scopeMode={scopeMode}
        onScopeChange={setScopeMode}
        selfName={identity.name}
      />
      {/* fix-138-b: shrink right sidebar from 1fr (20%) → 0.85fr (≈17%)
          so the two bucket columns claim more horizontal real estate;
          v1 register. min-w-0 on each track prevents long task text
          from pushing IN PROGRESS narrower than NOT STARTED at the
          inner-grid level. */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns:
            'minmax(0,2fr) minmax(0,2fr) minmax(0,0.85fr)',
        }}
        data-testid="mytasks-kanban"
      >
        {filters.groupByProject ? (
          <ProjectGroupedView
            className="col-span-2"
            tasks={visible}
            milestones={visibleMilestones}
            today={today}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMilestoneTick={onMilestoneTick}
            onMilestoneOpen={onMilestoneOpen}
            milestoneBusy={milestoneBusy}
          />
        ) : (
          <>
            <BucketColumn
              bucket="de"
              tasks={visible.filter((t) => bucketOf(t) === 'de')}
              milestones={visibleMilestones.filter(
                (m) => milestoneLane(m) === 'de',
              )}
              today={today}
                activeOnly={filters.activeOnly}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMilestoneTick={onMilestoneTick}
              onMilestoneOpen={onMilestoneOpen}
              milestoneBusy={milestoneBusy}
            />
            <BucketColumn
              bucket="pm"
              tasks={visible.filter((t) => bucketOf(t) === 'pm')}
              milestones={visibleMilestones.filter(
                (m) => milestoneLane(m) === 'pm',
              )}
              today={today}
                activeOnly={filters.activeOnly}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMilestoneTick={onMilestoneTick}
              onMilestoneOpen={onMilestoneOpen}
              milestoneBusy={milestoneBusy}
            />
          </>
        )}
        <TaskDetailPane
          task={selected}
          members={members}
          missing={deepLinkMissing}
          // ★ fix-362: the task is real, opened, and NOT in the columns beside
          // it — a resolved task under "active only", or somebody else's under
          // "mine". Saying so is the difference between a deep link and a
          // detail pane that appears to be showing a card that is not there.
          outsideView={
            !!selected &&
            selected.id === deepLinkTaskId &&
            // ★ Measured against `visible`, NOT `filtered`: the columns render
            // `visible`, and "active only" lives between the two. A resolved
            // task passes every chip and is still absent from the board, which
            // is exactly the case this note exists for.
            !visible.some((t) => t.id === selected.id)
          }
        />
      </div>
    </div>
    </CoAssignedContext.Provider>
  );
}

function uniqueNamesByRole(
  members: TeamMember[],
  match: (role: TeamMember['role']) => boolean,
): string[] {
  const set = new Set<string>();
  for (const m of members) {
    if (!match(m.role)) continue;
    // ★ fix-321 #79: the shared roster rule, same as Project View's copy.
    if (!isCurrentMember(m)) continue;
    set.add(m.name);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function Counters({
  c,
}: {
  c: {
    open: number;
    overdue: number;
    projects: number;
    resolved: number;
    total: number;
    pct: number;
  };
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-4 px-3 py-2 rounded border"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-s2)',
      }}
      data-testid="mytasks-counters"
    >
      <Counter label="OPEN" value={c.open} testid="mytasks-counter-open" />
      <Counter
        label="OVERDUE"
        value={c.overdue}
        valueColor={c.overdue > 0 ? 'var(--color-co)' : undefined}
        testid="mytasks-counter-overdue"
      />
      <Counter
        label="PROJECTS"
        value={c.projects}
        testid="mytasks-counter-projects"
      />
      <div
        className="flex-1 min-w-[160px] flex items-center gap-2"
        data-testid="mytasks-counter-done"
      >
        <span
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--color-muted)' }}
        >
          DONE
        </span>
        <div
          className="flex-1 h-2 rounded overflow-hidden"
          style={{ background: 'var(--color-bg)' }}
        >
          <div
            style={{
              width: `${c.pct}%`,
              height: '100%',
              background: 'var(--color-pm)',
              transition: 'width 0.2s',
            }}
            data-testid="mytasks-counter-done-bar"
          />
        </div>
        <span
          className="text-[11px] font-mono"
          data-testid="mytasks-counter-done-text"
        >
          {c.resolved}/{c.total} · {c.pct}%
        </span>
      </div>
    </div>
  );
}

function Counter({
  label,
  value,
  valueColor,
  testid,
}: {
  label: string;
  value: number;
  valueColor?: string;
  testid: string;
}) {
  return (
    <div className="flex items-baseline gap-2" data-testid={testid}>
      <span
        className="text-[10px] uppercase tracking-wide"
        style={{ color: 'var(--color-muted)' }}
      >
        {label}
      </span>
      <span
        className="text-lg font-bold font-mono"
        style={{ color: valueColor ?? 'var(--color-text)' }}
        data-testid={`${testid}-value`}
      >
        {value}
      </span>
    </div>
  );
}

function FilterRow({
  filters,
  roster,
  permitTypeOptions,
  onPatch,
  onReset,
  scopeMode,
  onScopeChange,
  selfName,
}: {
  filters: FilterState;
  roster: {
    ent: string[];
    da: string[];
    dm: string[];
    consultant: string[];
  };
  permitTypeOptions: string[];
  onPatch: (p: Partial<FilterState>) => void;
  onReset: () => void;
  scopeMode: ScopeMode;
  onScopeChange: (mode: ScopeMode) => void;
  selfName: string | null;
}) {
  // ★★★ fix-445 §B2 — HOW MANY PEOPLE FILTERS ARE HIDDEN BEHIND THE BUTTON.
  //
  // The four role dropdowns move inside a panel, so without this the row could
  // be filtering hard and look untouched. A hidden filter must never be a
  // silent one — the badge is the whole reason collapsing them is safe.
  const peopleCount =
    filters.roles.ent.length +
    filters.roles.da.length +
    filters.roles.dm.length +
    filters.roles.consultant.length;

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded border"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="mytasks-filterrow"
    >
      {/* =====================================================================
          ★★★ fix-445 §B — THREE CLUSTERS, NOT A STRIP OF SEVENTEEN
          =====================================================================

          Bobby, 2026-08-29 (ruling 4): *"the ~18-control filter row grouped so
          it reads as a few things rather than a strip."* Counted on
          origin/main: 17 controls — scope, search, 4 role dropdowns, 5 quick-
          role chips, the stage select, Active only, By Project, BOT, Show held
          work, Clear — plus this ticket's Co-assigned makes 18.

          ★★ The grouping is WHO / WHAT, and the four role dropdowns are the
          only things that collapse. They are the widest controls on the row
          and the least often used; everything else is one click and stays one
          click. §B3's rule — no control removed, no test id changed — means
          this is a re-parenting, not a redesign.

          ★ The dividers are hairlines drawn with a border, not a component:
          §B1 says no new components, and a 1px rule does not need one.
          ================================================================= */}

      {/* ---- cluster 1: WHERE you are looking ---- */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="mytasks-filtergroup-scope"
      >
        <ScopeToggle
          mode={scopeMode}
          onChange={onScopeChange}
          name={selfName}
          testid="mytasks-scope"
        />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onPatch({ search: e.target.value })}
          placeholder="Search tasks, addresses, assignees…"
          className="text-[12px] px-2 py-1 border rounded outline-none"
          style={inputStyle()}
          data-testid="mytasks-filter-search"
        />
      </div>

      <FilterDivider />

      {/* ---- cluster 2: WHO ---- */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="mytasks-filtergroup-who"
      >
      <PeoplePanel
        roster={roster}
        filters={filters}
        onPatch={onPatch}
        count={peopleCount}
      />
      {/* Quick role-family chip. "All" clears nothing — it just keeps the per-
          family multi-selects authoritative; picking ENT/DA/etc. quickly
          limits to tasks with at least one assignee in that family. */}
      <div
        className="flex items-center gap-1"
        data-testid="mytasks-filter-allroles"
      >
        {(['all', 'ent', 'da', 'dm', 'consultant'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onPatch({ quickRole: r })}
            className="text-[11px] px-2 py-0.5 rounded border"
            style={chipStyle(filters.quickRole === r, 'bg')}
            data-testid={`mytasks-filter-allroles-${r}`}
          >
            {r === 'all'
              ? 'All roles'
              : r === 'consultant'
                ? 'Consultant'
                : r.toUpperCase()}
          </button>
        ))}
      </div>
      </div>

      <FilterDivider />

      {/* ---- cluster 3: WHAT ---- */}
      <div
        className="flex flex-wrap items-center gap-2 flex-1"
        data-testid="mytasks-filtergroup-what"
      >
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          if (filters.permitTypes.includes(v)) return;
          onPatch({ permitTypes: [...filters.permitTypes, v] });
          e.currentTarget.value = '';
        }}
        className="text-[12px] px-2 py-1 border rounded"
        style={inputStyle()}
        data-testid="mytasks-filter-stage"
      >
        <option value="">
          {filters.permitTypes.length === 0
            ? 'All stages'
            : 'Add stage filter…'}
        </option>
        {permitTypeOptions
          .filter((p) => !filters.permitTypes.includes(p))
          .map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
      </select>
      {filters.permitTypes.map((p) => (
        <span
          key={p}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
          style={chipBg()}
          data-testid={`mytasks-filter-stage-chip-${p}`}
        >
          {p}
          <button
            type="button"
            onClick={() =>
              onPatch({
                permitTypes: filters.permitTypes.filter((x) => x !== p),
              })
            }
            className="text-dim hover:text-text leading-none"
            title={`Remove ${p}`}
            data-testid={`mytasks-filter-stage-remove-${p}`}
          >
            ×
          </button>
        </span>
      ))}
      <Toggle
        label="Active only"
        on={filters.activeOnly}
        onToggle={() => onPatch({ activeOnly: !filters.activeOnly })}
        testid="mytasks-filter-active"
      />
      {/* fix-224 (Jade): group the list by project instead of the D&E/PM kanban. */}
      <Toggle
        label="By Project"
        on={filters.groupByProject}
        onToggle={() => onPatch({ groupByProject: !filters.groupByProject })}
        testid="mytasks-filter-byproject"
      />
      {/* fix-155: BOT quick-filter — narrows to lifecycle auto-tasks. */}
      <Toggle
        label="🤖 BOT"
        on={filters.botOnly}
        onToggle={() => onPatch({ botOnly: !filters.botOnly })}
        testid="mytasks-filter-bot"
      />
      {/* ★★★ fix-409 — THE SWITCH, in the row with the filters it belongs to.
          It is NOT one of `filters` and is not reset by the Reset button
          beside it, deliberately: the other chips are this screen's own
          filters, and this is a shared preference My Board reads too. Resetting
          My Tasks' filter row must not silently change what the board shows. */}
      <ShowHeldWorkToggle testid="mytasks-filter-held" />
      {/* ★★★ fix-445 §A2 — beside Show held work, same shape, same per-user
          memory mechanism (lib/coAssignedPref). DISABLED, not hidden, under
          Everyone: that list is not defined by ownership, so there is no
          "your" co-assignment to hide, and a control that vanished between
          scopes would leave the reader hunting for it. */}
      <CoAssignedToggle
        testid="mytasks-filter-coassigned"
        disabled={scopeMode !== 'mine'}
      />
      {/* ★ fix-428: the label is Bobby's word; the id is unchanged. The
          FilterBar's own `mytasks-filter-clear` already read correctly and did
          not move.

          ★★ fix-445: Clear still does NOT touch Co-assigned, for exactly the
          reason fix-409 gave about Show held work — the chips beside it are
          this screen's own filters, and these two are per-user PREFERENCES
          that outlive a filter reset. Clear DOES empty the four role dropdowns
          inside the People panel (§B2): they are `filters.roles` and always
          were, so collapsing them behind a button changed where they are drawn
          and nothing about what Clear means.

          ★★★ THE COMMENT LIVES OUT HERE, ABOVE THE BUTTON, ON PURPOSE.
          fix-428's own pin slices 260 characters after `data-testid=
          "mytasks-filter-reset"` and requires the word Clear inside that
          window. A comment between the id and the label pushes it out and
          fails a test whose subject — the label and the id — this ticket never
          touched. Loosening someone else's pin to make room for prose is the
          wrong trade; moving the prose is free. */}
      <button
        type="button"
        onClick={onReset}
        className="text-[11px] px-2 py-1 rounded border ml-auto"
        style={chipStyle(false, 'bg')}
        data-testid="mytasks-filter-reset"
      >
        Clear
      </button>
      </div>
    </div>
  );
}

/** ★ fix-445 §B1: a hairline between clusters. Not a component in the sense
 *  §B1 rules out — it is a 1px rule with a name, so the three call sites
 *  cannot drift apart. */
function FilterDivider() {
  return (
    <span
      aria-hidden
      className="self-stretch w-px my-0.5"
      style={{ background: 'var(--color-border)' }}
      data-testid="mytasks-filter-divider"
    />
  );
}

// ===========================================================================
// ★★★ fix-445 §B1/§B2 — THE FOUR ROLE DROPDOWNS, BEHIND ONE BUTTON
// ===========================================================================
//
// ★★★ THE PANEL'S OPEN STATE IS LOCAL AND DELIBERATELY NOT REMEMBERED (§B4).
// fix-403's line is preference vs train of thought, and "which drawer was open
// when I left" is neither — it is a gesture. Persisting it would also mean a
// row that changes height on load for a reason the reader cannot see.
//
// ★★ THE DROPDOWNS THEMSELVES ARE UNCHANGED — same `RoleDropdown`, same four
// test ids, same `filters.roles` writes. §B3: this re-parents them, it does not
// reimplement them, so every existing assertion about them still holds.
function PeoplePanel({
  roster,
  filters,
  onPatch,
  count,
}: {
  roster: { ent: string[]; da: string[]; dm: string[]; consultant: string[] };
  filters: FilterState;
  onPatch: (p: Partial<FilterState>) => void;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" data-testid="mytasks-filter-people">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border whitespace-nowrap"
        style={chipStyle(count > 0, 'bg')}
        aria-expanded={open}
        data-testid="mytasks-filter-people-button"
        data-count={count}
      >
        People
        {/* ★★★ §B2 — THE BADGE IS WHAT MAKES COLLAPSING THEM HONEST. Four
            filters that can be set and then hidden would otherwise narrow the
            board with nothing on screen saying so. */}
        {count > 0 && (
          <span
            className="text-[9px] px-1 rounded-full font-bold"
            style={{
              background: 'var(--color-de)',
              color: 'var(--color-surface)',
            }}
            data-testid="mytasks-filter-people-count"
          >
            {count}
          </span>
        )}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 left-0 flex flex-col gap-2 p-2 rounded border shadow-lg"
          style={{
            background: 'var(--color-panel)',
            borderColor: 'var(--color-border)',
          }}
          data-testid="mytasks-filter-people-panel"
        >
          <RoleDropdown
            label="ENT"
            options={roster.ent}
            selected={filters.roles.ent}
            onChange={(next) =>
              onPatch({ roles: { ...filters.roles, ent: next } })
            }
            testid="mytasks-filter-role-ent"
          />
          <RoleDropdown
            label="DA"
            options={roster.da}
            selected={filters.roles.da}
            onChange={(next) =>
              onPatch({ roles: { ...filters.roles, da: next } })
            }
            testid="mytasks-filter-role-da"
          />
          <RoleDropdown
            label="DM"
            options={roster.dm}
            selected={filters.roles.dm}
            onChange={(next) =>
              onPatch({ roles: { ...filters.roles, dm: next } })
            }
            testid="mytasks-filter-role-dm"
          />
          <RoleDropdown
            label="Consultant"
            options={roster.consultant}
            selected={filters.roles.consultant}
            onChange={(next) =>
              onPatch({ roles: { ...filters.roles, consultant: next } })
            }
            testid="mytasks-filter-role-consultant"
          />
        </div>
      )}
    </div>
  );
}

function RoleDropdown({
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
        disabled={available.length === 0 && selected.length === options.length}
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

function Toggle({
  label,
  on,
  onToggle,
  testid,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-[11px] px-2 py-1 rounded border"
      style={chipStyle(on, 'bg')}
      data-testid={testid}
      data-on={on ? 'true' : 'false'}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}

function BucketColumn({
  bucket,
  tasks,
  milestones,
  today,
  activeOnly,
  selectedId,
  onSelect,
  onMilestoneTick,
  onMilestoneOpen,
  milestoneBusy,
}: {
  bucket: DiagBucket;
  tasks: Task[];
  milestones: MilestoneRow[];
  today: string;
  activeOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMilestoneTick: (item: ForecastItem) => void;
  onMilestoneOpen: (item: ForecastItem) => void;
  milestoneBusy: boolean;
}) {
  // ★★★ fix-444 §A1: the STATUS columns stay; the ordering inside each one is
  //     now date BANDS with headers, in fix-397's order and under fix-397's
  //     labels. See lib/taskBands.
  // ★★★ fix-446 RULING 1 — MILESTONES LIVE IN "NOT STARTED", AND ONLY THERE.
  //
  // Bobby: *"a milestone sits in NOT STARTED until acknowledged, then
  // disappears from My Tasks. It is never 'In Progress' and never 'Resolved'
  // here (Project Overview keeps showing it)."*
  //
  // ★★ They are banded by the SAME `bandRows` as the tasks beside them
  // (ruling 4), so one date band holds both kinds in one date order. The
  // adapter below is the whole integration: `target_date` is the milestone's
  // date, and `priority` is deliberately absent — the flag does not apply to
  // milestones, so `compareInBand` sorts them purely by date, which is what
  // ruling 4 asks for.
  const notStarted = useMemo(
    () =>
      bandRows(
        [
          ...tasks
            .filter((t) => t.status === 'Open')
            .map((t): ColumnRow => ({ kind: 'task', id: t.id, task: t, target_date: t.target_date, priority: t.priority, sort_order: t.sort_order })),
          ...milestones.map(
            (m): ColumnRow => ({
              kind: 'milestone',
              id: m.item.key,
              milestone: m,
              target_date: m.item.date,
            }),
          ),
        ],
        today,
      ),
    [tasks, milestones, today],
  );
  const inProgress = useMemo(
    () =>
      bandRows(
        tasks
          .filter((t) => t.status === 'In Progress')
          .map((t): ColumnRow => ({ kind: 'task', id: t.id, task: t, target_date: t.target_date, priority: t.priority, sort_order: t.sort_order })),
        today,
      ),
    [tasks, today],
  );
  // ★★★ A4: RESOLVED IS NOT BANDED. Measured on prod: 738 of 1,320 resolved
  //     tasks carry a target date already in the past, so banding would file
  //     them under "Past due" — a false statement about finished work. The
  //     date stays on the row; only the claim that it is still a deadline goes.
  const resolved = useMemo(
    () =>
      resolvedOrder(
        tasks
          .filter((t) => t.status === 'Resolved')
          .map((t): ColumnRow => ({ kind: 'task', id: t.id, task: t, target_date: t.target_date, priority: t.priority, sort_order: t.sort_order })),
      ),
    [tasks],
  );
  const openCount =
    notStarted.reduce((n, b) => n + b.items.length, 0) +
    inProgress.reduce((n, b) => n + b.items.length, 0);
  return (
    <div
      className="rounded border flex flex-col"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
      data-testid={`mytasks-bucket-${bucket}`}
    >
      <div
        className="px-3 py-2 border-b flex items-baseline justify-between"
        style={{
          borderBottomColor: 'var(--color-border)',
          background: 'var(--color-s2)',
        }}
      >
        <span
          className="text-sm font-bold"
          style={{ color: BUCKET_ACCENT[bucket] }}
        >
          {BUCKET_LABEL[bucket]}
        </span>
        <span
          className="text-[11px] font-mono"
          style={{ color: 'var(--color-muted)' }}
          data-testid={`mytasks-bucket-${bucket}-open-count`}
        >
          {openCount} open
        </span>
      </div>
      {/* fix-138-b: minmax(0,1fr) on each track so an overflowing task
          card in NOT STARTED can't elastically widen its column and
          squish IN PROGRESS. CSS-wise the columns were already 1:1,
          but min-content auto-tracking was leaking through. */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: activeOnly
            ? 'minmax(0,1fr) minmax(0,1fr)'
            : 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',
        }}
        data-testid={`mytasks-bucket-${bucket}-subgrid`}
      >
        <SubColumn
          bucket={bucket}
          kind="not-started"
          label="NOT STARTED"
          bands={notStarted}
          today={today}
          selectedId={selectedId}
          onSelect={onSelect}
          onMilestoneTick={onMilestoneTick}
          onMilestoneOpen={onMilestoneOpen}
          milestoneBusy={milestoneBusy}
        />
        <SubColumn
          bucket={bucket}
          kind="in-progress"
          label="IN PROGRESS"
          bands={inProgress}
          today={today}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        {!activeOnly && (
          <SubColumn
            bucket={bucket}
            kind="resolved"
            label="RESOLVED"
            flat={resolved}
            today={today}
            selectedId={selectedId}
            onSelect={onSelect}
            dimmed
          />
        )}
      </div>
    </div>
  );
}

/**
 * ★★★ fix-446 — ONE BAND, TWO KINDS OF ROW, ONE ORDER.
 *
 * Ruling 4 puts milestones in the SAME band as the tasks, in the same order.
 * That rules out the easy shape (all the tasks, then all the milestones): in a
 * band holding a task due the 4th and a milestone due the 2nd, the milestone
 * has to come first.
 *
 * ★★ SO NESTING RUNS OVER THE TASKS ONLY, and the resulting GROUPS are then
 * merged back with the milestones under `compareInBand` — the very comparator
 * that ordered the band. A subtask stays under its parent (fix-294) because it
 * never enters this list; `nestSubtasks` has already folded it into a group.
 *
 * ★ A milestone has no `priority` and no `sort_order`, so `compareInBand`
 * falls through to the date for it — which is precisely ruling 4's "the
 * priority flag does not apply to milestones".
 */
function renderRows(
  rows: ColumnRow[],
  ctx: {
    today: string;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onMilestoneTick?: (item: ForecastItem) => void;
    onMilestoneOpen?: (item: ForecastItem) => void;
    milestoneBusy?: boolean;
  },
) {
  const tasks: Task[] = [];
  const milestones: ColumnRow[] = [];
  for (const r of rows) {
    if (r.kind === 'task') tasks.push(r.task);
    else milestones.push(r);
  }
  type Slot =
    | { sort: BandableRow; node: ReactElement }
    | never;
  const slots: Slot[] = [];
  for (const g of nestSubtasks(tasks)) {
    slots.push({
      sort: g.task,
      node: (
        <TaskGroupRows
          key={g.task.id}
          group={g}
          today={ctx.today}
          selectedId={ctx.selectedId}
          onSelect={ctx.onSelect}
        />
      ),
    });
  }
  for (const m of milestones) {
    if (m.kind !== 'milestone') continue;
    slots.push({
      sort: m,
      node: (
        <MilestoneCard
          key={m.id}
          item={m.milestone.item}
          coAssigned={m.milestone.coAssigned}
          onOpen={ctx.onMilestoneOpen ?? (() => {})}
          onTick={ctx.onMilestoneTick ?? (() => {})}
          busy={ctx.milestoneBusy ?? false}
        />
      ),
    });
  }
  slots.sort((a, z) => compareInBand(a.sort, z.sort));
  return slots.map((s) => s.node);
}

function SubColumn({
  bucket,
  kind,
  label,
  bands,
  flat,
  today,
  selectedId,
  onSelect,
  onMilestoneTick,
  onMilestoneOpen,
  milestoneBusy,
  dimmed,
}: {
  bucket: DiagBucket;
  kind: 'not-started' | 'in-progress' | 'resolved';
  label: string;
  /** Banded — the two OPEN columns. */
  bands?: Band<ColumnRow>[];
  /** One flat list — Resolved only. See lib/taskBands.RESOLVED_IS_BANDED. */
  flat?: ColumnRow[];
  today: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMilestoneTick?: (item: ForecastItem) => void;
  onMilestoneOpen?: (item: ForecastItem) => void;
  milestoneBusy?: boolean;
  dimmed?: boolean;
}) {
  const total = bands
    ? bands.reduce((n, b) => n + b.items.length, 0)
    : (flat?.length ?? 0);
  return (
    <div
      className="p-2 border-r last:border-r-0"
      style={{
        borderRightColor: 'var(--color-border)',
        opacity: dimmed ? 0.65 : 1,
      }}
      data-testid={`mytasks-bucket-${bucket}-sub-${kind}`}
    >
      <div
        className="flex items-baseline justify-between mb-2"
        style={{ color: 'var(--color-muted)' }}
      >
        <span className="text-[10px] uppercase tracking-wide font-bold">
          {label}
        </span>
        <span
          className="text-[11px] font-mono"
          data-testid={`mytasks-bucket-${bucket}-sub-${kind}-count`}
        >
          {total}
        </span>
      </div>
      {bands ? (
        <div className="flex flex-col gap-2">
          {bands.map((b) => (
            <div key={b.band} data-testid={`mytasks-band-${bucket}-${kind}-${b.band}`}>
              {/* ★★★ fix-444 §A1: the header, with its count. Ninety-one of
                  Miles's 121 open tasks have no target date and were falling
                  off the bottom of this column UNLABELLED behind a '￿'
                  sentinel — indistinguishable from "nothing left". */}
              <div
                className="flex items-baseline justify-between mb-1 px-0.5"
                style={{ color: 'var(--color-dim)' }}
              >
                <span className="text-[9px] uppercase tracking-wider font-bold">
                  {b.label}
                </span>
                <span
                  className="text-[9px] font-mono"
                  data-testid={`mytasks-band-${bucket}-${kind}-${b.band}-count`}
                >
                  {b.items.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {renderRows(b.items, {
                  today,
                  selectedId,
                  onSelect,
                  onMilestoneTick,
                  onMilestoneOpen,
                  milestoneBusy,
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {renderRows(flat ?? [], {
            today,
            selectedId,
            onSelect,
            onMilestoneTick,
            onMilestoneOpen,
            milestoneBusy,
          })}
        </div>
      )}
    </div>
  );
}

/** fix-224 (Jade): group the flat visible task list into one section per
 *  project (address header + its tasks, sorted by the active sort). Spans the
 *  two kanban tracks; the detail pane stays to the right. */
function ProjectGroupedView({
  className,
  tasks,
  milestones,
  today,
  selectedId,
  onSelect,
  onMilestoneTick,
  onMilestoneOpen,
  milestoneBusy,
}: {
  className?: string;
  tasks: Task[];
  milestones: MilestoneRow[];
  today: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMilestoneTick: (item: ForecastItem) => void;
  onMilestoneOpen: (item: ForecastItem) => void;
  milestoneBusy: boolean;
}) {
  const groups = useMemo(() => {
    const byProject = new Map<string, { address: string; rows: ColumnRow[] }>();
    function bucketFor(projectId: string, address: string) {
      const g = byProject.get(projectId) ?? { address, rows: [] };
      byProject.set(projectId, g);
      return g;
    }
    for (const t of tasks) {
      bucketFor(t.project_id, t.project_address).rows.push({
        kind: 'task',
        id: t.id,
        task: t,
        target_date: t.target_date,
        priority: t.priority,
        sort_order: t.sort_order,
      });
    }
    // ★★ fix-446 §A4: *"Group-by-Project (fix-224) places a milestone under
    //    its project like any row."* Same map, same key — the milestone's own
    //    projectId — so a project with only milestones still gets a section.
    for (const m of milestones) {
      if (!m.item.projectId) continue;
      bucketFor(m.item.projectId, m.item.address ?? m.item.where).rows.push({
        kind: 'milestone',
        id: m.item.key,
        milestone: m,
        target_date: m.item.date,
      });
    }
    return [...byProject.values()]
      // ★ fix-444 §A1: the by-project view bands too — one list per project,
      //   ordered by the same rule, so the two views cannot disagree about
      //   what comes first.
      .map((g) => ({
        ...g,
        rows: bandRows(g.rows, today).flatMap((b) => b.items),
      }))
      .sort((a, b) => a.address.localeCompare(b.address));
  }, [tasks, milestones, today]);

  return (
    <div className={`${className ?? ''} flex flex-col gap-3`} data-testid="mytasks-by-project">
      {groups.length === 0 && (
        <div className="text-[11px] italic" style={{ color: 'var(--color-dim)' }}>
          No tasks match the current filters.
        </div>
      )}
      {groups.map((g) => (
        <div
          key={g.address}
          className="rounded border"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          data-testid={`mytasks-project-group-${g.address}`}
        >
          <div
            className="px-3 py-2 border-b flex items-baseline justify-between"
            style={{ borderBottomColor: 'var(--color-border)', background: 'var(--color-s2)' }}
          >
            <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
              {g.address}
            </span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>
              {g.rows.length} item{g.rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="p-2 flex flex-col gap-1.5">
            {renderRows(g.rows, {
              today,
              selectedId,
              onSelect,
              onMilestoneTick,
              onMilestoneOpen,
              milestoneBusy,
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** fix-294: one parent card followed by its subtasks, as a single visual group.
 *  Both list renderers use this so the two views cannot drift apart. */
function TaskGroupRows({
  group,
  today,
  selectedId,
  onSelect,
}: {
  group: TaskGroup<Task>;
  today: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid={`mytask-group-${group.task.id}`}
    >
      {/* ★★ fix-434: `onSelect` is passed DOWN rather than wrapped in a
          closure here. `setSelectedId` is stable all the way from `Body`, so
          the card's props only change when the card's own task does — which is
          what lets the memo below actually bite. */}
      <TaskCard
        task={group.task}
        today={today}
        isSelected={selectedId === group.task.id}
        onSelect={onSelect}
      />
      {group.subtasks.map((s) => (
        <TaskCard
          key={s.id}
          task={s}
          today={today}
          isSelected={selectedId === s.id}
          onSelect={onSelect}
          isSubtask
        />
      ))}
    </div>
  );
}

// ★★★ fix-434 §B — MEMOISED, AND ONLY NOW THAT IT PAYS.
//
// Before this ticket the board barely re-rendered on a tick at all (measured:
// one card render for ten clicks) because react-query's structural sharing made
// ten identical refetches referentially equal — memoising then would have been
// a fix for nothing. The optimistic overlay changes that: a tick now genuinely
// moves the row, so without this every one of ~200 cards re-rendered on every
// click. Measured after: 199 → 2.
//
// ★ It works only because of the two things next to it: `onSelect` is the same
//   function on every render (passed down, not wrapped), and the overlay's
//   ACTIONS context never changes identity, so a card is not woken by a
//   sibling's click through the context it consumes.
const TaskCard = memo(function TaskCard({
  task,
  today,
  isSelected,
  onSelect,
  // fix-294: a subtask renders indented under its parent with a left rule,
  // matching how Project Overview has always drawn them (PermitDetailV2's
  // TaskItem). Same task, same shape, whichever screen you are on.
  isSubtask = false,
}: {
  task: Task;
  today: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  isSubtask?: boolean;
}) {
  // ★★★ fix-434 §A2: ONE write path, two entry points. The checkbox and the
  // chip below both go through this — same payload, same RPC, same audit
  // trigger, same optimistic layer. See hooks/useSetTaskStatus.
  const { setStatus, advance } = useSetTaskStatus();
  const overdue = isOverdue(task, today);
  const visual = checkboxVisual(task.status);
  // ★★ fix-364 §2: WHICH permit, when the address and type do not say. Read
  // from the permit list the board already holds — React Query dedupes it, so
  // this costs no fetch, and the alternative (widening bp_list_tasks, the RPC
  // behind every task surface in the app) would be a large blast radius for a
  // label.
  const permitsQ = usePermits();
  const permitSuffix = taskPermitSuffix(task.permit_id, permitsQ.data ?? []);
  // ★ fix-445 §A3: read from context, not a prop — see lib/coAssignedContext
  //   for why four signature changes were the wrong price for one badge.
  const coAssigned = useIsCoAssigned(task.id);

  // fix-235: the checkbox advances FORWARD only — Open → In Progress →
  // Resolved — and stops at Resolved (a further click is a no-op so a
  // completed task can't be accidentally un-completed). Backward moves go
  // through the detail-pane status dropdown. Both controls share the same
  // transition rules via taskStatus.ts; the done/done_at write-path
  // unification is enforced by the bp_trg_task_done_at DB trigger.
  //
  // ★★★ fix-434 (P-065): the transition is computed from the OPTIMISTIC current
  // status, not from `task.status`. Ten clicks in one React batch produce no
  // re-render between them, so the old handler read the same stale 'Open' ten
  // times and sent 'In Progress' ten times — measured, and the reason three
  // fast clicks landed on In Progress instead of Resolved.
  function advanceStatus(e: React.MouseEvent) {
    e.stopPropagation();
    advance(task);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(task.id);
        }
      }}
      className="rounded border px-2 py-1.5 cursor-pointer text-[12px]"
      style={{
        borderColor: isSelected ? 'var(--color-de)' : 'var(--color-border)',
        background: isSelected ? 'var(--color-de-bg)' : 'var(--color-bg)',
        borderWidth: isSelected ? 2 : 1,
        // fix-294: indent + a left rule, the same vocabulary the Overview uses.
        ...(isSubtask
          ? { marginLeft: 14, borderLeftWidth: 2, borderLeftColor: 'var(--color-border)' }
          : null),
      }}
      data-testid={`mytask-card-${task.id}`}
      data-subtask={isSubtask ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={advanceStatus}
          disabled={visual === 'checked'}
          title={
            visual === 'checked'
              ? 'Resolved — use the status dropdown to reopen'
              : 'Click to advance: Open → In Progress → Resolved'
          }
          className="flex-shrink-0 mt-0.5 rounded border"
          style={{
            width: 14,
            height: 14,
            background:
              visual === 'checked'
                ? 'var(--color-pm)'
                : visual === 'partial'
                  ? 'var(--color-de)'
                  : 'transparent',
            borderColor:
              visual === 'checked' ? 'var(--color-pm)' : 'var(--color-border)',
            color: '#fff',
            fontSize: 9,
            lineHeight: '12px',
            cursor: visual === 'checked' ? 'default' : 'pointer',
          }}
          data-testid={`mytask-card-${task.id}-status-toggle`}
          data-status-visual={visual}
        >
          {visual === 'checked' ? '✓' : ''}
        </button>
        <span
          className="flex-1 truncate"
          style={{
            textDecoration: task.status === 'Resolved' ? 'line-through' : 'none',
          }}
          data-testid={`mytask-card-${task.id}-text`}
        >
          {task.text}
        </span>
      </div>
      <div className="flex items-center justify-between mt-1 gap-2">
        <span
          className="text-[10px] truncate"
          style={{ color: 'var(--color-muted)' }}
          data-testid={`mytask-card-${task.id}-address`}
        >
          {task.project_address}
        </span>
        {task.target_date && (
          <span
            className="text-[10px] font-mono"
            style={{
              color: overdue ? 'var(--color-co)' : 'var(--color-muted)',
              fontWeight: overdue ? 700 : 400,
            }}
            data-testid={`mytask-card-${task.id}-due`}
            data-overdue={overdue ? 'true' : 'false'}
          >
            {task.target_date}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        {task.is_auto_generated && (
          <BotBadge taskId={task.id} event={task.auto_event} />
        )}
        {/* ★★ fix-337: 88 tasks were closed by the system when their permit
            issued. On a board of completed work, "who ticked this?" has to have
            an answer, and for these the answer is nobody. */}
        {task.auto_closed_reason && (
          <AutoClosedBadge taskId={task.id} reason={task.auto_closed_reason} />
        )}
        {/* ★★★ fix-409: only ever present when the viewer switched held work
            on — the filter above removed it otherwise — so the card says why
            it is here and why it is not moving. Same component, same colour as
            the project and permit badges. */}
        <HoldBadge
          hold={task.hold}
          compact
          testid={`mytask-card-${task.id}-hold`}
        />
        {/* ★★★ fix-445 §A3 — SHARED, NOT MINE.
            Bobby: *"so 'mine' and 'shared' are distinguishable rather than
            blended."* Present only when the task reaches this viewer through
            the co-assignee join ALONE — a task you own AND are separately
            listed on is yours, and 24 of Miles's rows are exactly that, so
            marking those would label most of the board's busiest list as
            somebody else's work.

            ★ It rides the SAME badge row as the bot, auto-closed, hold, type
            and unowned chips — the tag slot fix-444 left open — rather than
            starting a second place where a row can be annotated. */}
        {coAssigned && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-bold"
            style={{
              background: 'var(--color-de-bg, var(--color-s2))',
              color: 'var(--color-de)',
            }}
            title="You are a co-assignee on this task — it is not assigned to you directly."
            data-testid={`mytask-card-${task.id}-coassigned`}
          >
            CO-ASSIGNED
          </span>
        )}
        {task.permit_type && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
            style={{
              background: 'var(--color-s2)',
              color: 'var(--color-text)',
            }}
            data-testid={`mytask-card-${task.id}-type`}
          >
            {task.permit_type}
            {/* ★★ fix-364 §2: WHICH of the four. Four Building Permits on one
                address produced four identical cards; the discriminator rides
                the type chip because that is the half of the label that was
                ambiguous. Absent — and costing nothing — for the 484 permits
                that are the only one of their type on their project. */}
            {permitSuffix ? (
              <span
                className="ml-1 font-extrabold"
                style={{ color: 'var(--color-de)' }}
                data-testid={`mytask-card-${task.id}-permit-label`}
              >
                {permitSuffix.replace(' · ', '')}
              </span>
            ) : null}
          </span>
        )}
        {/* ★★★ fix-434 §A (P-063) — this chip used to be a <span>. Bobby:
            "being able to just mark something off as Resolved, Resolved,
            Resolved". It offers the trio in place — no dialog, no navigation,
            nothing that could cost the scroll position — and writes through
            exactly the path the checkbox two lines up uses. */}
        <TaskStatusChip
          taskId={task.id}
          status={task.status}
          background={STATUS_BG[task.status]}
          onSelect={(next) => setStatus(task, next)}
        />
        {/* ★★ fix-308b #44: an unassigned OPEN task says so, here, where the
            densest population of them surfaces. 316 of 501 open tasks have no
            assignee — Bobby's rule is "a task is always owned by somebody", so
            an ownerless one is a visible gap for a person to close.

            ★ It NEVER names the DA. Attributing unowned work to permits.da is
            exactly what produced "blocked by Cam" on a permit where Cam had no
            task, and fix-308 removed that fallback at the source. This is the
            rendered half of the same promise.

            ★ Not hidden and not auto-assigned — the chip is the prompt. */}
        {isTaskLive(task.status) && taskNeedsOwner(task) && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-bold"
            style={{
              background: 'var(--color-co-bg)',
              color: 'var(--color-co)',
            }}
            data-testid={`mytask-card-${task.id}-needs-owner`}
          >
            {UNOWNED_LABEL}
          </span>
        )}
      </div>
    </div>
  );
});

// ============================================================
// fix-138-c: v1-parity Task Detail panel
// ============================================================
//
// Nine inline-editable fields, top to bottom:
//   1. Project (link)             6. Start Date (date picker)
//   2. Permit (link)              7. Target Date (date picker)
//   3. Assigned To (dropdown)     8. Completed (date picker — set this
//   4. Waiting On (dropdown)         to mark done)
//   5. Priority (star toggle)     9. Notes (textarea, blur-commit)
//
//  +  "→ Open in Project View" link at the bottom.
//
// Inline-editable = no edit modal. Dates / dropdowns / priority commit
// immediately on change; Notes commits on blur (debounced via local
// draft state) so the user can type freely without firing the RPC per
// keystroke.
//
// Each row uses a small uppercase label in v1 typography. Key the
// Editor on task.id so switching tasks throws away the draft state.

function TaskDetailPane({
  task,
  members,
  missing = false,
  outsideView = false,
}: {
  task: Task | null;
  members: TeamMember[];
  /** ★ fix-362 §3: a notification pointed at a task that is no longer here. */
  missing?: boolean;
  /** ★ fix-362: opened from a notification, but filtered out of the board. */
  outsideView?: boolean;
}) {
  if (missing) {
    return (
      <div
        className="rounded border p-3 text-[11px] text-center"
        style={{
          borderColor: 'var(--color-co-border)',
          background: 'var(--color-co-bg)',
          color: 'var(--color-co)',
        }}
        data-testid="mytasks-detail-missing"
      >
        That task has been deleted. Your board is below.
      </div>
    );
  }
  if (!task) {
    return (
      <div
        className="rounded border p-3 text-[11px] italic text-center"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-muted)',
        }}
        data-testid="mytasks-detail-empty"
      >
        Select a task to view details.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {outsideView && (
        <div
          className="rounded border px-2 py-1 text-[10px] leading-snug"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-s2)',
            color: 'var(--color-muted)',
          }}
          data-testid="mytasks-detail-outside-view"
        >
          Opened from a notification. It is not in the columns beside this —
          your filters or scope exclude it.
        </div>
      )}
      <TaskDetailEditor key={task.id} task={task} members={members} />
    </div>
  );
}

function chipBg() {
  return {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };
}

// ★★★ fix-444 §A3: `sorted()` IS GONE. It ranked `priority` above the DATE
// across a whole column, so a flagged task due next month outranked an
// unflagged one due today — the confusion between "important" and "urgent"
// that ruling 3 settles ("the flag lifts a task to the top of its band, never
// out of it"). Its undated sentinel '￿' is gone with it: undated work now has
// a header instead of a silent seat at the bottom. See lib/taskBands.

function filterTasks(
  tasks: Task[],
  filters: FilterState,
  rolesByName: Map<string, Set<'ent' | 'da' | 'dm' | 'consultant'>>,
  // fix-238b: the SAME ownership resolver "My Work" uses. Both the person
  // dropdowns and the quick role-family chips now resolve a task's owner(s)
  // through it (assigned_to role → person incl. DM/Schematic, co-assignees, the
  // DA arch-blanket) instead of the server-derived primary_assignee — so
  // filtering by a person P returns EXACTLY the tasks in P's My Work, and the
  // two surfaces can't diverge. Derry (a DM) now surfaces "Design Manager" tasks.
  taskMatches: (t: Task, name: string) => boolean,
  // fix-380: struct_address by permit_id (from the permits cache) — joins the
  // search haystack so a structure address finds the permit's tasks. Absent
  // entries (518 of 588 permits carry none) contribute nothing.
  structAddressByPermitId: ReadonlyMap<number, string>,
): Task[] {
  const q = filters.search.trim().toLowerCase();
  const wantTypes =
    filters.permitTypes.length > 0
      ? new Set(filters.permitTypes)
      : null;

  const roleNameSet = new Set<string>([
    ...filters.roles.ent,
    ...filters.roles.da,
    ...filters.roles.dm,
    ...filters.roles.consultant,
  ]);
  const roleNames = [...roleNameSet];

  // fix-238b: the roster people who belong to the active quick role-family — a
  // task "resolves to" that family iff it resolves to one of these people (via
  // the shared owner resolver). Computed once, not per task.
  const quickFamily =
    filters.quickRole === 'all' ? null : filters.quickRole;
  const quickRolePeople: string[] = [];
  if (quickFamily) {
    for (const [name, families] of rolesByName) {
      if (families.has(quickFamily)) quickRolePeople.push(name);
    }
  }

  return tasks.filter((t) => {
    // fix-155: BOT filter — keep only lifecycle auto-tasks when active.
    if (filters.botOnly && !t.is_auto_generated) return false;
    if (wantTypes && t.permit_type && !wantTypes.has(t.permit_type)) {
      return false;
    }
    if (wantTypes && !t.permit_type) return false;
    if (roleNames.length > 0 && !roleNames.some((n) => taskMatches(t, n))) {
      return false;
    }
    if (filters.quickRole !== 'all') {
      if (!quickRolePeople.some((n) => taskMatches(t, n))) {
        return false;
      }
    }
    if (q) {
      const hay =
        `${t.text} ${t.project_address} ${structAddressByPermitId.get(t.permit_id) ?? ''} ${t.primary_assignee ?? ''} ${t.co_assignees.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
