// ===========================================================================
// fix-620 (P-315) — FINISHED BLOCKS NEVER MOVE, AND AN OVERLAP ASKS TO BE FIXED
// ===========================================================================
//
// Bobby, 2026-10-02: "we dont want past blocks to move, and we dont want
// overlapping, because then we cannot see if something is over one another.
// so if something were to overlap, an error or prompt needs to appear to fix
// it".
//
// ★★★ THE SERVER IS THE RULE; THIS IS ITS MIRROR. The deferred trigger
//     `bp_draw_schedule_no_overlap` (migrations/fix_620_…) refuses every write
//     — drag, resize, DA move, DD dates, wizard, backfill — with SQLSTATE
//     P0620 and the sentence `finishedBlockRefusal` builds here. The grid asks
//     this mirror FIRST so a drop over finished work says so at once, instead
//     of offering a Push Down the server would refuse. Keep the two in step:
//     the SQL is `bp_draw_overlap_refusal`.
//
// The rule:
//   · "Started" = start_week before the current week's Monday.
//   · A project block may not newly overlap a STARTED block in its lane.
//     "Newly" is judged against the row's own previous position (same lane
//     only) — an edit that leaves an existing overlap no bigger is allowed.
//   · Overlaps between two UPCOMING blocks are not refused: Push Down clears
//     those, as before.

export interface LaneBlock {
  projectId: string;
  startWeek: string;
  endWeek: string;
}

/** Week keys are `YYYY-MM-DD` Mondays; noon UTC keeps the arithmetic off DST. */
function toDate(weekKey: string): Date {
  return new Date(`${weekKey}T12:00:00Z`);
}

function weeksBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / (7 * 86400000));
}

/** The current week's Monday as a week key, from the viewer's local date. */
export function currentWeekMonday(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
  const back = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Has this block started? Week keys compare lexically like dates. */
export function isStartedBlock(startWeek: string, monday: string): boolean {
  return startWeek < monday;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Jun 24 – Jul 1, 2024`, or both years when they differ — the SQL's
 *  `to_char(…, 'Mon FMDD, YYYY')`. */
export function formatBlockWeeks(startWeek: string, endWeek: string): string {
  const s = toDate(startWeek);
  const e = toDate(endWeek);
  const md = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return s.getUTCFullYear() === e.getUTCFullYear()
    ? `${md(s)} – ${md(e)}, ${e.getUTCFullYear()}`
    : `${md(s)}, ${s.getUTCFullYear()} – ${md(e)}, ${e.getUTCFullYear()}`;
}

/** Inclusive overlap in weeks; 0 when the ranges don't touch. */
function overlapWeeks(aS: string, aE: string, bS: string, bE: string): number {
  if (!(aS <= bE && bS <= aE)) return 0;
  const start = aS > bS ? aS : bS;
  const end = aE < bE ? aE : bE;
  return weeksBetween(start, end) + 1;
}

export interface RefusalInput {
  /** Every project block on the TARGET lane (the moving one may be included). */
  laneBlocks: readonly LaneBlock[];
  projectId: string;
  lane: string;
  startWeek: string;
  endWeek: string;
  /** Where the block was before — null for a new block. */
  oldLane: string | null;
  oldStartWeek: string | null;
  oldEndWeek: string | null;
  monday: string;
  addressOf: (projectId: string) => string | null | undefined;
}

/** The sentence the server would refuse with, or null when the write may stand. */
export function finishedBlockRefusal(input: RefusalInput): string | null {
  const { laneBlocks, projectId, lane, startWeek, endWeek, monday } = input;
  if (!lane.trim() || !startWeek || !endWeek) return null;
  const sameLane = input.oldLane === lane && !!input.oldStartWeek && !!input.oldEndWeek;

  const hits = laneBlocks
    .filter((b) => b.projectId !== projectId)
    .filter((b) => isStartedBlock(b.startWeek, monday))
    .filter((b) => {
      const now = overlapWeeks(startWeek, endWeek, b.startWeek, b.endWeek);
      const before = sameLane
        ? overlapWeeks(input.oldStartWeek as string, input.oldEndWeek as string, b.startWeek, b.endWeek)
        : 0;
      return now > before;
    })
    .map((b) => ({
      addr: (input.addressOf(b.projectId) ?? '').trim() || 'another project',
      startWeek: b.startWeek,
      endWeek: b.endWeek,
    }))
    .sort((a, b) =>
      a.startWeek < b.startWeek ? -1 : a.startWeek > b.startWeek ? 1 : a.addr.localeCompare(b.addr),
    );

  if (hits.length === 0) return null;
  const parts = hits.slice(0, 3).map((h) => `${h.addr} (${formatBlockWeeks(h.startWeek, h.endWeek)})`);
  let list: string;
  if (hits.length > 3) list = `${parts.join(', ')} and ${hits.length - 3} more`;
  else if (parts.length === 1) list = parts[0];
  else list = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This overlaps ${list}. Finished blocks don't move — choose other weeks or another lane.`;
}
