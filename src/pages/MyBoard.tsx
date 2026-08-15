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
import { useMilestoneAcks, useAckMilestone } from '../hooks/useMilestoneAcks';
import { useConfirmHandoff } from '../hooks/useConfirmHandoff';
import { useDmDaGroups } from '../hooks/useDmDaGroups';
import { useDaTeamRouting } from '../hooks/useDaTeamRouting';
import { useBoardReads, useMarkBoardItemsRead } from '../hooks/useBoardReads';
import { buildNewItems, keyForTask, unseenItems } from '../lib/boardReads';
import { parseFlips } from '../lib/boardFlips';
import {
  AGING_LEVEL_LABEL,
  buildAging,
  type AgedRow,
  type DataGapRow,
} from '../lib/boardAging';
import { useScraperActivity } from '../hooks/useScraperActivity';
// ★ fix-303 §3: the SAME editor My Tasks uses, lifted out of it so the board is
// not a lesser copy. Not a second editing path — literally the same component,
// the same hooks, the same RPC.
import TaskDetailEditor from '../components/TaskDetailEditor';
import { nestSubtasks } from '../lib/taskNesting';


import { buildHandedOff } from '../lib/boardOwnership';
import {
  BOARD_SECTION_CAPS,
  buildForecast,
  canConfirmHandoff,
  handoffAffordance,
  isDesignTask,
  resolveBoardViewer,
  buildQueueForScope,
  teamMembersFor,
  DEFAULT_QUEUE_SCOPE,
  systemHealth,
  teamMappingGap,
  todayIso,
  type BoardInput,
  type BoardTask,
  type BoardSection,
  type ForecastItem,
  type QueueProject,
  type QueueScope,
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
  isNew = false,
}: {
  item: ForecastItem;
  onTick: (item: ForecastItem) => void;
  busy: boolean;
  subtasks?: BoardTask[];
  /** fix-304 §19: EVERY row opens something. */
  onOpenRow: (item: ForecastItem) => void;
  /** ★ fix-307 #39: unseen rows are highlighted until acknowledged. */
  isNew?: boolean;
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
      className={`px-3.5 py-1.5 border-b border-border/50 ${isNew ? 'bg-de-bg' : ''}`}
      style={{ borderLeft: `3px solid ${rule}` }}
      data-testid={`board-forecast-row-${item.key}`}
      data-actionable={item.actionable ? 'true' : 'false'}
      // ★ fix-307: the highlight, as an attribute a test can read. Clicking the
      // row clears it — WITHOUT resolving anything.
      data-new={isNew ? 'true' : 'false'}
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
            {isNew && (
              <span
                className="ml-1 inline-block text-[8px] font-extrabold uppercase px-1.5 rounded-lg bg-de text-white align-[1px]"
                data-testid={`board-row-new-${item.key}`}
              >
                new
              </span>
            )}
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
                  to={`/project/${item.projectId}`}
                  className="text-de hover:underline"
                  data-testid={`board-row-project-${item.key}`}
                >
                  {item.address ?? 'Project'}
                </Link>
                {item.permitId != null && (
                  <>
                    {' · '}
                    <Link
                      to={`/project/${item.projectId}?permit=${item.permitId}`}
                      className="text-de hover:underline"
                      data-testid={`board-row-permit-${item.key}`}
                    >
                      {item.permitLabel ?? 'Permit'}
                    </Link>
                  </>
                )}
                {/* ★ fix-313 #62 REMOVED the "My Tasks" link that sat here.
                    /my-tasks now redirects to /board, so it would have sent you
                    to the screen you are already on — a control that renders
                    and does nothing, which is the exact defect this codebase
                    has shipped four times. The task still opens: the row itself
                    opens the fix-303 editor drawer, in place. */}
              </>
            ) : (
              item.where
            )}
          </div>
        </div>
        {/* ★ fix-306 #29: the right-hand space was empty. It now carries the
            ACTION — one line saying what to do — above the date, so the row
            answers "what am I supposed to do with this" without a click. */}
        <div className="ml-auto text-right pl-2 flex-none max-w-[46%]">
          {item.actionLine && (
            <div
              className={`text-[10px] font-bold leading-tight ${
                item.actionable ? 'text-text' : 'text-dim'
              }`}
              data-testid={`board-row-action-${item.key}`}
            >
              {item.actionLine}
            </div>
          )}
          <div className={`text-[9px] whitespace-nowrap ${tone}`}>
            <b className="text-[10px]">
              {item.daysLate > 0
                ? `${item.daysLate}d late`
                : item.daysLate === 0
                  ? 'today'
                  : item.date.slice(5)}
            </b>
          </div>
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

/** ★ fix-306 #33: one permit line that SCANS.
 *
 *  "Address, permit number, and then a bunch of tags… a lot of white open
 *  space, it just looks like it's not formatted, it's not reading very well."
 *
 *  Redesigned around what matters, in order: which permit · what state · what
 *  date · how long. The left column holds identity, the right column holds the
 *  clock — so the eye runs down two aligned edges instead of hunting through a
 *  ragged block of tags. The horizontal space is used for the dates rather
 *  than padded with sentences (#22 stays cut).
 *
 *  ★ A missing date still says so in words. */
function PermitDetailLine({
  d,
  projectId,
}: {
  d: QueuePermitDetail;
  projectId: string;
}) {
  return (
    <div
      className="mt-1 flex items-baseline gap-2 text-[10px]"
      data-testid={`board-permit-${d.permitId}`}
    >
      {/* Identity — which permit. */}
      <div className="min-w-0 flex-1">
        <Link
          to={`/project/${projectId}?permit=${d.permitId}`}
          className="font-bold text-de hover:underline"
          data-testid={`board-permit-${d.permitId}-link`}
        >
          {d.num ?? 'No permit number'}
        </Link>
        <span className="text-muted"> · {d.type}</span>
        {d.cycleIndex !== null && (
          <span className="text-dim"> · cy{d.cycleIndex}</span>
        )}
      </div>

      {/* State + how long — the middle question. */}
      <div className="text-dim whitespace-nowrap" data-testid={`board-permit-${d.permitId}-state`}>
        {d.daysInState}d {d.stateLabel}
      </div>

      {/* The clock — right-aligned so it forms a column down the panel. */}
      <div
        className="text-right whitespace-nowrap w-[104px] flex-none"
        data-testid={`board-permit-${d.permitId}-target`}
      >
        {d.cityTarget ? (
          <span className={d.cityTargetPassed ? 'text-co font-bold' : 'text-muted'}>
            target {d.cityTarget.slice(5)}
            {d.cityTargetPassed ? ' ⚑' : ''}
          </span>
        ) : (
          <span className="text-dim italic">No target date</span>
        )}
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
      {/* Project — the headline, with the state and count on the same line so
          the row opens with "where is this and what does it need". */}
      <div className="flex items-baseline gap-2">
        <Link
          to={`/project/${item.projectId}`}
          className="text-[11.5px] font-extrabold text-text hover:underline truncate"
          data-testid={`board-queue-project-${item.key}`}
        >
          {item.address}
        </Link>
        {item.permitCount > 1 && (
          <span className="text-[9px] text-dim flex-none">{item.permitCount} permits</span>
        )}
        {item.status && (
          <span className="text-[10px] text-muted ml-auto flex-none truncate">
            {item.status}
          </span>
        )}
      </div>
      {item.next && (
        <div className="text-[10.5px] font-bold text-text mt-0.5">{item.next}</div>
      )}
      {item.permits.map((d) => (
        <PermitDetailLine key={d.permitId} d={d} projectId={item.projectId} />
      ))}
    </div>
  );
}

/** ★ fix-305: an ageing permit — what state, how long, what is expected, and
 *  whose it is. Ranked by age, so 227 days can never sit below 22. */
function AgedPermitRow({
  row,
  onChase,
  busy,
}: {
  row: AgedRow;
  onChase: (row: AgedRow) => void;
  busy: boolean;
}) {
  const tone =
    row.level === 'priority'
      ? 'text-co'
      : row.level === 'task'
        ? 'text-wa'
        : 'text-muted';
  return (
    <div
      className="px-3.5 py-2 border-b border-border/50"
      data-testid={`board-aged-${row.permitId}`}
      data-level={row.level}
      data-days={row.daysInState}
    >
      <div className="flex items-baseline gap-2">
        <Link
          to={`/project/${row.projectId}?permit=${row.permitId}`}
          className="text-[11.5px] font-extrabold text-text hover:underline truncate"
          data-testid={`board-aged-${row.permitId}-link`}
        >
          {row.address}
        </Link>
        <span className={`text-[9px] font-extrabold uppercase ml-auto flex-none ${tone}`}>
          {AGING_LEVEL_LABEL[row.level]}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-0.5 text-[10px]">
        <span className="text-muted truncate flex-1">{row.permitLabel}</span>
        <span className={`whitespace-nowrap font-bold ${tone}`}>
          {row.daysInState}d in state
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className="text-[10px] text-muted">{row.expectation}</span>
        {row.cityTarget && row.cityTargetLevel !== 'none' && (
          <span className="text-[9px] text-co" data-testid={`board-aged-${row.permitId}-target`}>
            city target {row.cityTarget} passed
          </span>
        )}
        {/* ★ At the task rung the board OFFERS the chase rather than writing
            it unattended — see the note on onChase in MyBoard. Rows whose
            clock started before the deploy never offer it. */}
        {row.level !== 'acknowledge' && row.mayCreateTask && (
          <button
            type="button"
            onClick={() => onChase(row)}
            disabled={busy}
            className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded border border-de text-de bg-bg hover:bg-de-bg disabled:opacity-40 flex-none"
            data-testid={`board-aged-${row.permitId}-chase`}
          >
            {row.verb}
          </button>
        )}
      </div>
    </div>
  );
}

/** ★ Permits in a tracked state with nothing to measure from. Surfaced, never
 *  given an invented clock — 35 of the 37 "additional info requested" permits
 *  have neither an approval date nor a submitted date. */
function DataGapRowView({ row }: { row: DataGapRow }) {
  return (
    <div
      className="px-3.5 py-1.5 border-b border-border/50 flex items-baseline gap-2"
      data-testid={`board-gap-${row.permitId}`}
    >
      <Link
        to={`/project/${row.projectId}?permit=${row.permitId}`}
        className="text-[11px] font-bold text-text hover:underline truncate flex-1"
      >
        {row.address}
      </Link>
      <span className="text-[10px] text-muted truncate">{row.permitLabel}</span>
      <span className="text-[9.5px] text-dim italic whitespace-nowrap">
        no {row.missing}
      </span>
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
  isNewRow,
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
  isNewRow: (item: ForecastItem) => boolean;
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
            isNew={isNewRow(i)}
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
  const readsQ = useBoardReads();
  const markRead = useMarkBoardItemsRead();
  const dmGroups = useDmDaGroups();
  const entRouting = useDaTeamRouting();

  // ★ fix-306 #35: the queue's scope. Defaults to MY QUEUE so nobody is handed
  // 90 permits on load.
  const [queueScope, setQueueScope] = useState<QueueScope>(DEFAULT_QUEUE_SCOPE);

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
  /** ★ fix-307: is this row one of the viewer's unseen items? Only task rows
   *  carry a stable board-item key today (a milestone row is derived state, not
   *  an event); the flip that CAUSED it is the acknowledgeable thing and lives
   *  in the bell. */
  function isNewRow(item: ForecastItem): boolean {
    return item.taskId ? unseenKeys.has(keyForTask(item.taskId)) : false;
  }

  /** ★ fix-305: create the chase task the ladder calls for.
   *
   *  The brief says "7 days -> task auto-create". This OFFERS it on a click
   *  rather than writing it unattended, and the reason is not squeamishness:
   *  a client render has no idempotency. Every mount, for every viewer who can
   *  see the permit, would insert — Miles and Briana both hold Concord, so one
   *  permit would produce two tasks, and a refresh would produce two more.
   *  True unattended creation belongs in the scraper or a scheduled job, where
   *  it runs once and can be made idempotent; that is the follow-up. Everything
   *  else about the ladder — when it fires, who owns it, the day-one rule — is
   *  implemented here, and the click writes through the SAME useUpsertTask
   *  every other task write on this board uses.
   */
  function onChaseAged(row: AgedRow) {
    upsertTask.mutate({
      permitId: row.permitId,
      discipline: row.owner === 'design' ? 'arch' : 'ent',
      text: `${row.verb} — ${row.daysInState}d in ${row.state.replace(/_/g, ' ')}`,
      status: 'Open',
    });
  }

  function onOpenRow(item: ForecastItem) {
    // ★★ READ IS NOT DONE. Opening a row acknowledges it — the badge drops and
    // the highlight clears — and it stays exactly where it was on the board,
    // still past due, still needing doing. Nothing here resolves anything.
    if (item.taskId) markRead.mutate([keyForTask(item.taskId)]);
    if (item.task) {
      setOpenTask(item.task);
      return;
    }
    if (item.projectId) {
      navigate(
        item.permitId != null
          ? `/project/${item.projectId}?permit=${item.permitId}`
          : `/project/${item.projectId}`,
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

  // ★ fix-307 (register #39): which board rows are NEW to this person. Always
  // personal — built from the viewer's own items, never from the queue scope,
  // so drilling into Fisk's queue cannot highlight or clear anything of his.
  const readKeys = useMemo(() => new Set(readsQ.data ?? []), [readsQ.data]);
  const newItems = useMemo(
    () =>
      buildNewItems({
        flips: parseFlips(activityQ.data ?? []),
        tasks: allTasks ?? [],
        acks: acksQ.data ?? [],
        permits: permitsQ.data ?? [],
        viewerName: viewer.name,
      }),
    [activityQ.data, allTasks, acksQ.data, permitsQ.data, viewer.name],
  );
  // Not wrapped in useMemo: the React Compiler cannot preserve a manual memo
  // around a Set construction here, and it memoizes this for us anyway.
  const unseenKeys = new Set(unseenItems(newItems, readKeys).map((i) => i.key));

  // ★ fix-305 (register #24): TIME-IN-STATE, not time-since-update. The Concord
  // Building Permit was touched 4 days ago and has sat in Ready for Intake for
  // 94 — the record is fresh, the state is stale, and only this catches it.
  const aging = useMemo(() => {
    const byId = new Map((projectsQ.data ?? []).map((pr) => [pr.id, pr.address]));
    return buildAging({
      permits: permitsQ.data ?? [],
      projectAddress: (id) => byId.get(id) ?? 'Unknown address',
      today: input.today,
      viewerName: viewer.name,
      isOversight: viewer.isOversight,
      cancelledIds: input.cancelledIds,
    });
  }, [permitsQ.data, projectsQ.data, input.today, input.cancelledIds, viewer]);

  const forecast = useMemo(() => buildForecast(input), [input]);

  // ★ fix-308 #46 — "Handed off — waiting on others". THE OUTGOING SIDE.
  //
  // Not to be confused with `handoffs` below, which is INCOMING: things I could
  // hand on now. This is what I have ALREADY passed on and am waiting to get
  // back — Bobby's "hey, I sent this to you two days ago, why haven't you
  // resubmitted this". They are kept distinct by what they derive from:
  // `handoffs` reads handoffAffordance; this reads the rows that are no longer
  // actionable for me because the other half now holds them.
  //
  // ★★ It shows age and climbs WITHIN the section, and it NEVER escalates.
  // No task, no priority, no notification, however old — that obligation is
  // the receiver's, and fix-305's ladder already escalates it on their board.
  const handedOff = useMemo(() => {
    const all = [
      ...forecast.past_due.items,
      ...forecast.today.items,
      ...forecast.tomorrow.items,
      ...forecast.this_week.items,
      ...forecast.next_week.items,
    ];
    return buildHandedOff(
      all.map((i) => ({ ...i, withWhom: i.entLead ?? '' })),
    );
  }, [forecast]);
  // ★ fix-306 #35: the people this viewer may scope the queue to. Derived from
  // dm_da_groups (design managers), da_team_routing (entitlement leads), or
  // everyone (oversight). A design associate gets an empty list and therefore
  // no toggle at all.
  const teamNames = useMemo(() => {
    const everyone = [
      ...new Set(
        (permitsQ.data ?? [])
          .flatMap((p) => [p.da, p.ent_lead])
          .map((n) => (n ?? '').trim())
          .filter(Boolean),
      ),
    ];
    return teamMembersFor(viewer, dmGroups.rows ?? [], entRouting.data ?? [], everyone);
  }, [viewer, dmGroups.rows, entRouting.data, permitsQ.data]);

  // ★ THE RULE: the scope reaches the QUEUE and nothing else. buildForecast is
  // called with `input` untouched, so a manager's day stays their own however
  // they filter the queue. The test for this is the one most likely to catch a
  // regression, and it exists.
  const queue = useMemo(
    () => buildQueueForScope(input, queueScope, teamNames),
    [input, queueScope, teamNames],
  );


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
  // The gap is shown to anyone who manages people — it is their structure
  // that is wrong — and only when there is a gap to show.
  const showGap =
    teamNames.length > 0 &&
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
    // ★ Ticking marks read as a side effect — you have plainly seen a thing you
    // just acted on. The reverse is deliberately NOT true: marking read never
    // ticks anything.
    if (item.taskId) markRead.mutate([keyForTask(item.taskId)]);
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
      // ★ fix-313: was calc(100vh - 52px), the old header height. <main> is
      // now a bounded flex child, so the board fills it instead of measuring
      // the viewport and being 48px of padding out.
      style={{ height: '100%' }}
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
        {/* ★ fix-313 #62: the "My Tasks →" link is gone with the destination.
            My Board IS the personal view now; a link from here to here would
            be furniture that lies. */}
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
                isNewRow={isNewRow}
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
                isNewRow={isNewRow}
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
                isNewRow={isNewRow}
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
                isNewRow={isNewRow}
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
                isNewRow={isNewRow}
                expanded={isExpanded('board-sec-next-week')}
                onToggle={() => toggleSection('board-sec-next-week')}
              />

              {/* ★ fix-308 #46: its own section, at the BOTTOM of the forecast.
                  When the design half is done the row LEAVES the dated buckets
                  — it is no longer past due FOR THE SENDER — and lands here
                  with who it went to and how long ago. */}
              {handedOff.length > 0 && (
                <div data-testid="board-sec-handed-off-wrap">
                  <SectionHeader
                    label="Handed off — waiting on others"
                    total={handedOff.length}
                    capped={handedOff.length > BOARD_SECTION_CAPS.queueGroup}
                    testid="board-sec-handed-off"
                  />
                  {handedOff
                    .slice(0, BOARD_SECTION_CAPS.queueGroup)
                    .map((h) => (
                      <div
                        key={h.key}
                        className="px-3.5 py-2 border-b border-border/50"
                        data-testid={`board-handed-off-row-${h.key}`}
                        data-days-ago={h.daysAgo}
                        /* ★ Never a task, never a priority — asserted. */
                        data-escalates="false"
                      >
                        <div className="text-[11.5px] text-text truncate">{h.where}</div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {h.withWhom} · {h.daysAgo} day{h.daysAgo === 1 ? '' : 's'}
                        </div>
                      </div>
                    ))}
                </div>
              )}
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
            {/* ★ fix-306 #35: My queue · My team · [person]. A filter on the
                existing queue, not a separate page. Absent entirely for a
                design associate, who has no team to filter to. */}
            {teamNames.length > 0 && (
              <div
                className="px-3.5 py-1.5 border-b border-border flex items-center gap-1 flex-wrap flex-none"
                data-testid="board-queue-scope"
              >
                <button
                  type="button"
                  onClick={() => setQueueScope({ mode: 'mine' })}
                  className={`text-[10px] px-2 py-0.5 rounded border ${
                    queueScope.mode === 'mine'
                      ? 'bg-de text-white border-de'
                      : 'bg-bg text-muted border-border hover:text-text'
                  }`}
                  data-testid="board-scope-mine"
                  aria-pressed={queueScope.mode === 'mine'}
                >
                  My queue
                </button>
                <button
                  type="button"
                  onClick={() => setQueueScope({ mode: 'team' })}
                  className={`text-[10px] px-2 py-0.5 rounded border ${
                    queueScope.mode === 'team'
                      ? 'bg-de text-white border-de'
                      : 'bg-bg text-muted border-border hover:text-text'
                  }`}
                  data-testid="board-scope-team"
                  aria-pressed={queueScope.mode === 'team'}
                >
                  My team ({teamNames.length})
                </button>
                <select
                  value={queueScope.mode === 'person' ? (queueScope.person ?? '') : ''}
                  onChange={(e) =>
                    setQueueScope(
                      e.target.value
                        ? { mode: 'person', person: e.target.value }
                        : { mode: 'mine' },
                    )
                  }
                  className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-bg text-text"
                  data-testid="board-scope-person"
                  aria-label="Filter the queue to one person"
                >
                  <option value="">— one person —</option>
                  {teamNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                {showGap && (
                  <span
                    className="text-[9px] text-co ml-auto"
                    data-testid="board-scope-gap"
                    title="Some active designers are not assigned to any manager"
                  >
                    ⚑ {mappingGap.unassignedDas.length} unassigned
                  </span>
                )}
              </div>
            )}
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

              {/* ★ fix-305 (register #24): DID THE THING ACTUALLY HAPPEN?
                  Permits ranked by how long they have sat in one state — not
                  by how long since the row was touched. Concord's Building
                  Permit is here at 94 days despite being scraped 4 days ago. */}
              {aging.aged.length > 0 && (
                <div data-testid="board-aging-wrap">
                  <SectionHeader
                    label="Did this happen?"
                    total={aging.aged.length}
                    urgent
                    capped={aging.aged.length > BOARD_SECTION_CAPS.queueGroup}
                    expanded={isExpanded('board-sec-aging')}
                    onToggle={() => toggleSection('board-sec-aging')}
                    testid="board-sec-aging"
                  />
                  {(isExpanded('board-sec-aging')
                    ? aging.aged
                    : aging.aged.slice(0, BOARD_SECTION_CAPS.queueGroup)
                  ).map((row) => (
                    <AgedPermitRow
                      key={row.key}
                      row={row}
                      onChase={onChaseAged}
                      busy={busy}
                    />
                  ))}
                </div>
              )}

              {/* ★ The permits that cannot be aged. Surfaced rather than
                  silently omitted — omitting them is the missing-vs-absent
                  failure, and it is how Concord happened. */}
              {aging.dataGaps.length > 0 && (
                <div data-testid="board-datagap-wrap">
                  <SectionHeader
                    label="Cannot be tracked — missing dates"
                    total={aging.dataGaps.length}
                    capped={aging.dataGaps.length > BOARD_SECTION_CAPS.queueGroup}
                    expanded={isExpanded('board-sec-datagap')}
                    onToggle={() => toggleSection('board-sec-datagap')}
                    testid="board-sec-datagap"
                  />
                  {(isExpanded('board-sec-datagap')
                    ? aging.dataGaps
                    : aging.dataGaps.slice(0, BOARD_SECTION_CAPS.queueGroup)
                  ).map((row) => (
                    <DataGapRowView key={row.key} row={row} />
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
