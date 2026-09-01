// fix-25-feat-b: per-quarter DA team configuration helpers. Mirrors the
// SQL helper bp_member_active_in_quarter so client + server compute the
// same predicate. Quarter strings are 'YYYY-Qn' (e.g. '2026-Q1') —
// sortable lexically, equivalent to chronological order.

/** Convert a (year, quarterIndex 0-3) pair to the canonical 'YYYY-Qn' string. */
export function formatQuarter(year: number, quarterIndex: number): string {
  return `${year}-Q${quarterIndex + 1}`;
}

/** Returns the 'YYYY-Qn' string for `now` + `offset` quarters. */
export function quarterOffsetToString(
  offset: number,
  now: Date = new Date(),
): string {
  const baseQuarter = Math.floor(now.getMonth() / 3);
  const total = baseQuarter + offset;
  // Floor-mod so negative offsets wrap correctly (-1 → previous year Q4).
  const year = now.getFullYear() + Math.floor(total / 4);
  const q = ((total % 4) + 4) % 4;
  return formatQuarter(year, q);
}

/** Inverse of quarterOffsetToString — parse 'YYYY-Qn' to the offset
 *  (delta in quarters) from `now`'s current quarter. Used when the user
 *  picks a quarter from a dropdown and we need to update quarterOffset. */
export function quarterStringToOffset(
  quarterStr: string,
  now: Date = new Date(),
): number {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarterStr);
  if (!m) return 0;
  const targetYear = Number(m[1]);
  const targetQ = Number(m[2]) - 1;
  const baseYear = now.getFullYear();
  const baseQ = Math.floor(now.getMonth() / 3);
  return (targetYear - baseYear) * 4 + (targetQ - baseQ);
}

/** Mirror of public.bp_member_active_in_quarter. NULL on either side
 *  means open-ended (active forever in that direction). */
export function isMemberActiveInQuarter(
  activeStart: string | null,
  activeEnd: string | null,
  quarter: string,
): boolean {
  return (
    (activeStart === null || quarter >= activeStart) &&
    (activeEnd === null || quarter <= activeEnd)
  );
}

// ===========================================================================
// ★★★ fix-470 §2 (P-123) — A HISTORY FLOOR IS A DATE, NOT AN OFFSET
// ===========================================================================
//
// Bobby, 2026-09-01: *"we are going to backfill 2024 data. can we make the
// drawschedule editor go back to 2024."*
//
// ★★★ THE DEFECT IS NOT THE NUMBER — IT IS THAT `back` WAS MEASURED FROM `now`.
// Eight quarters back from 2026-Q3 is 2024-Q3, so today it *looks* right. In
// 2026-Q4 the floor becomes 2024-Q4; by 2027 the year he is about to enter has
// silently left the dropdown. **No error and no migration**: the saved layouts
// stay in the database and the selector simply stops offering their quarters.
// Raising 8 to 10 fixes today and re-breaks in six months.
//
// ★★ THE ASYMMETRY THAT MAKES THIS SAFE: `forward` is LEGITIMATELY rolling —
// you plan forward from where you stand, so a fixed future ceiling would be the
// bug in the other direction. `back` is not: **history does not recede.**
//
// ★ RULED — Bobby, 2026-09-01: floor at **2023-Q1**, *"leave room to go back
//   further"*. 2023 is expected after 2024, so the floor is set once for both
//   rather than moved twice.
//
// ★ Checked against prod 2026-09-01: earliest `projects.go_date` is 2024-09-25
//   and earliest `draw_schedule.start_week` is 2024-12-30. A 2023-Q1 floor
//   clears everything that exists and everything named as coming.
//
// ★★ ONE CHANGE, TWO SCREENS, AND THAT IS WANTED. Both callers take the
//    defaults — `QuarterLayoutEditor` and `TeamActiveQuartersEditor` — and
//    assigning a DA to a 2023 column is useless if that DA cannot be marked
//    active in 2023.
export const EARLIEST_QUARTER = '2023-Q1';

/** Build the list of selectable quarter strings — used by the admin UI's
 *  dropdowns. Runs from `EARLIEST_QUARTER` (absolute) to `now + forward`.
 *
 *  ★ `back` remains an optional OVERRIDE rather than being deleted: it is how
 *    the existing tests say "give me a window around this date", and it keeps
 *    its old meaning exactly. Passing it opts out of the floor; omitting it —
 *    which is what both real callers do — gets the floor.
 */
export function buildQuarterOptions(
  now: Date = new Date(),
  back?: number,
  forward: number = 8,
): string[] {
  const out: string[] = [];

  if (back !== undefined) {
    // ★ The pre-fix-470 behaviour, unchanged, for a caller that asks for it.
    for (let i = -back; i <= forward; i += 1) {
      out.push(quarterOffsetToString(i, now));
    }
    return out;
  }

  // ★★ Walk BACK from now until the floor is reached, so the list's first
  //    entry is `EARLIEST_QUARTER` whatever the clock says. Counting forward
  //    from a fixed offset is what made the floor drift in the first place.
  let first = 0;
  while (quarterOffsetToString(first - 1, now) >= EARLIEST_QUARTER) {
    first -= 1;
    // ★ A guard, not an expectation: a clock set far in the future must not
    //   spin here. 400 quarters is a century.
    if (first < -400) break;
  }

  for (let i = first; i <= forward; i += 1) {
    out.push(quarterOffsetToString(i, now));
  }
  return out;
}
