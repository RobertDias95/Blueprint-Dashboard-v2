import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import { useAllPermitTasks } from '../hooks/useAllPermitTasks';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useSelfScope } from '../hooks/useSelfScope';
import { useAllProjectHolds, cancelledProjectIds } from '../hooks/useProjectHolds';
import { useScraperActivity } from '../hooks/useScraperActivity';
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
// ★ THIS IS A SECOND BELL, deliberately. The existing NotificationBell is the
// SCRAPER ACTIVITY bell (fix-27/28) and links to /activity — a different
// question ("what did the robot do") from this one ("what is mine today").
// Merging them is a product decision I have not been asked to make, so they sit
// side by side and Bobby can collapse them later if three bells reads as
// clutter. Flagged in the PR rather than decided here.

export default function BoardBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const tasksQ = useAllPermitTasks();
  const team = useTeamMembers();
  const holdsQ = useAllProjectHolds();
  const { identity } = useSelfScope();
  // Reuses the query the scraper bell already drives — React Query dedupes, so
  // the suppression counts cost no extra fetch.
  const activityQ = useScraperActivity();

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

  // The badge counts what is ASKED OF YOU — past due + today + blocked. Not
  // "things that happened": this is a planner, so the number has to mean
  // "things to act on" or it is just noise with a red dot.
  const actionable =
    forecast.past_due.total + forecast.today.total + queue.blocked_on_you.total;

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

          <div className="px-3.5 py-2 border-b border-border">
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
