import type { ProjectHold } from '../../lib/database.types';

// fix-178: presentational On-Hold badge — mirrors LandUsePhaseBadge (prop-driven,
// renders nothing when there's no active hold). Fed from the bulk holds fetch
// (activeHoldByProjectId) so list/grid surfaces don't query per project. The
// amber/⏸ treatment matches the existing ProjectDetail hold badge and is
// deliberately distinct from the red urgency zone so a held item never reads as
// a normal overdue card.

export function HoldBadge({
  hold,
  testid = 'hold-badge',
}: {
  /** The project's ACTIVE hold, or null/undefined when not held. */
  hold: Pick<ProjectHold, 'reason' | 'hold_start' | 'note'> | null | undefined;
  testid?: string;
}) {
  if (!hold) return null;
  return (
    <span
      className="inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-co-bg text-co border-co-border whitespace-nowrap"
      title={`On hold since ${hold.hold_start}${hold.note ? ` — ${hold.note}` : ''}`}
      data-testid={testid}
    >
      ⏸ On Hold — {hold.reason}
    </span>
  );
}
