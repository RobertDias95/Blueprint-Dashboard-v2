import { useShowHeldWork } from '../../hooks/useShowHeldWork';

// ===========================================================================
// ★★★ fix-409 — ONE CONTROL, RENDERED TWICE
// ===========================================================================
//
// Bobby, 2026-08-25 (register P-039): *"anything with a hold gets auto turned
// off, but you can switch that on/off in the my tasks/my boards. and maybe when
// you turn it on in my tasks or my board, it will turn them on together — that
// way they live together in display."*
//
// ★★★ IT READS THE PREFERENCE ITSELF, and takes no `value`/`onChange` props.
// That is the point: two instances cannot be handed two different values, and
// a page cannot forget to wire the setter. Both screens render <ShowHeldWorkToggle />
// and the shared store does the rest — "they live together in display" is
// structural rather than something two call sites have to keep agreeing on.
//
// ★★ THE OFF STATE IS THE PLAIN ONE, deliberately. The default is off, so an
// active-looking control on load would suggest a filter had been applied to
// you. It lights up (amber — the PARK token, the same colour as the chips it
// reveals) only once you have asked for held work, which is exactly when the
// list you are looking at is not the default one and you want to be told.
//
// ★ NOT a `HoldFilterMode` three-way. fix-178's All / Only holds / Exclude
// holds is the PIPELINE's filter, over projects, and it stays. This is a
// two-state switch over your own work, which is what was asked for; a third
// "only held" state on a personal board would be a way to look at a list of
// things you have already decided not to do.

export default function ShowHeldWorkToggle({
  testid = 'show-held-work',
}: {
  testid?: string;
}) {
  const { showHeldWork, setShowHeldWork } = useShowHeldWork();
  return (
    <button
      type="button"
      onClick={() => setShowHeldWork(!showHeldWork)}
      role="switch"
      aria-checked={showHeldWork}
      // ★ The same shape as My Tasks' own filter Toggle and the Pipeline's
      //   chips — text-[11px] px-2 py-1 rounded border — so it reads as one of
      //   the row's controls rather than something bolted on beside them.
      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border whitespace-nowrap"
      style={
        showHeldWork
          ? {
              background: 'var(--color-hold-bg)',
              borderColor: 'var(--color-hold-border)',
              color: 'var(--color-hold-text)',
            }
          : {
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-muted)',
            }
      }
      title={
        showHeldWork
          ? 'Held work is shown. Click to hide tasks and milestones on projects or permits that are on hold.'
          : 'Held work is hidden. Click to show tasks and milestones on projects or permits that are on hold.'
      }
      data-testid={testid}
      data-on={showHeldWork ? 'true' : 'false'}
    >
      <span aria-hidden>⏸</span>
      Show held work
    </button>
  );
}
