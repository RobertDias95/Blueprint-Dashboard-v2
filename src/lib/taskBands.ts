import {
  QUEUE_BANDS,
  QUEUE_BAND_LABEL,
  bandFor,
  type QueueBand,
} from './projectQueue';

// ===========================================================================
// ★★★ fix-444 §A (P-048, ruling 3) — DATE BANDS WITH HEADERS, EVERYWHERE
// ===========================================================================
//
// Bobby, 2026-08-29 (D-2026-08-29-board-is-the-snapshot-my-tasks-is-
// everything): *"Date bands with headers, EVERYWHERE: Past due → Today →
// Tomorrow → This week → Later → No target date. The manual priority flag
// lifts a task to the top of its band, never out of it."*
//
// ★★★ THE VOCABULARY IS REUSED, NOT RE-INVENTED. `QUEUE_BANDS`,
// `QUEUE_BAND_LABEL` and `bandFor` are fix-397's, chosen deliberately after
// Bobby's own framing ("this is due today, this is due tomorrow, this is due in
// three days") — and `this_week` is a ROLLING seven days rather than the
// remainder of the calendar week, precisely so a row does not change band
// between Friday and Monday. Two surfaces on one screen calling the same seven
// days by two different names is the drift this file exists to prevent.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT THIS REPLACES, AND WHY IT MATTERS MOST FOR UNDATED WORK
// ---------------------------------------------------------------------------
//
// `sorted()` ranked by `target_date ?? '￿'` — a sentinel that sorts after
// every real ISO date, so undated tasks sank to the bottom of a long column
// with NOTHING SAYING SO. Measured on prod 2026-08-29, open tasks per person:
//
//     who      past_due  today  tomorrow  this_week  later  no_date  total
//     Bobby           0      2         1          0      0        2      5
//     Miles          25      3         1          0      1       91    121
//     Trevor          2      0         0          0      0        5      7
//
// ★★ SEVENTY-FIVE PER CENT OF MILES'S OPEN TASKS HAVE NO TARGET DATE. Ninety-one
// rows were falling off the bottom of his column unlabelled, indistinguishable
// from "nothing left". A header that says "No target date · 91" is the whole
// point of the ruling.

export { QUEUE_BANDS, QUEUE_BAND_LABEL, bandFor };
export type { QueueBand };

/** One band's worth of rows, ready to render. */
export interface Band<T> {
  band: QueueBand;
  label: string;
  items: T[];
}

/** The two fields banding needs off a row. Structurally typed so a task node
 *  and (later) a milestone item both satisfy it without either importing the
 *  other. */
export interface BandableRow {
  target_date: string | null;
  priority?: boolean | null;
  sort_order?: number | null;
}

/**
 * ★★★ THE ORDER WITHIN A BAND (ruling 3's second sentence).
 *
 *   1. `priority` first — and ONLY here. The flag lifts a row to the top of
 *      the band it is already in; it can never carry a Later task above an
 *      unflagged Today one. That is the whole difference between "important"
 *      and "urgent", and the old sort conflated them by ranking priority above
 *      the date across the entire column.
 *   2. `target_date` ascending — inside `no_date` every row compares equal
 *      here and falls through.
 *   3. `sort_order` — the last tiebreak, and it is NOT dead weight: 86 of
 *      1,643 tasks carry a non-zero value across 17 distinct numbers, seeded
 *      by the task TEMPLATES (a template's steps keep their intended order).
 *      Nothing in the app lets a person drag a task, so this preserves the
 *      template's sequence rather than any user arrangement — see the note on
 *      the removed By Due Date toggle in MyTasks.
 */
export function compareInBand<T extends BandableRow>(a: T, z: T): number {
  const byFlag = (z.priority ? 1 : 0) - (a.priority ? 1 : 0);
  if (byFlag !== 0) return byFlag;
  const ad = a.target_date ?? '';
  const zd = z.target_date ?? '';
  if (ad !== zd) return ad < zd ? -1 : 1;
  return (a.sort_order ?? 0) - (z.sort_order ?? 0);
}

/**
 * ★★ Group rows into bands, in QUEUE_BANDS order, dropping the empty ones.
 *
 * ★ Empty bands are not emitted — the bands are a SORT, not a checklist, and
 *   fix-397 made the same call for the same reason. A column of six headers
 *   over two rows teaches nobody anything.
 */
export function bandRows<T extends BandableRow>(
  rows: readonly T[],
  today: string,
): Band<T>[] {
  const byBand = new Map<QueueBand, T[]>();
  for (const r of rows) {
    const b = bandFor(r.target_date, today);
    const list = byBand.get(b);
    if (list) list.push(r);
    else byBand.set(b, [r]);
  }
  const out: Band<T>[] = [];
  for (const band of QUEUE_BANDS) {
    const items = byBand.get(band);
    if (!items || items.length === 0) continue;
    out.push({
      band,
      label: QUEUE_BAND_LABEL[band],
      items: [...items].sort(compareInBand),
    });
  }
  return out;
}

/**
 * ★★★ RESOLVED IS NOT BANDED, AND THE MEASUREMENT IS WHY.
 *
 * The brief offered one trigger for collapsing it — "if Resolved is dominated
 * by no_date". It is not: 761 of 1,320 resolved tasks carry a target date. But
 * measuring it falsified the premise in a worse way:
 *
 *     resolved with a target date IN THE PAST     738
 *     resolved with a target date in the future    23
 *     resolved with no target date                559
 *
 * ★★★ So banding Resolved would file 738 FINISHED tasks under "Past due" — a
 * label that is simply false about completed work, and the exact class of lie
 * this codebase keeps removing (fix-303's "a blank looks like zero", fix-358's
 * verdict-on-the-card). A finished task is not late; it is done.
 *
 * ★ The date is not lost — it is still on the row. What is dropped is the
 *   claim that the date still means a deadline.
 */
export const RESOLVED_IS_BANDED = false;

/** Resolved rows in one list, newest-finished first is not available here
 *  (done_at is not on the node), so the same in-band comparator is reused —
 *  it degrades to date-then-order, which is the ordering Resolved had. */
export function resolvedOrder<T extends BandableRow>(rows: readonly T[]): T[] {
  return [...rows].sort(compareInBand);
}
