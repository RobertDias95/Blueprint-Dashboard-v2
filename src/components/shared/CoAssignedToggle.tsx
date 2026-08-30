import { useShowCoAssigned } from '../../hooks/useShowCoAssigned';

// ===========================================================================
// ★★★ fix-445 §A2 — "CO-ASSIGNED", THE SWITCH THAT SEPARATES MINE FROM SHARED
// ===========================================================================
//
// Bobby, 2026-08-29 (ruling 4 / P-047): *"No separate DM board. Same board,
// ONE new toggle that shows/hides work you are co-assigned on."*
//
// ★★ IT READS THE PREFERENCE ITSELF, like fix-409's ShowHeldWorkToggle beside
// it — no `value`/`onChange` props, so a caller cannot wire it to a second
// source of truth or forget the setter.
//
// ---------------------------------------------------------------------------
// ★★★ DISABLED UNDER "EVERYONE", NOT HIDDEN
// ---------------------------------------------------------------------------
//
// The switch subtracts from a list defined by "is this MINE", so it has no
// meaning when the list is everybody's work — there is no "your" co-assignment
// to hide. Hiding the control would make the row silently change shape between
// two scopes and leave the reader wondering where a switch went; disabling it
// with a reason keeps the row stable and answers the question in place. This is
// fix-406's rule about controls that cannot act: say why, do not vanish.
//
// ★ The ON state is the PLAIN one here, and that inverts Show held work
// deliberately. Held work defaults off, so its lit state means "you asked for
// extra". This defaults ON, so the state worth shouting about is OFF — a
// filter IS applied and, for five people on this roster, it is hiding 80–100%
// of their work. The lit state is therefore the narrowed one.

export default function CoAssignedToggle({
  testid = 'co-assigned',
  disabled = false,
}: {
  testid?: string;
  /** True under the Everyone scope — see the block above. */
  disabled?: boolean;
}) {
  const { showCoAssigned, setShowCoAssigned } = useShowCoAssigned();
  // ★ Under Everyone the control reads as its resting state whatever the
  //   stored value is, so it never advertises a filter that is not running.
  const on = disabled ? true : showCoAssigned;
  const narrowed = !on;
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        setShowCoAssigned(!showCoAssigned);
      }}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border whitespace-nowrap"
      style={
        narrowed
          ? {
              background: 'var(--color-de-bg, var(--color-surface))',
              borderColor: 'var(--color-de)',
              color: 'var(--color-de)',
            }
          : {
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-muted)',
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'not-allowed' : undefined,
            }
      }
      title={
        disabled
          ? 'Co-assigned only applies to your own work. Switch to My Work to use it.'
          : narrowed
            ? 'Co-assigned work is hidden — you are seeing only tasks you own. Click to show work you share.'
            : 'Co-assigned work is shown. Click to see only the tasks you own.'
      }
      data-testid={testid}
      data-on={on ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
    >
      <span aria-hidden>👥</span>
      Co-assigned
    </button>
  );
}
