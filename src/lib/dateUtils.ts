// fix-141 (2026-06-09): Monday-snap helpers.
//
// The Draw Schedule grid keys every lane off Monday week-keys
// (draw_schedule.start_week / end_week — see DrawScheduleGrid.tsx), so any
// dd_start / start_week the client writes must already be Monday-aligned or the
// lane lands in the wrong column — or, when the weekday has no matching column,
// renders nowhere at all (the 6605 57th Ave NE "invisible lane" bug). The root
// cause lived server-side (bp_next_available_da_slot returned a non-Monday
// slot_start); these client helpers are the at-the-source guard so a manual DD
// edit never re-introduces a non-Monday start.
//
// snapToMonday() mirrors the SQL snap_to_monday_forward() helper
// (migrations/fix_141_snap_to_monday_forward_rpc_guards.sql) byte-for-byte on
// the same inputs so client and server agree.
//
// Parsing uses the UTC-noon trick (`${iso}T12:00:00Z`) — the same pattern as
// daysBetween() in reportMetrics — so the result never drifts across a day
// boundary regardless of the runtime timezone.

export type SnapDirection = 'forward' | 'back' | 'nearest';

/** Parse a Date | YYYY-MM-DD string to a UTC-noon Date, or null for
 *  empty / malformed input. A Date is re-anchored to UTC noon on its own
 *  calendar Y-M-D (local), so a value built in any timezone keeps the day the
 *  caller meant. Strings are validated by round-trip so JS "fix-ups"
 *  (e.g. 2026-13-40 → 2027-02-09) are rejected as null. */
function parseUtcNoon(date: Date | string | null | undefined): Date | null {
  if (date == null) return null;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    return new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12),
    );
  }
  const s = date.trim();
  if (s === '') return null;
  // Only the calendar date matters; ignore any time component the caller passed.
  const ymd = s.slice(0, 10);
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (toIso(d) !== ymd) return null; // reject overflow/garbage that JS coerced
  return d;
}

/** Format a UTC-noon Date back to YYYY-MM-DD. */
function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add `days` (may be negative) to a Date | YYYY-MM-DD value, returning a new
 *  ISO date string. null for bad input. UTC-noon parsing keeps it tz-safe. */
export function addDays(
  date: Date | string | null | undefined,
  days: number,
): string | null {
  const d = parseUtcNoon(date);
  if (d === null) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Snap a date to a Monday boundary. Default direction = 'forward'.
 *
 *  forward (Bobby's locked direction): Mon→Mon, Tue→+6, Wed→+5, Thu→+4,
 *    Fri→+3, Sat→+2, Sun→+1 — i.e. the next Monday on or after the date.
 *  back: the Monday on or before — Mon→Mon, Tue→-1, Wed→-2, … Sun→-6.
 *  nearest: the Monday with the smaller absolute offset; an exact tie
 *    resolves forward. (Only Monday itself ties, at offset 0.)
 *
 *  Returns an ISO date string (YYYY-MM-DD), or null for empty / malformed
 *  input. */
export function snapToMonday(
  date: Date | string | null | undefined,
  direction: SnapDirection = 'forward',
): string | null {
  const d = parseUtcNoon(date);
  if (d === null) return null;
  // JS getUTCDay: Sun=0..Sat=6. Convert to ISO weekday Mon=1..Sun=7.
  const isodow = ((d.getUTCDay() + 6) % 7) + 1;
  const forward = (8 - isodow) % 7; // 0,6,5,4,3,2,1 for Mon..Sun
  const back = 1 - isodow; // 0,-1,-2,-3,-4,-5,-6 for Mon..Sun
  let offset: number;
  if (direction === 'forward') offset = forward;
  else if (direction === 'back') offset = back;
  else offset = forward <= Math.abs(back) ? forward : back; // nearest, tie→fwd
  d.setUTCDate(d.getUTCDate() + offset);
  return toIso(d);
}

/** fix-143: parse a `YYYY-Qn` tenure quarter into its inclusive ISO date
 *  range. '2026-Q1' → { start: '2026-01-01', end: '2026-03-31' }, Q2 → Apr 1–
 *  Jun 30, Q3 → Jul 1–Sep 30, Q4 → Oct 1–Dec 31. Returns null for anything
 *  that isn't a 4-digit year + Q1–Q4 (e.g. '2026-Q5', '', null). Used by the
 *  backfill wizard's tenure warning. */
export function quarterToDateRange(
  quarter: string | null | undefined,
): { start: string; end: string } | null {
  if (!quarter) return null;
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter.trim());
  if (!m) return null;
  const year = m[1];
  const q = Number(m[2]);
  // Inclusive last day of each quarter (Mar 31, Jun 30, Sep 30, Dec 31).
  const bounds: Record<number, { start: string; end: string }> = {
    1: { start: `${year}-01-01`, end: `${year}-03-31` },
    2: { start: `${year}-04-01`, end: `${year}-06-30` },
    3: { start: `${year}-07-01`, end: `${year}-09-30` },
    4: { start: `${year}-10-01`, end: `${year}-12-31` },
  };
  return bounds[q];
}
