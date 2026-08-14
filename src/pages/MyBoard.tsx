import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import { useAllPermitTasks } from '../hooks/useAllPermitTasks';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useSelfScope } from '../hooks/useSelfScope';
import { useAllProjectHolds, cancelledProjectIds } from '../hooks/useProjectHolds';
import { useScraperActivity } from '../hooks/useScraperActivity';
import { useMilestoneAcks, useAckMilestone } from '../hooks/useMilestoneAcks';
import { useConfirmHandoff } from '../hooks/useConfirmHandoff';
import { useUpsertTask } from '../hooks/useTaskTree';
import type { PermitTask } from '../lib/database.types';
import {
  BOARD_SECTION_CAPS,
  buildForecast,
  buildQueue,
  canConfirmHandoff,
  handoffAffordance,
  isDesignTask,
  resolveBoardViewer,
  systemHealth,
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

function ForecastRow({
  item,
  onTick,
  busy,
}: {
  item: ForecastItem;
  onTick: (item: ForecastItem) => void;
  busy: boolean;
}) {
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
        // fix-298 Phase 2: ticking performs the underlying action — resolve the
        // task, hand the permit over, or record the milestone. Never a
        // cosmetic tick.
        <button
          type="button"
          onClick={() => onTick(item)}
          disabled={busy}
          title={
            item.action === 'resolve-task'
              ? 'Resolve this task'
              : item.action === 'handoff'
                ? 'Design finished — hand this to the entitlement lead'
                : 'Mark this done'
          }
          className="w-[13px] h-[13px] border-[1.5px] border-border rounded-[3px] flex-none mt-0.5 bg-bg hover:border-de disabled:opacity-40"
          data-testid={`board-forecast-check-${item.key}`}
          data-action={item.action}
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
  onTick,
  busy,
}: {
  label: string;
  urgent?: boolean;
  data: BoardSection<ForecastItem>;
  empty: string;
  testid: string;
  onTick: (item: ForecastItem) => void;
  busy: boolean;
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
        data.items.map((i) => (
          <ForecastRow key={i.key} item={i} onTick={onTick} busy={busy} />
        ))
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
  // fix-298 Phase 2: the scraper feed the old nav bell used to own.
  const activityQ = useScraperActivity();
  const acksQ = useMilestoneAcks();
  const ackMilestone = useAckMilestone();
  const upsertTask = useUpsertTask();
  const handoff = useConfirmHandoff();

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
      acks: acksQ.data ?? [],
    }),
    [viewer, permitsQ.data, projectsQ.data, tasksQ.data, holdsQ.data, acksQ.data],
  );

  // ★ The handoff candidates. A permit qualifies when its design leg is
  // finished (or has no design tasks and needs a person to say so), the viewer
  // is allowed to confirm, and it has not already been handed off.
  const allTasks = tasksQ.data;
  const handoffs = useMemo(() => {
    const acks = acksQ.data ?? [];
    const tasksByPermit = new Map<number, PermitTask[]>();
    for (const t of allTasks ?? []) {
      const list = tasksByPermit.get(t.permit_id) ?? [];
      list.push(t);
      tasksByPermit.set(t.permit_id, list);
    }
    const cancelled = cancelledProjectIds(holdsQ.data);
    const addr = new Map((projectsQ.data ?? []).map((p) => [p.id, p.address]));
    return (permitsQ.data ?? [])
      .filter((p) => !cancelled.has(p.project_id))
      .filter((p) => canConfirmHandoff(p, viewer))
      .map((p) => {
        const tasks = tasksByPermit.get(p.id) ?? [];
        return {
          permit: p,
          address: addr.get(p.project_id) ?? 'Unknown address',
          affordance: handoffAffordance(p, tasks, acks),
          designTotal: tasks.filter(isDesignTask).length,
        };
      })
      .filter((h) => h.affordance !== 'none');
  }, [permitsQ.data, projectsQ.data, allTasks, acksQ.data, holdsQ.data, viewer]);

  const forecast = useMemo(() => buildForecast(input), [input]);
  const queue = useMemo(() => buildQueue(input), [input]);
  const health = useMemo(
    () =>
      systemHealth(
        permitsQ.data ?? [],
        activityQ.data ?? [],
        input.today,
        undefined,
        input.cancelledIds,
      ),
    [permitsQ.data, activityQ.data, input.today, input.cancelledIds],
  );

  // ★ Ticking does the real thing. Three routes, decided when the row was
  // built (see ForecastItem.action) rather than re-derived here.
  const busy = ackMilestone.isPending || upsertTask.isPending || handoff.isPending;

  function onTick(item: ForecastItem) {
    if (!item.actionable || item.permitId == null) return;
    if (item.action === 'resolve-task' && item.task) {
      // ★ The SAME hook My Tasks' checkbox uses — bp_upsert_permit_task via
      // useUpsertTask — so the two can never diverge, and My Tasks reflects
      // this immediately (the hook invalidates permitTasksAll).
      upsertTask.mutate({
        id: item.task.id,
        permitId: item.task.permit_id,
        parentTaskId: item.task.parent_task_id,
        discipline: item.task.discipline ?? 'ent',
        bucket: (item.task.bucket === 'de' || item.task.bucket === 'pm'
          ? item.task.bucket
          : null) as 'de' | 'pm' | null,
        text: item.task.text,
        status: 'Resolved',
        startDate: item.task.start_date,
        targetDate: item.task.target_date,
      });
      return;
    }
    if (item.action === 'handoff') {
      void handoff.confirm({
        permitId: item.permitId,
        cycleIndex: item.cycleIndex,
        entLead: item.entLead,
        byName: viewer.name,
      });
      return;
    }
    ackMilestone.mutate({
      permitId: item.permitId,
      milestone: item.milestoneKind ?? 'unknown',
      anchor: item.anchor,
      ackedByName: viewer.name,
    });
  }

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
                onTick={onTick}
                busy={busy}
              />
              <ForecastSection
                label="Today"
                urgent
                data={forecast.today}
                empty="Nothing due today."
                testid="board-sec-today"
                onTick={onTick}
                busy={busy}
              />
              <ForecastSection
                label="Tomorrow"
                data={forecast.tomorrow}
                empty="Nothing scheduled."
                testid="board-sec-tomorrow"
                onTick={onTick}
                busy={busy}
              />
              <ForecastSection
                label="This week"
                data={forecast.this_week}
                empty="Nothing else this week."
                testid="board-sec-this-week"
                onTick={onTick}
                busy={busy}
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
              {/* ★ THE HANDOFF. "All design tasks are done. Hand this to
                  Miles to resubmit?" Sits at the top of the queue because it
                  is the one thing on this screen that moves a permit to
                  somebody else. Confirming creates the submittal task assigned
                  to the lead — they do not have to notice, it arrives. */}
              {handoffs.length > 0 && (
                <div data-testid="board-sec-handoff-wrap">
                  {/* ★ Capped like every other section, with the TRUE total in
                      the header — the board must not grow with the workload. */}
                  <SectionHeader
                    label="Ready to hand off"
                    total={handoffs.length}
                    urgent
                    capped={handoffs.length > BOARD_SECTION_CAPS.queueGroup}
                    testid="board-sec-handoff"
                  />
                  {handoffs.slice(0, BOARD_SECTION_CAPS.queueGroup).map((h) => (
                    <div
                      key={h.permit.id}
                      className="px-3.5 py-2 border-b border-border/50"
                      data-testid={`board-handoff-row-${h.permit.id}`}
                      data-affordance={h.affordance}
                    >
                      <div className="text-[11.5px] font-extrabold text-text truncate">
                        {h.address}
                        <span className="text-muted font-normal">
                          {' '}
                          · {h.permit.type}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted mt-0.5 leading-snug">
                        {h.affordance === 'prompt'
                          ? `All ${h.designTotal} design task${h.designTotal === 1 ? '' : 's'} resolved. Nothing on the design side is outstanding.`
                          : 'No design tasks were recorded on this permit, so nothing can vouch that the work is done — a person has to say so.'}
                      </div>
                      <button
                        type="button"
                        disabled={handoff.pendingId === h.permit.id || busy}
                        onClick={() =>
                          void handoff.confirm({
                            permitId: h.permit.id,
                            cycleIndex:
                              [...(h.permit.permit_cycles ?? [])].sort(
                                (a, b) => b.cycle_index - a.cycle_index,
                              )[0]?.cycle_index ?? null,
                            entLead: h.permit.ent_lead ?? null,
                            byName: viewer.name,
                            manual: h.affordance === 'manual',
                          })
                        }
                        className="mt-1.5 text-[10.5px] font-bold px-2.5 py-1 rounded border border-ok bg-ok-bg text-ok hover:opacity-80 disabled:opacity-40"
                        data-testid={`board-handoff-confirm-${h.permit.id}`}
                      >
                        {h.affordance === 'prompt'
                          ? `Ready to resubmit → assign to ${h.permit.ent_lead ?? 'the lead'}`
                          : 'Mark design complete'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

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

              {/* fix-298 Phase 2: system health — OVERSIGHT ONLY.
                  This is where the old scraper-activity bell went. It is not
                  project work, so it sits below the queue rather than in it,
                  and it renders COUNTS rather than a list: a to-do list of 120
                  stale permits would be noise, the shape of the staleness is
                  the actual signal. Hidden entirely for everyone else. */}
              {viewer.isOversight && (
                <div data-testid="board-sec-health-wrap">
                  <SectionHeader
                    label="System health"
                    total={health.portalFailures + health.unowned}
                    capped={false}
                    testid="board-sec-health"
                  />
                  <div className="px-3.5 py-2 text-[10px] text-muted leading-relaxed">
                    <div data-testid="health-portal-failures">
                      <b className="text-text">{health.portalFailures}</b> portal fetch
                      failures in the feed
                    </div>
                    <div data-testid="health-unowned">
                      <b className="text-text">{health.unowned}</b> active permits with
                      nobody on them
                    </div>
                    <div data-testid="health-stale">
                      <b className="text-text">{health.staleMedium}</b> untouched 14d+ ·{' '}
                      <b className="text-text">{health.staleLong}</b> untouched 30d+
                    </div>
                    <Link
                      to="/activity"
                      className="text-de hover:underline"
                      data-testid="health-activity-link"
                    >
                      Full scraper activity →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
