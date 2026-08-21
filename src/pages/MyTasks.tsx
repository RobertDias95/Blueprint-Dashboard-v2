import { usePermits } from '../hooks/usePermits';
import { taskPermitSuffix } from '../lib/permitDiscriminator';
import { nestSubtasks, type TaskGroup } from '../lib/taskNesting';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PARAM_TASK } from '../lib/notificationTargets';
import WaitingOnView from '../components/MyTasks/WaitingOnView';
import BotBadge from '../components/shared/BotBadge';
import AutoClosedBadge from '../components/shared/AutoClosedBadge';
import { UNOWNED_LABEL, taskNeedsOwner } from '../lib/boardOwnership';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { isCurrentMember } from '../lib/roster';
import { useAllTasks, useUpsertTask } from '../hooks/useTaskTree';
// fix-303: the task detail editor moved to its own component so My Board can
// use the SAME one. Nothing about it changed in the move.
import TaskDetailEditor from '../components/TaskDetailEditor';
import { inputStyle } from '../lib/taskFieldStyles';
import {
  nextCheckboxStatus,
  checkboxVisual,
  isTaskLive,
  isTaskCancelled,
  isTaskOverdue,
  writableStatus,
} from '../lib/taskStatus';
import {
  useAllProjectHolds,
  cancelledProjectIds,
} from '../hooks/useProjectHolds';
import { excludeCancelled } from '../lib/projectViewHelpers';
import { useScopeMode } from '../hooks/useSelfScope';
import { type ScopeMode } from '../lib/selfScope';
import { useTaskOwnership } from '../hooks/useTaskOwnership';
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
type Task = MyTaskNode & { bucket?: 'de' | 'pm' };

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
  /** When true (default) cards within a sub-column sort by target_date asc
   *  NULLS LAST; otherwise by sort_order then created_at desc. */
  byDueDate: boolean;
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
  byDueDate: true,
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
        style={chipStyle(view === 'mine')}
        data-testid="my-tasks-view-mine"
        aria-pressed={view === 'mine'}
      >
        My Tasks
      </button>
      <button
        type="button"
        onClick={() => onChange('waiting-on')}
        className="text-[11px] px-3 py-1 rounded border font-bold"
        style={chipStyle(view === 'waiting-on')}
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
  const cancelledIds = useMemo(
    () => cancelledProjectIds(holdsQ.data),
    [holdsQ.data],
  );
  const liveTasks = useMemo(
    () => excludeCancelled((tasksQ.data ?? []) as Task[], cancelledIds),
    [tasksQ.data, cancelledIds],
  );

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
      tasks={liveTasks}
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
  const { matches: taskMatches } = useTaskOwnership();

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
    return tasks.filter((t) => taskMatches(t, name));
  }, [tasks, scopeMode, identity.name, taskMatches]);
  const filtered = useMemo(
    () => filterTasks(scopedTasks, filters, rolesByName, taskMatches, structByPermitId),
    [scopedTasks, filters, rolesByName, taskMatches, structByPermitId],
  );
  const today = useMemo(() => todayIso(), []);
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
    const total = filtered.length - cancelled;
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
  }, [filtered, today]);

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
            today={today}
            byDueDate={filters.byDueDate}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : (
          <>
            <BucketColumn
              bucket="de"
              tasks={visible.filter((t) => bucketOf(t) === 'de')}
              today={today}
              byDueDate={filters.byDueDate}
              activeOnly={filters.activeOnly}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <BucketColumn
              bucket="pm"
              tasks={visible.filter((t) => bucketOf(t) === 'pm')}
              today={today}
              byDueDate={filters.byDueDate}
              activeOnly={filters.activeOnly}
              selectedId={selectedId}
              onSelect={setSelectedId}
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
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded border"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="mytasks-filterrow"
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
        onChange={(next) => onPatch({ roles: { ...filters.roles, da: next } })}
        testid="mytasks-filter-role-da"
      />
      <RoleDropdown
        label="DM"
        options={roster.dm}
        selected={filters.roles.dm}
        onChange={(next) => onPatch({ roles: { ...filters.roles, dm: next } })}
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
            style={chipStyle(filters.quickRole === r)}
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
      <Toggle
        label="By Due Date"
        on={filters.byDueDate}
        onToggle={() => onPatch({ byDueDate: !filters.byDueDate })}
        testid="mytasks-filter-bydue"
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
      <button
        type="button"
        onClick={onReset}
        className="text-[11px] px-2 py-1 rounded border ml-auto"
        style={chipStyle(false)}
        data-testid="mytasks-filter-reset"
      >
        Reset
      </button>
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
      style={chipStyle(on)}
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
  today,
  byDueDate,
  activeOnly,
  selectedId,
  onSelect,
}: {
  bucket: DiagBucket;
  tasks: Task[];
  today: string;
  byDueDate: boolean;
  activeOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const notStarted = useMemo(
    () => sorted(tasks.filter((t) => t.status === 'Open'), byDueDate),
    [tasks, byDueDate],
  );
  const inProgress = useMemo(
    () => sorted(tasks.filter((t) => t.status === 'In Progress'), byDueDate),
    [tasks, byDueDate],
  );
  const resolved = useMemo(
    () => sorted(tasks.filter((t) => t.status === 'Resolved'), byDueDate),
    [tasks, byDueDate],
  );
  const openCount = notStarted.length + inProgress.length;
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
          tasks={notStarted}
          today={today}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <SubColumn
          bucket={bucket}
          kind="in-progress"
          label="IN PROGRESS"
          tasks={inProgress}
          today={today}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        {!activeOnly && (
          <SubColumn
            bucket={bucket}
            kind="resolved"
            label="RESOLVED"
            tasks={resolved}
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

function SubColumn({
  bucket,
  kind,
  label,
  tasks,
  today,
  selectedId,
  onSelect,
  dimmed,
}: {
  bucket: DiagBucket;
  kind: 'not-started' | 'in-progress' | 'resolved';
  label: string;
  tasks: Task[];
  today: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dimmed?: boolean;
}) {
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
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {nestSubtasks(tasks).map((g) => (
          <TaskGroupRows
            key={g.task.id}
            group={g}
            today={today}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/** fix-224 (Jade): group the flat visible task list into one section per
 *  project (address header + its tasks, sorted by the active sort). Spans the
 *  two kanban tracks; the detail pane stays to the right. */
function ProjectGroupedView({
  className,
  tasks,
  today,
  byDueDate,
  selectedId,
  onSelect,
}: {
  className?: string;
  tasks: Task[];
  today: string;
  byDueDate: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const byProject = new Map<string, { address: string; tasks: Task[] }>();
    for (const t of tasks) {
      const g = byProject.get(t.project_id) ?? {
        address: t.project_address,
        tasks: [],
      };
      g.tasks.push(t);
      byProject.set(t.project_id, g);
    }
    return [...byProject.values()]
      .map((g) => ({ ...g, tasks: sorted(g.tasks, byDueDate) }))
      .sort((a, b) => a.address.localeCompare(b.address));
  }, [tasks, byDueDate]);

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
              {g.tasks.length} task{g.tasks.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="p-2 flex flex-col gap-1.5">
            {nestSubtasks(g.tasks).map((grp) => (
              <TaskGroupRows
                key={grp.task.id}
                group={grp}
                today={today}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
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
      <TaskCard
        task={group.task}
        today={today}
        isSelected={selectedId === group.task.id}
        onSelect={() => onSelect(group.task.id)}
      />
      {group.subtasks.map((s) => (
        <TaskCard
          key={s.id}
          task={s}
          today={today}
          isSelected={selectedId === s.id}
          onSelect={() => onSelect(s.id)}
          isSubtask
        />
      ))}
    </div>
  );
}

function TaskCard({
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
  onSelect: () => void;
  isSubtask?: boolean;
}) {
  const upsert = useUpsertTask();
  const overdue = isOverdue(task, today);
  const visual = checkboxVisual(task.status);
  // ★★ fix-364 §2: WHICH permit, when the address and type do not say. Read
  // from the permit list the board already holds — React Query dedupes it, so
  // this costs no fetch, and the alternative (widening bp_list_tasks, the RPC
  // behind every task surface in the app) would be a large blast radius for a
  // label.
  const permitsQ = usePermits();
  const permitSuffix = taskPermitSuffix(task.permit_id, permitsQ.data ?? []);

  // fix-235: the checkbox advances FORWARD only — Open → In Progress →
  // Resolved — and stops at Resolved (a further click is a no-op so a
  // completed task can't be accidentally un-completed). Backward moves go
  // through the detail-pane status dropdown. Both controls share the same
  // transition rules via taskStatus.ts; the done/done_at write-path
  // unification is enforced by the bp_trg_task_done_at DB trigger.
  function advanceStatus(e: React.MouseEvent) {
    e.stopPropagation();
    const next = nextCheckboxStatus(task.status);
    if (!next) return; // Resolved is terminal on the checkbox
    upsert.mutate({
      id: task.id,
      permitId: task.permit_id,
      parentTaskId: task.parent_task_id,
      discipline: task.discipline,
      bucket: task.bucket,
      text: task.text,
      status: writableStatus(next),
      startDate: task.start_date,
      targetDate: task.target_date,
    });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
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
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-bold"
          style={{
            background: STATUS_BG[task.status],
            color: 'var(--color-text)',
          }}
          data-testid={`mytask-card-${task.id}-status`}
        >
          {task.status === 'Open' ? 'Not Started' : task.status}
        </span>
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
}

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
function chipStyle(active: boolean) {
  return {
    borderColor: active ? 'var(--color-de)' : 'var(--color-border)',
    background: active ? 'var(--color-de)' : 'var(--color-bg)',
    color: active ? '#fff' : 'var(--color-text)',
  };
}

function sorted(tasks: Task[], byDueDate: boolean): Task[] {
  const arr = [...tasks];
  // fix-155: priority tasks bubble to the top of each sub-column, then the
  // existing by-due / by-order ordering applies within the priority and
  // non-priority groups. corr_issued auto-tasks set priority=true, so they
  // surface alongside any human-starred priority tasks per existing handling.
  const byPriority = (a: Task, b: Task) =>
    (b.priority ? 1 : 0) - (a.priority ? 1 : 0);
  if (byDueDate) {
    arr.sort((a, b) => {
      const p = byPriority(a, b);
      if (p !== 0) return p;
      const ad = a.target_date ?? '￿';
      const bd = b.target_date ?? '￿';
      if (ad !== bd) return ad.localeCompare(bd);
      return a.sort_order - b.sort_order;
    });
  } else {
    arr.sort((a, b) => {
      const p = byPriority(a, b);
      if (p !== 0) return p;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      const ad = a.start_date ?? '';
      const bd = b.start_date ?? '';
      return bd.localeCompare(ad);
    });
  }
  return arr;
}

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
