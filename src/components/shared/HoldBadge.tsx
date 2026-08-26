import { holdKind, type ProjectHold } from '../../lib/database.types';

// fix-178: presentational On-Hold badge — mirrors LandUsePhaseBadge (prop-driven,
// renders nothing when there's no active hold). Fed from the bulk holds fetch
// (activeHoldByProjectId) so list/grid surfaces don't query per project. The
// amber/⏸ treatment matches the existing ProjectDetail hold badge and is
// deliberately distinct from the red urgency zone so a held item never reads as
// a normal overdue card.
//
// fix-262: the same component now renders BOTH kinds off project_holds.kind,
// because they are one mechanism. They must never look alike:
//   hold      → amber ⏸  "still active, just paused"
//   cancelled → muted ✕, struck reason, "no longer active"
// A cancelled badge deliberately reads as terminal at a glance.
//
// fix-263: both kinds now paint from the shared PARK tokens in index.css, the
// same ones the Draw Schedule block and legend use — one concept, one colour,
// enforced by there being a single definition. Before this the hold badge
// borrowed the CORRECTIONS palette (bg-co-bg / text-co / border-co-border), so
// "on hold" and "in corrections" were the same amber; they are now distinct.

// ===========================================================================
// ★★★ fix-409 — THE SAME BADGE, ON A TASK ROW
// ===========================================================================
//
// Bobby, 2026-08-25 (register P-039): *"an on hold chip/color filter or
// something to tell the difference. that should be on the project overview
// too."*
//
// ★★★ A `compact` PROP, NOT A SECOND COMPONENT. A held task and a held project
// are the same fact at two scales; two components would be two places for the
// colour, the glyph and the cancelled/hold split to drift — which is exactly
// what fix-263 fixed when the hold badge had quietly borrowed the CORRECTIONS
// palette and "on hold" and "in corrections" were the same amber.
//
// ★★ WHAT COMPACT DROPS IS THE REASON, AND NOTHING ELSE. On a project header
// the reason is the headline. On a task row inside a permit whose every task
// shares one hold, printing "⏸ On Hold — Waiting on builder" fifteen times is
// noise that pushes the task's own text off the line. So the chip keeps the
// glyph, the word and the colour — the three things that make it read as the
// same concept — and moves the reason into the `title`, where it already was
// for the date and the note.

export function HoldBadge({
  hold,
  testid = 'hold-badge',
  compact = false,
}: {
  /** The OPEN hold row (project or permit, either kind), or null/undefined. */
  hold:
    | Pick<ProjectHold, 'reason' | 'hold_start' | 'note' | 'kind'>
    | null
    | undefined;
  testid?: string;
  /** ★ fix-409: glyph + word only, reason in the tooltip. For task rows. */
  compact?: boolean;
}) {
  if (!hold) return null;
  const cancelled = holdKind(hold) === 'cancelled';
  const cls = compact
    ? 'inline-block text-[8.5px] font-bold uppercase tracking-wider px-1 py-0 rounded border whitespace-nowrap align-middle'
    : 'inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap';

  if (cancelled) {
    return (
      <span
        className={cls}
        style={{
          background: 'var(--hatch-cancelled)',
          color: 'var(--color-cancelled-text)',
          borderColor: 'var(--color-cancelled-border)',
          textDecoration: 'line-through',
          textDecorationThickness: '1px',
        }}
        title={`Cancelled ${hold.hold_start}${hold.reason ? ` — ${hold.reason}` : ''}${hold.note ? ` — ${hold.note}` : ''}`}
        data-testid={`${testid}-cancelled`}
      >
        ✕ Cancelled{compact ? '' : ` — ${hold.reason}`}
      </span>
    );
  }

  return (
    <span
      className={cls}
      style={{
        background: 'var(--color-hold-bg)',
        color: 'var(--color-hold-text)',
        borderColor: 'var(--color-hold-border)',
      }}
      title={`On hold since ${hold.hold_start}${hold.reason ? ` — ${hold.reason}` : ''}${hold.note ? ` — ${hold.note}` : ''}`}
      data-testid={testid}
    >
      ⏸ On Hold{compact ? '' : ` — ${hold.reason}`}
    </span>
  );
}
