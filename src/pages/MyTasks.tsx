import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import WaitingOnView from '../components/MyTasks/WaitingOnView';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useAllTasks, useUpsertTask } from '../hooks/useTaskTree';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  WAITING_ON_OPTIONS,
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
}

const FILTER_STORAGE_KEY = 'mytasks.filters.v2';

const DEFAULT_FILTERS: FilterState = {
  search: '',
  roles: { ent: [], da: [], dm: [], consultant: [] },
  quickRole: 'all',
  permitTypes: [],
  activeOnly: true,
  byDueDate: true,
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
  return (
    t.status !== 'Resolved' && !!t.target_date && t.target_date < today
  );
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

function MineTasks() {
  const team = useTeamMembers();
  const tasksQ = useAllTasks();

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
      tasks={(tasksQ.data ?? []) as Task[]}
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
  const filtered = useMemo(
    () => filterTasks(tasks, filters, rolesByName),
    [tasks, filters, rolesByName],
  );
  const today = useMemo(() => todayIso(), []);
  const counters = useMemo(() => {
    let open = 0;
    let overdue = 0;
    let resolved = 0;
    const projects = new Set<string>();
    for (const t of filtered) {
      projects.add(t.project_id);
      if (t.status === 'Resolved') resolved += 1;
      else {
        open += 1;
        if (isOverdue(t, today)) overdue += 1;
      }
    }
    const total = filtered.length;
    const pct = total === 0 ? 0 : Math.round((resolved / total) * 100);
    return {
      open,
      overdue,
      projects: projects.size,
      resolved,
      total,
      pct,
    };
  }, [filtered, today]);

  // The visible-in-columns set excludes Resolved when activeOnly is ON. The
  // counters above already used the unrestricted filtered set so the done %
  // stays meaningful even when Resolved cards are hidden.
  const visible = useMemo(
    () =>
      filters.activeOnly
        ? filtered.filter((t) => t.status !== 'Resolved')
        : filtered,
    [filtered, filters.activeOnly],
  );

  const permitTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.permit_type) set.add(t.permit_type);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const selected = useMemo(
    () => (selectedId ? filtered.find((t) => t.id === selectedId) ?? null : null),
    [filtered, selectedId],
  );

  return (
    <div className="space-y-3 p-3" data-testid="mytasks-page">
      <Counters c={counters} />
      <FilterRow
        filters={filters}
        roster={rosterByRole}
        permitTypeOptions={permitTypeOptions}
        onPatch={patch}
        onReset={resetAll}
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
        <TaskDetailPane task={selected} members={members} />
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
    if (m.active === false) continue;
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
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded border"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="mytasks-filterrow"
    >
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
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            today={today}
            isSelected={selectedId === t.id}
            onSelect={() => onSelect(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  today,
  isSelected,
  onSelect,
}: {
  task: Task;
  today: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const upsert = useUpsertTask();
  const overdue = isOverdue(task, today);

  function toggleStatusOnce(e: React.MouseEvent) {
    e.stopPropagation();
    // Single click on the checkbox flips Open <-> In Progress. Double-click
    // marks Resolved (see onDoubleClick handler below).
    const next: Task['status'] =
      task.status === 'Open'
        ? 'In Progress'
        : task.status === 'In Progress'
          ? 'Open'
          : 'Open';
    upsert.mutate({
      id: task.id,
      permitId: task.permit_id,
      parentTaskId: task.parent_task_id,
      discipline: task.discipline,
      bucket: task.bucket,
      text: task.text,
      status: next,
      startDate: task.start_date,
      targetDate: task.target_date,
    });
  }
  function markResolved(e: React.MouseEvent) {
    e.stopPropagation();
    upsert.mutate({
      id: task.id,
      permitId: task.permit_id,
      parentTaskId: task.parent_task_id,
      discipline: task.discipline,
      bucket: task.bucket,
      text: task.text,
      status: 'Resolved',
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
      }}
      data-testid={`mytask-card-${task.id}`}
      data-selected={isSelected ? 'true' : 'false'}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={toggleStatusOnce}
          onDoubleClick={markResolved}
          title="Click: flip Open ↔ In Progress · Double-click: Resolved"
          className="flex-shrink-0 mt-0.5 rounded border cursor-pointer"
          style={{
            width: 14,
            height: 14,
            background:
              task.status === 'Resolved'
                ? 'var(--color-pm)'
                : task.status === 'In Progress'
                  ? 'var(--color-de)'
                  : 'transparent',
            borderColor:
              task.status === 'Resolved'
                ? 'var(--color-pm)'
                : 'var(--color-border)',
            color: '#fff',
            fontSize: 9,
            lineHeight: '12px',
          }}
          data-testid={`mytask-card-${task.id}-status-toggle`}
        >
          {task.status === 'Resolved' ? '✓' : ''}
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
}: {
  task: Task | null;
  members: TeamMember[];
}) {
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
  return <TaskDetailEditor key={task.id} task={task} members={members} />;
}

function TaskDetailEditor({
  task,
  members,
}: {
  task: Task;
  members: TeamMember[];
}) {
  const upsert = useUpsertTask();

  // Notes is the only multi-line free-form field — debounce-commit on
  // blur via local draft + onBlur. Every other field commits on change
  // (single click / single pick).
  const [notesDraft, setNotesDraft] = useState<string>(task.notes ?? '');
  const notesInitial = useRef<string>(task.notes ?? '');

  function patch(p: Partial<Parameters<typeof upsert.mutate>[0]>) {
    upsert.mutate({
      id: task.id,
      permitId: task.permit_id,
      parentTaskId: task.parent_task_id,
      discipline: task.discipline,
      bucket: task.bucket,
      text: task.text,
      // Preserve current values when not patching them — `undefined`
      // on optional fields tells the RPC to leave the column alone.
      ...p,
    });
  }

  function commitNotes() {
    const next = notesDraft;
    if (next === notesInitial.current) return;
    if (next.trim() === '') {
      patch({ notes: null, clearNotes: true });
    } else {
      patch({ notes: next });
    }
    notesInitial.current = next;
  }

  function commitDate(
    field: 'startDate' | 'targetDate' | 'dueDate' | 'completed',
    value: string,
  ) {
    const trimmed = value.trim();
    if (!trimmed) {
      // Empty input clears the date.
      const clearKey = (
        {
          startDate: 'clearAssignedTo', // unused — startDate has no clear flag (column is non-mandatory but we just pass null)
          targetDate: 'clearAssignedTo',
          dueDate: 'clearDueDate',
          completed: 'clearCompleted',
        } as const
      )[field];
      if (field === 'startDate' || field === 'targetDate') {
        // start_date + target_date use the legacy NULL-passthrough.
        patch({ [field]: null } as Record<typeof field, null>);
      } else {
        patch({
          [field]: null,
          [clearKey]: true,
        } as Record<string, unknown>);
      }
      return;
    }
    patch({ [field]: trimmed } as Record<typeof field, string>);
  }

  const isResolved = task.status === 'Resolved';
  const completedValue: string =
    task.done_at && typeof task.done_at === 'string'
      ? task.done_at.slice(0, 10)
      : '';

  return (
    <aside
      className="rounded border flex flex-col"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
        alignSelf: 'start',
      }}
      data-testid="mytasks-detail"
    >
      <header
        className="px-2.5 py-1.5 border-b flex items-center gap-1.5"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <Pill
          label={task.discipline === 'arch' ? 'Architecture' : 'Entitlements'}
          color={task.discipline === 'arch' ? 'var(--color-jv)' : 'var(--color-de)'}
          testid="mytasks-detail-discipline"
        />
        <Pill
          label={bucketOf(task) === 'de' ? 'D&E' : 'Permitting'}
          color={BUCKET_ACCENT[bucketOf(task)]}
          testid="mytasks-detail-bucket"
        />
      </header>

      <div
        className="text-[12px] font-bold px-2.5 py-1.5 border-b"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="mytasks-detail-text"
      >
        {task.text}
      </div>

      <div className="p-2.5 flex flex-col gap-2">
        {/* 1 Project */}
        <FieldRow label="Project">
          <Link
            to={`/project/${task.project_id}`}
            className="text-[11px] underline truncate"
            style={{ color: 'var(--color-de)' }}
            data-testid="task-detail-project"
          >
            {task.project_address}
          </Link>
        </FieldRow>

        {/* 2 Permit (read-only link) */}
        <FieldRow label="Permit">
          <Link
            to={`/project/${task.project_id}`}
            className="text-[11px] underline"
            style={{ color: 'var(--color-muted)' }}
            data-testid="task-detail-permit"
          >
            {task.permit_type ?? '—'}
          </Link>
        </FieldRow>

        {/* 3 Assigned To */}
        <FieldRow label="Assigned To">
          <select
            value={task.assigned_to ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') {
                patch({ assignedTo: null, clearAssignedTo: true });
              } else {
                patch({ assignedTo: v });
              }
            }}
            className="text-[11px] px-2 py-1 border rounded outline-none"
            style={inputStyle()}
            data-testid="task-detail-assigned"
          >
            <option value="">—</option>
            <option value="Entitlements">Entitlements</option>
            <option value="Architecture">Architecture</option>
            {members
              .filter((m) => m.active !== false)
              .map((m) => m.name)
              .filter(
                (n, i, arr) => arr.indexOf(n) === i,
              )
              .sort((a, b) => a.localeCompare(b))
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        </FieldRow>

        {/* 4 Waiting On */}
        <FieldRow label="Waiting On">
          <select
            value={task.waiting_on ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') {
                patch({ waitingOn: null, clearWaitingOn: true });
              } else {
                patch({ waitingOn: v });
              }
            }}
            className="text-[11px] px-2 py-1 border rounded outline-none"
            style={inputStyle()}
            data-testid="task-detail-waiting-on"
          >
            <option value="">—</option>
            {WAITING_ON_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </FieldRow>

        {/* 5 Priority — star toggle */}
        <FieldRow label="Priority">
          <button
            type="button"
            onClick={() => patch({ priority: !task.priority })}
            className="text-[14px] leading-none px-1"
            style={{
              color: task.priority ? 'var(--color-co)' : 'var(--color-muted)',
              cursor: 'pointer',
            }}
            data-testid="task-detail-priority"
            data-priority={task.priority ? 'true' : 'false'}
            aria-pressed={!!task.priority}
            title={task.priority ? 'Priority on' : 'Priority off'}
          >
            {task.priority ? '★' : '☆'}
          </button>
        </FieldRow>

        {/* 6 Start Date */}
        <FieldRow label="Start Date">
          <input
            type="date"
            value={task.start_date ?? ''}
            onChange={(e) => commitDate('startDate', e.target.value)}
            className="text-[11px] px-2 py-1 border rounded outline-none font-mono"
            style={inputStyle()}
            data-testid="task-detail-start"
          />
        </FieldRow>

        {/* 7 Target Date */}
        <FieldRow label="Target Date">
          <input
            type="date"
            value={task.target_date ?? ''}
            onChange={(e) => commitDate('targetDate', e.target.value)}
            className="text-[11px] px-2 py-1 border rounded outline-none font-mono"
            style={inputStyle()}
            data-testid="task-detail-target"
          />
        </FieldRow>

        {/* 8 Completed — setting the date stamps done_at AND moves the
            task to Resolved (the upsert RPC's completion_status rule
            doesn't flip status from a date, so do it client-side). */}
        <FieldRow label="Completed">
          <input
            type="date"
            value={completedValue}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (!v) {
                patch({
                  completed: null,
                  clearCompleted: true,
                  // Reopen the task — if there's no completion date,
                  // the task can't still be Resolved.
                  status: isResolved ? 'Open' : task.status,
                });
              } else {
                patch({
                  completed: v,
                  status: 'Resolved',
                });
              }
            }}
            className="text-[11px] px-2 py-1 border rounded outline-none font-mono"
            style={inputStyle()}
            data-testid="task-detail-completed"
            data-done={isResolved ? 'true' : 'false'}
          />
        </FieldRow>

        {/* 9 Notes — multiline, blur-commit */}
        <div className="flex flex-col gap-0.5">
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={commitNotes}
            rows={3}
            placeholder="—"
            className="text-[11px] px-2 py-1 border rounded outline-none resize-vertical"
            style={inputStyle()}
            data-testid="task-detail-notes"
          />
        </div>
      </div>

      <Link
        to={`/project/${task.project_id}`}
        className="text-[10px] font-display font-bold px-2.5 py-1.5 border-t text-center no-underline"
        style={{
          background: 'var(--color-s2)',
          borderTopColor: 'var(--color-border)',
          color: 'var(--color-muted)',
        }}
        data-testid="task-detail-open-project"
      >
        → Open in Project View
      </Link>
    </aside>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[8px] font-bold uppercase tracking-wide"
      style={{ color: 'var(--color-dim)' }}
    >
      {children}
    </span>
  );
}

function Pill({
  label,
  color,
  testid,
}: {
  label: string;
  color: string;
  testid: string;
}) {
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase"
      style={{
        background: color,
        color: '#fff',
      }}
      data-testid={testid}
    >
      {label}
    </span>
  );
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

function sorted(tasks: Task[], byDueDate: boolean): Task[] {
  const arr = [...tasks];
  if (byDueDate) {
    arr.sort((a, b) => {
      const ad = a.target_date ?? '￿';
      const bd = b.target_date ?? '￿';
      if (ad !== bd) return ad.localeCompare(bd);
      return a.sort_order - b.sort_order;
    });
  } else {
    arr.sort((a, b) => {
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
): Task[] {
  const q = filters.search.trim().toLowerCase();
  const wantTypes =
    filters.permitTypes.length > 0
      ? new Set(filters.permitTypes)
      : null;

  function nameMatchesAnyRoleFamily(
    name: string,
    families: Set<'ent' | 'da' | 'dm' | 'consultant'>,
  ): boolean {
    const r = rolesByName.get(name);
    if (!r) return false;
    for (const f of families) if (r.has(f)) return true;
    return false;
  }

  function taskHasAssigneeFromSet(t: Task, names: Set<string>): boolean {
    if (t.primary_assignee && names.has(t.primary_assignee)) return true;
    return t.co_assignees.some((a) => names.has(a));
  }

  const roleNameSet = new Set<string>([
    ...filters.roles.ent,
    ...filters.roles.da,
    ...filters.roles.dm,
    ...filters.roles.consultant,
  ]);

  return tasks.filter((t) => {
    if (wantTypes && t.permit_type && !wantTypes.has(t.permit_type)) {
      return false;
    }
    if (wantTypes && !t.permit_type) return false;
    if (roleNameSet.size > 0 && !taskHasAssigneeFromSet(t, roleNameSet)) {
      return false;
    }
    if (filters.quickRole !== 'all') {
      const families = new Set<'ent' | 'da' | 'dm' | 'consultant'>([
        filters.quickRole as 'ent' | 'da' | 'dm' | 'consultant',
      ]);
      const candidates = [
        ...(t.primary_assignee ? [t.primary_assignee] : []),
        ...t.co_assignees,
      ];
      if (!candidates.some((n) => nameMatchesAnyRoleFamily(n, families))) {
        return false;
      }
    }
    if (q) {
      const hay =
        `${t.text} ${t.project_address} ${t.primary_assignee ?? ''} ${t.co_assignees.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
