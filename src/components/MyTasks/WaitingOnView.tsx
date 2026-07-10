import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useWaitingOnTasks,
  groupByDisciplineThenFirm,
  type WaitingOnFirmGroup,
} from '../../hooks/useWaitingOnTasks';
import { useAllTasks } from '../../hooks/useTaskTree';
import { useScopeMode } from '../../hooks/useSelfScope';
import { taskMatchesSelf } from '../../lib/selfScope';
import ScopeToggle from '../shared/ScopeToggle';
import { exportAllToCsv, exportFirmToCsv } from '../../lib/waitingOnCsv';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import type { WaitingOnTaskRow } from '../../lib/database.types';

// fix-140: My Tasks "Waiting On" reporting view. Resolves each task's
// waiting_on discipline to the firm assigned for that discipline on the task's
// project, then groups discipline -> firm. Read-only here — the project-address
// column links to the project page for editing (per the brief).
//
// fix-236: the section now offers the SAME personal/holistic scope toggle the
// My Tasks board uses (fix-176/179). It shares the 'mytasks' persistence key +
// role-aware default with the board, so a user's Mine/All choice stays
// consistent across both sub-views. "Mine" reuses the board's EXACT ownership
// definition (taskMatchesSelf over the resolved primary + co-assignees): the
// waiting-on RPC only carries the raw assigned_to token, so ownership is
// resolved by cross-referencing each row's task_id against the full task set
// (bp_list_tasks — already cached by the board) rather than string-matching
// that token. An unmapped login (no roster name) sees the holistic view and no
// toggle, exactly as on the board.

const STATUS_BG: Record<string, string> = {
  Open: 'var(--color-s2)',
  'In Progress': 'var(--color-de)',
  Resolved: 'var(--color-pm)',
};

export default function WaitingOnView() {
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const tasksQ = useWaitingOnTasks({ includeCompleted });

  // fix-236: Mine/All scope, shared with the board (same hook, key, default).
  const { mode: scopeMode, setMode: setScopeMode, identity } =
    useScopeMode('mytasks');
  const allTasksQ = useAllTasks();
  // We only need the full task set (and only surface its load/error) when the
  // user is actually scoping to their own work; the holistic view is unaffected.
  const scoping = scopeMode === 'mine' && !!identity.name;

  // Task ids the current user owns, by the board's ownership rule (primary or
  // co-assignee). null = not scoping → show everything.
  const selfTaskIds = useMemo(() => {
    if (!scoping) return null;
    const ids = new Set<string>();
    for (const t of allTasksQ.data ?? []) {
      if (taskMatchesSelf(t, identity.name)) ids.add(t.id);
    }
    return ids;
  }, [scoping, identity.name, allTasksQ.data]);

  const rows = useMemo(() => {
    const all = tasksQ.data ?? [];
    return selfTaskIds ? all.filter((r) => selfTaskIds.has(r.task_id)) : all;
  }, [tasksQ.data, selfTaskIds]);
  const groups = useMemo(() => groupByDisciplineThenFirm(rows), [rows]);

  // Wait on the full task set too when scoping so there's no flash of an empty
  // "Mine" list before ownership resolves; surface its error the same way.
  const isLoading = tasksQ.isLoading || (scoping && allTasksQ.isLoading);
  const error = tasksQ.error ?? (scoping ? allTasksQ.error : null);

  // Collapsed disciplines — local per-visit state, default all expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggle(discipline: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(discipline)) next.delete(discipline);
      else next.add(discipline);
      return next;
    });
  }

  if (error) {
    return (
      <div className="p-3" data-testid="waiting-on-view">
        <QueryError
          title="Waiting On failed to load"
          error={error}
          onRetry={() => {
            tasksQ.refetch();
            if (scoping) allTasksQ.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3" data-testid="waiting-on-view">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-display font-bold text-text">Waiting On</h2>
          {/* fix-236: same Mine/All control as the board (hidden for unmapped
              logins, which have no roster name to scope to). */}
          <ScopeToggle
            mode={scopeMode}
            onChange={setScopeMode}
            name={identity.name}
            testid="waiting-on-scope"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={includeCompleted}
              onChange={(e) => setIncludeCompleted(e.target.checked)}
              data-testid="waiting-on-include-completed"
            />
            Include completed
          </label>
          <button
            type="button"
            onClick={() => exportAllToCsv(rows)}
            disabled={rows.length === 0}
            className="text-[11px] px-2 py-1 rounded border disabled:opacity-50"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            data-testid="waiting-on-csv-all"
          >
            ↓ Export all CSV
          </button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonRows count={4} rowClassName="h-10" />
      ) : groups.length === 0 ? (
        <div
          className="text-center px-4 py-10 rounded border"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-s2)' }}
          data-testid="waiting-on-empty"
        >
          <div className="text-[13px] font-bold text-text">
            No tasks are waiting on external teams right now.
          </div>
          <div className="text-[11px] text-muted mt-1">
            Set a task's "Waiting On" field to surface it here.
          </div>
        </div>
      ) : (
        groups.map((group) => {
          const isCollapsed = collapsed.has(group.discipline);
          return (
            <div
              key={group.discipline}
              className="rounded border"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid={`waiting-on-discipline-${group.discipline}`}
            >
              <button
                type="button"
                onClick={() => toggle(group.discipline)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
                style={{ background: 'var(--color-s2)' }}
                data-testid={`waiting-on-discipline-${group.discipline}-header`}
                aria-expanded={!isCollapsed}
              >
                <span className="text-[10px] text-dim w-3">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span className="text-[12px] font-display font-bold text-text">
                  {group.discipline}
                </span>
                <span className="text-[11px] text-muted">
                  ({group.totalTasks} {group.totalTasks === 1 ? 'task' : 'tasks'})
                </span>
              </button>

              {!isCollapsed && (
                <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {group.firms.map((firm) => (
                    <FirmSection
                      key={firm.firmId ?? 'none'}
                      discipline={group.discipline}
                      firm={firm}
                      allRows={rows}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function FirmSection({
  discipline,
  firm,
  allRows,
}: {
  discipline: string;
  firm: WaitingOnFirmGroup;
  allRows: WaitingOnTaskRow[];
}) {
  const idKey = firm.firmId ?? 'none';
  const count = firm.tasks.length;
  return (
    <div data-testid={`waiting-on-firm-${idKey}`}>
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ background: 'var(--color-bg)' }}
      >
        <span className="text-[11px] font-bold text-text">
          {firm.firmId === null ? '(no firm assigned)' : firm.firmName}
        </span>
        {firm.firmId !== null && !firm.firmActive && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
            style={{ background: 'var(--color-co-bg)', color: 'var(--color-co)' }}
            data-testid={`waiting-on-firm-${idKey}-archived`}
          >
            archived
          </span>
        )}
        <span className="text-[10px] text-muted">
          ({count} {count === 1 ? 'task' : 'tasks'})
        </span>
        {firm.firmId !== null && (
          <button
            type="button"
            onClick={() => exportFirmToCsv(allRows, { discipline, firmId: firm.firmId })}
            className="ml-auto text-[10px] px-1.5 py-0.5 rounded border"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            data-testid={`waiting-on-csv-firm-${idKey}`}
          >
            ↓ Export CSV
          </button>
        )}
      </div>

      <table className="w-full text-[11px]">
        <tbody>
          {firm.tasks.map((task) => (
            <tr
              key={task.task_id}
              className="border-t"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid={`waiting-on-task-${task.task_id}`}
            >
              <td className="px-3 py-1.5 align-top">
                <Link
                  to={`/project/${task.project_id}`}
                  className="font-bold text-de hover:underline"
                  data-testid={`waiting-on-task-${task.task_id}-project`}
                >
                  {task.project_address ?? '(no address)'}
                </Link>
              </td>
              <td className="px-2 py-1.5 align-top">
                {task.permit_type && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
                    style={{ background: 'var(--color-s2)', color: 'var(--color-text)' }}
                  >
                    {task.permit_type}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 align-top text-text">{task.task_text}</td>
              <td className="px-2 py-1.5 align-top text-muted whitespace-nowrap">
                {task.assigned_to ?? '—'}
              </td>
              <td className="px-2 py-1.5 align-top text-muted whitespace-nowrap">
                {task.due_date ?? '—'}
              </td>
              <td className="px-2 py-1.5 align-top text-center">
                {task.priority ? (
                  <span style={{ color: 'var(--color-co)' }} title="Priority">
                    ★
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-1.5 align-top text-right">
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap"
                  style={{
                    background: STATUS_BG[task.completion_status ?? 'Open'] ?? 'var(--color-s2)',
                    color: 'var(--color-text)',
                  }}
                >
                  {task.completion_status === 'Open'
                    ? 'Not Started'
                    : task.completion_status ?? 'Not Started'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
