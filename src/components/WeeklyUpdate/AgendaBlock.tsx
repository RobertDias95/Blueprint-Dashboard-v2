import { useMemo, useState } from 'react';
import { useAllTasks } from '../../hooks/useTaskTree';
import { useUpsertTeamTask } from '../../hooks/useTeamTasks';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useIsAgendaMember } from '../../hooks/useAgendaMember';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { splitAgenda } from '../../lib/agenda';
import { todayIso } from '../../lib/myBoard';
import { TaskCard } from '../../pages/MyTasks';
import TeamTaskComposer from '../MyTasks/TeamTaskComposer';
import type { MyTaskNode } from '../../lib/database.types';
import TwoStateToggle from '../shared/TwoStateToggle';

// ===========================================================================
// ★★★ fix-465 §D (P-115) — THE AGENDA, IN THE WEEKLY UPDATE
// ===========================================================================
//
// ★★★ THE DEFECT, IN ONE SENTENCE: the Weekly Update modal is the one screen
// the whole meeting is looking at on a Wednesday morning, and it did not
// contain the agenda. fix-463's own header comment said the agenda was
// *"rendered by the Agenda page around this"* — true, and that was the bug.
// The page had it; the modal, which is where people actually are when the
// meeting starts, had five snapshot tables and an SSS card and nothing to talk
// about. Anyone wanting to raise something had to leave the modal to do it.
//
// ★★★ SO THE BLOCK MOVED DOWN, NOT SIDEWAYS. It is not re-implemented for the
// modal: this component is rendered by `WeeklyUpdate`, which BOTH surfaces
// render, so the page and the modal show one agenda by construction. The
// Agenda page no longer renders a list of its own — see the note there.
// Two renderings of one list is how they start disagreeing, which is exactly
// the argument fix-463 made about the report and then did not apply here.
//
// ★★ AND IT FETCHES NOTHING NEW. `useAllTasks` is the same `bp_list_tasks`
// every board already reads and the modal's parent already has in cache.
// fix-462's design holds: an agenda item is a `team_tasks` row carrying a flag,
// so there is no agenda query to add.

/** Which surface is rendering. It changes exactly two things — see below. */
export type AgendaSurface = 'page' | 'modal';

/**
 * ★★ THE ONE SENTENCE THAT DIFFERS, AND IT IS THE MOCK'S OWN DECISION. The
 * mock writes a different empty-state line for each surface, and it is right
 * to: on the Agenda page the reader arrived on purpose and needs to know how
 * an item gets here, while in the modal the meeting is starting NOW and the
 * question is whether anything wants raising. Same block, same list, same
 * control — one sentence of context.
 */
const EMPTY_HINT: Record<AgendaSurface, string> = {
  page: 'Add the first item, or tick Agenda on any task to carry it into the meeting.',
  modal: 'Anything below worth raising? Add it now — it carries into the meeting.',
};

export default function AgendaBlock({
  surface = 'page',
}: {
  surface?: AgendaSurface;
}) {
  const tasksQ = useAllTasks();
  const team = useTeamMembers();
  const isMember = useIsAgendaMember();
  const isAdmin = useIsTenantAdmin();
  const upsert = useUpsertTeamTask();
  const today = useMemo(() => todayIso(), []);
  const [selected, setSelected] = useState<string | null>(null);
  // ★★ ONE RUNNING LIST SHOWN AS TWO, and the mock shows them as TABS rather
  //    than as two stacked sections. That is the right shape for the modal:
  //    the closed list is history, and history should not push the snapshot
  //    off the bottom of a dialog on the one morning everybody reads it.
  //    Nothing moves between lists — an item's STATUS decides which tab holds
  //    it, which is fix-462's "one running list" unchanged.
  const [tab, setTab] = useState<'open' | 'closed'>('open');

  const { open, closed } = useMemo(
    () => splitAgenda(tasksQ.data ?? []),
    [tasksQ.data],
  );

  // ★★★ §D4 — WHO MAY ADD AN ITEM: A MEMBER, OR AN ADMIN.
  //
  // An admin who is not in the meeting already SEES this — fix-462 put the
  // ribbon entry in front of admins deliberately, and the Agenda page says
  // "You are seeing this as an admin, not as a member" rather than hiding.
  // Letting them read the list but not put anything on it would be the worse
  // half of both: they are the person most likely to be told "raise this on
  // Wednesday" and least likely to be in the room. Nothing about an agenda
  // item is privileged — it is a `team_tasks` row whose RLS already decides
  // who may write it, so this is a matter of which control is worth showing,
  // not of permission.
  //
  // ★ The route itself is ungated (router.tsx has no guard on /agenda), so a
  //   non-member non-admin who types the URL gets the list read-only rather
  //   than a create control for a meeting they are not in.
  const canAdd = isMember || isAdmin;

  const shown: readonly MyTaskNode[] = tab === 'open' ? open : closed;

  const composer = canAdd ? (
    // ★★ §C3 (fix-462, unchanged): adding an item is fix-460's composer with
    //    one field pre-set. NOT a new flow and NOT a second create path.
    <TeamTaskComposer
      memberNames={team.all}
      agenda
      testidPrefix="agenda-task"
      addLabel="+ Agenda item"
    />
  ) : null;

  if (tasksQ.isLoading) {
    return (
      <div className="text-xs" style={{ color: 'var(--color-muted)' }} data-testid="agenda-loading">
        Loading the agenda…
      </div>
    );
  }

  return (
    <section data-testid="agenda-block" data-surface={surface} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* ★★★ fix-483 §B (P-137) — THE MOCK'S TAB PAIR IS NOW THE APP'S TOGGLE.
            Bobby, 2026-09-02: *"on pipeline it's like a blue highlight. We want
            that toggle feature to be consistent whether we're on agenda or the
            library."*

            ★★ WHAT IS LOST AND WHY THAT IS THE POINT: fix-465 §B4 measured the
            mock's own inks here and stepped the unselected tab UP to
            `--color-text` on `--color-s3` (11.75:1) because the mock's `--muted`
            was 4.24:1. That measurement was about a strip this no longer draws.
            `chipStyle`'s two states are the app's, and they clear the same floor
            — DE blue with white ink at 5.17:1 selected, `--color-text` on
            `--color-bg` at 12.6:1 unselected — so the legibility fix-465 won is
            kept while the chrome stops being a third opinion.

            ★ THE COUNT SURVIVES ON THE LABEL — "Open · 4" — which is why
            `TwoStateToggle` takes a ReactNode label rather than a string. The
            reader still never has to switch to find out whether the other list
            is worth switching to, and `agenda-tab-open-count` still resolves. */}
        <TwoStateToggle<'open' | 'closed'>
          value={tab}
          onChange={setTab}
          testid="agenda-tabs"
          ariaLabel="Show open or closed agenda items"
          surface="bg"
          options={[
            {
              value: 'open',
              label: (
                <>
                  Open ·{' '}
                  <span data-testid="agenda-tab-open-count">{open.length}</span>
                </>
              ),
              testid: 'agenda-tab-open',
            },
            {
              value: 'closed',
              label: (
                <>
                  Closed ·{' '}
                  <span data-testid="agenda-tab-closed-count">
                    {closed.length}
                  </span>
                </>
              ),
              testid: 'agenda-tab-closed',
            },
          ]}
        />
        <span className="flex-1" />
        {/* ★★ ONE CONTROL (fix-440). When the list is empty the composer moves
            into the body, where the mock puts its call to action — it does not
            appear in both places. */}
        {shown.length > 0 && composer}
      </div>

      <div
        className="rounded border"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
        data-testid={`agenda-${tab}`}
      >
        {shown.length === 0 ? (
          <div className="px-4 py-5 text-center" data-testid={`agenda-${tab}-empty`}>
            <p className="text-[14px] font-bold" style={{ color: 'var(--color-text)' }}>
              {tab === 'open'
                ? 'Nothing on the agenda yet'
                : 'Nothing has been closed out yet'}
            </p>
            {tab === 'open' && (
              <p
                className="text-[12.5px] mt-1.5"
                style={{ color: 'var(--color-muted)' }}
                data-testid="agenda-empty-hint"
              >
                {EMPTY_HINT[surface]}
              </p>
            )}
            {tab === 'open' && composer && <div className="mt-3">{composer}</div>}
          </div>
        ) : (
          <div className="p-2 flex flex-col gap-1.5">
            {/* ★★★ THE ROWS ARE THE SAME COMPONENT MY TASKS RENDERS —
                `TaskCard`, imported, not copied (fix-462). Same statuses, same
                dates, same tag slot, same click-to-open, same write path. */}
            {shown.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                today={today}
                isSelected={selected === t.id}
                onSelect={setSelected}
              />
            ))}
          </div>
        )}
      </div>

      {upsert.isPending && (
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }} data-testid="agenda-saving">
          Saving…
        </p>
      )}
    </section>
  );
}
