import { RETIRED_PALETTE, retiredHatch, type RetiredCause } from '../../lib/retiredState';

// ===========================================================================
// ★★★ fix-524 §A — ONE BADGE, TWO RETIRED STATES
// ===========================================================================
//
// fix-263 gave the cancelled badge its hatch by pointing `HoldBadge` at
// `--hatch-cancelled`, so that the badge, the block and the legend were
// literally the same paint. §A adds a second retired state and rules that the
// treatment is shared — so this is the badge both of them render through, and
// `HoldBadge`'s cancelled branch delegates here rather than keeping a second
// copy of the same five style lines.
//
// ★ The BADGE and the BLOCK are still two components, deliberately: a block is
//   positioned inside a grid and carries a phase, a badge is inline text. What
//   they share is `RETIRED_PALETTE` and `retiredHatch`, which is the part that
//   would otherwise drift.

export default function RetiredBadge({
  cause,
  title,
  compact,
  suffix,
  testid,
}: {
  cause: RetiredCause;
  /** Hover text. The caller owns it because the two causes know different
   *  things: a cancel has a reason and a date, a redesign has a successor. */
  title?: string;
  /** ★ fix-409's shape: glyph + word only, for task rows. */
  compact?: boolean;
  /** Appended after the state's name — the cancel reason, for the badge
   *  `HoldBadge` has rendered since fix-262. Dropped in `compact`. */
  suffix?: string | null;
  testid?: string;
}) {
  const p = RETIRED_PALETTE[cause];
  const cls = compact
    ? 'inline-block text-[8.5px] font-bold uppercase tracking-wider px-1 py-0 rounded border whitespace-nowrap align-middle'
    : 'inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap';
  return (
    <span
      className={cls}
      style={{
        background: retiredHatch(cause),
        color: p.text,
        borderColor: p.border,
        // ★ The strike-through is part of the retired treatment, not part of
        //   "cancelled": Bobby described the pattern as *"all those hash lines
        //   with a line through it"* and then asked for it in purple.
        textDecoration: 'line-through',
        textDecorationThickness: '1px',
      }}
      title={title}
      data-retired-cause={cause}
      data-testid={testid}
    >
      {cause === 'cancelled' ? '✕' : '↻'} {p.label}
      {!compact && suffix ? ` — ${suffix}` : ''}
    </span>
  );
}
