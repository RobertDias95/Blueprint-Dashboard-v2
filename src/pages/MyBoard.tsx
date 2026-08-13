import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import { useAllPermitTasks } from '../hooks/useAllPermitTasks';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useSelfScope } from '../hooks/useSelfScope';
import { useAllProjectHolds, cancelledProjectIds } from '../hooks/useProjectHolds';
import {
  buildForecast,
  buildQueue,
  resolveBoardViewer,
  todayIso,
  type BoardInput,
  type BoardSection,
  type ForecastItem,
  type QueueProject,
} from '../lib/myBoard';

// fix-298 Phase 1 — My Board.
//
// ★ A PLANNER, NOT AN ALERT FEED. Left asks "when" (forecast, by date), right
// asks "where" (queue, by state). Same permits, two orderings — that is the
// only justification for showing them together.
//
// ★ THE BOARD MUST NOT GROW WITH THE WORKLOAD. Miles has 165 active permits
// across 62 projects; Bobby has 5 across 3. Both get the same-SHAPED screen:
// volume changes what is IN a section, never how TALL the page is. The page
// itself never scrolls — each panel scrolls independently inside a fixed
// height, section headers stick, and every section reports its TRUE total in
// the header whether or not its rows are capped.
//
// ★ READ-ONLY. Phase 1 renders the relay and proves the routing; nothing here
// writes. The checkbox is a static affordance showing WHICH rows would be
// actionable — Phase 2 wires it. Rows in the "waiting on the other half" state
// deliberately render with NO checkbox at all.

function SectionHeader({
  label,
  total,
  urgent,
  onShowAll,
  capped,
  testid,
}: {
  label: string;
  total: number;
  urgent?: boolean;
  capped: boolean;
  onShowAll?: () => void;
  testid: string;
}) {
  return (
    <div
      // Sticky so the label and the count stay visible while the panel scrolls.
      className="sticky top-0 z-10 px-3.5 py-1.5 bg-s2 border-t border-b border-border flex items-center gap-2"
      data-testid={testid}
    >
      <span
        className={`text-[8px] font-extrabold uppercase tracking-[0.06em] ${
          urgent ? 'text-co' : 'text-muted'
        }`}
      >
        {urgent && '⚑ '}
        {label}
      </span>
      {/* ★ The true total, always — capping rows must never hide the scale. */}
      <span
        className="text-[9px] text-dim ml-auto tabular-nums"
        data-testid={`${testid}-total`}
      >
        {total}
        {capped && (
          <button
            type="button"
            onClick={onShowAll}
            className="ml-2 text-de hover:underline bg-transparent border-none p-0 text-[9px]"
            data-testid={`${testid}-showall`}
          >
            Show all ({total}) →
          </button>
        )}
      </span>
    </div>
  );
}

function ForecastRow({ item }: { item: ForecastItem }) {
  const tone =
    item.daysLate > 0 ? 'text-co' : item.daysLate === 0 ? 'text-wa' : 'text-ok';
  return (
    <div
      className="px-3.5 py-1.5 border-b border-border/50 flex gap-2.5 items-start"
      data-testid={`board-forecast-row-${item.key}`}
      data-actionable={item.actionable ? 'true' : 'false'}
    >
      {/* ★ NO CHECKBOX when the row is waiting on the other half. The whole
          distinction rests on not being asked to act, so the control is
          absent rather than disabled. */}
      {item.actionable ? (
        <span
          className="w-[13px] h-[13px] border-[1.5px] border-border rounded-[3px] flex-none mt-0.5"
          data-testid={`board-forecast-check-${item.key}`}
        />
      ) : (
        <span className="w-[13px] flex-none" aria-hidden />
      )}
      <div className="min-w-0">
        <div
          className={`text-[11px] font-bold leading-tight ${
            item.actionable ? 'text-text' : 'text-dim'
          }`}
        >
          {item.verb}
          <span
            className={`ml-1 inline-block text-[8px] font-extrabold uppercase px-1.5 rounded-lg align-[1px] ${
              item.source === 'task'
                ? 'bg-co-bg text-co'
                : item.actionable
                  ? 'bg-de-bg text-de'
                  : 'bg-s2 text-muted'
            }`}
          >
            {item.source === 'task' ? 'task' : item.actionable ? 'milestone' : 'waiting'}
          </span>
        </div>
        <div className="text-[10px] text-muted mt-px leading-snug">{item.why}</div>
        {item.where && (
          <div className="text-[9px] text-dim font-mono mt-0.5 truncate">
            {item.where}
          </div>
        )}
      </div>
      <div className={`text-[9px] ml-auto text-right whitespace-nowrap pl-1.5 ${tone}`}>
        <b className="block text-[10px]">
          {item.daysLate > 0
            ? `${item.daysLate}d`
            : item.daysLate === 0
              ? 'today'
              : item.date.slice(5)}
        </b>
      </div>
    </div>
  );
}

function QueueRow({ item }: { item: QueueProject }) {
  return (
    <div
      className="px-3.5 py-2 border-b border-border/50"
      data-testid={`board-queue-row-${item.key}`}
    >
      <div className="text-[11.5px] font-extrabold text-text truncate">
        {item.address}
        {item.permitCount > 1 && (
          <span className="ml-1.5 inline-block text-[8px] font-extrabold uppercase px-1.5 rounded-lg bg-s2 text-muted align-[1px]">
            {item.permitCount} permits
          </span>
        )}
      </div>
      <div className="text-[10px] text-muted mt-0.5 leading-snug">{item.status}</div>
      <div className="text-[10.5px] font-bold mt-1 text-text">{item.next}</div>
    </div>
  );
}

function ForecastSection({
  label,
  urgent,
  data,
  empty,
  testid,
}: {
  label: string;
  urgent?: boolean;
  data: BoardSection<ForecastItem>;
  empty: string;
  testid: string;
}) {
  return (
    <>
      <SectionHeader
        label={label}
        total={data.total}
        urgent={urgent}
        capped={data.capped}
        testid={testid}
      />
      {data.items.length === 0 ? (
        <div className="px-3.5 py-2 text-[10px] text-dim" data-testid={`${testid}-empty`}>
          {empty}
        </div>
      ) : (
        data.items.map((i) => <ForecastRow key={i.key} item={i} />)
      )}
    </>
  );
}

function QueueSection({
  label,
  urgent,
  data,
  sub,
  testid,
}: {
  label: string;
  urgent?: boolean;
  data: BoardSection<QueueProject>;
  sub?: string;
  testid: string;
}) {
  return (
    <>
      <SectionHeader
        label={sub ? `${label} · ${sub}` : label}
        total={data.total}
        urgent={urgent}
        capped={data.capped}
        testid={testid}
      />
      {data.items.length === 0 ? (
        <div className="px-3.5 py-2 text-[10px] text-dim" data-testid={`${testid}-empty`}>
          Nothing here.
        </div>
      ) : (
        data.items.map((i) => <QueueRow key={i.key} item={i} />)
      )}
    </>
  );
}

export default function MyBoard() {
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const tasksQ = useAllPermitTasks();
  const team = useTeamMembers();
  const holdsQ = useAllProjectHolds();
  const { identity } = useSelfScope();

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

  const loading =
    permitsQ.isLoading || projectsQ.isLoading || tasksQ.isLoading || team.isLoading;

  return (
    <div
      // ★ Fixed height, no page-level scroll. 52px is the Chrome header.
      className="p-4 flex flex-col"
      style={{ height: 'calc(100vh - 52px)' }}
      data-testid="my-board"
    >
      <div className="flex items-baseline gap-3 mb-2.5 flex-none">
        <h1 className="text-[15px] font-extrabold text-text">My Board</h1>
        <span className="text-[11px] text-muted" data-testid="my-board-who">
          {viewer.name ?? 'Not on the roster'}
          {viewer.isOversight && (
            <span
              className="ml-1.5 inline-block text-[8px] font-extrabold uppercase px-1.5 rounded-lg bg-jv-bg text-jv align-[1px]"
              data-testid="my-board-oversight-badge"
            >
              oversight
            </span>
          )}
        </span>
        <Link
          to="/my-tasks"
          className="text-[11px] text-de hover:underline ml-auto"
          data-testid="my-board-to-my-tasks"
        >
          My Tasks →
        </Link>
      </div>

      {loading ? (
        <div className="text-[11px] text-dim" data-testid="my-board-loading">
          Loading your board…
        </div>
      ) : (
        <div
          className="grid grid-cols-1 lg:grid-cols-2 border border-border rounded-md overflow-hidden bg-surface flex-1 min-h-0"
          data-testid="my-board-panels"
        >
          {/* ── LEFT: FORECAST — only ever things with a DATE ── */}
          <div
            className="border-r border-border flex flex-col min-h-0"
            data-testid="my-board-forecast"
          >
            <div className="px-3.5 py-2 bg-s2 border-b border-border flex-none">
              <div className="text-[12.5px] font-extrabold text-text">Forecast</div>
              <div className="text-[10px] text-muted mt-px">
                Your tasks and permit milestones, in date order
              </div>
            </div>
            {/* Independent scroll: the panel grows internally, the page does not. */}
            <div className="overflow-y-auto flex-1 min-h-0" data-testid="my-board-forecast-scroll">
              <ForecastSection
                label="Past due"
                urgent
                data={forecast.past_due}
                empty="Nothing past due."
                testid="board-sec-past-due"
              />
              <ForecastSection
                label="Today"
                urgent
                data={forecast.today}
                empty="Nothing due today."
                testid="board-sec-today"
              />
              <ForecastSection
                label="Tomorrow"
                data={forecast.tomorrow}
                empty="Nothing scheduled."
                testid="board-sec-tomorrow"
              />
              <ForecastSection
                label="This week"
                data={forecast.this_week}
                empty="Nothing else this week."
                testid="board-sec-this-week"
              />
            </div>
          </div>

          {/* ── RIGHT: PROJECT QUEUE — only ever things with a STATE ── */}
          <div className="flex flex-col min-h-0" data-testid="my-board-queue">
            <div className="px-3.5 py-2 bg-s2 border-b border-border flex-none">
              <div className="text-[12.5px] font-extrabold text-text">Project queue</div>
              <div className="text-[10px] text-muted mt-px">
                {queue.projectCount} projects · where each one sits and what it needs next
              </div>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0" data-testid="my-board-queue-scroll">
              <QueueSection
                label="Blocked on you"
                urgent
                data={queue.blocked_on_you}
                testid="board-sec-blocked"
              />
              <QueueSection
                label="Waiting on design"
                urgent
                data={queue.waiting_on_design}
                testid="board-sec-waiting-design"
              />
              <QueueSection
                label="Waiting on the city"
                sub="nothing for you to do"
                data={queue.waiting_on_city}
                testid="board-sec-waiting-city"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
