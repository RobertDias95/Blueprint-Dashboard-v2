import { useState } from 'react';
import {
  deriveTaskState,
  sortTasksForColumn,
  type FilterContext,
} from '../../lib/myTasksHelpers';
import type { PermitTask } from '../../lib/database.types';
import TaskCard from './TaskCard';

// Q7.1.b: one stage column (DE or CO). Internal layout splits non-done
// tasks into Not Started + In Progress side-by-side sub-columns (matches
// v1 layout at index.html line 5041), with a collapsible Completed
// section below. Each sub-column sorts independently.

const STAGE_LABEL: Record<'de' | 'co', string> = {
  de: 'D&E',
  co: 'Corrections',
};

interface Props {
  stage: 'de' | 'co';
  tasks: PermitTask[];
  ctx: FilterContext;
  today: Date;
  /** Q7.1.c: selected task id (page-level state). Null when nothing selected. */
  selectedTaskId?: string | null;
  /** Q7.1.c: select handler. Passes null to deselect. */
  onSelect?: (taskId: string | null) => void;
  /** Q7.1.c: when true, the Completed collapse starts expanded. Used when
   * the page-level status filter is 'done' or 'all' — the user explicitly
   * asked to see done tasks, so hiding them behind a collapse is wrong. */
  defaultCompletedOpen?: boolean;
}

export default function TaskColumn({
  stage,
  tasks,
  ctx,
  today,
  selectedTaskId = null,
  onSelect = () => {},
  defaultCompletedOpen = false,
}: Props) {
  // Q7.1.c: initial state honors defaultCompletedOpen; the parent uses a
  // key prop to remount when the status filter changes, so this state
  // re-initializes to the new intent (avoids setState-in-effect lint).
  const [doneOpen, setDoneOpen] = useState(defaultCompletedOpen);

  const notStarted = sortTasksForColumn(
    tasks.filter((t) => deriveTaskState(t) === 'not-started'),
  );
  const inProgress = sortTasksForColumn(
    tasks.filter((t) => deriveTaskState(t) === 'in-progress'),
  );
  const completed = tasks.filter((t) => deriveTaskState(t) === 'complete');
  const openCount = notStarted.length + inProgress.length;

  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-testid={`mytasks-col-${stage}`}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-s2 border-b border-border">
        <span className="text-xs font-display font-extrabold uppercase tracking-wide text-text">
          {STAGE_LABEL[stage]}
        </span>
        <span
          className="text-[11px] text-dim font-mono"
          data-testid={`mytasks-col-${stage}-count`}
        >
          {openCount} open
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-dim italic">
          No {STAGE_LABEL[stage]} tasks
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 border-b border-border">
            <div className="border-r border-border">
              <SubHeader label="Not Started" count={notStarted.length} tone="dim" />
              {notStarted.length === 0 ? (
                <Empty>Nothing queued</Empty>
              ) : (
                notStarted.map((t) => (
                  <TaskCard
                  key={t.id}
                  task={t}
                  ctx={ctx}
                  today={today}
                  selected={selectedTaskId === t.id}
                  onSelect={onSelect}
                />
                ))
              )}
            </div>
            <div>
              <SubHeader label="◐ In Progress" count={inProgress.length} tone="de" />
              {inProgress.length === 0 ? (
                <Empty>None active</Empty>
              ) : (
                inProgress.map((t) => (
                  <TaskCard
                  key={t.id}
                  task={t}
                  ctx={ctx}
                  today={today}
                  selected={selectedTaskId === t.id}
                  onSelect={onSelect}
                />
                ))
              )}
            </div>
          </div>

          {completed.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setDoneOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-s2 border-b border-border text-left"
                data-testid={`mytasks-col-${stage}-done-toggle`}
              >
                <span
                  className="text-[10px] text-dim inline-block transition-transform"
                  style={{
                    transform: doneOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}
                >
                  ▶
                </span>
                <span className="text-[10px] text-muted uppercase tracking-wide">
                  Completed
                </span>
                <span className="text-[11px] font-bold text-pm ml-auto">
                  {completed.length}
                </span>
              </button>
              {doneOpen && (
                <div className="opacity-70" data-testid={`mytasks-col-${stage}-done-list`}>
                  {completed.map((t) => (
                    <TaskCard
                  key={t.id}
                  task={t}
                  ctx={ctx}
                  today={today}
                  selected={selectedTaskId === t.id}
                  onSelect={onSelect}
                />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SubHeader({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'de' | 'dim';
}) {
  const cls =
    tone === 'de'
      ? 'bg-de-bg border-b-de-border text-de'
      : 'bg-s2 border-b-border text-dim';
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 border-b ${cls}`}
    >
      <span className="text-[9px] uppercase tracking-wide font-bold">{label}</span>
      <span className="text-[11px] font-bold ml-auto">{count}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-4 text-center text-[11px] text-dim opacity-60">
      {children}
    </div>
  );
}
