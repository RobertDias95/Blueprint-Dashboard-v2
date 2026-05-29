import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useMyTasks, resolveUserName } from '../hooks/useTaskTree';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import type { MyTaskNode } from '../lib/database.types';

// fix-70: My Tasks rebuilt on bp_my_tasks. The page shows ONLY tasks where the
// signed-in user is the implicit primary (bucket-scoped: arch -> permit.da,
// ent -> permit.ent_lead) OR an explicit co-assignee. Being the DA does not
// surface a permit's ENT tasks — that's enforced server-side in bp_my_tasks.
//
// The caller's display name (the string that matches permits.da / ent_lead) is
// resolved from the team_members roster by matching the auth email.

const DISCIPLINE_LABEL: Record<'arch' | 'ent', string> = {
  arch: 'Architecture',
  ent: 'Entitlements',
};

const STATUS_BG: Record<string, string> = {
  Open: 'var(--color-s2)',
  'In Progress': 'var(--color-de)',
  Resolved: 'var(--color-pm)',
};

export default function MyTasks() {
  const email = useAuthStore((s) => s.user?.email ?? null);
  const team = useTeamMembers();
  const userName = useMemo(
    () => resolveUserName(email, team.all),
    [email, team.all],
  );
  const tasksQ = useMyTasks(userName);

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
  if (team.isLoading || (userName && tasksQ.isLoading)) {
    return <SkeletonRows count={6} rowClassName="h-12" />;
  }

  if (!userName) {
    return (
      <div className="p-6 text-sm" data-testid="mytasks-no-identity">
        <h1 className="text-lg font-bold mb-2">My Tasks</h1>
        <p style={{ color: 'var(--color-muted)' }}>
          We couldn&apos;t match your sign-in email to a team member, so we
          can&apos;t tell which tasks are yours. Ask an admin to set your email
          on your team roster entry (Settings → Team).
        </p>
      </div>
    );
  }

  return <Body userName={userName} tasks={tasksQ.data ?? []} />;
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

function Body({ userName, tasks }: { userName: string; tasks: MyTaskNode[] }) {
  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const childrenByParent = useMemo(() => {
    const m = new Map<string, MyTaskNode[]>();
    for (const t of tasks) {
      if (t.parent_task_id) {
        const list = m.get(t.parent_task_id) ?? [];
        list.push(t);
        m.set(t.parent_task_id, list);
      }
    }
    return m;
  }, [tasks]);

  return (
    <div className="space-y-4 p-4" data-testid="mytasks-page">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-bold">My Tasks</h1>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {userName} · {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
      </div>

      {groups.length === 0 ? (
        <div
          className="text-sm italic"
          style={{ color: 'var(--color-muted)' }}
          data-testid="mytasks-empty"
        >
          Nothing assigned to you right now.
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
                  const list = permit.byDiscipline[disc].filter(
                    (t) => !t.parent_task_id || !hasParentInSet(t, tasks),
                  );
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

function hasParentInSet(task: MyTaskNode, all: MyTaskNode[]): boolean {
  if (!task.parent_task_id) return false;
  return all.some((t) => t.id === task.parent_task_id);
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
  // Stable order: by address, then permit id.
  const out = [...projects.values()].sort((a, b) =>
    a.address.localeCompare(b.address),
  );
  for (const p of out) p.permits.sort((a, b) => a.permitId - b.permitId);
  return out;
}
