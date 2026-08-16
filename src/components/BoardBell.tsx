import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
// fix-303: the SAME task source My Tasks uses, so the board is not a lesser
// copy — one shape, one editor, one write path.
import { useAllTasks } from '../hooks/useTaskTree';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useSelfScope } from '../hooks/useSelfScope';
import { useAllProjectHolds, cancelledProjectIds } from '../hooks/useProjectHolds';
import { useScraperActivity } from '../hooks/useScraperActivity';
import { parseFlips } from '../lib/boardFlips';
import { buildNewItems, unseenItems } from '../lib/boardReads';
import { useBoardReads, useMarkBoardItemsRead } from '../hooks/useBoardReads';
import { useMilestoneAcks } from '../hooks/useMilestoneAcks';
import {
  buildForecast,
  buildQueue,
  resolveBoardViewer,
  suppressionCounts,
  todayIso,
  type BoardInput,
} from '../lib/myBoard';

// fix-298 Phase 1 — the board bell and its dropdown.
//
// ★ "Open my board →" IS THE FIRST THING IN IT. The dropdown is a doorway, not
// a feed: short, skimmable, and it hands you to the board rather than trying to
// be the board.
//
// ★ fix-326: THIS IS THE ONLY NOTIFICATION BELL. The comment here used to say
// it was the second of two, sitting beside fix-27/28's scraper-activity bell.
// That stopped being true somewhere between fix-298 and fix-307 — Chrome renders
// BoardBell and ErrorTriageBell and nothing else — and the stale comment is what
// made a later brief instruct me to "remove NotificationBell from the top bar",
// a component that was not on screen. Bobby caught it: "the current bell I see is
// the myboard notification bell, not the scraper bell?" He was right.
//
// NotificationBell.tsx is deleted. This bell absorbed both questions: it carries
// the personal board feed AND, for oversight viewers, the scraper flips
// (useScraperActivity below), with fix-307's per-user read state and suppression
// counts. The feed itself still has a home at /activity, reachable from the
// Reporting hub (fix-325) and from the health panel on My Board.

export default function BoardBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const tasksQ = useAllTasks();
  const team = useTeamMembers();
  const holdsQ = useAllProjectHolds();
  const { identity } = useSelfScope();
  // Reuses the query the scraper bell already drives — React Query dedupes, so
  // the suppression counts cost no extra fetch.
  const activityQ = useScraperActivity();
  const acksQ = useMilestoneAcks();
  const readsQ = useBoardReads();
  const markRead = useMarkBoardItemsRead();

  const viewer = useMemo(
    () => resolveBoardViewer(identity.name, team.all),
    [identity.name, team.all],
  );

  const input: BoardInput = useMemo(
    () => ({
      viewer,
      permits: permitsQ.data ?? [],
      projects: projectsQ.data ?? [],
      tasks: tasksQ.data ?? [],
      today: todayIso(),
      cancelledIds: cancelledProjectIds(holdsQ.data),
    }),
    [viewer, permitsQ.data, projectsQ.data, tasksQ.data, holdsQ.data],
  );

  const forecast = useMemo(() => buildForecast(input), [input]);
  const queue = useMemo(() => buildQueue(input), [input]);
  const suppressed = useMemo(
    () => suppressionCounts(activityQ.data ?? [], viewer),
    [activityQ.data, viewer],
  );

  // ★ fix-307 (register #36/#38): what is NEW to this person — flips, tasks
  // newly assigned, handoffs arriving, permits newly naming them. parseFlips
  // has already applied the suppression rules and the fix-304 backfill filter,
  // so a retry-recovered event or a 300-day-old applied date can never arrive
  // here as news. Reused, not restated.
  const newItems = useMemo(
    () =>
      buildNewItems({
        flips: parseFlips(activityQ.data ?? []),
        tasks: tasksQ.data ?? [],
        acks: acksQ.data ?? [],
        permits: permitsQ.data ?? [],
        viewerName: viewer.name,
      }),
    [activityQ.data, tasksQ.data, acksQ.data, permitsQ.data, viewer.name],
  );

  const readKeys = useMemo(
    () => new Set(readsQ.data ?? []),
    [readsQ.data],
  );
  const unseen = useMemo(() => unseenItems(newItems, readKeys), [newItems, readKeys]);

  // ★ fix-307: THE BADGE COUNTS WHAT IS UNSEEN, NOT WHAT IS UNDONE.
  //
  // It used to count past due + today + blocked — outstanding work, which never
  // reaches zero, so the number stopped being a signal and became decoration.
  // Zero now means "I have seen everything new", never "I have nothing to do".
  // The counts that used to drive it are still in the dropdown as CONTEXT and
  // never contribute here.
  //
  // Always personal: `unseen` comes from the viewer's own items and knows
  // nothing about the queue's scope, so switching to My team cannot move it.
  const actionable = unseen.length;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative bg-transparent border border-border text-muted hover:text-text px-2 py-1 rounded-md transition inline-flex items-center"
        title="My board"
        aria-expanded={open}
        data-testid="board-bell-button"
      >
        <span aria-hidden>🔔</span>
        {actionable > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-co text-white text-[9px] font-extrabold flex items-center justify-center"
            data-testid="board-bell-badge"
          >
            {actionable > 99 ? '99+' : actionable}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 w-[290px] bg-surface border border-border rounded-md shadow-lg z-50 overflow-hidden"
          data-testid="board-bell-dropdown"
        >
          {/* ★ First thing in the dropdown, per the mockup. */}
          <Link
            to="/board"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2.5 bg-s2 border-b border-border text-[12px] font-extrabold text-de hover:bg-de-bg transition"
            data-testid="board-bell-open-board"
          >
            Open my board →
          </Link>

          <div className="px-3.5 py-2 border-b border-border" data-testid="board-bell-standing">
            <div className="text-[8px] font-extrabold uppercase tracking-wide text-muted mb-0.5">
              Where you stand
            </div>
            <Row label="Past due" value={forecast.past_due.total} urgent testid="bell-past-due" />
            <Row label="Today" value={forecast.today.total} urgent testid="bell-today" />
            <Row label="Blocked on you" value={queue.blocked_on_you.total} urgent testid="bell-blocked" />
            <Row
              label="Waiting on design"
              value={queue.waiting_on_design.total}
              testid="bell-waiting-design"
            />
            <Row
              label="Waiting on the city"
              value={queue.waiting_on_city.total}
              testid="bell-waiting-city"
            />
          </div>

          {/* ★ fix-307 (register #37): the dropdown shows BOTH — the unseen
              items, which are the badge's population and each acknowledgeable,
              and "where you stand", which is context and never contributes to
              the badge. */}
          <div className="border-b border-border" data-testid="board-bell-new">
            <div className="px-3.5 pt-2 pb-1 flex items-baseline gap-2">
              <span className="text-[8px] font-extrabold uppercase tracking-wide text-muted">
                New
              </span>
              {unseen.length > 0 && (
                <button
                  type="button"
                  onClick={() => markRead.mutate(unseen.map((i) => i.key))}
                  disabled={markRead.isPending}
                  className="ml-auto text-[9px] text-de hover:underline bg-transparent border-none p-0 disabled:opacity-40"
                  data-testid="board-bell-mark-all-read"
                >
                  Mark all read
                </button>
              )}
            </div>

            {unseen.length === 0 ? (
              // ★ Zero means "seen everything new", NOT "nothing to do" — so
              // the empty state says so, with the standing counts right below.
              <div
                className="px-3.5 pb-2 text-[10px] text-dim"
                data-testid="board-bell-new-empty"
              >
                Nothing new. You are up to date on what has changed.
              </div>
            ) : (
              unseen.slice(0, 8).map((i) => (
                <div
                  key={i.key}
                  className="flex items-start gap-2 px-3.5 py-1.5 hover:bg-s2 transition"
                  data-testid={`bell-new-${i.key}`}
                >
                  <Link
                    to={
                      i.projectId
                        ? `/project/${i.projectId}${i.permitId ? `?permit=${i.permitId}` : ''}`
                        : '/board'
                    }
                    onClick={() => {
                      // Following the item is plainly seeing it.
                      markRead.mutate([i.key]);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1"
                    data-testid={`bell-new-link-${i.key}`}
                  >
                    <div className="text-[11px] font-bold text-text leading-tight">
                      {i.title}
                    </div>
                    {i.subtitle && (
                      <div className="text-[10px] text-muted">{i.subtitle}</div>
                    )}
                    <div className="text-[9px] text-dim font-mono truncate">{i.where}</div>
                  </Link>
                  {/* ★ Acknowledgement is a CLICK. Opening the bell must never
                      mark things read implicitly. */}
                  <button
                    type="button"
                    onClick={() => markRead.mutate([i.key])}
                    className="text-[9px] text-dim hover:text-de bg-transparent border-none p-0 flex-none mt-0.5"
                    title="Mark read — it stays on your board"
                    data-testid={`bell-new-read-${i.key}`}
                  >
                    ✓
                  </button>
                </div>
              ))
            )}
          </div>

          {/* ★ CONTEXT, not notification. These are the counts the badge used
              to be built from; they stay visible because "where do I stand" is
              a real question, and they contribute nothing to the badge. */}
          {/* ★ NEVER NOTIFY, BUT SHOW THE COUNT. The scraper's retries and
              manual-edit guards are the two largest event categories in the
              system and both mean "working as intended" — they must never
              reach a person. Showing what was suppressed is how a quiet day
              and a broken notifier stop looking the same. Renders even at
              zero, for exactly that reason. */}
          <div
            className="px-3.5 py-2 text-[9.5px] text-dim leading-relaxed"
            data-testid="board-bell-suppressed"
          >
            <div className="font-bold uppercase tracking-wide text-[8px] text-muted mb-0.5">
              Not shown
            </div>
            <span data-testid="bell-suppressed-retries">
              {suppressed.retries} scraper retries
            </span>
            {' · '}
            <span data-testid="bell-suppressed-guarded">
              {suppressed.guarded} manual-edit guards
            </span>
            {' · '}
            <span data-testid="bell-suppressed-notyours">
              {suppressed.notYours} changes on permits that aren&apos;t yours
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  urgent,
  testid,
}: {
  label: string;
  value: number;
  urgent?: boolean;
  testid: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5" data-testid={testid}>
      <span className="text-[11px] text-muted">{label}</span>
      <span
        className={`ml-auto text-[12px] font-extrabold tabular-nums ${
          urgent && value > 0 ? 'text-co' : 'text-text'
        }`}
        data-testid={`${testid}-value`}
      >
        {value}
      </span>
    </div>
  );
}
