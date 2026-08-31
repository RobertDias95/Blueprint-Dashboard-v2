import { useMemo, useState } from 'react';
import { useAllTasks } from '../hooks/useTaskTree';
import { useUpsertTeamTask } from '../hooks/useTeamTasks';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useIsAgendaMember, useAgendaMemberNames } from '../hooks/useAgendaMember';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import { TaskStatusOverlayProvider } from '../lib/taskStatusOverlay';
import { splitAgenda } from '../lib/agenda';
import { todayIso } from '../lib/myBoard';
import { TaskCard } from './MyTasks';
import TeamTaskComposer from '../components/MyTasks/TeamTaskComposer';

// ===========================================================================
// ★★★ fix-462 (P-045) — THE AGENDA
// ===========================================================================
//
// ★★★ THERE IS NO AGENDA SYSTEM, AND THAT IS THE DESIGN. An agenda item is a
// `team_tasks` row carrying a flag. Nothing is copied, nothing syncs, and "put
// it on the agenda" and "assign it" are two properties of ONE object.
//
// ★★ SO THIS PAGE FETCHES NOTHING OF ITS OWN. It reads `useAllTasks` — the same
// `bp_list_tasks` every board already reads — and filters. That is why an
// agenda item appears on its assignee's board and in their My Tasks with **no
// board code edited anywhere**: there is nothing to integrate, which is Bobby's
// *"nothing agreed in the meeting dies in a list nobody reopens"*.
//
// ★★★ AND THE ROWS ARE THE SAME COMPONENT MY TASKS RENDERS — `TaskCard`,
// imported, not copied. Bobby: *"it would look very similar to the milestones in
// MyTask so that it fits and blends with our existing system."* The only way to
// guarantee that is for it to BE the same row: same statuses, same dates, same
// tag slot, same click-to-open, same write path.
//
// ★ ONE RUNNING LIST SHOWN AS TWO — open above, closed below. NOT per-meeting:
// no meeting dates, no archive, no minutes, no attendance.

export default function Agenda() {
  return (
    // ★ The optimistic status layer, so ticking an item here behaves exactly as
    //   it does on My Tasks (fix-434). Without it TaskCard still works —
    //   NOOP_OVERLAY returns the server status — but a click would wait for the
    //   round trip, and "the same row" would quietly stop being true.
    <TaskStatusOverlayProvider>
      <AgendaBody />
    </TaskStatusOverlayProvider>
  );
}

function AgendaBody() {
  const tasksQ = useAllTasks();
  const team = useTeamMembers();
  const isMember = useIsAgendaMember();
  const isAdmin = useIsTenantAdmin();
  const memberNames = useAgendaMemberNames();
  const upsert = useUpsertTeamTask();
  const today = useMemo(() => todayIso(), []);
  const [selected, setSelected] = useState<string | null>(null);

  const { open, closed } = useMemo(
    () => splitAgenda(tasksQ.data ?? []),
    [tasksQ.data],
  );

  if (tasksQ.isLoading) {
    return (
      <div className="p-3 text-xs text-muted" data-testid="agenda-loading">
        Loading the agenda…
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3" data-testid="agenda-page">
      <header className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-[15px] font-display font-bold text-text">Agenda</h1>
        <span className="text-[11px] text-muted">
          One running list. {open.length} open · {closed.length} closed.
        </span>
        <span className="flex-1" />
        {/* ★★ §C3 — adding an item from the Agenda screen is fix-460's composer
            with one field pre-set. NOT a new flow and NOT a second create path:
            an agenda item is a team task, so the thing that creates team tasks
            creates these. */}
        <TeamTaskComposer
          memberNames={team.all}
          agenda
          testidPrefix="agenda-task"
          addLabel="+ Agenda item"
        />
      </header>

      {/* ★ Who is in the meeting, stated rather than implied. A reader who
          wonders why a colleague cannot see this screen has the answer here. */}
      {memberNames.length > 0 && (
        <p className="text-[10px] text-muted" data-testid="agenda-members">
          In the meeting: {memberNames.join(', ')}.
          {!isMember && isAdmin && (
            <>
              {' '}
              ★ You are seeing this as an admin, not as a member.
            </>
          )}
        </p>
      )}

      <AgendaList
        title="Open"
        testId="agenda-open"
        tasks={open}
        today={today}
        selected={selected}
        onSelect={setSelected}
        empty="Nothing on the agenda. Add an item, or tick one from anywhere a task is created."
      />

      {/* ★★★ §C4's other half, and it is worth stating: the closed list is the
          SAME list. An item does not move between two places when it is
          finished — its status changes and it renders below. That is what "one
          running list shown as two" means. */}
      <AgendaList
        title="Closed"
        testId="agenda-closed"
        tasks={closed}
        today={today}
        selected={selected}
        onSelect={setSelected}
        empty="Nothing has been closed out yet."
        muted
      />

      {upsert.isPending && (
        <p className="text-[10px] text-muted" data-testid="agenda-saving">
          Saving…
        </p>
      )}
    </div>
  );
}

function AgendaList({
  title,
  testId,
  tasks,
  today,
  selected,
  onSelect,
  empty,
  muted = false,
}: {
  title: string;
  testId: string;
  tasks: readonly import('../lib/database.types').MyTaskNode[];
  today: string;
  selected: string | null;
  onSelect: (id: string) => void;
  empty: string;
  muted?: boolean;
}) {
  return (
    <section
      className="rounded border"
      style={{ borderColor: 'var(--color-border)', opacity: muted ? 0.85 : 1 }}
      data-testid={testId}
    >
      <header
        className="px-2.5 py-1.5 border-b flex items-baseline gap-2"
        style={{ borderBottomColor: 'var(--color-border)' }}
      >
        <span className="text-[11px] font-bold uppercase tracking-wide text-dim">
          {title}
        </span>
        <span className="text-[11px] text-muted" data-testid={`${testId}-count`}>
          {tasks.length}
        </span>
      </header>
      <div className="p-2 flex flex-col gap-1.5">
        {tasks.length === 0 ? (
          <span className="text-[11px] text-muted" data-testid={`${testId}-empty`}>
            {empty}
          </span>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              today={today}
              isSelected={selected === t.id}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </section>
  );
}
