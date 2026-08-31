import { useAgendaMemberNames, useIsAgendaMember } from '../hooks/useAgendaMember';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import WeeklyUpdate from '../components/WeeklyUpdate/WeeklyUpdate';

// ===========================================================================
// ★★★ fix-462 (P-045) — THE AGENDA
// ★★★ fix-465 §D (P-115) — …AND THIS PAGE NO LONGER OWNS IT
// ===========================================================================
//
// ★★★ THERE IS NO AGENDA SYSTEM, AND THAT IS THE DESIGN. An agenda item is a
// `team_tasks` row carrying a flag. Nothing is copied, nothing syncs, and "put
// it on the agenda" and "assign it" are two properties of ONE object.
//
// ★★ SO THIS PAGE FETCHES NOTHING OF ITS OWN. The block it renders reads
// `useAllTasks` — the same `bp_list_tasks` every board already reads — and
// filters. That is why an agenda item appears on its assignee's board and in
// their My Tasks with **no board code edited anywhere**: there is nothing to
// integrate, which is Bobby's *"nothing agreed in the meeting dies in a list
// nobody reopens"*.
//
// ---------------------------------------------------------------------------
// ★★★ fix-465 §D2 — WHY THE LIST LEFT THIS FILE, AND WHY THAT IS NOT A DEMOTION
// ---------------------------------------------------------------------------
// The agenda used to be built here: tabs, list, composer, empty state. The
// Weekly Update was then rendered underneath it. That made the PAGE the only
// place the agenda existed — and the modal, which is the screen the whole
// meeting is looking at on a Wednesday morning, showed the snapshot and the SSS
// card and nothing to talk about.
//
// The block now lives in `WeeklyUpdate`, which BOTH surfaces render, so there
// is exactly one agenda and this page gets it the same way the modal does.
// ★★ THIS PAGE MUST NOT ALSO RENDER ONE. Two renderings of one list is how
// they start disagreeing, and it would put two "+ Agenda item" buttons on one
// screen. What is left here is the page's own chrome — a heading, and who is
// in the meeting — which the modal supplies for itself in its own header.
//
// ★ ONE RUNNING LIST SHOWN AS TWO — open and closed, now as the mock's tabs.
// NOT per-meeting: no meeting dates, no archive, no minutes, no attendance.

export default function Agenda() {
  const isMember = useIsAgendaMember();
  const isAdmin = useIsTenantAdmin();
  const memberNames = useAgendaMemberNames();

  return (
    <div className="space-y-3 p-3" data-testid="agenda-page">
      <header className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-[15px] font-display font-bold text-text">Agenda</h1>
      </header>

      {/* ★ Who is in the meeting, stated rather than implied. A reader who
          wonders why a colleague cannot see this screen has the answer here. */}
      {memberNames.length > 0 && (
        <p className="text-[11.5px]" style={{ color: 'var(--color-muted)' }} data-testid="agenda-members">
          In the meeting: {memberNames.join(', ')}.
          {!isMember && isAdmin && (
            <>
              {' '}
              ★ You are seeing this as an admin, not as a member.
            </>
          )}
        </p>
      )}

      {/* ★★★ fix-465 §D5 — agenda, then snapshot, then the SSS card, in that
          order, and identical to what the modal shows. `surface="page"` changes
          exactly one sentence: the empty-state hint, which on this screen
          explains how an item gets here rather than asking whether anything
          wants raising right now. */}
      <WeeklyUpdate surface="page" />
    </div>
  );
}
