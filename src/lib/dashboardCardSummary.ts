// fix-notes-2: pure display-rule logic for the dashboard expanded-permit
// "what's this waiting on?" card. Kept separate from the component so the
// slot rules are unit-testable without a render.

/** Per-permit summary as returned by bp_dashboard_permit_cards (mapped in
 *  useDashboardPermitCards). Any field may be null. */
export interface PermitCardSummary {
  /** Earliest open task in bucket 'de' (Entitlement), or null. */
  entTask: string | null;
  /** Earliest open task in bucket 'pm' (Architecture), or null. */
  archTask: string | null;
  /** Newest active permit note snippet, or null. */
  note: string | null;
}

export type CardSlotLabel = 'Entitlement' | 'Architecture' | 'Note';

export interface CardSlot {
  label: CardSlotLabel;
  text: string;
}

/**
 * At most TWO slots, tasks before notes:
 *   - both tasks exist            → [Entitlement, Architecture]
 *   - exactly one task exists     → [that task, Note?]  (note fills slot 2)
 *   - no task but a note exists   → [Note]
 *   - nothing                     → []  (caller renders "Nothing pending")
 */
export function computeCardSlots(
  summary: PermitCardSummary | null | undefined,
): CardSlot[] {
  if (!summary) return [];
  const slots: CardSlot[] = [];
  if (summary.entTask) {
    slots.push({ label: 'Entitlement', text: summary.entTask });
  }
  if (summary.archTask) {
    slots.push({ label: 'Architecture', text: summary.archTask });
  }
  // Note only fills a slot when fewer than two tasks are shown — tasks win.
  if (slots.length < 2 && summary.note) {
    slots.push({ label: 'Note', text: summary.note });
  }
  return slots;
}
