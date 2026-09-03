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

// ===========================================================================
// ★★★ fix-484 §A (P-146) — A BLOCK'S LABEL IS READABLE, OR THE BLOCK IS PAINT
// ===========================================================================
//
// Bobby, 2026-09-02, on 548 3rd Ave N [Redesign 1]: *"when a project is on one
// quarter and goes to the next, it slams to the top or the bottom… it's going
// off the screen, a ton of colour and just a little bit of text."*
//
// ---------------------------------------------------------------------------
// ★★★ THERE IS NO CLIPPED RECT TO COMPUTE, AND NO `position: sticky` EITHER
// ---------------------------------------------------------------------------
// The brief offers both. Neither is needed, and the reason is worth writing
// down because it looks like it should be:
//
//   · The block ELEMENT IS ALREADY THE VISIBLE SLICE. `DrawScheduleBody`
//     derives `top = si * rowH` and `height` from `si`/`ei`, which are the
//     block's week range CLIPPED to the quarter's `weeks` array. A cross-quarter
//     block is not a tall element being trimmed by an ancestor — it is a short
//     element, drawn only where it shows.
//   · And the grid does not scroll vertically: `rowH = max(BASE_ROW_H,
//     floor(rowsAreaH / weeks.length))` FITS the whole quarter into the visible
//     area. There is no viewport clip for a sticky label to escape.
//   · `position: sticky` would in fact do NOTHING here even if there were: the
//     block sets `overflow: hidden`, which makes the block its own scroll
//     container, so a sticky child sticks to a box that never scrolls.
//
// ★★★ SO WHAT WAS WRONG WAS THE ANCHOR, NOT THE GEOMETRY. `justifyContent` read
// `isCompact ? 'flex-start' : 'center'`, and `isCompact` is true for EVERY
// cross-quarter slice however tall it is. The Q3 tail of that project is seven
// week-rows — ~180px — and it top-anchored two lines of 9px text against 170px
// of colour. That is the screenshot.
//
// fix-DS-address-anchor's reason for top-anchoring is real and is KEPT: centring
// inside an `overflow: hidden` box clips the TOP of a stack that is taller than
// its box, and the address is the first child. But that is a question about
// HEIGHT, not about which quarter a block started in — so it is asked as one.

/** ★ Vertical padding on the block (`padding: '1px 6px'`) plus its 1px flex gap,
 *  named so the height arithmetic below and the component cannot drift. */
export const BLOCK_STACK_PAD_Y = 1;
export const BLOCK_STACK_GAP = 1;

/** How many text lines the stack renders BESIDE the address.
 *  compact → "Est. Approval" + the date. full → juris + status + both of those.
 *  ★ A held block adds its "⏸ On hold" line; counted as full's 4 either way,
 *    which errs toward top-anchoring — the safe direction. */
export function blockDetailLines(isCompact: boolean): number {
  return isCompact ? 2 : 4;
}

/** The height the block's content stack needs, in px.
 *
 *  ★ Derived, not typed: it reads the SAME fonts the component renders with, so
 *    a font change moves this in the same build. `1.1` is the address's declared
 *    `lineHeight`; the detail lines use the same. */
export function blockStackHeight(
  addressLines: number,
  addressFontPx: number,
  detailFontPx: number,
  detailLines: number,
): number {
  const rows = addressLines + detailLines;
  return (
    Math.ceil(addressLines * addressFontPx * 1.1) +
    Math.ceil(detailLines * detailFontPx * 1.15) +
    Math.max(0, rows - 1) * BLOCK_STACK_GAP +
    BLOCK_STACK_PAD_Y * 2
  );
}

/** ★★★ Does this block have room to CENTRE its stack?
 *
 *  The whole of §A1: centre when the content fits, top-anchor when it does not.
 *  A cross-quarter slice that is seven rows tall centres like any other block;
 *  a one-week block still top-anchors, because that is the case
 *  fix-DS-address-anchor found clipping. */
export function blockCentresStack(
  blockHeightPx: number,
  stackHeightPx: number,
): boolean {
  return blockHeightPx >= stackHeightPx;
}

// ---------------------------------------------------------------------------
// ★★★ §A2 — WRAP, THEN SHRINK
// ---------------------------------------------------------------------------
//
// Bobby: *"just a little bit of text."* The address was ONE line with an
// ellipsis (fix-DS-uniform-layout, which chose a uniform per-block rhythm over
// legibility), so "548 3rd Ave N [Redesign 1]" rendered as "548 3rd Ave…" in a
// 90px column. Now: up to two lines, and a font that steps down rather than
// truncating — to a floor, never below it.

/** ★★★ THE FLOOR: 9.5px, ABSOLUTE — NOT MULTIPLIED BY `textScale`.
 *
 *  fix-47's week-date label renders at `9 * textScale`, and the brief names it
 *  as the reference, so scaling this with it looks like the obvious reading.
 *  ★★★ IT IS WRONG, AND THE HARNESS SAID SO. At a 1920×1080 viewport `textScale`
 *  sits on its 1.7 cap, which would put the "floor" at **16.15px** — and a
 *  16.15px floor in a ~100px text box holds 11 characters a line, so
 *  "548 3rd Ave N [Redesign 1]" (27) cannot fit two lines at ANY permitted size.
 *  Measured: every block pinned at the floor with `fits=false`. A floor that
 *  scales is not a floor, it is a second ramp, and it forbids exactly the
 *  step-down §A2 exists to allow.
 *
 *  ★★ So this is a READABILITY floor and it is absolute: 9.5px is legible on
 *  every monitor the team uses, and it is the size fix-47's date label renders
 *  at when the grid is NOT stretched. The ramp above it still scales — a tall
 *  row still gets big text — this is only the point at which shrinking stops
 *  and the two-line clamp takes over. */
export const BLOCK_ADDRESS_MIN_FONT = 9.5;

/** At most two lines. Three would eat the Est. Approval date on a short block,
 *  and the full address is always in the `title`. */
export const BLOCK_ADDRESS_MAX_LINES = 2;

/** ★★★ THE ONE MEASURED CONSTANT: average glyph advance as a fraction of the
 *  font size, for the block address at `fontWeight: 800` in the app's system
 *  sans stack.
 *
 *  ★★ WHY AN ESTIMATE RATHER THAN A MEASUREMENT. The alternative is to measure
 *  each address in the DOM and re-render — for up to a few hundred blocks, on
 *  every quarter change and every resize, in a grid that already drag-drops.
 *  This is arithmetic over a constant that was measured ONCE, in Chrome, in the
 *  harness (harness/draw-block-fit.html) against the real addresses.
 *
 *  ★★★ MEASURED IN CHROME, 2026-09-02, over the seven real addresses the grid
 *  renders (harness/draw-block-fit-484.html, canvas `measureText` at
 *  `800 <n>px` in the app's system-sans stack). The advance is scale-invariant,
 *  and the spread is the point:
 *
 *      548 3rd Ave N [Redesign 1]        0.5163
 *      13021 23rd Ave NE [Redesign 2]    0.5212
 *      611 3rd Ave N                     0.5220
 *      548 3rd Ave N                     0.5415
 *      5917 41st Ave SW                  0.5401
 *      100 Apple Way                     0.5637
 *      2724 Walnut Ave SW                0.5759   ← the widest
 *
 *  ★ IT ERRS WIDE ON PURPOSE — 0.58, above every measured value. Over-estimating
 *    makes the font step down one notch sooner than strictly necessary, which is
 *    legible; under-estimating leaves an address truncated, which is the defect.
 *    An average (0.535) would have been wrong for the two widest addresses in
 *    the exact direction that costs the reader the end of the street name.
 *
 *  ★ A digit-heavy address is NARROWER than a word-heavy one in this face,
 *    which is why the longest string on the list is not the widest per glyph. */
export const BLOCK_ADDRESS_CHAR_EM = 0.58;

/** How many lines `label` needs at `fontPx` inside `columnPx`.
 *
 *  ★ Wrapping breaks at SPACES, so a run with no space in it cannot be split:
 *    the widest single word sets the real minimum, and a label whose longest
 *    word overflows can never fit however many lines it is given. Counted the
 *    way the browser wraps rather than by dividing the whole string. */
export function blockAddressLines(
  label: string,
  fontPx: number,
  columnPx: number,
): number {
  const perLine = Math.floor(columnPx / (fontPx * BLOCK_ADDRESS_CHAR_EM));
  if (perLine <= 0) return Number.POSITIVE_INFINITY;
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const w of words) {
    // ★ A word longer than the column has nowhere better to go: it fills the
    //   line it starts on and overflows it. `min(…, perLine)` is what stops it
    //   being charged a SECOND line for the overflow — the browser draws one
    //   line and clips, and this counts one.
    if (used === 0) {
      used = Math.min(w.length, perLine);
      continue;
    }
    const need = used + 1 + w.length;
    if (need <= perLine) {
      used = need;
      continue;
    }
    lines += 1;
    used = Math.min(w.length, perLine);
  }
  return lines;
}

/** The font size the address renders at: the ramp's size, stepped down in
 *  half-pixels until it fits `maxLines`, never below `floorPx`.
 *
 *  ★ `floorPx` is also a FLOOR ON THE RAMP, not only on the step-down. The ramp
 *    bottoms out at 8px for a one-week block, which is below the date label
 *    beside it — exactly the "little bit of text" complaint. A block too short
 *    to hold two lines of 9.5px top-anchors and ellipsises (see
 *    `blockCentresStack`), which is the honest failure: small and readable, not
 *    smaller and readable. */
export function blockAddressFontPx(
  label: string,
  columnPx: number,
  rampPx: number,
  floorPx: number,
  maxLines: number = BLOCK_ADDRESS_MAX_LINES,
): number {
  const start = Math.max(rampPx, floorPx);
  if (columnPx <= 0) return start;
  for (let f = start; f > floorPx; f -= 0.5) {
    if (blockAddressLines(label, f, columnPx) <= maxLines) return f;
  }
  return floorPx;
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
