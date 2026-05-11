import { useMemo } from 'react';
import { useAllPermitTasks } from '../hooks/useAllPermitTasks';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import {
  computeStats,
  filterTasks,
  type FilterContext,
  type TaskFilters,
} from '../lib/myTasksHelpers';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import StatsRow from '../components/MyTasks/StatsRow';
import TaskColumn from '../components/MyTasks/TaskColumn';

// Q7.1.b: My Tasks view shell. Read-only against the data layer shipped
// in Q7.1.a. Filter UI + inline edits land in Q7.1.c.
//
// Defaults match v1's initial state on load:
//   stage='all', status='active' (hides done tasks), assignee='',
//   search=''. The UI controls to change them ship in Q7.1.c.

const DEFAULT_FILTERS: TaskFilters = {
  stage: 'all',
  status: 'active',
  assignee: '',
  search: '',
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

function Body({
  tasks,
  permits,
  projects,
}: {
  tasks: ReturnType<typeof useAllPermitTasks>['data'] extends infer T
    ? T extends Array<infer U>
      ? U[]
      : never
    : never;
  permits: ReturnType<typeof usePermits>['data'] extends infer T
    ? T extends Array<infer U>
      ? U[]
      : never
    : never;
  projects: ReturnType<typeof useProjects>['data'] extends infer T
    ? T extends Array<infer U>
      ? U[]
      : never
    : never;
}) {
  const today = useMemo(() => new Date(), []);

  const ctx: FilterContext = useMemo(
    () => ({
      permitsById: new Map(permits.map((p) => [p.id, p])),
      projectsById: new Map(projects.map((p) => [p.id, p])),
    }),
    [permits, projects],
  );

  const filtered = useMemo(
    () => filterTasks(tasks, DEFAULT_FILTERS, ctx),
    [tasks, ctx],
  );

  const stats = useMemo(
    () => computeStats(filtered, ctx, today),
    [filtered, ctx, today],
  );

  // Split filtered tasks into the two stage columns. PM has already been
  // dropped by filterTasks.
  const { deTasks, coTasks } = useMemo(() => {
    const de: typeof filtered = [];
    const co: typeof filtered = [];
    for (const t of filtered) {
      if (t.bucket === 'de') de.push(t);
      else if (t.bucket === 'co') co.push(t);
    }
    return { deTasks: de, coTasks: co };
  }, [filtered]);

  return (
    <div className="space-y-4" data-testid="mytasks-page">
      <StatsRow stats={stats} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TaskColumn stage="de" tasks={deTasks} ctx={ctx} today={today} />
        <TaskColumn stage="co" tasks={coTasks} ctx={ctx} today={today} />
      </div>
    </div>
  );
}
