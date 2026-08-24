// ===========================================================================
// ★★★ fix-397 — THE PROJECT QUEUE BECOMES THE OWNER'S PRIORITY LIST
// ===========================================================================
//
// Bobby, 2026-08-24, from his own board screenshot:
//
//   "For 554 North 75th, there is something with a past due target date that
//    should be kind of at the top of the list. And for the Project Queue, what
//    we want in that lineup is not just waiting on the city, but if there's any
//    permits that had target submits or corrections that were assigned to you,
//    that's what your Project Queue would look like from an owner of a permit.
//    So if you're assigned to a permit, it's going to help sort by priority. So
//    whatever is past due, of course, would be at the top … we want it to
//    display: this is due today, this is due tomorrow, this is due in three
//    days. But we have to have submittals, corrections, and city review. So
//    those are like the three main things."
//
// ★★★ THE BUG THAT PROMPTED IT, MEASURED ON PROD 2026-08-24: 554 N 75th St's
// SDOT Tree (SDOTTRLA0002501) carries city_target 2026-08-21 — three days past
// due — and sat at the BOTTOM of Bobby's queue, below two PAR/Pre-Subs whose
// targets are the 28th. The old queue sorted by GROUP first and by project
// second, so a past-due row could never reach the top unless its whole group
// did. Sorting by the date is the entire fix.
//
// ---------------------------------------------------------------------------
// ★★★ TWO RULINGS FROM THE APPROVED MOCKUP (2026-08-24)
// ---------------------------------------------------------------------------
//
// 1. FLAT, SORTED PURELY BY DUE DATE — not grouped by project. The address is
//    the row's primary label, and a project with two due permits APPEARS TWICE.
//    (554 N 75th does exactly that on Bobby's live board: its SDOT Tree leads
//    the list and its PAR/Pre-Sub sits four rows down.)
//
// 2. "Blocked on you" and "Waiting on design" are REMOVED. In Bobby's words:
//
//      "i am not sure how well 'Blocked on you' and 'Waiting on design' is
//       built out and if it is serving a function. i think we remove those for
//       the time being until that gets built out in depth better. but this will
//       serve a better purpose i think."
//
//    ★★ RECORDED HERE BECAUSE REMOVAL WAS A RULING, NOT AN ACCIDENT. They may
//    return in a richer form; a future reader finding the relay machinery
//    (relayStateFor, MILESTONE_VERBS, milestoneCounterparty) still present and
//    unused in the queue should know it was left deliberately, not orphaned.

/** ★ The three mains, and it is a CLOSED SET. Bobby named exactly these:
 *  "we have to have submittals, corrections, and city review". */
export type QueueKind = 'submittal' | 'corrections' | 'city_review';

export const QUEUE_KIND_LABEL: Record<QueueKind, string> = {
  submittal: 'Submittal',
  corrections: 'Corrections',
  city_review: 'City review',
};

/**
 * ★★★ WHEN TWO KINDS FIT AT ONCE, THE MORE ACTIONABLE ONE WINS.
 *
 * Lower number = shown. Only ONE overlap is actually reachable:
 *
 *   corrections ∩ city_review — a permit whose current cycle has corrections
 *     in hand is also, literally, "submitted and not yet approved". The city's
 *     review target is not the question any more; the redlines are. Corrections
 *     wins, per the brief's explicit ruling.
 *
 *   corrections ∩ submittal — UNREACHABLE. `corrections` needs a cycle with
 *     corr_issued (so something was submitted); `target_submit` requires
 *     nothing has ever been submitted. They cannot both hold.
 *
 *   submittal ∩ city_review — UNREACHABLE for the same reason.
 *
 * The map is still written out in full rather than special-casing the one live
 * pair, so that adding a fourth kind is a one-line change with an obvious
 * place to put it.
 */
export const QUEUE_KIND_RANK: Record<QueueKind, number> = {
  corrections: 0,
  city_review: 1,
  submittal: 2,
};

/** ★ The bands, most urgent first. This array IS the render order. */
export const QUEUE_BANDS = [
  'past_due',
  'today',
  'tomorrow',
  'this_week',
  'later',
  'no_date',
] as const;
export type QueueBand = (typeof QUEUE_BANDS)[number];

export const QUEUE_BAND_LABEL: Record<QueueBand, string> = {
  past_due: 'Past due',
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  later: 'Later',
  no_date: 'No target date',
};

/** Whole days from `fromIso` to `toIso`, at UTC noon so the result never drifts
 *  across a day boundary regardless of the runtime timezone. */
export function daysUntil(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T12:00:00Z`);
  const b = Date.parse(`${toIso}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * ★★ THE BAND, and the one judgement call in it is "this week".
 *
 * It is a ROLLING SEVEN DAYS (2..7 days out), not the remainder of the calendar
 * week. Bobby's own framing is relative — "this is due today, this is due
 * tomorrow, this is due in three days" — and a calendar week would mean a row
 * due in two days lands in "Later" on a Saturday and in "This week" on a
 * Monday, which is the kind of Monday-morning surprise that makes people stop
 * trusting a list.
 */
export function bandFor(due: string | null | undefined, today: string): QueueBand {
  if (!due) return 'no_date';
  const d = daysUntil(today, due);
  if (d < 0) return 'past_due';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d <= 7) return 'this_week';
  return 'later';
}

/**
 * ★★ Due-ness in words, right-aligned on the row above the date itself.
 *
 * ★ Never a bare number and never blank: "3d past due" / "due today" /
 * "due in 4d" / "No target date". A blank looks like zero, which is the failure
 * mode this codebase keeps hitting (fix-303's rule, carried forward).
 */
export function dueWordsFor(due: string | null | undefined, today: string): string {
  if (!due) return QUEUE_BAND_LABEL.no_date;
  const d = daysUntil(today, due);
  if (d < 0) return `${-d}d past due`;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  return `due in ${d}d`;
}

/** Days past due, or null when the row has no date. ★ A missing date is NOT
 *  overdue — "we don't know" and "it's late" are different facts. */
export function daysPastDueFor(
  due: string | null | undefined,
  today: string,
): number | null {
  if (!due) return null;
  const d = daysUntil(today, due);
  return d < 0 ? -d : 0;
}

/** One flat row. The address is the PRIMARY label (ruling 1), so a project with
 *  two due permits produces two of these. */
export interface QueueRow {
  key: string;
  permitId: number;
  projectId: string;
  /** The row's headline. */
  address: string;
  num: string | null;
  type: string;
  cycleIndex: number | null;
  kind: QueueKind;
  /** ISO date, or null — `corrections` is always null; see the note in
   *  myBoard.ts's buildQueue for why the model carries no resubmit target. */
  due: string | null;
  band: QueueBand;
  /** "3d past due" / "due today" / "due in 4d" / "No target date". */
  dueWords: string;
  /** null when there is no date; 0 when dated and not late. */
  daysPastDue: number | null;
  /** "6d submitted, awaiting intake" — the existing queue's state sentence. */
  stateLine: string;
  /** Whose row this is, for the DM's group-by-associate view (fix-365). */
  owner: string | null;
}

/** A band with its rows. Empty bands are NOT emitted — the bands are a sort,
 *  not a checklist, so there are no "Nothing here" rows. */
export interface QueueBandGroup {
  band: QueueBand;
  label: string;
  rows: QueueRow[];
}

export interface OwnerQueue {
  bands: QueueBandGroup[];
  /** Every row, already in render order. */
  rows: QueueRow[];
  total: number;
  pastDue: number;
  /** today + tomorrow + this_week — "what lands before the week is out". */
  dueThisWeek: number;
}

/**
 * ★★★ THE SORT, AND IT IS PURELY THE DATE.
 *
 * Band order first (which is itself date order, coarsely), then the date
 * ascending inside the band — so the oldest past-due row leads the whole list.
 * Kind is NOT a sort key: sorting by kind is what buried the SDOT Tree.
 *
 * ★ Ties break on address then permit id, so the order is stable across
 * renders and two rows of the same project sit together within a band.
 */
export function sortQueueRows(rows: readonly QueueRow[]): QueueRow[] {
  const bandRank = new Map<QueueBand, number>(QUEUE_BANDS.map((b, i) => [b, i]));
  return [...rows].sort((a, z) => {
    const byBand = bandRank.get(a.band)! - bandRank.get(z.band)!;
    if (byBand !== 0) return byBand;
    // Within a band: earliest date first. Rows with no date only ever share the
    // no_date band, where they compare equal and fall through to address.
    if (a.due && z.due && a.due !== z.due) return a.due < z.due ? -1 : 1;
    const byAddr = a.address.localeCompare(z.address);
    if (byAddr !== 0) return byAddr;
    return a.permitId - z.permitId;
  });
}

/** Group already-sorted rows into their bands, dropping the empty ones. */
export function groupIntoBands(rows: readonly QueueRow[]): QueueBandGroup[] {
  const out: QueueBandGroup[] = [];
  for (const band of QUEUE_BANDS) {
    const inBand = rows.filter((r) => r.band === band);
    if (inBand.length === 0) continue;
    out.push({ band, label: QUEUE_BAND_LABEL[band], rows: inBand });
  }
  return out;
}

/** Assemble the finished queue from unsorted rows. */
export function assembleQueue(rows: readonly QueueRow[]): OwnerQueue {
  const sorted = sortQueueRows(rows);
  return {
    bands: groupIntoBands(sorted),
    rows: sorted,
    total: sorted.length,
    pastDue: sorted.filter((r) => r.band === 'past_due').length,
    dueThisWeek: sorted.filter(
      (r) => r.band === 'today' || r.band === 'tomorrow' || r.band === 'this_week',
    ).length,
  };
}
