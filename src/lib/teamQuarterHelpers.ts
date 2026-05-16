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

/** Build the list of selectable quarter strings around `now` — used by
 *  the admin UI's dropdowns. Default span: 8 quarters back, 8 forward. */
export function buildQuarterOptions(
  now: Date = new Date(),
  back: number = 8,
  forward: number = 8,
): string[] {
  const out: string[] = [];
  for (let i = -back; i <= forward; i += 1) {
    out.push(quarterOffsetToString(i, now));
  }
  return out;
}
