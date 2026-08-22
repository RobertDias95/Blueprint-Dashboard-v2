import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MyBoard from './MyBoard';
import MyTasks from './MyTasks';
import NotificationsPage from './Notifications';
import { useAllTasks } from '../hooks/useTaskTree';
import { useTaskOwnership } from '../hooks/useTaskOwnership';
import { useSelfScope } from '../hooks/useSelfScope';
import { useBoardNotifications } from '../hooks/useBoardNotifications';
import {
  useAllProjectHolds,
  cancelledProjectIds,
} from '../hooks/useProjectHolds';
import { isTaskCancelled, isTaskOverdue } from '../lib/taskStatus';

// ===========================================================================
// fix-385 — My Board becomes tabs: My Board · My Tasks · Notifications
// ===========================================================================
//
// Bobby: "i think for my board, it you can make my tasks and notifications a
// tab in the my board. i think that would look cleaner for now"
//
//   ┌───────────────────────────────────────────────────────────────┐
//   │  MY BOARD │ MY TASKS  3 open · 1 overdue │ NOTIFICATIONS  7    │
//   ├───────────────────────────────────────────────────────────────┤
//   │  the active panel takes the screen                            │
//   └───────────────────────────────────────────────────────────────┘
//
// ★★★ THIS SUPERSEDES fix-326, KNOWINGLY. That ticket built a collapsible bar
// from Bobby's earlier words — "the primary focus should be the my board, and
// then the my task should be expandable and collapsible … my task is something
// they could dive into if and need be" — and it chose a fold precisely BECAUSE
// a fold keeps My Board on screen while My Tasks opens beneath it. Tabs give
// that up: the three panels are now mutually exclusive, one visible at a time.
//
// ★ Asked directly whether he accepted that trade, Bobby chose tabs
// (2026-08-21). So the quote above is HISTORY, not the spec — kept here
// because the reasoning it produced is still the reason several rules below
// survive, not because it still describes the screen. This is the loop
// working, not churn: he saw the bar, lived with it, and chose differently.
//
// ─── what survives, and why ───────────────────────────────────────────────
// ★★ ONE QUERY (fix-318, held by fix-326). Every panel and both tab badges
// read the same react-query caches, so ticking a task on the My Tasks tab
// moves the My Tasks badge in the same render, with nothing to keep in step.
// ★★ FOLDED WORK STAYS VISIBLE (fix-324's spine rule, which fix-326 carried on
// its bar). A tab that is not open must still say that there is work behind
// it, which is why the badges live on the TABS and are computed at page level.
// ★★ NOT BUILT, NOT HIDDEN (fix-326, from fix-324b). An inactive tab is
// UNMOUNTED, not display:none — "hidden" and "absent" look identical on screen
// and differ entirely in cost, and these are three heavy panels.
// ★ The PAGE never scrolls; the active panel does (fix-318).
// ★ MyBoard, MyTasks and Notifications are MOUNTED, NOT REWRITTEN — fix-318's
// rule for MyTasks (since fix-325 the full shell, with the Mine / Waiting On
// switcher inside it), now extended to fix-336's notification centre.
//
// ─── the tab lives in the URL ─────────────────────────────────────────────
// ★★★ `/notifications` IS STILL A ROUTE, and that is the whole answer to the
// deep-link problem. It renders this page with the Notifications tab pinned
// and LEAVES THE URL ALONE, so `?kind=suppressed` still reaches
// Notifications.tsx's own `useSearchParams` exactly as it did before the move
// — fix-298's honesty line and fix-336 §2's destination keep working with no
// parameter plumbing at all. Every standing link stays literally correct:
// BoardBell's "see all" and its suppressed link, MyBoard's header link, and
// ribbonNav.ts:673's exemption entry (still not a ribbon row — a tab is not a
// third entry point).
//
// ★ THE OTHER TABS ARE ADDRESSABLE TOO: `/board` is My Board and
// `/board?tab=tasks` is My Tasks, so the back button and a pasted link both
// behave. ★★ `/board?task=<id>` also opens My Tasks — that is fix-362's task
// click-through, whose target MyTasks reads, and it keeps working without
// notificationTargets.ts changing a line.
//
// ★ Deriving the tab from the URL rather than from state is also why there is
// no flinch frame to avoid here — there is no initial state to read, so
// fix-313's "lazy initialiser, never an effect" rule is satisfied by having
// nothing to initialise.
//
// ★★ `boardPanelPrefs` IS RETIRED (src/lib/boardPanelPrefs.ts deleted). It
// existed to remember one fold, and the fold is gone. A remembered TAB was
// considered and rejected: it would fight the deep links above — arriving from
// the bell must show notifications whatever you looked at last — and Bobby
// asked for a cleaner layout, not a stateful one. Old `board.collapsed` entries
// are left in localStorage, inert, because the module that read them is gone;
// `collapsePrefs` itself is untouched and still serves the Pipeline.

export type BoardTab = 'board' | 'tasks' | 'notifications';

const TABS: { id: BoardTab; label: string }[] = [
  { id: 'board', label: 'My Board' },
  { id: 'tasks', label: 'My Tasks' },
  { id: 'notifications', label: 'Notifications' },
];

/** The canonical URL for each tab. Notifications keeps its own path because
 *  every standing link already points there. */
function pathForTab(tab: BoardTab): string {
  if (tab === 'notifications') return '/notifications';
  if (tab === 'tasks') return '/board?tab=tasks';
  return '/board';
}

function parseTab(params: URLSearchParams): BoardTab {
  const raw = params.get('tab');
  if (raw === 'tasks' || raw === 'notifications') return raw;
  // ★★★ fix-362's TASK CLICK-THROUGH. `notificationTargets.ts:97` sends a task
  // notification to `/board?task=<id>`, and the component that reads that param
  // is MyTasks (MyTasks.tsx:313) — so without this the link would land on the
  // Board tab and the task it named would never open. The param IS the tab
  // choice here; nothing in notificationTargets had to change, which is what
  // keeps its own tests and every already-sent link correct.
  if (params.get('task')) return 'tasks';
  return 'board';
}

export default function PersonalBoard({
  pinnedTab,
}: {
  /** Set by the `/notifications` route, which owns that tab's address. */
  pinnedTab?: BoardTab;
} = {}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const active: BoardTab = pinnedTab ?? parseTab(params);

  // ★★★ BOTH BADGE NUMBERS ARE COMPUTED HERE, AT PAGE LEVEL, because an
  // inactive tab is unmounted and a dead panel cannot report anything. Neither
  // adds a query: `useMyTaskCounts` reads the same `useAllTasks` the panels
  // read, and `useBoardNotifications` is a pure composition of already-shared
  // react-query hooks that, in its own words, "NOTHING HERE READS A SOCKET" —
  // BoardBell, MyBoard and the centre all call it already. No second
  // subscription is mounted to decorate a tab.
  const counts = useMyTaskCounts();
  const { unseenCount } = useBoardNotifications();

  return (
    <div
      className="h-full flex flex-col"
      style={{ overflow: 'hidden' }}
      data-testid="personal-board"
    >
      <nav
        role="tablist"
        aria-label="My Board"
        className="flex-none flex items-stretch gap-1 px-3.5 border-b border-border bg-s2"
        data-testid="personal-board-tabs"
      >
        {TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls="personal-board-panel"
              onClick={() => navigate(pathForTab(t.id))}
              className="flex items-center gap-2 px-3 py-2 text-[12.5px] font-display font-extrabold uppercase tracking-wide transition"
              style={{
                color: isActive ? 'var(--color-text)' : 'var(--color-dim)',
                // The active tab is joined to the panel below it; the others
                // sit behind. One 2px rule, not a box — the fix-327 instinct.
                borderBottom: `2px solid ${isActive ? 'var(--color-de)' : 'transparent'}`,
                background: isActive ? 'var(--color-surface)' : 'transparent',
              }}
              data-testid={`personal-board-tab-${t.id}`}
              data-active={isActive ? 'true' : 'false'}
            >
              {t.label}

              {/* ★★ MY TASKS: the counts ALWAYS render, including zeros. This
                  is fix-324's rule and fix-326's bar doing the same job in a
                  new place — a closed tab must not hide that the work exists,
                  and "0 open" is itself the answer to "is there anything in
                  there". */}
              {t.id === 'tasks' && (
                <span
                  className="text-[11px] font-display font-bold text-muted normal-case tracking-normal"
                  data-testid="personal-board-tasks-counts"
                  title={`${counts.open} open · ${counts.overdue} overdue`}
                >
                  {counts.open} open
                  <span className="text-dim"> · </span>
                  <span className={counts.overdue > 0 ? 'text-co' : undefined}>
                    {counts.overdue} overdue
                  </span>
                </span>
              )}

              {/* ★ NOTIFICATIONS: the badge appears only when something is
                  unread. The asymmetry with My Tasks above is deliberate —
                  "0 open" says the queue is clear, but a "0" on a bell says
                  nothing anyone needed to be told, and this is the same
                  semantic the bell in the ribbon already uses. */}
              {t.id === 'notifications' && unseenCount > 0 && (
                <span
                  className="text-[10px] font-display font-bold px-1.5 py-0.5 rounded-full normal-case tracking-normal"
                  style={{
                    background: 'var(--color-de)',
                    color: 'var(--color-surface)',
                  }}
                  data-testid="personal-board-notifications-count"
                  title={`${unseenCount} unread`}
                >
                  {unseenCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── The active panel. Each keeps the overflow rules it had before this
           ticket: My Board and the notification centre are `height: 100%` and
           scroll internally, while MyTasks is a plain block that needs the
           container to scroll — both axes, Bobby's "fixed vertically and
           horizontally" from fix-318, so the task columns keep their width in
           here rather than widening the page. ── */}
      <section
        id="personal-board-panel"
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === active)?.label}
        className={
          active === 'tasks'
            ? 'flex-1 min-h-0 overflow-auto'
            : active === 'board'
              ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden'
              : 'flex-1 min-h-0 overflow-hidden'
        }
        data-testid="personal-board-panel"
        data-tab={active}
      >
        {active === 'board' && <MyBoard />}
        {active === 'tasks' && <MyTasks />}
        {active === 'notifications' && <NotificationsPage />}
      </section>
    </div>
  );
}

/**
 * ★ The My Tasks badge: this person's live tasks, open and overdue.
 *
 * ★ WHY NOT ASK MyTasks. The panel's own counters sit behind its filter row and
 * its scope toggle, and they exist only while it is mounted — which, on any
 * other tab, it deliberately is not. So the badge counts from the SAME query
 * (`useAllTasks`, the one fix-318 requires every panel to share) using the SAME
 * shared predicates the panel uses: `useTaskOwnership` for whose task it is
 * (fix-238's resolver, so a task routed to a role reaches the person it is
 * displayed as), `cancelledProjectIds` for fix-264's exclusion, and
 * `isTaskOverdue` / `isTaskCancelled` from lib/taskStatus.
 *
 * ★ IT IS DELIBERATELY UNFILTERED by the panel's own filter row. The badge
 * answers "is there work in there", which must not change because someone typed
 * a search term inside the panel — and cannot, since the panel is unmounted
 * while the question matters most.
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
