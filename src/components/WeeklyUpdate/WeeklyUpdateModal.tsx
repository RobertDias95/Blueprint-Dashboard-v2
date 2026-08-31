import { useWeeklyEdition } from '../../hooks/useWeeklyEdition';
import { editionAgeDays } from '../../lib/weeklyEdition';
import WeeklyUpdate from './WeeklyUpdate';

// ===========================================================================
// ★★★ fix-463 §B2 (P-108) — THE MODAL OVER THE BRIDGE
// ===========================================================================
//
// Bobby: *"…so that when they wake up their computer that's the first thing that
// they see on the bridge until they acknowledge it."*
//
// ★★ IT RENDERS OVER WHATEVER SCREEN YOU ARE ON, because it is mounted in the
// shell rather than on a route. The trigger is a CLOCK — see useWeeklyEdition
// for the four check points and why a login could not be the trigger.
//
// ★★★ §B4 — A NON-MEMBER NEVER SEES IT. `useWeeklyEdition.shouldShow` is false
// for them whatever the clock says, so this component renders null and the
// modal does not exist for the other 23 people in the tenant.
//
// ★★★ §B5 — ACKNOWLEDGING IS NOT READING, AND THE BUTTON SAYS SO. It records
// that the reminder was dismissed on this edition, for this person. It makes NO
// claim that anybody read anything, and nothing anywhere reports on who has
// "seen" the update — a dismissal count dressed up as attention would be worse
// than no data at all.

export default function WeeklyUpdateModal() {
  const { edition, shouldShow, acknowledge } = useWeeklyEdition();

  if (!shouldShow) return null;

  const age = editionAgeDays(edition);

  return (
    <div
      className="fixed inset-0 z-[9500] flex items-start justify-center pt-10 pb-10 px-4 bg-black/40 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Weekly Update"
      data-testid="weekly-update-modal"
    >
      <div
        className="w-full max-w-[1100px] rounded-lg border shadow-lg"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <header
          className="px-4 py-2.5 border-b flex flex-wrap items-baseline gap-2 sticky top-0 rounded-t-lg"
          style={{ borderBottomColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <h1 className="text-[15px] font-display font-bold text-text">Weekly Update</h1>
          <span className="text-[11px] text-muted" data-testid="weekly-update-edition">
            Week of {edition}
            {age > 0 && ` · ${age} day${age === 1 ? '' : 's'} ago`}
          </span>
          <span className="flex-1" />
          {/* ★★★ §B5: the words matter. "Close" and not "Mark as read" — this
              dismisses a reminder and records nothing about attention. */}
          <button
            type="button"
            onClick={acknowledge}
            className="text-[11px] px-2.5 py-1 rounded border font-bold"
            style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
            data-testid="weekly-update-close"
          >
            Close
          </button>
        </header>
        <div className="p-3">
          {/* ★ §B4: the SAME component the Agenda screen renders. Two renderings
              of one report is how they start disagreeing.
              ★★★ fix-465 §D: and it now carries the AGENDA, so this modal is
              the whole meeting — what to talk about, then the numbers. Before,
              the one screen everybody opens on a Wednesday morning had the
              snapshot and no agenda on it. `surface="modal"` changes exactly
              one sentence: the empty-state hint asks whether anything wants
              raising now, rather than explaining how an item gets here. */}
          <WeeklyUpdate surface="modal" />
          <p className="text-[10px] text-muted pt-2" data-testid="weekly-update-permanence">
            Closing this dismisses the reminder for this week. The Weekly Update
            stays on the Agenda screen — nothing is hidden by closing it.
          </p>
        </div>
      </div>
    </div>
  );
}
