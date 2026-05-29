import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useAllTasks, resolveUserName } from '../hooks/useTaskTree';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import type { MyTaskNode } from '../lib/database.types';

// fix-78: My Tasks reverts to v1's "show all tenant tasks + filter to narrow"
// model. fix-70 had walled it down to "primary OR co-assigned" per Bobby's
// spec at the time; that broke his manager workflows (find every Open
// Corrections, every task on project X, every task assigned to Miles). The
// page name "My Tasks" stays (the nav slot is fine); the contract is now
// "filter to make it personal", with an Assignee=Me chip preset for the
// personal-scope shortcut.
//
// The no-identity wall (fix-70's "couldn't match your sign-in email" empty
// state) is gone — even unmapped users see the full list. Email-mapping for
// the Me preset stays useful but is no longer a wall.

const DISCIPLINE_LABEL: Record<'arch' | 'ent', string> = {
  arch: 'Architecture',
  ent: 'Entitlements',
};

const STATUS_BG: Record<string, string> = {
  Open: 'var(--color-s2)',
  'In Progress': 'var(--color-de)',
  Resolved: 'var(--color-pm)',
};

type DisciplineFilter = 'all' | 'arch' | 'ent';
type StatusFilter = 'all' | 'open_in_progress' | 'Open' | 'In Progress' | 'Resolved';

interface FilterState {
  /** Empty array = no assignee filter ("show all"). */
  assignees: string[];
  /** Special preset for the signed-in user; mapped to userName at render. */
  meSelected: boolean;
  discipline: DisciplineFilter;
  status: StatusFilter;
  /** Substring match against project address (case-insensitive). */
  projectQuery: string;
  /** Substring match against task text (the "title contains" filter). */
  titleQuery: string;
}

const FILTER_STORAGE_KEY = 'mytasks.filters.v1';

const DEFAULT_FILTERS: FilterState = {
  assignees: [],
  meSelected: false,
  discipline: 'all',
  status: 'open_in_progress',
  projectQuery: '',
  titleQuery: '',
};

function loadFilters(): FilterState {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterState> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_FILTERS;
    return {
      ...DEFAULT_FILTERS,
      ...parsed,
      // Defensive: a stored array of strings is required for assignees.
      assignees: Array.isArray(parsed.assignees)
        ? parsed.assignees.filter((a): a is string => typeof a === 'string')
        : [],
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export default function MyTasks() {
  const email = useAuthStore((s) => s.user?.email ?? null);
  const team = useTeamMembers();
  const userName = useMemo(
    () => resolveUserName(email, team.all),
    [email, team.all],
  );
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
      tasks={tasksQ.data ?? []}
      teamNames={team.all.map((m) => m.name).sort((a, b) => a.localeCompare(b))}
      userName={userName}
    />
  );
}

interface PermitGroup {
  permitId: number;
  permitType: string | null;
  projectId: string;
  byDiscipline: Record<'arch' | 'ent', MyTaskNode[]>;
}
interface ProjectGroup {
  projectId: string;
  address: string;
  permits: PermitGroup[];
}

function Body({
  tasks,
  teamNames,
  userName,
}: {
  tasks: MyTaskNode[];
  teamNames: string[];
  userName: string;
}) {
  const [filters, setFilters] = useState<FilterState>(() => loadFilters());

  // Persist filters across reloads (no churn from defaults — also avoids a
  // first-render write before the user has touched anything).
  useEffect(() => {
    try {
      window.localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify(filters),
      );
    } catch {
      // localStorage unavailable (private mode, quota) — silently skip.
    }
  }, [filters]);

  function patch(p: Partial<FilterState>) {
    setFilters((f) => ({ ...f, ...p }));
  }
  function resetAll() {
    setFilters(DEFAULT_FILTERS);
  }

  const filtered = useMemo(
    () => filterTasks(tasks, filters, userName),
    [tasks, filters, userName],
  );
  // Subtask nesting is over the FILTERED set: a parent that filtered out
  // doesn't pull its children along.
  const filteredIds = useMemo(
    () => new Set(filtered.map((t) => t.id)),
    [filtered],
  );
  const childrenByParent = useMemo(() => {
    const m = new Map<string, MyTaskNode[]>();
    for (const t of filtered) {
      if (t.parent_task_id && filteredIds.has(t.parent_task_id)) {
        const list = m.get(t.parent_task_id) ?? [];
        list.push(t);
        m.set(t.parent_task_id, list);
      }
    }
    return m;
  }, [filtered, filteredIds]);
  const topLevel = useMemo(
    () =>
      filtered.filter(
        (t) => !t.parent_task_id || !filteredIds.has(t.parent_task_id),
      ),
    [filtered, filteredIds],
  );
  const groups = useMemo(() => groupTasks(topLevel), [topLevel]);

  return (
    <div className="space-y-4 p-4" data-testid="mytasks-page">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-bold">My Tasks</h1>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {tasks.length} total · {filtered.length} match
          {filtered.length === 1 ? '' : 'es'}
        </span>
      </div>

      <FilterBar
        filters={filters}
        teamNames={teamNames}
        userName={userName}
        onPatch={patch}
        onReset={resetAll}
      />

      {groups.length === 0 ? (
        <div
          className="text-sm italic"
          style={{ color: 'var(--color-muted)' }}
          data-testid="mytasks-empty"
        >
          No tasks match your filters.
        </div>
      ) : (
        groups.map((proj) => (
          <div
            key={proj.projectId}
            className="rounded border"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`mytasks-project-${proj.projectId}`}
          >
            <div
              className="px-3 py-2 text-sm font-bold border-b"
              style={{
                borderBottomColor: 'var(--color-border)',
                background: 'var(--color-s2)',
              }}
            >
              <Link
                to={`/project/${proj.projectId}`}
                className="hover:underline"
                style={{ color: 'var(--color-text)' }}
              >
                {proj.address}
              </Link>
            </div>
            {proj.permits.map((permit) => (
              <div
                key={permit.permitId}
                className="px-3 py-2 border-b last:border-b-0"
                style={{ borderBottomColor: 'var(--color-border)' }}
              >
                <div
                  className="text-[11px] font-bold uppercase tracking-wide mb-1"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {permit.permitType ?? 'Permit'}
                </div>
                {(['ent', 'arch'] as const).map((disc) => {
                  const list = permit.byDiscipline[disc];
                  if (list.length === 0) return null;
                  return (
                    <div key={disc} className="mb-2 last:mb-0">
                      <div
                        className="text-[10px] font-bold"
                        style={{ color: 'var(--color-de)' }}
                      >
                        {DISCIPLINE_LABEL[disc]}
                      </div>
                      {list.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          subtasks={childrenByParent.get(t.id) ?? []}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function FilterBar({
  filters,
  teamNames,
  userName,
  onPatch,
  onReset,
}: {
  filters: FilterState;
  teamNames: string[];
  userName: string;
  onPatch: (p: Partial<FilterState>) => void;
  onReset: () => void;
}) {
  const meDisabled = !userName;
  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2 rounded border"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-s2)' }}
      data-testid="mytasks-filterbar"
    >
      {/* Assignee preset chips */}
      <button
        type="button"
        onClick={() => onPatch({ meSelected: false, assignees: [] })}
        className="text-[11px] px-2 py-1 rounded border"
        style={presetStyle(!filters.meSelected && filters.assignees.length === 0)}
        data-testid="mytasks-filter-preset-all"
      >
        All
      </button>
      <button
        type="button"
        onClick={() => onPatch({ meSelected: true, assignees: [] })}
        disabled={meDisabled}
        title={
          meDisabled
            ? 'Set your email on Settings → Team to use the Me preset'
            : undefined
        }
        className="text-[11px] px-2 py-1 rounded border disabled:opacity-50"
        style={presetStyle(filters.meSelected)}
        data-testid="mytasks-filter-preset-me"
      >
        Me{userName ? ` (${userName})` : ''}
      </button>
      {/* Assignee multi-select dropdown — adds chips below */}
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          if (filters.assignees.includes(v)) return;
          onPatch({
            meSelected: false,
            assignees: [...filters.assignees, v],
          });
          e.currentTarget.value = '';
        }}
        className="text-[11px] px-2 py-1 border rounded"
        style={selectStyle()}
        data-testid="mytasks-filter-assignee-select"
      >
        <option value="">+ Assignee</option>
        {teamNames
          .filter((n) => !filters.assignees.includes(n))
          .map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
      </select>
      {filters.assignees.map((n) => (
        <span
          key={n}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
          style={chipStyle()}
          data-testid={`mytasks-filter-assignee-chip-${n}`}
        >
          {n}
          <button
            type="button"
            onClick={() =>
              onPatch({
                assignees: filters.assignees.filter((a) => a !== n),
              })
            }
            className="text-dim hover:text-text leading-none"
            title={`Remove ${n}`}
            data-testid={`mytasks-filter-assignee-remove-${n}`}
          >
            ×
          </button>
        </span>
      ))}

      <Divider />

      {/* Discipline segmented control */}
      {(['all', 'arch', 'ent'] as const).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onPatch({ discipline: d })}
          className="text-[11px] px-2 py-1 rounded border"
          style={presetStyle(filters.discipline === d)}
          data-testid={`mytasks-filter-discipline-${d}`}
        >
          {d === 'all' ? 'All' : d === 'arch' ? 'Architecture' : 'ENT'}
        </button>
      ))}

      <Divider />

      {/* Status segmented control */}
      {(
        ['open_in_progress', 'Open', 'In Progress', 'Resolved', 'all'] as const
      ).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPatch({ status: s })}
          className="text-[11px] px-2 py-1 rounded border"
          style={presetStyle(filters.status === s)}
          data-testid={`mytasks-filter-status-${s.replace(/\s+/g, '_')}`}
        >
          {s === 'open_in_progress'
            ? 'Open + In Progress'
            : s === 'all'
              ? 'All statuses'
              : s}
        </button>
      ))}

      <Divider />

      <input
        type="text"
        value={filters.projectQuery}
        onChange={(e) => onPatch({ projectQuery: e.target.value })}
        placeholder="Project address…"
        className="text-[11px] px-2 py-1 border rounded"
        style={inputStyle()}
        data-testid="mytasks-filter-project"
      />
      <input
        type="text"
        value={filters.titleQuery}
        onChange={(e) => onPatch({ titleQuery: e.target.value })}
        placeholder="Title contains…"
        className="text-[11px] px-2 py-1 border rounded"
        style={inputStyle()}
        data-testid="mytasks-filter-title"
      />
      <button
        type="button"
        onClick={onReset}
        className="text-[11px] px-2 py-1 rounded border ml-auto"
        style={presetStyle(false)}
        data-testid="mytasks-filter-reset"
      >
        Reset
      </button>
    </div>
  );
}

function Divider() {
  return (
    <span
      style={{
        width: 1,
        height: 16,
        background: 'var(--color-border)',
        margin: '0 4px',
      }}
    />
  );
}

function presetStyle(active: boolean) {
  return {
    borderColor: active ? 'var(--color-de)' : 'var(--color-border)',
    background: active ? 'var(--color-de)' : 'var(--color-bg)',
    color: active ? '#fff' : 'var(--color-text)',
  };
}
function selectStyle() {
  return {
    borderColor: 'var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  };
}
function inputStyle() {
  return {
    borderColor: 'var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  };
}
function chipStyle() {
  return {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };
}

function TaskRow({
  task,
  subtasks,
  isSub,
}: {
  task: MyTaskNode;
  subtasks?: MyTaskNode[];
  isSub?: boolean;
}) {
  const assignees = [
    ...(task.primary_assignee ? [task.primary_assignee] : []),
    ...task.co_assignees,
  ];
  return (
    <div
      className="py-1"
      style={isSub ? { paddingLeft: 16 } : undefined}
      data-testid={`mytask-row-${task.id}`}
    >
      <div className="flex items-center gap-2 text-[12px]">
        <span
          className="px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{
            background: STATUS_BG[task.status] ?? 'var(--color-s2)',
            color: 'var(--color-text)',
          }}
          data-testid={`mytask-status-${task.id}`}
        >
          {task.status}
        </span>
        <span
          style={{
            flex: 1,
            textDecoration: task.status === 'Resolved' ? 'line-through' : 'none',
            opacity: task.status === 'Resolved' ? 0.6 : 1,
          }}
        >
          {task.text}
        </span>
        {task.target_date && (
          <span
            className="text-[10px]"
            style={{ color: 'var(--color-muted)' }}
            data-testid={`mytask-target-${task.id}`}
          >
            🎯 {task.target_date}
          </span>
        )}
      </div>
      {assignees.length > 0 && (
        <div
          className="text-[10px] mt-0.5"
          style={{ color: 'var(--color-muted)' }}
          data-testid={`mytask-assignees-${task.id}`}
        >
          {assignees.join(', ')}
        </div>
      )}
      {(subtasks ?? []).map((s) => (
        <TaskRow key={s.id} task={s} isSub />
      ))}
    </div>
  );
}

/** Apply filter chips to the full task set. Exported for testability through
 *  the page render; not exported as a module symbol. */
function filterTasks(
  tasks: MyTaskNode[],
  filters: FilterState,
  userName: string,
): MyTaskNode[] {
  const wantStatus =
    filters.status === 'all'
      ? null
      : filters.status === 'open_in_progress'
        ? new Set<MyTaskNode['status']>(['Open', 'In Progress'])
        : new Set<MyTaskNode['status']>([filters.status]);
  // Assignee match: Me preset → match userName as primary OR co-assignee.
  // Explicit chips → each chip as primary OR co-assignee. Falls through to
  // "no assignee filter" when neither is set.
  const wantNames =
    filters.meSelected && userName
      ? new Set<string>([userName])
      : filters.assignees.length > 0
        ? new Set<string>(filters.assignees)
        : null;
  const projQuery = filters.projectQuery.trim().toLowerCase();
  const titleQuery = filters.titleQuery.trim().toLowerCase();

  return tasks.filter((t) => {
    if (
      filters.discipline !== 'all' &&
      t.discipline !== filters.discipline
    ) {
      return false;
    }
    if (wantStatus && !wantStatus.has(t.status)) return false;
    if (wantNames) {
      const hit =
        (t.primary_assignee && wantNames.has(t.primary_assignee)) ||
        t.co_assignees.some((a) => wantNames.has(a));
      if (!hit) return false;
    }
    if (projQuery && !t.project_address.toLowerCase().includes(projQuery)) {
      return false;
    }
    if (titleQuery && !t.text.toLowerCase().includes(titleQuery)) {
      return false;
    }
    return true;
  });
}

function groupTasks(tasks: MyTaskNode[]): ProjectGroup[] {
  const projects = new Map<string, ProjectGroup>();
  for (const t of tasks) {
    let proj = projects.get(t.project_id);
    if (!proj) {
      proj = {
        projectId: t.project_id,
        address: t.project_address,
        permits: [],
      };
      projects.set(t.project_id, proj);
    }
    let permit = proj.permits.find((p) => p.permitId === t.permit_id);
    if (!permit) {
      permit = {
        permitId: t.permit_id,
        permitType: t.permit_type,
        projectId: t.project_id,
        byDiscipline: { arch: [], ent: [] },
      };
      proj.permits.push(permit);
    }
    permit.byDiscipline[t.discipline].push(t);
  }
  const out = [...projects.values()].sort((a, b) =>
    a.address.localeCompare(b.address),
  );
  for (const p of out) p.permits.sort((a, b) => a.permitId - b.permitId);
  return out;
}
