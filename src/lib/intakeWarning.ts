import { intakeIsAccepted } from './targetApproval';

// ===========================================================================
// ★★★ fix-637 (P-180) — SEATTLE INTAKES 7 BUSINESS DAYS OUT
// ===========================================================================
//
// ⚖️ Bobby, 10-11: *"do 7 business days in advance total."* · *"a pop up on the
// screen, like the weekly agenda and an email notication daily until
// resolved."* Weekends are skipped; there is no holiday calendar.
//
// ★★★ THE RULE LIVES IN THE DATABASE, ONCE. `bp_intake_warning_due` (migrations/
//     fix_637_seattle_intake_warning.sql) is what BOTH deliveries read — the
//     pop-up through an RPC, the 7 AM email from the cron job — so the two can
//     never list different slots. This module is its MIRROR: the same rule in
//     TypeScript so CI can test it without a database (the fix-153 pattern),
//     pinned to the SQL by `SeattleIntakeWarningFix637.test.ts`. The pop-up
//     itself only uses the display helpers and the clock from here.
//
// ★★ "ACCEPTED" IS NOT RESTATED HERE. It calls fix-513's `intakeIsAccepted`
//    (date only, Bobby 09-09), and the SQL calls its one-line twin
//    `bp_intake_is_accepted`.

/** ★ "7 business days in advance total" — days 0 through 7 are due. */
export const INTAKE_WARNING_WINDOW_DAYS = 7;

/**
 * ★★★ The go-live gate for PAST dates. A slot past its date and still
 * unresolved stays due — but only if its date is on or after this day. On
 * 2026-10-11 there were 19 past slots nobody had released (old "OPEN"
 * placeholders back to January); listing them in the first email would have
 * been a backlog nobody can act on (P-180's own warning). Mirrors the SQL.
 */
export const INTAKE_WARNING_PAST_SINCE = '2026-10-12';

/** The app_config key Settings writes and the cron job reads. */
export const INTAKE_WARNING_RECIPIENTS_KEY = 'seattleIntakeWarningRecipients';

/** ★ fix-627: one exact key per day, asked for by key, never found in a list. */
export function intakeWarningReadKey(day: string): string {
  return `intake-warning:${day}`;
}

const SEATTLE_TZ = 'America/Los_Angeles';

/** Today's calendar date in Seattle (YYYY-MM-DD), whatever the device's zone. */
export function pacificToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SEATTLE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A YYYY-MM-DD as a UTC-midnight Date — calendar arithmetic with no DST. */
function utcDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function isWeekendUtc(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** Monday–Friday. */
export function isBusinessDay(iso: string): boolean {
  return !isWeekendUtc(utcDay(iso));
}

/**
 * Business days from `from` to `to`: the weekdays in (from, to]. Same day → 0,
 * Friday → Monday → 1, negative when `to` is earlier. Mirrors
 * `bp_business_days_between`.
 */
export function businessDaysBetween(from: string, to: string): number {
  const a = utcDay(from);
  const b = utcDay(to);
  const sign = b.getTime() >= a.getTime() ? 1 : -1;
  const [lo, hi] = sign === 1 ? [a, b] : [b, a];
  let n = 0;
  const d = new Date(lo.getTime());
  while (d.getTime() < hi.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekendUtc(d)) n += 1;
  }
  return sign * n;
}

/** The slot fields the rule reads. */
export interface IntakeSlot {
  intake_date: string | null;
  permit_id: number | null;
  is_placeholder?: boolean | null;
}

/** The linked permit's fields the rule reads (null for a placeholder). */
export interface IntakeSlotPermit {
  intake_date: string | null;
  /** The permit's project jurisdiction. */
  juris: string | null;
}

/**
 * ★★★ THE MIRROR OF `bp_intake_warning_due`'s WHERE clause.
 *   1. a Seattle slot — no permit (a placeholder), or a permit in Seattle
 *   2. not accepted — fix-513's `intakeIsAccepted`, on the PERMIT's date
 *   3. 0–7 business days out, or past its date since the go-live gate
 */
export function isIntakeWarningDue(
  slot: IntakeSlot,
  permit: IntakeSlotPermit | null,
  today: string,
): boolean {
  const date = slot.intake_date;
  if (!date) return false;
  const hasPermit = slot.permit_id != null;
  if (hasPermit && permit?.juris !== 'Seattle') return false;
  if (hasPermit && intakeIsAccepted(permit, today)) return false;
  if (date >= today) {
    return businessDaysBetween(today, date) <= INTAKE_WARNING_WINDOW_DAYS;
  }
  return date >= INTAKE_WARNING_PAST_SINCE;
}

// ---------------------------------------------------------------------------
// What `bp_intake_warning_due` returns, and how one row reads
// ---------------------------------------------------------------------------

export interface IntakeWarningRow {
  slot_id: number;
  tenant_id: string;
  project_id: string | null;
  permit_id: number | null;
  address: string;
  permit_num: string | null;
  permit_type: string | null;
  is_placeholder: boolean;
  intake_date: string;
  business_days_left: number;
  past_date: boolean;
}

/** "Placeholder", or the permit number (and its type when known). */
export function slotPermitLabel(row: Pick<IntakeWarningRow, 'is_placeholder' | 'permit_num' | 'permit_type'>): string {
  if (row.is_placeholder) return 'Placeholder';
  const num = (row.permit_num ?? '').trim();
  const type = (row.permit_type ?? '').trim();
  if (num && type) return `${num} · ${type}`;
  return num || type || 'No permit linked';
}

/** "Past date", "Today", "1 business day left", "N business days left". */
export function dueLabel(row: Pick<IntakeWarningRow, 'past_date' | 'business_days_left'>): string {
  if (row.past_date) return 'Past date';
  const n = row.business_days_left;
  if (n <= 0) return 'Today';
  return `${n} business day${n === 1 ? '' : 's'} left`;
}

/** M/D/YYYY, matching the chat's dated stamps (fix-633). */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}/${d}/${y}`;
}

/** ★ Where "open the tracker" goes: Draw Schedule's Seattle Intakes tab. */
export const INTAKE_TRACKER_PATH = '/draw-schedule?tab=intake';

/** Is this login one of the named recipients? Matched by roster name. */
export function isIntakeWarningRecipient(
  recipients: readonly string[],
  myRosterName: string | null | undefined,
): boolean {
  const me = (myRosterName ?? '').trim().toLowerCase();
  if (me === '') return false;
  return recipients.some((r) => r.trim().toLowerCase() === me);
}
