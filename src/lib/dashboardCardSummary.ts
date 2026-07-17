// fix-notes-2: pure display-rule logic for the dashboard expanded-permit
// "what's this waiting on?" card. Kept separate from the component so the
// slot rules are unit-testable without a render.
//
// fix-notes-5: slots are grouped by permit_tasks.DISCIPLINE (ownership), not
// bucket (lifecycle phase) — bucket had 'ent' work split across de/pm, so
// e.g. "Civil by the EOW" (discipline ent, bucket pm) was mislabeled
// Architecture. NULL discipline folds into ENT server-side, mirroring
// bp_list_permit_tasks' COALESCE(discipline,'ent') so the card always agrees
// with the permit detail's two task columns. Labels are short: ENT/ARCH/NOTE.

/** Per-permit summary as returned by bp_dashboard_permit_cards (mapped in
 *  useDashboardPermitCards). Any field may be null. */
export interface PermitCardSummary {
  /** Earliest open task with discipline 'ent' (NULL folds in), or null. */
  entTask: string | null;
  /** Earliest open task with discipline 'arch', or null. */
  archTask: string | null;
  /** Newest active permit note snippet, or null. */
  note: string | null;
}

export type CardSlotLabel = 'ENT' | 'ARCH' | 'NOTE';

export interface CardSlot {
  label: CardSlotLabel;
  text: string;
}

/**
 * At most TWO slots, tasks before notes:
 *   - both disciplines have a task → [ENT, ARCH]
 *   - exactly one task exists      → [that task, NOTE?]  (note fills slot 2)
 *   - no task but a note exists    → [NOTE]
 *   - nothing                      → []  (caller renders "Nothing pending")
 */
export function computeCardSlots(
  summary: PermitCardSummary | null | undefined,
): CardSlot[] {
  if (!summary) return [];
  const slots: CardSlot[] = [];
  if (summary.entTask) {
    slots.push({ label: 'ENT', text: summary.entTask });
  }
  if (summary.archTask) {
    slots.push({ label: 'ARCH', text: summary.archTask });
  }
  // Note only fills a slot when fewer than two tasks are shown — tasks win.
  if (slots.length < 2 && summary.note) {
    slots.push({ label: 'NOTE', text: summary.note });
  }
  return slots;
}
