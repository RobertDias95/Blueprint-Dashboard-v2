import { useCallback, useMemo, useState } from 'react';
import MyBoard from './MyBoard';
import MyTasks from './MyTasks';
import { useAuthStore } from '../stores/authStore';
import { useAllTasks } from '../hooks/useTaskTree';
import { useTaskOwnership } from '../hooks/useTaskOwnership';
import { useSelfScope } from '../hooks/useSelfScope';
import {
  useAllProjectHolds,
  cancelledProjectIds,
} from '../hooks/useProjectHolds';
import { isTaskCancelled, isTaskOverdue } from '../lib/taskStatus';
import {
  BOARD_TASKS_KEY,
  defaultBoardCollapsed,
  loadBoardCollapsed,
  saveBoardCollapsed,
  toggleCollapsedKey,
} from '../lib/boardPanelPrefs';

// fix-318 merged My Board and My Tasks onto one screen with a draggable 45/55
// split. ★ fix-326 REPLACES that split, because the merge answered "both on one
// screen" and Bobby's next look answered which one is the screen:
//
//   "The my board section just seems very clustered and very congested. I think
//    the primary focus should be the my board, and then the my task should be
//    expandable and collapsible. My board covers portions of my tasks and
//    everything else and provides that project queue, and my task is something
//    they could dive into if and need be. So the primary focus is my board and
//    then my task expands, and then the screen maybe shifts down."
//
//   ┌──────────────────────────────────────────┐
//   │  MY BOARD              takes the screen  │
//   ├──────────────────────────────────────────┤
//   │  ▸ MY TASKS   N open · N overdue         │ ← a bar. Folded by default.
//   └──────────────────────────────────────────┘
//
// ★ THE DRAGGABLE DIVIDER IS GONE, and `boardSplitPrefs` with it. It existed to
// referee two panels competing for one screen; with My Board taking the space
// and My Tasks folded away there is no competition to referee, and a drag handle
// that only appears in one of two states is furniture that has to be explained.
// Expanded, My Tasks takes a fixed generous share and My Board keeps the rest —
// "the screen shifts down" — which is the behaviour without the handle.
//
// ─── what survives from fix-318 ───────────────────────────────────────────
// ★ ONE QUERY. Both halves read `useAllTasks`, so ticking a task in either
// updates the other in the same render. The bar's counts come from that same
// query, so a tick moves the count too, with nothing to keep in step.
// ★ The PAGE never scrolls; the regions do.
// ★ MyTasks.tsx is MOUNTED, NOT REWRITTEN — and since fix-325 that is the full
// shell, with the Mine / Waiting On switcher inside it.

export default function PersonalBoard() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  // Read in the lazy initialiser, write in the handler — no effects. An effect
  // that setStates on mount is the React Compiler's set-state-in-effect and it
  // renders one frame of the wrong layout before correcting itself, which the
  // user sees as a flinch (fix-313's reasoning, unchanged).
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>(
    () => loadBoardCollapsed(userId) ?? defaultBoardCollapsed(),
  );
  const tasksCollapsed = collapsedKeys.includes(BOARD_TASKS_KEY);

  const toggleTasks = useCallback(() => {
    setCollapsedKeys((prev) => {
      const next = toggleCollapsedKey(prev, BOARD_TASKS_KEY);
      saveBoardCollapsed(userId, next);
      return next;
    });
  }, [userId]);

  const counts = useMyTaskCounts();

  return (
    <div
      className="h-full flex flex-col"
      style={{ overflow: 'hidden' }}
      data-testid="personal-board"
    >
      {/* ── MY BOARD. The screen. Scrolls vertically, never horizontally. ── */}
      <section
        data-testid="personal-board-top"
        aria-label="My Board"
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
      >
        <MyBoard />
      </section>

      {/* ── MY TASKS, behind a bar. ──
           ★ The bar is the control AND the summary. Folding a panel must not
           hide that there is work in it — the same rule fix-324's column spines
           follow, and the reason the counts sit here rather than inside. */}
      <section
        data-testid="personal-board-bottom"
        aria-label="My Tasks"
        className="flex-none flex flex-col min-h-0 border-t border-border"
        style={
          tasksCollapsed
            ? undefined
            : // Expanded: a generous fixed share, and My Board gives way —
              // "the screen shifts down". Not 50%: My Board stays the screen.
              { flex: '0 0 58%' }
        }
        data-collapsed={tasksCollapsed ? 'true' : 'false'}
      >
        <button
          type="button"
          onClick={toggleTasks}
          aria-expanded={!tasksCollapsed}
          className="flex-none w-full flex items-center gap-2.5 px-3.5 py-2 text-left bg-s2 hover:bg-surface transition"
          data-testid="personal-board-tasks-toggle"
          title={tasksCollapsed ? 'Open My Tasks' : 'Fold My Tasks away'}
        >
          <span
            className="text-dim text-[10px]"
            style={{
              display: 'inline-block',
              transition: 'transform .15s',
              transform: tasksCollapsed ? undefined : 'rotate(90deg)',
            }}
            aria-hidden
          >
            ▶
          </span>
          <span className="text-[12.5px] font-display font-extrabold uppercase tracking-wide text-text">
            My Tasks
          </span>
          {/* ★ The counts ride on the bar in BOTH states. Collapsed they are the
              only thing saying the work exists; expanded they still frame what
              is below, and they cost nothing because they come from the query
              the panel already reads. */}
          <span
            className="text-[11px] font-display font-bold text-muted"
            data-testid="personal-board-tasks-counts"
            title={`${counts.open} open · ${counts.overdue} overdue`}
          >
            {counts.open} open
            <span className="text-dim"> · </span>
            <span className={counts.overdue > 0 ? 'text-co' : undefined}>
              {counts.overdue} overdue
            </span>
          </span>
          <span className="ml-auto text-[10.5px] text-dim">
            {tasksCollapsed ? 'Show' : 'Hide'}
          </span>
        </button>

        {/* ★ FOLDED MEANS NOT BUILT, not hidden. fix-324b found the same thing on
            the Pipeline: a folded column that still renders its rows costs the
            page hundreds of nodes on every load for something nobody is looking
            at. `MyTasks` is unmounted here, so its task cards, its filter row and
            its detail pane are not in the DOM at all — asserted, because "hidden"
            and "absent" look identical on screen and differ entirely in cost. */}
        {!tasksCollapsed && (
          <div
            className="flex-1 min-h-0 overflow-auto"
            data-testid="personal-board-tasks-body"
          >
            {/* ★ Scrolls BOTH axes — Bobby's "fixed vertically and
                horizontally" from fix-318. The task columns keep their width in
                here rather than widening the page. */}
            <MyTasks />
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * ★ The bar's counts: this person's live tasks, open and overdue.
 *
 * ★ WHY NOT ASK MyTasks. The panel's own counters sit behind its filter row and
 * its scope toggle, and they exist only while it is mounted — which, folded, it
 * deliberately is not. So the bar counts from the SAME query (`useAllTasks`, the
 * one fix-318 requires both halves to share) using the SAME shared predicates
 * the panel uses: `useTaskOwnership` for whose task it is (fix-238's resolver,
 * so a task routed to a role reaches the person it is displayed as),
 * `cancelledProjectIds` for fix-264's exclusion, and `isTaskOverdue` /
 * `isTaskCancelled` from lib/taskStatus.
 *
 * ★ IT IS DELIBERATELY UNFILTERED by the panel's own filter row. The bar answers
 * "is there work down there", which must not change because someone typed a
 * search term inside the panel — and cannot, since the panel is unmounted while
 * the question matters most.
 */
function useMyTaskCounts(): { open: number; overdue: number } {
  const tasksQ = useAllTasks();
  const holdsQ = useAllProjectHolds();
  const { matches } = useTaskOwnership();
  const { identity } = useSelfScope();

  return useMemo(() => {
    const cancelled = cancelledProjectIds(holdsQ.data);
    const today = todayIso();
    const name = identity.name;
    let open = 0;
    let overdue = 0;
    for (const t of tasksQ.data ?? []) {
      // fix-264: work on a cancelled project is not work.
      if (cancelled.has(t.project_id)) continue;
      if (name && !matches(t, name)) continue;
      if (isTaskCancelled(t.status) || t.status === 'Resolved') continue;
      open += 1;
      if (isTaskOverdue(t, today)) overdue += 1;
    }
    return { open, overdue };
  }, [tasksQ.data, holdsQ.data, matches, identity.name]);
}

/** Local midnight, as an ISO date — the same form target_date is stored in. */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
