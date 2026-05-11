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

/** Q6.2.c: NP block colors (Vacation/Training/Redesign/Corrections/Other).
 * v1 used the same flat grey for every type (index.html line 8035). */
export const NP_BLOCK_COLOR: StatusColor = {
  bg: '#cacaca',
  border: '#a0a0a0',
  text: '#1a2540',
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

/** Q6.2.d: NP block conflict detection. Given the NP blocks on the target
 * DA and the proposed range, returns the NP blocks the drop would overlap.
 * Pure function — identical shape to decideDrop but treats every match as
 * a soft warning rather than a hard conflict. Anchor exclusion isn't a
 * concern here: projects and NP blocks live in separate tables. */
export interface NpConflict {
  id: string;
  daName: string;
  type: string;
  label: string | null;
  startWeek: string;
  endWeek: string;
}
export function findNpConflictsForDrop(
  daNpBlocks: NpConflict[],
  targetStart: string,
  targetEnd: string,
): NpConflict[] {
  return daNpBlocks.filter((np) =>
    weekRangeOverlap(targetStart, targetEnd, np.startWeek, np.endWeek),
  );
}

/** Q6.2.e: segment math for clipping NP block render around overlapping
 * project blocks on the same DA. Given an NP range, the project ranges on
 * that DA, and the visible quarter weeks, returns the visible (uncovered)
 * sub-ranges of the NP. Each sub-range maps to one rendered rectangle.
 *
 * Bounded to the current quarter view — NP weeks outside it aren't
 * rendered anyway. Multiple project blocks may split the NP into several
 * visible segments. If a project fully covers the NP, returns [].
 *
 * Pure function, walks the quarter weeks once; per-week cost is bounded
 * by the project count on the target DA. */
export interface WeekRange {
  startWeek: string;
  endWeek: string;
}
export function computeNpSegments(
  npStart: string,
  npEnd: string,
  projectRanges: WeekRange[],
  quarterWeeks: string[],
): WeekRange[] {
  const segments: WeekRange[] = [];
  let curSegStart: string | null = null;
  let curSegEnd: string | null = null;

  for (const wk of quarterWeeks) {
    const inNp = wk >= npStart && wk <= npEnd;
    const covered = projectRanges.some(
      (p) => wk >= p.startWeek && wk <= p.endWeek,
    );
    const visible = inNp && !covered;

    if (visible) {
      if (curSegStart === null) curSegStart = wk;
      curSegEnd = wk;
    } else if (curSegStart !== null) {
      segments.push({ startWeek: curSegStart, endWeek: curSegEnd as string });
      curSegStart = null;
      curSegEnd = null;
    }
  }
  if (curSegStart !== null) {
    segments.push({ startWeek: curSegStart, endWeek: curSegEnd as string });
  }
  return segments;
}

/** Q6.2.b: cascade math for the Push Down operation. Given the anchor's
 * NEW position and every other block on the target DA, returns the new
 * positions for blocks that must move (preserving each block's duration).
 *
 * Algorithm: walk blocks in current-start order; track a frontier (latest
 * occupied week, starting at anchor end). A block must be pushed iff its
 * range overlaps with [anchor_start, frontier]. Pushed block: new_start =
 * frontier + 1 week, new_end = new_start + originalDuration; frontier
 * advances to new_end so chain effects (push A → A overlaps B → push B)
 * are caught in a single pass.
 *
 * The bp_resolve_da_overlap SQL implements the same algorithm; this pure
 * helper exists for unit testing the math AND for client-side preview if
 * we ever want to show "X will move from W3 to W7" before confirmation. */
export interface PushedBlock {
  projectId: string;
  newStartWeek: string;
  newEndWeek: string;
}
export function planPushDown(
  otherBlocks: DropBlock[],
  anchorStartWeek: string,
  anchorEndWeek: string,
): PushedBlock[] {
  const sorted = [...otherBlocks].sort((a, b) =>
    a.startWeek.localeCompare(b.startWeek),
  );
  let frontier = anchorEndWeek;
  const pushed: PushedBlock[] = [];
  for (const b of sorted) {
    // Block needs pushing iff it overlaps with [anchor_start, frontier].
    // Lexical compare on YYYY-MM-DD = date compare.
    if (!weekRangeOverlap(anchorStartWeek, frontier, b.startWeek, b.endWeek)) {
      continue;
    }
    const startMs = new Date(`${b.startWeek}T12:00:00Z`).getTime();
    const endMs = new Date(`${b.endWeek}T12:00:00Z`).getTime();
    const durationWeeks = Math.round((endMs - startMs) / (7 * 86400000));
    const newStartWeek = addWeeksToWeekKey(frontier, 1);
    const newEndWeek = addWeeksToWeekKey(newStartWeek, durationWeeks);
    pushed.push({
      projectId: b.projectId,
      newStartWeek,
      newEndWeek,
    });
    frontier = newEndWeek;
  }
  return pushed;
}
