import { minusBusinessDays } from './boardAging';
import { vendorTargetSend } from './vendorReport';

// ===========================================================================
// ★★★ fix-474 (P-116) — THE CONSULTANT RECORD, AND ITS ROUNDS
// ===========================================================================
//
// Bobby: *"the overall goal here is to help get more clarity for our
// acquisitions team… what it doesn't show is consultants. Are the consultants
// complete? Are we waiting on consultants? What's the status?"*
//
// ★ THE AUDIENCE IS ACQUISITIONS. Schedule Health answers "is the permit late";
//   nothing answered "are we blocked on a consultant", which is what a land
//   person asks before committing.
//
// ★★ DATA LAYER ONLY. fix-475 builds the column on top of this. A screen built
//    on a schema that is still moving is the expensive way to find out the
//    schema was wrong (the fix-461 → fix-462 split, again).

/**
 * ★★★ THE STATUS LADDER, AND IT LIVES HERE BECAUSE IT HAS MOVED THREE TIMES.
 *
 *   Preparing / Sent / Complete
 *     → Preparing / In progress / Complete
 *       → **Scheduled / Pending / Received**
 *
 * It will move again. **Nothing may hard-code one of these three words at a
 * call site** — read the label from here, always.
 *
 * ★★ THE SAME THREE WORDS LIVE IN THREE PLACES, and fix-464 is why that is
 * called out rather than assumed safe: `bp_set_team_department` validated
 * against its own private list, so widening the CHECK constraint alone shipped
 * a picker whose options the writer rejected. The three places here are:
 *   1. this constant,
 *   2. `project_consultant_rounds.status`'s CHECK,
 *   3. `bp_set_consultant_status`'s own `not in (...)`.
 * A test reads the migration and asserts all three carry the same words.
 */
export const CONSULTANT_STATUSES = ['Scheduled', 'Pending', 'Received'] as const;

export type ConsultantStatus = (typeof CONSULTANT_STATUSES)[number];

/** The one a new round starts in. */
export const CONSULTANT_STATUS_DEFAULT: ConsultantStatus = 'Scheduled';

/**
 * ★★ WHICH TWO DATE SLOTS A STATUS SHOWS. The record always keeps FOUR dates;
 * a status decides which two the reader is shown.
 *
 *   Scheduled   EST SEND · EST RECEIVED
 *   Pending     SENT     · EST RECEIVED    (`sent` auto-stamped by the RPC)
 *   Received    SENT     · RECEIVED        (`recd` auto-stamped by the RPC)
 *
 * ★ Keeping all four means stepping backwards never destroys something the
 *   user typed: `Received → Pending` clears `recd` but the `est_recd` they
 *   entered three weeks ago is still there when they need it again.
 */
export const CONSULTANT_DATE_SLOTS: Record<
  ConsultantStatus,
  readonly [ConsultantDateField, ConsultantDateField]
> = {
  Scheduled: ['est_send', 'est_recd'],
  Pending: ['sent', 'est_recd'],
  Received: ['sent', 'recd'],
};

export type ConsultantDateField = 'est_send' | 'sent' | 'est_recd' | 'recd';

export const CONSULTANT_DATE_FIELDS: readonly ConsultantDateField[] = [
  'est_send',
  'sent',
  'est_recd',
  'recd',
];

/** Column headings, so the two visible slots are never labelled at a call site
 *  either — same reason as the statuses. */
export const CONSULTANT_DATE_LABEL: Record<ConsultantDateField, string> = {
  est_send: 'Est send',
  sent: 'Sent',
  est_recd: 'Est received',
  recd: 'Received',
};

/**
 * ★★★ THE LEAD, AND IT IS ONE CONSTANT. Bobby: *"let's go with three business
 * days."* `EST RECEIVED` seeds from **Target Submit − 3 BUSINESS days** — not
 * calendar, because a Monday target would otherwise seed a Friday-to-Saturday
 * window and every consultant date would drift by a weekend.
 */
export const LEAD_BUSINESS_DAYS = 3;

export interface ConsultantRound {
  id: string;
  consultant_id: string;
  round_index: number;
  phase: string;
  status: ConsultantStatus;
  est_send: string | null;
  sent: string | null;
  est_recd: string | null;
  recd: string | null;
  created_at: string;
  updated_at: string;
}

/** One row of `project_consultant_current` — a consultant with its LATEST
 *  round flattened on, which is what the UI ticket reads. */
export interface ConsultantCurrent {
  consultant_id: string;
  project_id: string;
  discipline: string;
  firm_id: string;
  firm_name: string;
  /** ★ fix-474: an INACTIVE directory row still resolves. `active` is a flag,
   *  not a delete, so a firm that stops being offered for NEW work keeps
   *  naming the work it already did. Surfaced so the UI can say so if it
   *  wants; it is not an error state. */
  firm_active: boolean;
  notes: string | null;
  updated_at: string;
  round_id: string | null;
  round_index: number | null;
  phase: string | null;
  status: ConsultantStatus | null;
  est_send: string | null;
  sent: string | null;
  est_recd: string | null;
  recd: string | null;
  round_updated_at: string | null;
  round_count: number;
}

/**
 * ★★★ THE TWO SEED DATES — AND WHY THEY ARE COMPUTED HERE RATHER THAN IN SQL.
 *
 * The ruling is explicit that both are *"ordinary editable fields that assert
 * no rule"*: they are DEFAULTS, not invariants, which is also why the
 * per-discipline "DD-driven" flag was killed and must not be built.
 *
 * ★★ So deriving them server-side would have meant re-implementing two rules
 * that already have owners — and `vendorTargetSend`'s own comment is a warning
 * against exactly that: *"the second literal `- 7` here is exactly how the row
 * on this card and the date in the email would silently diverge the day the
 * lead changes. One concept, one function."* This composes those owners
 * instead, and hands the result to the RPC as a value.
 *
 * ★ What IS server-canonical is what is genuinely a rule — the auto-stamp and
 *   the append-a-round transition. Those live in `bp_set_consultant_status`
 *   where no client can disagree with them.
 *
 * ★ Either seed may be null and that is not a failure: a project with no DD
 *   window has no EST SEND, exactly as fix-311's Consultant row renders
 *   nothing rather than a guess.
 */
export function seedConsultantDates(input: {
  /** The permit's DD window end — `vendorTargetSend`'s primary anchor. */
  ddEnd: string | null | undefined;
  /** The draw block's end week — its documented fallback. */
  endWeek?: string | null;
  /** The permit's target submit, which EST RECEIVED counts back from. */
  targetSubmit: string | null | undefined;
}): { est_send: string | null; est_recd: string | null } {
  const est_send = vendorTargetSend({
    dd_end: input.ddEnd ?? null,
    end_week: input.endWeek ?? null,
  });
  const target = (input.targetSubmit ?? '').trim();
  const est_recd = target ? minusBusinessDays(target, LEAD_BUSINESS_DAYS) : null;
  return { est_send, est_recd };
}

/**
 * ★★ CURRENT = THE LATEST ROUND. Highest `round_index`, tie broken by `id`.
 *
 * ★ The tie-break is not decoration: fix-338 recorded that `now()` is CONSTANT
 *   inside a transaction, so two rounds written together would order at random
 *   under a timestamp sort. The server view uses the same two keys, so the
 *   client and the database cannot disagree about which round is current.
 */
export function currentRound(
  rounds: readonly ConsultantRound[],
): ConsultantRound | null {
  let best: ConsultantRound | null = null;
  for (const r of rounds) {
    if (
      best === null ||
      r.round_index > best.round_index ||
      (r.round_index === best.round_index && r.id > best.id)
    ) {
      best = r;
    }
  }
  return best;
}

/**
 * ★★★ WOULD THIS TRANSITION APPEND A ROUND?
 *
 * **Only the backward step out of `Received`.** Everything else edits the round
 * in hand. Stated here as well as in the RPC so the UI can say "this reopens
 * the consultant" BEFORE the click — but the RPC is the one that decides, and
 * a test asserts the two agree.
 */
export function transitionAppends(
  from: ConsultantStatus | null,
  to: ConsultantStatus,
): boolean {
  return from === 'Received' && to === 'Scheduled';
}

/** The label a newly appended round is seeded with. Editable afterwards —
 *  Bobby: *"in case multiple cycles handle in one round"*, so `Cycle 1 & 2`
 *  must be typeable. ★ Deliberately NOT a registry: it is a caption on a row
 *  the user owns and **it is not a join key**, which is the whole difference
 *  between this free text and the firm name that P-100 is about. */
export function seedPhaseLabel(roundIndex: number): string {
  return roundIndex === 0 ? 'Design' : `Cycle ${roundIndex}`;
}
