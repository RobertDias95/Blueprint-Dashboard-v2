import { useMemo, useState } from 'react';
import { useAllPermitTasks } from '../hooks/useAllPermitTasks';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import {
  assignedToOptions,
  computeStats,
  daOptions,
  dmOptions,
  entLeadOptions,
  externalConsultantOptions,
  filterTasks,
  type FilterContext,
  type TaskFilters,
} from '../lib/myTasksHelpers';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import StatsRow from '../components/MyTasks/StatsRow';
import TaskColumn from '../components/MyTasks/TaskColumn';
import FilterBar from '../components/MyTasks/FilterBar';
import TaskDetailPanel from '../components/MyTasks/TaskDetailPanel';
import type {
  PermitTask,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// Q7.1.b: read-only view shell.
// Q7.1.c: filter state lifted here + FilterBar mounted; selected-task
// state managed at page level so inline date editors only render for
// one card at a time.

const DEFAULT_FILTERS: TaskFilters = {
  stage: 'all',
  status: 'active',
  assignee: '',
  search: '',
  // Q9.5.f-fix-2 C: new multi-select dimensions default to empty (no filter).
  entLeads: new Set<string>(),
  das: new Set<string>(),
  dms: new Set<string>(),
  externalConsultants: new Set<string>(),
};

export default function MyTasks() {
  const tasksQ = useAllPermitTasks();
  const permitsQ = usePermits();
  const projectsQ = useProjects();

  const error = tasksQ.error ?? permitsQ.error ?? projectsQ.error;
  if (error) {
    return (
      <QueryError
        title="My Tasks failed to load"
        error={error}
        onRetry={() => {
          tasksQ.refetch();
          permitsQ.refetch();
          projectsQ.refetch();
        }}
      />
    );
  }
  if (tasksQ.isLoading || permitsQ.isLoading || projectsQ.isLoading) {
    return <SkeletonRows count={8} rowClassName="h-12" />;
  }

  return (
    <Body
      tasks={tasksQ.data ?? []}
      permits={permitsQ.data ?? []}
      projects={projectsQ.data ?? []}
    />
  );
}

interface BodyProps {
  tasks: PermitTask[];
  permits: PermitWithCycles[];
  projects: Project[];
}

function Body({ tasks, permits, projects }: BodyProps) {
  const today = useMemo(() => new Date(), []);
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const ctx: FilterContext = useMemo(
    () => ({
      permitsById: new Map(permits.map((p) => [p.id, p])),
      projectsById: new Map(projects.map((p) => [p.id, p])),
    }),
    [permits, projects],
  );

  // Dropdown options come from the FULL task set (so the dropdown doesn't
  // mysteriously shrink as the user narrows filters and assignees fall out).
  const assigneeChoices = useMemo(
    () => assignedToOptions(tasks),
    [tasks],
  );
  // Q9.5.f-fix-2 C: person/consultant option lists from the linked permits
  // and the full task set. Same "from the unfiltered data" rule.
  const entChoices = useMemo(() => entLeadOptions(permits), [permits]);
  const daChoices = useMemo(() => daOptions(permits), [permits]);
  const dmChoices = useMemo(() => dmOptions(permits), [permits]);
  const consultantChoices = useMemo(
    () => externalConsultantOptions(tasks),
    [tasks],
  );

  const filtered = useMemo(
    () => filterTasks(tasks, filters, ctx),
    [tasks, filters, ctx],
  );

  const stats = useMemo(
    () => computeStats(filtered, ctx, today),
    [filtered, ctx, today],
  );

  const { deTasks, coTasks } = useMemo(() => {
    const de: PermitTask[] = [];
    const co: PermitTask[] = [];
    for (const t of filtered) {
      if (t.bucket === 'de') de.push(t);
      else if (t.bucket === 'co') co.push(t);
    }
    return { deTasks: de, coTasks: co };
  }, [filtered]);

  function updateFilter<K extends keyof TaskFilters>(
    key: K,
    value: TaskFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setSelectedTaskId(null); // narrowing the set should drop selection
  }
  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setSelectedTaskId(null);
  }

  return (
    <div className="space-y-4" data-testid="mytasks-page">
      <FilterBar
        filters={filters}
        onChange={updateFilter}
        onClear={clearFilters}
        assigneeOptions={assigneeChoices}
        entLeadOpts={entChoices}
        daOpts={daChoices}
        dmOpts={dmChoices}
        externalConsultantOpts={consultantChoices}
        resultCount={filtered.length}
      />
      <StatsRow stats={stats} />
      {/* Q9.5.f Item 5: 3-pane layout — D&E | Permitting | Task Detail (280px).
          The detail panel reads selectedTaskId and renders the picked task's
          full context (mirrors v1 index.html:976-982). Empty state shows
          "Click a task to view details" until a row is clicked. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_280px] gap-4">
        <TaskColumn
          // Q7.1.c: key on filters.status remounts the column when the
          // user changes status. That re-initializes the Completed
          // collapse state to defaultCompletedOpen — cleaner than syncing
          // via useEffect.
          key={`de-${filters.status}`}
          stage="de"
          tasks={deTasks}
          ctx={ctx}
          today={today}
          selectedTaskId={selectedTaskId}
          onSelect={setSelectedTaskId}
          defaultCompletedOpen={
            filters.status === 'done' || filters.status === 'all'
          }
        />
        <TaskColumn
          key={`co-${filters.status}`}
          stage="co"
          tasks={coTasks}
          ctx={ctx}
          today={today}
          selectedTaskId={selectedTaskId}
          onSelect={setSelectedTaskId}
          defaultCompletedOpen={
            filters.status === 'done' || filters.status === 'all'
          }
        />
        <TaskDetailPanel
          task={
            selectedTaskId
              ? filtered.find((t) => t.id === selectedTaskId) ?? null
              : null
          }
          ctx={ctx}
          assigneeOptions={assigneeChoices}
        />
      </div>
    </div>
  );
}
