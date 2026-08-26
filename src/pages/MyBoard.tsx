import BoardLensControl from '../components/BoardLensControl';
import { useBoardLens } from '../hooks/useBoardLens';
import { focusItems, groupItems, type AssociateGroup } from '../lib/boardByAssociate';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import OriginLink from '../components/OriginLink';
import { useOriginState } from '../hooks/useOriginState';
import ShowHeldWorkToggle from '../components/shared/ShowHeldWorkToggle';
import { useShowHeldWork } from '../hooks/useShowHeldWork';
import { HoldBadge } from '../components/shared/HoldBadge';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
// fix-303: the SAME task source My Tasks uses, so the board is not a lesser
// copy — one shape, one editor, one write path.
import { useAllTasks, useUpsertTask } from '../hooks/useTaskTree';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useSelfScope } from '../hooks/useSelfScope';
import {
  cancelledProjectIds,
  useAllProjectHolds,
} from '../hooks/useProjectHolds';
import { useAllPermitHolds } from '../hooks/usePermitHolds';
import { useMilestoneAcks, useAckMilestone } from '../hooks/useMilestoneAcks';
import { useBoardNotifications } from '../hooks/useBoardNotifications';
import { useConfirmHandoff } from '../hooks/useConfirmHandoff';
import { useDmDaGroups } from '../hooks/useDmDaGroups';
import { useDaTeamRouting } from '../hooks/useDaTeamRouting';
import { useTaskOwnership } from '../hooks/useTaskOwnership';
import { useBoardReads, useMarkBoardItemsRead } from '../hooks/useBoardReads';
import { buildNewItems, keyForTask, unseenItems } from '../lib/boardReads';
import { useMyMentions } from '../hooks/useProjectMessages';
// ★ fix-339: the same shared-item query the bell reads — one source, so the
// board and the badge cannot disagree about an open post request.
import { useMyPostRequests } from '../hooks/usePostRequests';
import { useAutoClosures } from '../hooks/useAutoClosures';
import { useAuthStore } from '../stores/authStore';
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
  sourceSplit,
  systemHealth,
  teamMappingGap,
  todayIso,
  type BoardInput,
  type BoardTask,
  type BoardSection,
  type ForecastItem,
  type QueueScope,
} from '../lib/myBoard';
// ★ fix-397: the queue's own vocabulary — kinds, bands, and the row shape.
import {
  QUEUE_KIND_LABEL,
  type QueueBandGroup,
  type QueueRow,
} from '../lib/projectQueue';

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
  split,
}: {
  label: string;
  total: number;
  urgent?: boolean;
  capped: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  testid: string;
  /** ★★ fix-348: the composition of a BLENDED section — how many of the total
   *  are milestones and how many are tasks. The cap shows five of Miles's 202
   *  past-due rows; without this the header says "202" and a reader has no way
   *  to tell whether his tasks are in there at all, which is the complaint this
   *  ticket started from. Rendered only when the section holds both kinds. */
  split?: { milestones: number; tasks: number };
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
        {split && split.milestones > 0 && split.tasks > 0 && (
          <span data-testid={`${testid}-split`}>
            {' · '}
            {split.milestones} milestone{split.milestones === 1 ? '' : 's'}
            {' · '}
            {split.tasks} task{split.tasks === 1 ? '' : 's'}
          </span>
        )}
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
            {/* ★★★ fix-409: a held row is only here because the viewer asked
                for it, so it says WHY it is quiet. Bobby: "an on hold
                chip/color filter or something to tell the difference."
                `holdChip` is null on every other row, and HoldBadge renders
                nothing for a null hold, so this costs untouched rows nothing. */}
            {item.isHeld && (
              <span className="ml-1">
                <HoldBadge
                  hold={item.hold}
                  compact
                  testid={`board-row-hold-${item.key}`}
                />
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
                <OriginLink
                  to={`/project/${item.projectId}`}
                  className="text-de hover:underline"
                  data-testid={`board-row-project-${item.key}`}
                >
                  {item.address ?? 'Project'}
                </OriginLink>
                {item.permitId != null && (
                  <>
                    {' · '}
                    <OriginLink
                      to={`/project/${item.projectId}?permit=${item.permitId}`}
                      className="text-de hover:underline"
                      data-testid={`board-row-permit-${item.key}`}
                    >
                      {item.permitLabel ?? 'Permit'}
                    </OriginLink>
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
          {/* ★ fix-308b #45: the row now carries THREE facts — its STATE, the
              ACTION, and WHY IT IS YOURS. Bobby: "maybe that needs some sort of
              a note section where it says 'past due' and then 'here's the
              action item' … to help understand what we're supposed to do or why
              it's on our list."

              ★ Structure, not more prose — #22's verbiage cut stands. Each is a
              short clause, and "why" is a ROLE ("You are the entitlement lead
              on this permit"), not a sentence about the permit. */}
          {item.stateLabel && (
            <div
              className={`text-[9px] font-extrabold uppercase tracking-wide leading-tight ${
                item.daysLate > 0 ? 'text-co' : 'text-dim'
              }`}
              data-testid={`board-row-state-${item.key}`}
            >
              {item.stateLabel}
            </div>
          )}
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
          {item.whyYours && (
            <div
              className="text-[9px] text-dim leading-tight"
              data-testid={`board-row-why-${item.key}`}
            >
              {item.whyYours}
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


/** ★★★ fix-397 — one flat queue row: the owner's priority list.
 *
 *  Ruling 1 (2026-08-24): the ADDRESS is the headline, not the project group.
 *  A project with two due permits renders two of these — 554 N 75th does
 *  exactly that on Bobby's live board, its SDOT Tree leading the list and its
 *  PAR/Pre-Sub four rows below.
 *
 *  ★ The row answers, left to right: what kind of work · where · which permit ·
 *  what state it is in · how due it is. */
function QueueRowView({ row }: { row: QueueRow }) {
  const pastDue = row.band === 'past_due';
  return (
    <div
      className={`px-3.5 py-2 border-b border-border/50 flex items-start gap-2 ${
        pastDue ? 'border-l-2 border-l-de bg-de-bg/30' : ''
      }`}
      data-testid={`board-queue-row-${row.key}`}
      data-kind={row.kind}
      data-band={row.band}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span
            className="text-[8.5px] font-extrabold uppercase tracking-wide px-1 py-px rounded flex-none"
            style={{
              background: 'var(--color-de-bg)',
              color: 'var(--color-de)',
              border: '1px solid var(--color-de)',
            }}
            data-testid={`board-queue-kind-${row.key}`}
          >
            {QUEUE_KIND_LABEL[row.kind]}
          </span>
          {/* ★ fix-409: a queue row is only here while held if the viewer asked
              for held work — the queue gates on `quiet`. Say why it is quiet. */}
          {row.isHeld && (
            <HoldBadge
              hold={row.hold}
              compact
              testid={`board-queue-hold-${row.key}`}
            />
          )}
          <OriginLink
            to={`/project/${row.projectId}`}
            className="text-[11.5px] font-extrabold text-text hover:underline truncate"
            data-testid={`board-queue-address-${row.key}`}
          >
            {row.address}
          </OriginLink>
        </div>
        {/* ★ The permit itself is still one click away — the old queue's row
            offered that and losing it would be a quiet regression. */}
        <div className="text-[10px] text-muted mt-0.5 truncate">
          <OriginLink
            to={`/project/${row.projectId}?permit=${row.permitId}`}
            className="text-de hover:underline"
            data-testid={`board-queue-permit-${row.key}`}
          >
            {row.num ?? 'no number yet'} · {row.type}
          </OriginLink>
          {row.cycleIndex != null && ` · cycle ${row.cycleIndex}`}
        </div>
        <div className="text-[10px] text-dim mt-px truncate">{row.stateLine}</div>
      </div>
      {/* ★ Due-ness in WORDS over the date. Never a bare number, never blank —
          a blank reads as zero, which is fix-303's rule carried forward. */}
      <div className="flex-none text-right">
        <div
          className={`text-[10.5px] font-extrabold ${pastDue ? 'text-de' : 'text-text'}`}
          data-testid={`board-queue-due-${row.key}`}
        >
          {row.dueWords}
        </div>
        {row.due && <div className="text-[9px] text-dim">{row.due}</div>}
      </div>
    </div>
  );
}

/** ★★ A band header plus its rows. Empty bands never reach here — the bands are
 *  a sort, not a checklist, so there is deliberately no "Nothing here" row. */
function QueueBandBlock({ group }: { group: QueueBandGroup }) {
  return (
    <>
      <div
        className="px-3.5 py-1 bg-s2 border-b border-border flex items-baseline gap-1.5 sticky top-0"
        data-testid={`board-queue-band-${group.band}`}
      >
        <span
          className={`text-[8.5px] font-extrabold uppercase tracking-wide ${
            group.band === 'past_due' ? 'text-de' : 'text-muted'
          }`}
        >
          {group.label}
        </span>
        <span className="text-[8.5px] text-dim">{group.rows.length}</span>
      </div>
      {group.rows.map((r) => (
        <QueueRowView key={r.key} row={r} />
      ))}
    </>
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
        <OriginLink
          to={`/project/${row.projectId}?permit=${row.permitId}`}
          className="text-[11.5px] font-extrabold text-text hover:underline truncate"
          data-testid={`board-aged-${row.permitId}-link`}
        >
          {row.address}
        </OriginLink>
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
      <OriginLink
        to={`/project/${row.projectId}?permit=${row.permitId}`}
        className="text-[11px] font-bold text-text hover:underline truncate flex-1"
      >
        {row.address}
      </OriginLink>
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
  groups = null,
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
  /** ★★ fix-365: split this bucket's rows by design associate, or null to
   *  render them as one list. Passed as a FUNCTION rather than as computed
   *  groups so a bucket nobody is looking at costs nothing. */
  groups?: ((items: ForecastItem[]) => AssociateGroup[] | null) | null;
}) {
  const rows = expanded ? data.all : data.items;
  // ★★★ URGENCY STAYS OUTERMOST. This splits the rows of ONE bucket; it cannot
  // reorder across buckets because it never sees across them. "Past due" still
  // reads first, still carries its own count, and every row inside it is still
  // rendered by the same ForecastRow — so a past-due item is past-due in
  // exactly the way it was before, grouped or not.
  const grouped = groups ? groups(rows) : null;
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
        split={sourceSplit(data.all)}
      />
      {rows.length === 0 ? (
        <div className="px-3.5 py-2 text-[10px] text-dim" data-testid={`${testid}-empty`}>
          {empty}
        </div>
      ) : grouped ? (
        grouped.map((g) => (
          <div key={g.label} data-testid={`${testid}-group-${g.label}`}>
            {/* ★ A quiet sub-heading, deliberately lighter than SectionHeader:
                the bucket is the section, this is a divider inside it. */}
            <div
              className="px-3.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-muted bg-bg border-b border-border flex items-center gap-1.5"
              data-testid={`${testid}-group-head-${g.label}`}
            >
              <span>{g.label}</span>
              <span className="text-dim font-bold">{g.items.length}</span>
            </div>
            {g.items.map((i) => (
              <ForecastRow
                key={i.key}
                item={i}
                onTick={onTick}
                busy={busy}
                subtasks={i.taskId ? (subtasksByParent.get(i.taskId) ?? []) : []}
                onOpenRow={onOpenRow}
                isNew={isNewRow(i)}
              />
            ))}
          </div>
        ))
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


export default function MyBoard() {
  // ★ fix-336: the SAME notification model the bell counts from, so the link
  // below can never show a different number than the badge two inches above it.
  const notifications = useBoardNotifications();
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const tasksQ = useAllTasks();
  const team = useTeamMembers();
  const holdsQ = useAllProjectHolds();
  // ★ fix-390: the permit-scoped siblings, one bulk fetch like its sibling.
  const permitHoldsQ = useAllPermitHolds();
  // ★ fix-409: shared with My Tasks — see hooks/useShowHeldWork.
  const { showHeldWork } = useShowHeldWork();
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
  // ★ fix-348: fix-238's ownership resolver, shared with My Tasks.
  const taskOwnership = useTaskOwnership();
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
  const originState = useOriginState();

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
      // ★★ fix-408: the ONE imperative entry path on this page. Every other
      //    row here is an <OriginLink>; this one cannot be, because the click
      //    also marks the notification read and may open a task panel instead
      //    of navigating at all. `useOriginState()` is the same helper wearing
      //    a different shape — see hooks/useOriginState.
      navigate(
        item.permitId != null
          ? `/project/${item.projectId}?permit=${item.permitId}`
          : `/project/${item.projectId}`,
        { state: originState() },
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
      // ★★ fix-390: which projects and which permits are paused. The board
      // silences a held permit's milestone chips — reversibly, and without
      // writing an ack. Project holds cover their permits; a permit hold covers
      // ONLY its permit and never rolls up.
      holdRows: holdsQ.data ?? [],
      permitHoldRows: permitHoldsQ.data ?? [],
      // ★★★ fix-409: the one preference, shared with My Tasks. Default false,
      // which is byte-for-byte fix-390's behaviour; true brings held tasks AND
      // the milestones fix-390 silenced back, each wearing a hold chip.
      showHeldWork,
      acks: acksQ.data ?? [],
      // ★★ fix-348: the blended forecast asks "is this task mine?" with fix-238's
      // resolver — the SAME predicate the My Tasks bar directly below this panel
      // counts with. Two surfaces on one screen must not disagree about who a
      // task belongs to, and before this they did: the board compared
      // `assigned_to` as a raw string, so a task routed to a ROLE, or with no
      // assignee at all (344 of 558 open tasks on prod), reached nobody here.
      taskOwns: taskOwnership.matches,
    }),
    [
      viewer,
      permitsQ.data,
      projectsQ.data,
      tasksQ.data,
      holdsQ.data,
      permitHoldsQ.data,
      showHeldWork,
      acksQ.data,
      taskOwnership.matches,
    ],
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
  const mentionsQ = useMyMentions();
  const postRequestsQ = useMyPostRequests();
  // ★ fix-354: the eighth board source, on the board's own call site.
  const autoClosuresQ = useAutoClosures();
  const viewerUserId = useAuthStore((s) => s.user?.id ?? null);
  const readKeys = useMemo(() => new Set(readsQ.data ?? []), [readsQ.data]);
  const newItems = useMemo(
    () =>
      buildNewItems({
        flips: parseFlips(activityQ.data ?? []),
        tasks: allTasks ?? [],
        acks: acksQ.data ?? [],
        permits: permitsQ.data ?? [],
        viewerName: viewer.name,
        // ★ fix-329: the board and the bell read the SAME new-items builder with
        // the SAME inputs, so a chat mention cannot be news in one and not the
        // other.
        mentions: mentionsQ.data ?? [],
        viewerUserId,
        projects: projectsQ.data ?? [],
        // ★ fix-339: and the shared post requests, from the SAME query the bell
        // uses — a request open in the badge and absent from the board would be
        // exactly the two-sources defect fix-298 Phase 2 collapsed.
        postRequests: postRequestsQ.data ?? [],
        // ★ fix-354: the board re-derives the item list, so the eighth source
        // has to be added HERE as well as in useBoardNotifications — two call
        // sites, one model, and they must not disagree.
        autoClosures: autoClosuresQ.data ?? [],
      }),
    [
      activityQ.data,
      allTasks,
      acksQ.data,
      permitsQ.data,
      viewer.name,
      mentionsQ.data,
      viewerUserId,
      projectsQ.data,
      postRequestsQ.data,
      autoClosuresQ.data,
    ],
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

  // ★★ fix-365: the manager's lens. `hasAssociates` is false for 25 of the 29
  // logins, and the control simply does not render for them — a control that
  // does nothing for you is the clutter fix-331 and fix-345 removed.
  const boardLens = useBoardLens();
  // ★ A milestone row has no assignee; its design associate is the PERMIT's
  // `da`. Built once here, where the permits already are, and handed to the
  // pure functions as a lookup so they never go fetching.
  const daOfPermit = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const p of permitsQ.data ?? []) map.set(p.id, p.da ?? null);
    return (permitId: number | null) =>
      permitId == null ? null : (map.get(permitId) ?? null);
  }, [permitsQ.data]);

  /** ★★★ FOCUS narrows a bucket; GROUP sections it. Applied per bucket, never
   *  across them — see lib/boardByAssociate for why urgency stays outermost. */
  const lensSection = useCallback(
    (data: BoardSection<ForecastItem>): BoardSection<ForecastItem> => {
      if (!boardLens.hasAssociates || !boardLens.lens.focus) return data;
      const all = focusItems(
        data.all,
        boardLens.lens.focus,
        boardLens.associates,
        daOfPermit,
      );
      // ★ The section's own contract: `total` is the TRUE total of what it
      // holds, and `items` is the capped head of it. Rebuilding both keeps the
      // header's count honest about the focused view rather than about the
      // board behind it.
      const cap = data.items.length === data.all.length ? all.length : data.items.length;
      return {
        total: all.length,
        items: all.slice(0, Math.max(cap, 0)),
        capped: all.length > Math.max(cap, 0),
        all,
      };
    },
    [boardLens.hasAssociates, boardLens.lens.focus, boardLens.associates, daOfPermit],
  );

  const lensGroups = useCallback(
    (items: ForecastItem[]) =>
      boardLens.hasAssociates &&
      boardLens.lens.mode === 'group' &&
      boardLens.associates.length > 1
        ? groupItems(items, boardLens.associates, daOfPermit)
        : null,
    [boardLens.hasAssociates, boardLens.lens.mode, boardLens.associates, daOfPermit],
  );

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
  //
  // ★★★ fix-348 — TWO BUGS LIVED IN THE SIX LINES THIS REPLACES.
  //
  // It read the rendered dated buckets and mapped EVERY non-actionable row into
  // this section, with `withWhom: i.entLead` hardcoded. So:
  //
  //   1. THE SAME ROW APPEARED TWICE ON ONE SCREEN. Deriving from the buckets
  //      does not remove anything from them — the comment above claims the row
  //      "LEAVES the dated buckets" and nothing ever made it leave. On
  //      4137 54th Ave SW · PAR/Pre-Sub that produced Bobby's screenshot
  //      exactly: PAST DUE *and* HANDED OFF, one permit, one board.
  //   2. IT NAMED THE WRONG PERSON, in the wrong direction. `!actionable`
  //      catches BOTH halves of the relay, and an ENTITLEMENT-leg row waiting
  //      on the DA is INCOMING — the opposite of handed off. Naming the ent
  //      lead on it told Bobby he had handed the permit to himself, one line
  //      away from a row saying it was with Cam.
  //
  // Both are gone at the source: buildForecast now splits the outgoing rows out
  // of the buckets and carries the counterparty on each item, from the single
  // milestoneCounterparty definition.
  const handedOff = useMemo(
    () =>
      buildHandedOff(
        forecast.handed_off.map((i) => ({ ...i, withWhom: i.withWhom ?? '' })),
      ),
    [forecast],
  );
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

        {/* ★★★ fix-336 §2: the second half of "there's nowhere that shows, hey,
            here are your notifications". The bell is in the top bar on every
            screen; My Board is where you go to see what is on you, and it had
            no way to reach the list at all. The count is the SAME number the
            badge shows — one model (useBoardNotifications), rendered twice. */}
        {/* ★★★ fix-409 — THE SWITCH. Bobby: "anything with a hold gets auto
            turned off, but you can switch that on/off in the my tasks/my
            boards." It sits in the page header, with the board's other
            whole-board controls, and it is the SAME component My Tasks renders
            — one preference, so flipping it here flips it there. */}
        <span className="ml-auto">
          <ShowHeldWorkToggle testid="my-board-show-held" />
        </span>

        <Link
          to="/notifications"
          className="text-[11px] font-bold text-de hover:underline no-underline"
          data-testid="my-board-notifications-link"
          data-unread={String(notifications.unseenCount)}
        >
          Notifications
          {notifications.unseenCount > 0 ? ` · ${notifications.unseenCount}` : ''} →
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
              {/* ★★ fix-378: milestones whose driving date was already past
                  when the permit row was created are backfilled history and
                  are not raised — but the COUNT is, because a quiet board and
                  a muted one must never look the same (fix-298's rule). */}
              {forecast.suppressedHistoric > 0 && (
                <div
                  className="text-[10px] text-muted mt-px"
                  data-testid="board-forecast-historic-suppressed"
                >
                  {forecast.suppressedHistoric} not shown: dated before the
                  record existed
                </div>
              )}
              {/* ★★ fix-365: a design manager's lens over their own board.
                  Renders for the four people who have associates and for
                  nobody else. It sits INSIDE the Forecast header because that
                  is the panel it acts on — the queue below is projects, not
                  people's work. */}
              {boardLens.hasAssociates && (
                <div className="mt-1.5">
                  <BoardLensControl
                    associates={boardLens.associates}
                    lens={boardLens.lens}
                    onChange={boardLens.setLens}
                    unmanaged={boardLens.unmanaged}
                  />
                </div>
              )}
            </div>
            {/* Independent scroll: the panel grows internally, the page does not. */}
            <div className="overflow-y-auto flex-1 min-h-0" data-testid="my-board-forecast-scroll">
              <ForecastSection
                label="Past due"
                urgent
                data={lensSection(forecast.past_due)}
                groups={lensGroups}
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
                data={lensSection(forecast.today)}
                groups={lensGroups}
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
                data={lensSection(forecast.tomorrow)}
                groups={lensGroups}
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
                data={lensSection(forecast.this_week)}
                groups={lensGroups}
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
                data={lensSection(forecast.next_week)}
                groups={lensGroups}
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

          {/* ── RIGHT: PROJECT QUEUE — the owner's priority list (fix-397) ── */}
          <div className="flex flex-col min-h-0" data-testid="my-board-queue">
            <div className="px-3.5 py-2 bg-s2 border-b border-border flex-none">
              <div className="text-[12.5px] font-extrabold text-text">Project queue</div>
              <div className="text-[10px] text-muted mt-px" data-testid="board-queue-subhead">
                {queue.total} due · submittals, corrections and city review on your permits
                {queue.pastDue > 0 && (
                  <span className="text-de font-bold"> · {queue.pastDue} past due</span>
                )}
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

              {/* ★★★ fix-397 — THE OWNER'S PRIORITY LIST.
                  One flat list of the viewer's permits, banded by how due they
                  are, most urgent first. No project grouping and no caps: a
                  band is a sort, not a top-five, and capping "Past due" is how
                  554 N 75th's SDOT Tree got lost below two permits due a week
                  later in the first place.

                  ★★ "Blocked on you" and "Waiting on design" used to render
                  here. Bobby, 2026-08-24: "i am not sure how well 'Blocked on
                  you' and 'Waiting on design' is built out and if it is serving
                  a function. i think we remove those for the time being until
                  that gets built out in depth better. but this will serve a
                  better purpose i think." A RULING, not an accident. */}
              {queue.bands.length === 0 ? (
                <div
                  className="px-3.5 py-3 text-[10px] text-dim"
                  data-testid="board-queue-empty"
                >
                  Nothing due on your permits.
                </div>
              ) : (
                queue.bands.map((g) => <QueueBandBlock key={g.band} group={g} />)
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
