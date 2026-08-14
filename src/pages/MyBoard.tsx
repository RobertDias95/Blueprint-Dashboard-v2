import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
// fix-303: the SAME task source My Tasks uses, so the board is not a lesser
// copy — one shape, one editor, one write path.
import { useAllTasks, useUpsertTask } from '../hooks/useTaskTree';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useSelfScope } from '../hooks/useSelfScope';
import { useAllProjectHolds, cancelledProjectIds } from '../hooks/useProjectHolds';
import { useScraperActivity } from '../hooks/useScraperActivity';
import { useMilestoneAcks, useAckMilestone } from '../hooks/useMilestoneAcks';
import { useConfirmHandoff } from '../hooks/useConfirmHandoff';
import { useDmDaGroups } from '../hooks/useDmDaGroups';
// ★ fix-303 §3: the SAME editor My Tasks uses, lifted out of it so the board is
// not a lesser copy. Not a second editing path — literally the same component,
// the same hooks, the same RPC.
import TaskDetailEditor from '../components/TaskDetailEditor';
import { nestSubtasks } from '../lib/taskNesting';


import {
  BOARD_SECTION_CAPS,
  buildForecast,
  buildQueue,
  canConfirmHandoff,
  handoffAffordance,
  isDesignTask,
  resolveBoardViewer,
  buildTeamQueues,
  designReportsFor,
  entitlementReportsFor,
  systemHealth,
  teamMappingGap,
  todayIso,
  type BoardInput,
  type BoardTask,
  type BoardSection,
  type ForecastItem,
  type QueueProject,
  type TeamQueue,
  type QueuePermitDetail,
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
  capped,
  expanded,
  onToggle,
  testid,
}: {
  label: string;
  total: number;
  urgent?: boolean;
  capped: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  testid: string;
}) {
  // fix-303: "Show all" now DOES something. Phase 1 wired onClick to a prop no
  // caller ever passed, so the control rendered, looked interactive, and was
  // inert for two releases. Expanding swaps the capped list for the full one
  // IN PLACE — the panel keeps its fixed height and scrolls, so a 139-row
  // expansion never grows the page.
  const showToggle = capped || expanded;
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
        {showToggle && onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="ml-2 text-de hover:underline bg-transparent border-none p-0 text-[9px]"
            data-testid={`${testid}-showall`}
            aria-expanded={expanded ? 'true' : 'false'}
          >
            {expanded ? 'Show less ←' : `Show all (${total}) →`}
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
  subtasks = [],
  onOpenRow,
}: {
  item: ForecastItem;
  onTick: (item: ForecastItem) => void;
  busy: boolean;
  subtasks?: BoardTask[];
  /** fix-304 §19: EVERY row opens something. */
  onOpenRow: (item: ForecastItem) => void;
}) {
  const tone =
    item.daysLate > 0 ? 'text-co' : item.daysLate === 0 ? 'text-wa' : 'text-ok';

  // ★ fix-304 §21 (register #21): a task and a milestone must be tellable apart
  // BEFORE the click, because they behave differently — a task or a task-backed
  // milestone opens the editor, a bare milestone opens the permit. Chosen
  // vocabulary: a coloured left rule plus a badge. ✓ amber = task (assigned to
  // a person), ◆ blue = milestone (something the permit is doing), grey =
  // waiting on the other half.
  const isTask = item.source === 'task';
  const kindLabel = isTask ? '✓ task' : item.actionable ? '◆ milestone' : '◆ waiting';
  const kindClass = isTask
    ? 'bg-co-bg text-co'
    : item.actionable
      ? 'bg-de-bg text-de'
      : 'bg-s2 text-muted';
  const rule = isTask
    ? 'var(--color-co)'
    : item.actionable
      ? 'var(--color-de)'
      : 'var(--color-border)';

  return (
    <div
      className="px-3.5 py-1.5 border-b border-border/50"
      style={{ borderLeft: `3px solid ${rule}` }}
      data-testid={`board-forecast-row-${item.key}`}
      data-actionable={item.actionable ? 'true' : 'false'}
      // ★ Asserted on directly: the distinction has to be a real attribute, not
      // a shade of text somebody must squint at.
      data-kind={isTask ? 'task' : 'milestone'}
      data-opens={item.task ? 'task' : 'permit'}
    >
      <div className="flex gap-2.5 items-start">
        {/* ★ NO CHECKBOX when the row is waiting on the other half. */}
        {item.actionable ? (
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
            {/* ★ fix-304 §19 (register #19): this used to fire only when the
                row HAD a task, so on Bobby's board — which is entirely
                milestones — nothing opened at all. Every row opens something
                now: a task row opens the editor, a bare milestone opens the
                permit it is about. */}
            <button
              type="button"
              onClick={() => onOpenRow(item)}
              className="bg-transparent border-none p-0 text-left font-bold text-[11px] hover:underline"
              style={{ color: 'inherit' }}
              data-testid={`board-row-open-${item.key}`}
            >
              {item.verb}
            </button>
            <span
              className={`ml-1 inline-block text-[8px] font-extrabold uppercase px-1.5 rounded-lg align-[1px] ${kindClass}`}
              data-testid={`board-row-kind-${item.key}`}
            >
              {kindLabel}
            </span>
          </div>
          {/* fix-304 §22: rendered only when it says something the headline,
              the location and the date do not. */}
          {item.why && (
            <div className="text-[10px] text-muted mt-px leading-snug">{item.why}</div>
          )}
          <div className="text-[9px] text-dim font-mono mt-0.5 truncate">
            {/* ★ fix-304 §20 (register #20): the PERMIT is a link, not just the
                project. "Maybe there's a hyperlink to the permit and I can go
                check on the permit right then and there." */}
            {item.projectId ? (
              <>
                <Link
                  to={`/projects/${item.projectId}`}
                  className="text-de hover:underline"
                  data-testid={`board-row-project-${item.key}`}
                >
                  {item.address ?? 'Project'}
                </Link>
                {item.permitId != null && (
                  <>
                    {' · '}
                    <Link
                      to={`/projects/${item.projectId}?permit=${item.permitId}`}
                      className="text-de hover:underline"
                      data-testid={`board-row-permit-${item.key}`}
                    >
                      {item.permitLabel ?? 'Permit'}
                    </Link>
                  </>
                )}
                {/* fix-303 kept: clicking through to My Tasks works and is
                    liked. §19 is about not HAVING to, not about removing it. */}
                {item.taskId && (
                  <>
                    {' · '}
                    <Link
                      to={`/my-tasks?task=${item.taskId}`}
                      className="text-de hover:underline"
                      data-testid={`board-row-mytasks-${item.key}`}
                    >
                      My Tasks
                    </Link>
                  </>
                )}
              </>
            ) : (
              item.where
            )}
          </div>
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

      {/* Subtasks nest exactly as in My Tasks (taskNesting.nestSubtasks). */}
      {subtasks.map((st) => (
        <div
          key={st.id}
          className="ml-[22px] mt-1 pl-2 border-l-2 border-border flex items-start gap-2"
          data-testid={`board-subtask-${st.id}`}
        >
          <span className="text-[10px] text-muted flex-1 truncate">{st.text}</span>
          <span className="text-[9px] text-dim">{st.status}</span>
        </div>
      ))}
    </div>
  );
}

function PermitDetailLine({
  d,
  projectId,
}: {
  d: QueuePermitDetail;
  projectId: string;
}) {
  const bits: string[] = [];
  if (d.submitted) bits.push(`submitted ${d.submitted}`);
  else bits.push('not yet submitted');
  if (d.intakeAccepted) bits.push(`intake ${d.intakeAccepted}`);
  else if (d.submitted) bits.push('intake not accepted yet');

  return (
    <div
      className="mt-1 pl-2 border-l-2 border-border"
      data-testid={`board-permit-${d.permitId}`}
    >
      <div className="text-[10px] font-bold text-text">
        {/* ★ fix-304 §20: the permit number is a LINK straight to the permit,
            in the queue as well as the forecast. */}
        <Link
          to={`/projects/${projectId}?permit=${d.permitId}`}
          className="text-de hover:underline"
          data-testid={`board-permit-${d.permitId}-link`}
        >
          {d.num ?? 'No permit number'}
        </Link>
        <span className="font-normal text-muted"> · {d.type}</span>
        {d.cycleIndex !== null && (
          <span className="font-normal text-dim"> · cycle {d.cycleIndex}</span>
        )}
      </div>
      <div className="text-[9.5px] text-muted font-mono">{bits.join(' · ')}</div>
      <div className="text-[9.5px]">
        {d.cityTarget ? (
          <span
            className={d.cityTargetPassed ? 'text-co font-bold' : 'text-muted'}
            data-testid={`board-permit-${d.permitId}-target`}
          >
            City target {d.cityTarget}
            {d.cityTargetPassed ? ' — passed' : ''}
          </span>
        ) : (
          // ★ Said out loud, not left blank.
          <span className="text-dim italic" data-testid={`board-permit-${d.permitId}-target`}>
            No target date
          </span>
        )}
        <span className="text-dim">
          {' · '}
          {d.daysInState}d {d.stateLabel}
        </span>
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
        <Link to={`/projects/${item.projectId}`} className="hover:underline">
          {item.address}
        </Link>
        {item.permitCount > 1 && (
          <span className="ml-1.5 inline-block text-[8px] font-extrabold uppercase px-1.5 rounded-lg bg-s2 text-muted align-[1px]">
            {item.permitCount} permits
          </span>
        )}
      </div>
      {/* fix-304 §22: both are omitted when empty rather than rendering an
          empty line — the permit detail below carries the facts. */}
      {item.status && (
        <div className="text-[10px] text-muted mt-0.5 leading-snug">{item.status}</div>
      )}
      {item.next && (
        <div className="text-[10.5px] font-bold mt-1 text-text">{item.next}</div>
      )}
      {item.permits.map((d) => (
        <PermitDetailLine key={d.permitId} d={d} projectId={item.projectId} />
      ))}
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
  expanded,
  onToggle,
  subtasksByParent,
  onOpenRow,
}: {
  label: string;
  urgent?: boolean;
  data: BoardSection<ForecastItem>;
  empty: string;
  testid: string;
  onTick: (item: ForecastItem) => void;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  subtasksByParent: Map<string, BoardTask[]>;
  onOpenRow: (item: ForecastItem) => void;
}) {
  const rows = expanded ? data.all : data.items;
  return (
    <>
      <SectionHeader
        label={label}
        total={data.total}
        urgent={urgent}
        capped={data.capped}
        expanded={expanded}
        onToggle={onToggle}
        testid={testid}
      />
      {rows.length === 0 ? (
        <div className="px-3.5 py-2 text-[10px] text-dim" data-testid={`${testid}-empty`}>
          {empty}
        </div>
      ) : (
        rows.map((i) => (
          <ForecastRow
            key={i.key}
            item={i}
            onTick={onTick}
            busy={busy}
            subtasks={i.taskId ? (subtasksByParent.get(i.taskId) ?? []) : []}
            onOpenRow={onOpenRow}
          />
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
  expanded,
  onToggle,
}: {
  label: string;
  urgent?: boolean;
  data: BoardSection<QueueProject>;
  sub?: string;
  testid: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rows = expanded ? data.all : data.items;
  return (
    <>
      <SectionHeader
        label={sub ? `${label} · ${sub}` : label}
        total={data.total}
        urgent={urgent}
        capped={data.capped}
        expanded={expanded}
        onToggle={onToggle}
        testid={testid}
      />
      {rows.length === 0 ? (
        <div className="px-3.5 py-2 text-[10px] text-dim" data-testid={`${testid}-empty`}>
          Nothing here.
        </div>
      ) : (
        rows.map((i) => <QueueRow key={i.key} item={i} />)
      )}
    </>
  );
}

export default function MyBoard() {
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const tasksQ = useAllTasks();
  const team = useTeamMembers();
  const holdsQ = useAllProjectHolds();
  const { identity } = useSelfScope();
  // fix-298 Phase 2: the scraper feed the old nav bell used to own.
  const activityQ = useScraperActivity();
  const acksQ = useMilestoneAcks();
  const ackMilestone = useAckMilestone();
  const upsertTask = useUpsertTask();
  const handoff = useConfirmHandoff();
  const dmGroups = useDmDaGroups();

  // fix-303 §1: which sections the user has expanded. Keyed by testid so every
  // section — including the per-report team ones — gets its own toggle.
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const isExpanded = (id: string) => expandedSections.has(id);

  // fix-303 §3: the task open in the editor drawer. A drawer rather than a
  // third column so the two-panel fixed-height contract is untouched.
  const [openTask, setOpenTask] = useState<BoardTask | null>(null);
  const navigate = useNavigate();

  // ★ fix-304 §19 (register #19). Phase 3 wired the drawer to item.task, which
  // is null on every milestone — so on a board made entirely of milestones,
  // Bobby's, NOTHING opened. Every row opens something now:
  //   task, or milestone with a task behind it -> the editor drawer
  //   milestone with no task                   -> the permit it is about
  function onOpenRow(item: ForecastItem) {
    if (item.task) {
      setOpenTask(item.task);
      return;
    }
    if (item.projectId) {
      navigate(
        item.permitId != null
          ? `/projects/${item.projectId}?permit=${item.permitId}`
          : `/projects/${item.projectId}`,
      );
    }
  }

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
    const tasksByPermit = new Map<number, BoardTask[]>();
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

  // ★ Subtasks grouped by taskNesting.nestSubtasks — the helper fix-294 wrote
  // for My Tasks and Project Overview, not a second implementation.
  const subtasksByParent = useMemo(() => {
    const groups = nestSubtasks(allTasks ?? []);
    const m = new Map<string, BoardTask[]>();
    for (const g of groups) m.set(g.task.id, g.subtasks);
    return m;
  }, [allTasks]);

  const forecast = useMemo(() => buildForecast(input), [input]);
  const queue = useMemo(() => buildQueue(input), [input]);

  // fix-303 §2: the people this viewer is responsible for. Derived from data,
  // never from a name list — an oversight entitlement leader picks up the other
  // ent leads; a design manager picks up their DAs via dm_da_groups.
  const teamQueues: TeamQueue[] = useMemo(() => {
    const entReports = entitlementReportsFor(viewer, permitsQ.data ?? []).map((owner) => ({
      owner,
      relationship: 'entitlement-lead' as const,
    }));
    const designReports = designReportsFor(viewer, dmGroups.rows ?? []).map((owner) => ({
      owner,
      relationship: 'design-associate' as const,
    }));
    const reports = [...entReports, ...designReports];
    return reports.length === 0 ? [] : buildTeamQueues(input, reports);
  }, [viewer, permitsQ.data, dmGroups.rows, input]);

  // ★ The mapping gap. Only shown to someone who manages people — it is their
  // structure that is wrong — and never silently swallowed.
  const mappingGap = useMemo(
    () =>
      teamMappingGap(
        team.all ?? [],
        dmGroups.rows ?? [],
        permitsQ.data ?? [],
        input.cancelledIds,
      ),
    [team.all, dmGroups.rows, permitsQ.data, input.cancelledIds],
  );
  const showGap =
    teamQueues.length > 0 &&
    (mappingGap.unassignedDas.length > 0 || mappingGap.formerInGroups.length > 0);
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
                subtasksByParent={subtasksByParent}
                onOpenRow={onOpenRow}
                expanded={isExpanded('board-sec-past-due')}
                onToggle={() => toggleSection('board-sec-past-due')}
              />
              <ForecastSection
                label="Today"
                urgent
                data={forecast.today}
                empty="Nothing due today."
                testid="board-sec-today"
                onTick={onTick}
                busy={busy}
                subtasksByParent={subtasksByParent}
                onOpenRow={onOpenRow}
                expanded={isExpanded('board-sec-today')}
                onToggle={() => toggleSection('board-sec-today')}
              />
              <ForecastSection
                label="Tomorrow"
                data={forecast.tomorrow}
                empty="Nothing scheduled."
                testid="board-sec-tomorrow"
                onTick={onTick}
                busy={busy}
                subtasksByParent={subtasksByParent}
                onOpenRow={onOpenRow}
                expanded={isExpanded('board-sec-tomorrow')}
                onToggle={() => toggleSection('board-sec-tomorrow')}
              />
              <ForecastSection
                label="This week"
                data={forecast.this_week}
                empty="Nothing else this week."
                testid="board-sec-this-week"
                onTick={onTick}
                busy={busy}
                subtasksByParent={subtasksByParent}
                onOpenRow={onOpenRow}
                expanded={isExpanded('board-sec-this-week')}
                onToggle={() => toggleSection('board-sec-this-week')}
              />
              {/* fix-304 §23 (register #23): "maybe even like a next week
                  column" — same capping and Show All as every other section. */}
              <ForecastSection
                label="Next week"
                data={forecast.next_week}
                empty="Nothing next week."
                testid="board-sec-next-week"
                onTick={onTick}
                busy={busy}
                subtasksByParent={subtasksByParent}
                onOpenRow={onOpenRow}
                expanded={isExpanded('board-sec-next-week')}
                onToggle={() => toggleSection('board-sec-next-week')}
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
                expanded={isExpanded('board-sec-blocked')}
                onToggle={() => toggleSection('board-sec-blocked')}
              />
              <QueueSection
                label="Waiting on design"
                urgent
                data={queue.waiting_on_design}
                testid="board-sec-waiting-design"
                expanded={isExpanded('board-sec-waiting-design')}
                onToggle={() => toggleSection('board-sec-waiting-design')}
              />
              <QueueSection
                label="Waiting on the city"
                sub="nothing for you to do"
                data={queue.waiting_on_city}
                testid="board-sec-waiting-city"
                expanded={isExpanded('board-sec-waiting-city')}
                onToggle={() => toggleSection('board-sec-waiting-city')}
              />

              {/* ★ fix-303 §2: TEAM QUEUES. A split, never a merge — each
                  report gets their own titled block so whose queue a row
                  belongs to is never ambiguous. More people means more
                  sections to scroll through, never a taller page. */}
              {teamQueues.length > 0 && (
                <div data-testid="board-team-wrap">
                  <SectionHeader
                    label="Your team"
                    total={teamQueues.length}
                    capped={false}
                    testid="board-sec-team"
                  />
                  {showGap && (
                    // ★ THE MAPPING GAP, SAID OUT LOUD. A board that quietly
                    // omits Cam — the largest DA load in the company — is worse
                    // than one that says he is unassigned.
                    <div
                      className="px-3.5 py-2 bg-co-bg border-b border-border"
                      data-testid="board-team-gap"
                    >
                      {mappingGap.unassignedDas.length > 0 && (
                        <div className="text-[10px] text-co" data-testid="board-gap-unassigned">
                          <b>
                            {mappingGap.unassignedDas.length} active designer
                            {mappingGap.unassignedDas.length === 1 ? '' : 's'} not assigned
                            to any manager
                          </b>
                          {' — '}
                          {mappingGap.unassignedDas
                            .map((d) => `${d.name} (${d.activePermits})`)
                            .join(', ')}
                          . Their work appears on nobody&apos;s team queue.
                        </div>
                      )}
                      {mappingGap.formerInGroups.length > 0 && (
                        <div
                          className="text-[10px] text-muted mt-1"
                          data-testid="board-gap-former"
                        >
                          Former staff still in a manager group —{' '}
                          {mappingGap.formerInGroups
                            .map((d) => `${d.name} (${d.activePermits})`)
                            .join(', ')}
                          .
                        </div>
                      )}
                      {/* ★ Deliberately NOT a link. Settings is a modal owned
                          by Chrome, so there is no /settings/team URL — a Link
                          there would fall through the catch-all to the
                          dashboard, which is exactly the dead-control failure
                          this ticket opened with. The editor already exists
                          (Settings → Team → Team structure) and already offers
                          reassignment, so this points at it in words. */}
                      <div className="text-[10px] text-muted" data-testid="board-gap-fix-hint">
                        An admin can reassign them in Settings → Team → Team structure.
                      </div>
                    </div>
                  )}
                  {teamQueues.map((tq) => (
                    <div key={tq.owner} data-testid={`board-team-${tq.owner}`}>
                      <SectionHeader
                        label={`${tq.owner} · ${
                          tq.relationship === 'entitlement-lead'
                            ? 'entitlement lead'
                            : 'design associate'
                        }`}
                        total={
                          tq.queue.blocked_on_you.total +
                          tq.queue.waiting_on_design.total +
                          tq.queue.waiting_on_city.total
                        }
                        capped={false}
                        testid={`board-sec-team-${tq.owner}`}
                      />
                      <QueueSection
                        label={`${tq.owner} — blocked`}
                        data={tq.queue.blocked_on_you}
                        testid={`board-sec-team-${tq.owner}-blocked`}
                        expanded={isExpanded(`board-sec-team-${tq.owner}-blocked`)}
                        onToggle={() => toggleSection(`board-sec-team-${tq.owner}-blocked`)}
                      />
                      <QueueSection
                        label={`${tq.owner} — waiting on design`}
                        data={tq.queue.waiting_on_design}
                        testid={`board-sec-team-${tq.owner}-design`}
                        expanded={isExpanded(`board-sec-team-${tq.owner}-design`)}
                        onToggle={() => toggleSection(`board-sec-team-${tq.owner}-design`)}
                      />
                      <QueueSection
                        label={`${tq.owner} — with the city`}
                        data={tq.queue.waiting_on_city}
                        testid={`board-sec-team-${tq.owner}-city`}
                        expanded={isExpanded(`board-sec-team-${tq.owner}-city`)}
                        onToggle={() => toggleSection(`board-sec-team-${tq.owner}-city`)}
                      />
                    </div>
                  ))}
                </div>
              )}

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

      {/* ★ fix-303 §3: the task editor, in a drawer. Absolutely positioned so
          the board's fixed height and per-panel scroll are untouched — the
          layout contract asserted since Phase 1 still holds with it open. */}
      {openTask && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/20"
          onClick={() => setOpenTask(null)}
          data-testid="board-task-drawer-backdrop"
        >
          <div
            className="w-[420px] max-w-full h-full bg-surface border-l border-border overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            data-testid="board-task-drawer"
          >
            <div className="flex items-center px-3.5 py-2 border-b border-border bg-s2">
              <span className="text-[12px] font-extrabold text-text">Task</span>
              <button
                type="button"
                onClick={() => setOpenTask(null)}
                className="ml-auto text-[11px] text-muted hover:text-text bg-transparent border-none"
                data-testid="board-task-drawer-close"
              >
                Close ✕
              </button>
            </div>
            <TaskDetailEditor task={openTask} members={team.all ?? []} />
          </div>
        </div>
      )}
    </div>
  );
}
