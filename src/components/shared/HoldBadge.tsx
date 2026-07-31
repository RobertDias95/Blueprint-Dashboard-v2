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

export function HoldBadge({
  hold,
  testid = 'hold-badge',
}: {
  /** The project's OPEN project_holds row (either kind), or null/undefined. */
  hold:
    | Pick<ProjectHold, 'reason' | 'hold_start' | 'note' | 'kind'>
    | null
    | undefined;
  testid?: string;
}) {
  if (!hold) return null;
  const cancelled = holdKind(hold) === 'cancelled';

  if (cancelled) {
    return (
      <span
        className="inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap"
        style={{
          background: 'var(--hatch-cancelled)',
          color: 'var(--color-cancelled-text)',
          borderColor: 'var(--color-cancelled-border)',
          textDecoration: 'line-through',
          textDecorationThickness: '1px',
        }}
        title={`Cancelled ${hold.hold_start}${hold.note ? ` — ${hold.note}` : ''}`}
        data-testid={`${testid}-cancelled`}
      >
        ✕ Cancelled — {hold.reason}
      </span>
    );
  }

  return (
    <span
      className="inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap"
      style={{
        background: 'var(--color-hold-bg)',
        color: 'var(--color-hold-text)',
        borderColor: 'var(--color-hold-border)',
      }}
      title={`On hold since ${hold.hold_start}${hold.note ? ` — ${hold.note}` : ''}`}
      data-testid={testid}
    >
      ⏸ On Hold — {hold.reason}
    </span>
  );
}
