// ===========================================================================
// ★★★ fix-484 §B (P-129) — THE PRIORITY STAR, AND NOW IT IS ONE CONTROL
// ===========================================================================
//
// Bobby: the permit screen SORTS by priority (fix-156 — priority tasks bubble
// to the top of every column) and has never had a way to SET it. You could see
// the effect of a flag you could not reach: the only star in the app was in
// `TaskDetailEditor`, on My Tasks and the board.
//
// ★★★ EXTRACTED, NOT COPIED. The brief's rule — *"one component, two call
// sites"* — and the reason is what happened to `chipStyle` before fix-441 and
// to the two-state toggle before fix-483: a second inline copy is how the two
// stars start disagreeing about what "on" looks like.
//
// ---------------------------------------------------------------------------
// ★★ THE BRAND RULE (2026-09-02), ANSWERED
// ---------------------------------------------------------------------------
// Anything added that is a switch, a tab strip or a disclosure must name the
// shared component it reuses or say why not. This is **not** `TwoStateToggle`,
// and deliberately:
//
//   · `TwoStateToggle` is a pair of LABELLED HALVES choosing between two VIEWS
//     of the same data — My Work / Everyone, Site / Unit, Open / Closed. Both
//     halves are always visible and exactly one is chosen.
//   · This is a single ON/OFF property of one row, in the family of
//     `HoldFilter` and the Project List's `activeOnly` chip: one control, two
//     states, and "off" is the absence of the mark rather than a second option.
//
// Forcing a star into a two-half toggle would put "Not priority" on screen next
// to every task, which is the fix-483 inventory's own reasoning applied to a
// control that is genuinely a different shape.
//
// ★ The ink and the glyph are fix-138-a's, unchanged: `--color-co` filled ★ on,
//   `--color-muted` hollow ☆ off. The permit screen inherits them rather than
//   choosing again.

export default function PriorityStar({
  value,
  onChange,
  disabled = false,
  testid = 'task-detail-priority',
}: {
  value: boolean | null | undefined;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Defaults to the id the detail editor has always used, so its own callers
   *  and every test that reaches for it are untouched. */
  testid?: string;
}) {
  const on = !!value;
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      disabled={disabled}
      className="text-[14px] leading-none px-1"
      style={{
        color: on ? 'var(--color-co)' : 'var(--color-muted)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      data-testid={testid}
      data-priority={on ? 'true' : 'false'}
      aria-pressed={on}
      title={on ? 'Priority on' : 'Priority off'}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
