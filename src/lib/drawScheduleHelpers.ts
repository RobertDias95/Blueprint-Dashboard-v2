// Q6.1: pure helpers for the draw schedule grid. Mirrors v1's
// getMonday / dateToWeekKey / getQuarterWeeks (index.html lines 7307-7370).
// Week-keys are 'YYYY-MM-DD' strings representing the Monday of that week.

import type { DsStatusColor } from './drawScheduleStatus';

// fix-160: the status→color map moved into drawScheduleStatus.ts as part of
// STATUS_PRESENTATION (the SINGLE source for a status's label AND color). It is
// re-exported here (derived, not a second literal) so existing importers are
// unchanged; the duplicate literal that lived here — and its dead 'Submitted'
// key — are gone, so label and color can no longer drift apart.
export type StatusColor = DsStatusColor;
export { DS_STATUS_COLORS } from './drawScheduleStatus';

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

/** fix-126: yellow border for redesign blocks. Sits outside the
 *  jurisdiction-color palette so the visual "this is a redesign" cue
 *  doesn't compete with the Seattle blue / AZ red signal. Picked
 *  Tailwind yellow-500 for visibility on both light and dark surfaces.
 *
 *  Exported as a named constant so the test suite + any future surfaces
 *  (matrix view, reports) can reference the same value. */
export const REDESIGN_BORDER_COLOR = '#eab308';

/** fix-126: pick the right block border color. Redesigns get yellow;
 *  everything else falls back to the jurisdiction palette. */
export function blockBorderColor(
  juris: string | null | undefined,
  redesignOfProjectId: string | null | undefined,
): string {
  if (redesignOfProjectId) return REDESIGN_BORDER_COLOR;
  return jurisBorder(juris);
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

/** fix-25-feat-c: format a Monday week-key as 'M/D — M/D' covering the
 *  Mon → Fri work week. weekKey is always 'YYYY-MM-DD' parsed at local
 *  noon to dodge timezone edge cases at month / year boundaries. Friday
 *  is Monday + 4 days. */
export function formatWeekRange(weekKey: string): string {
  const monday = new Date(`${weekKey}T12:00:00`);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(monday)} — ${fmt(friday)}`;
}

/** fix-DS-pill-and-date: render an ISO date (YYYY-MM-DD) as "MM-DD-YY"
 *  (e.g. 2026-05-04 -> "05-04-26"). Returns the input as-is if it can't parse
 *  (empty, too short, or non-numeric parts like "not-a-date"). */
export function formatProjectionDate(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return iso;
  }
  return `${month}-${day}-${year.slice(2)}`;
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

/** fix-23b: inverse of getQuarterStart. Maps a YYYY-MM-DD week-key to the
 * quarter offset (delta from `now`'s quarter) that contains it. Used by the
 * Draw Schedule auto-snap: when a search filters down to a match outside
 * the visible quarter, the grid jumps to whichever quarter contains the
 * earliest matched block's start_week. */
export function weekKeyToQuarterOffset(
  weekKey: string,
  now: Date = new Date(),
): number {
  // Parse the week-key as a local-noon date to dodge timezone edge cases
  // around month boundaries (a UTC midnight parse can land on the prior
  // day in negative-offset zones).
  const d = new Date(`${weekKey}T12:00:00`);
  const targetQ = Math.floor(d.getMonth() / 3);
  const nowQ = Math.floor(now.getMonth() / 3);
  return (d.getFullYear() - now.getFullYear()) * 4 + (targetQ - nowQ);
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

// fix-DS-legibility / fix-DS-fluid-sizing / fix-DS-uniform-layout:
// quarter-overlap + block-font helpers.
//
// fix-DS-uniform-layout dropped the content tiers entirely. Every non-tail
// block now renders the SAME 5-line stack (address / juris / status / "Est.
// Approval" label / date) regardless of how many week-rows it occupies — only
// the absolute font size changes (blockFontPx), so the grid reads uniformly
// instead of some blocks dropping fields. (The old xs/sm/default `blockTier`
// helper is gone.)

/** fix-DS-fluid-sizing / fix-DS-uniform-layout / fix-DS-tail-and-fit: base font
 *  size (px, before textScale) for a block's content, ramped gently by how many
 *  week-rows it occupies so a short block reads a touch smaller and a tall one a
 *  touch larger — but capped low (9px) so even wide blocks stay calm and longer
 *  addresses fit on one line. Linear from span 2 (7px) through span 5 (≈8.05px)
 *  to span 8+ (9px), clamped to [7, 9]. The component multiplies textScale
 *  (fix-47 row-height scaling) on top of this. The address renders one step
 *  larger (base + 1, bold, caps at 10px); juris / Est. Approval one step smaller
 *  (base − 1, caps at 8px). */
export function blockFontPx(visibleSpanWeeks: number): number {
  const ramped = 7 + (visibleSpanWeeks - 2) * 0.35;
  return Math.min(9, Math.max(7, ramped));
}

// When a project spans beyond the visible quarter window, the partial slice
// shown in a secondary quarter loses context. We mark those slices so the UI
// can render a compact address-only block with a nav affordance pointing to
// where the rest lives:
//   'tail' -> the block STARTED before this quarter (we see its tail); the
//             affordance jumps back to the start quarter.
//   'head' -> the block ENDS after this quarter (we see its head); the
//             affordance jumps forward to the next quarter.
//   null   -> the block is fully contained in this quarter (render in full).
export type BlockOverflow = 'tail' | 'head' | null;

/** Classify a block's overlap with the visible quarter window. `weeks` is the
 *  ordered week-key list for the current quarter (getQuarterWeeks output). */
export function blockOverflow(
  startWeek: string,
  endWeek: string,
  weeks: string[],
): BlockOverflow {
  if (weeks.length === 0) return null;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  // Started in an earlier quarter -> this view is the tail.
  if (startWeek < first) return 'tail';
  // Starts within but runs past the end -> this view is the head.
  if (endWeek > last) return 'head';
  return null;
}
