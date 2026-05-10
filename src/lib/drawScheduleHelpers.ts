// Q6.1: pure helpers for the draw schedule grid. Mirrors v1's
// getMonday / dateToWeekKey / getQuarterWeeks (index.html lines 7307-7370).
// Week-keys are 'YYYY-MM-DD' strings representing the Monday of that week.

export interface StatusColor {
  bg: string;
  border: string;
  text: string;
}

/** v1 status → block color (index.html line 7307). Order is also the
 * canonical order for status filters. */
export const DS_STATUS_COLORS: Record<string, StatusColor> = {
  Scheduled: { bg: '#ffffff', border: '#cacaca', text: '#1a2540' },
  Schematic: { bg: '#5a84c0', border: '#3d6aad', text: '#1a2540' },
  'DD / Permit Set': { bg: '#5d6aac', border: '#4a5499', text: '#ffffff' },
  'Pending Consultants': { bg: '#02267e', border: '#011a5c', text: '#ffffff' },
  Submitted: { bg: '#5cb8b2', border: '#3a9e98', text: '#1a2540' },
  'Under Review': { bg: '#5cb8b2', border: '#3a9e98', text: '#1a2540' },
  Corrections: { bg: '#5cb8b2', border: '#3a9e98', text: '#1a2540' },
  Approved: { bg: '#5abf75', border: '#3aa55e', text: '#ffffff' },
};

/** v1 jurisdiction → border color (index.html line 7318). */
export function jurisBorder(juris: string | null | undefined): string {
  if (!juris) return '#16a34a'; // green default
  const j = juris.toLowerCase();
  if (j === 'seattle') return '#1d4ed8'; // blue
  if (j === 'phoenix' || j === 'scottsdale' || j === 'arizona') {
    return '#dc2626'; // red
  }
  return '#16a34a';
}

/** Returns the Monday of the week containing `d` (00:00 local). */
export function getMonday(d: Date): Date {
  const dt = new Date(d);
  const day = dt.getDay();
  // Sunday=0 → -6 (back to previous Monday); else day-1.
  dt.setDate(dt.getDate() - day + (day === 0 ? -6 : 1));
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/** Returns 'YYYY-MM-DD' for the Monday of d's week. v1 calls this dateToWeekKey. */
export function dateToWeekKey(d: Date): string {
  return getMonday(d).toISOString().slice(0, 10);
}

export function addWeeks(d: Date, n: number): Date {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n * 7);
  return dt;
}

/** Start date of the quarter offset from `now` (offset=0 is current quarter). */
export function getQuarterStart(offset: number, now: Date = new Date()): Date {
  const q = Math.floor(now.getMonth() / 3);
  let tq = q + offset;
  const yr = now.getFullYear() + Math.floor(tq / 4);
  tq = ((tq % 4) + 4) % 4;
  return new Date(yr, tq * 3, 1);
}

export function getQuarterLabel(offset: number, now: Date = new Date()): string {
  const d = getQuarterStart(offset, now);
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

/** All Monday week-keys covering the quarter at `offset`. */
export function getQuarterWeeks(offset: number, now: Date = new Date()): string[] {
  const qs = getQuarterStart(offset, now);
  const qe = getQuarterStart(offset + 1, now);
  const weeks: string[] = [];
  let cur = getMonday(qs);
  // Bound by qe but also cap at 16 iterations as a safety belt.
  let safety = 16;
  while (cur < qe && safety-- > 0) {
    weeks.push(dateToWeekKey(cur));
    cur = addWeeks(cur, 1);
  }
  return weeks;
}

/** True if a project's [startWeek, endWeek] range overlaps the given list of
 * week-keys (any partial overlap counts). */
export function rangeOverlapsWeeks(
  startWeek: string | null | undefined,
  endWeek: string | null | undefined,
  weeks: string[],
): boolean {
  if (!startWeek || !endWeek || weeks.length === 0) return false;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  return startWeek <= last && endWeek >= first;
}

/** Multi-token address match: every whitespace-separated token in `query`
 * (case-insensitive) must appear somewhere in `haystack`. */
export function multiMatchAddress(query: string, haystack: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = haystack.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/** Week-keys are YYYY-MM-DD strings → lexical compare is order-equivalent
 * to date compare. weekKeyAdd shifts a week-key by `n` weeks. */
export function addWeeksToWeekKey(wk: string, n: number): string {
  const d = new Date(`${wk}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

/** Inclusive overlap predicate on week-key ranges. Equivalent to date
 * overlap: ranges touch if aStart ≤ bEnd AND bStart ≤ aEnd. */
export function weekRangeOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Q6.2 drop-decision input: every existing block on the target DA, plus the
 * proposed (anchorProjectId, targetStart, targetEnd). Returns either `save`
 * (no overlap with other blocks) or `overlap` (with conflicting project ids
 * the caller should surface in the prompt). The anchor itself is excluded
 * from overlap checks (a project can't conflict with its own current slot). */
export interface DropBlock {
  projectId: string;
  startWeek: string;
  endWeek: string;
}
export type DropDecision =
  | { kind: 'save' }
  | { kind: 'overlap'; conflictingProjectIds: string[] };

export function decideDrop(
  existingBlocks: DropBlock[],
  anchorProjectId: string,
  targetStart: string,
  targetEnd: string,
): DropDecision {
  const conflicts = existingBlocks
    .filter((b) => b.projectId !== anchorProjectId)
    .filter((b) => weekRangeOverlap(targetStart, targetEnd, b.startWeek, b.endWeek))
    .map((b) => b.projectId);
  if (conflicts.length === 0) return { kind: 'save' };
  return { kind: 'overlap', conflictingProjectIds: conflicts };
}
