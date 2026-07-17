import {
  computeCardSlots,
  type CardSlotLabel,
  type PermitCardSummary,
} from '../../lib/dashboardCardSummary';

// fix-notes-2: the "what's this waiting on?" body of a dashboard expanded
// permit row. Shows at most two owner-group-labeled items (tasks before
// notes) or a muted "Nothing pending" done-signal. Pure — takes the summary
// as a prop; the ordering/slot rules live in computeCardSlots.
// fix-notes-5: slots are DISCIPLINE groups (ENT / ARCH / NOTE) — see
// dashboardCardSummary.ts.

const SLOT_COLOR: Record<CardSlotLabel, string> = {
  ENT: 'var(--color-de)',
  ARCH: 'var(--color-pm)',
  NOTE: 'var(--color-dim, #9ca3af)',
};

export default function PermitWaitingOn({
  summary,
}: {
  summary: PermitCardSummary | null | undefined;
}) {
  const slots = computeCardSlots(summary);

  if (slots.length === 0) {
    return (
      <span
        className="text-[10px] text-dim italic"
        data-testid="permit-waiting-on-empty"
      >
        Nothing pending
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5" data-testid="permit-waiting-on">
      {slots.map((slot, i) => (
        <div
          key={`${slot.label}-${i}`}
          className="flex items-baseline gap-1.5 min-w-0"
          data-testid={`permit-waiting-on-slot-${slot.label.toLowerCase()}`}
        >
          <span
            className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0"
            style={{ color: SLOT_COLOR[slot.label] }}
          >
            {slot.label}
          </span>
          <span className="text-[10px] text-text truncate min-w-0">
            {slot.text}
          </span>
        </div>
      ))}
    </div>
  );
}
