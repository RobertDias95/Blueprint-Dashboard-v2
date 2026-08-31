import { useShowUnclaimed } from '../../hooks/useShowUnclaimed';

// ===========================================================================
// ★★★ fix-458 §B5 — "UNCLAIMED (17)", AND THE COUNT IS THE WHOLE POINT
// ===========================================================================
//
// P-106: seventeen open tasks reach nobody. Twelve are `results_ready` —
// "Permit approved / issued — send out approved plans / results" — the
// deliverable a client is waiting for. The oldest has been open since
// 2026-06-25 on a permit issued 2026-03-19: sixty-six days of nobody being
// able to see it was owed.
//
// ★★★ THE COUNT RENDERS WHETHER OR NOT THE SWITCH IS ON. A filter that shows
// nothing until you click it repeats the exact failure this ticket is about —
// the work was always there, it just never appeared in front of anybody. The
// number is the surface; the switch is only how you get to the rows.
//
// ★★ AND IT DISAPPEARS AT ZERO, deliberately. An empty queue should read as
// solved, not as a control you keep checking. §A5 makes the same choice for the
// Settings panel's empty state — this panel being empty is the goal.
//
// ★ Unlike its two neighbours on this row (fix-409's Show held work, fix-445's
//   Co-assigned) this switch is NOT subtractive: those hide rows from a list
//   you can already see, this one shows a list that is in nobody's "mine" by
//   definition. So its lit state means "you are looking at the queue", not "a
//   filter is hiding things".

export default function UnclaimedToggle({
  count,
  testid = 'mytasks-filter-unclaimed',
}: {
  /** How many tasks reach nobody right now. Zero renders no control at all. */
  count: number;
  testid?: string;
}) {
  const { showUnclaimed, setShowUnclaimed } = useShowUnclaimed();

  // ★ Nothing to clear, nothing to say. See the block above.
  if (count <= 0 && !showUnclaimed) return null;

  return (
    <button
      type="button"
      onClick={() => setShowUnclaimed(!showUnclaimed)}
      role="switch"
      aria-checked={showUnclaimed}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border whitespace-nowrap"
      style={
        showUnclaimed
          ? {
              background: 'var(--color-co-bg)',
              borderColor: 'var(--color-co)',
              color: 'var(--color-co)',
            }
          : {
              background: 'var(--color-surface)',
              borderColor: 'var(--color-co-border, var(--color-border))',
              color: 'var(--color-co)',
            }
      }
      title={
        showUnclaimed
          ? 'Showing work that reaches nobody. Click to go back to your board.'
          : `${count} open ${count === 1 ? 'task' : 'tasks'} resolve to no owner — they are on no board and in no one's My Tasks. Click to see them.`
      }
      data-testid={testid}
      data-on={showUnclaimed ? 'true' : 'false'}
      data-count={count}
    >
      <span aria-hidden="true">⚠</span>
      Unclaimed
      <span
        className="font-bold tabular-nums"
        data-testid={`${testid}-count`}
      >
        {count}
      </span>
    </button>
  );
}
