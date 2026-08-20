import { suppressionGroups, type BoardViewer, type SuppressionCounts } from './myBoard';

// ===========================================================================
// ★★★ fix-370 — a count of the page is not a count of the window
// ===========================================================================
//
// MEASURED ON PROD 2026-08-20:
//
//   rows matching the feed's own WHERE over 14 days        1,600
//   rows the RPC returned                                    300
//   where the 300th fell                    2026-08-19 15:29 — YESTERDAY
//
// ★★★ The "14-day" feed covered nineteen hours, and the suppression classifier
// ran AFTER the cap. Bobby's bell read "Not shown · 295" — 295 of the 300 rows
// that were fetched, leaving about five slots for anything a person could be
// shown. The number was not wrong about the page; the page was wrong about the
// window, and nothing anywhere said so.
//
// ---------------------------------------------------------------------------
// ★★ THE COUNTS ARE LOAD-BEARING — that is why this file exists at all
// ---------------------------------------------------------------------------
//
// `myBoard.suppressionGroups` carries the reason, and it is a good one:
// *"showing the SUPPRESSED COUNT is how a quiet day and a broken notifier stop
// looking the same: four bugs this year had the shape of a missing thing
// looking identical to an absent one."*
//
// So the answer was never "filter the noise away and delete the line". It is:
// the RPC gives each class its own row budget so neither starves the other,
// AND returns true totals from an uncapped aggregate, and this file is where
// the two meet.

/** One row of `bp_scraper_activity_summary`. Raw facts, no verdict. */
export interface ActivitySummary {
  /** The window the totals were taken over — the RPC's own clamped value. */
  window_days: number;
  /** Every row matching the feed's WHERE clause. */
  total: number;
  /** …minus retries and manual-edit guards: the rows a person can be shown. */
  showable: number;
  retries: number;
  guarded: number;
  oldest_at: string | null;
  newest_at: string | null;
}

/** The shape the two functions below need from a fetched row. */
interface ClassifiableRow {
  action: string;
  ent_lead: string | null;
}

/**
 * ★★★ THE COUNTS, HONESTLY — two of them from the window, one from the page.
 *
 * ★★ `retries` and `guarded` are properties of the ROW. They are the same
 * number for everyone, so the RPC counts them over the whole window and this
 * just carries the answer. On prod that turns `295` into `925`.
 *
 * ★★★ `notYours` is `ent_lead !== viewer` — a DIFFERENT ANSWER FOR EVERY
 * PERSON, and the oversight layer (Bobby, Gena, Dave) legitimately wants the
 * wider set. It stays here, classified in the browser over the rows that
 * arrived, exactly where it has always been. Pushing the viewer into the RPC
 * would buy one true number at the cost of a per-person cache entry and a
 * policy frozen into SQL.
 *
 * ★★ SO HOW IS IT KEPT HONEST AGAINST A CAP? By the cap no longer biting.
 * The showable budget (1,500) is nearly twice the worst 14-day volume ever
 * observed (799 over 60 days of history), so every showable row in the window
 * arrives and `notYours` counted over them IS the true count. When that stops
 * being true `isFeedTruncated` says so and the UI says "at least" — a floor
 * stated as a floor, rather than a total that quietly became a sample.
 */
export function trueSuppressionCounts(
  summary: ActivitySummary | null | undefined,
  rows: ReadonlyArray<ClassifiableRow>,
  viewer: BoardViewer,
): SuppressionCounts {
  const groups = suppressionGroups(rows, viewer);
  if (!summary) {
    // ★ No summary yet (first paint, or the query failed). Fall back to the
    // pre-fix-370 behaviour rather than showing zeros: an understated count is
    // wrong, but a count that vanishes looks like a quiet day, which is the one
    // thing this line exists to prevent.
    return {
      retries: groups.retries.length,
      guarded: groups.guarded.length,
      notYours: groups.notYours.length,
    };
  }
  return {
    retries: summary.retries,
    guarded: summary.guarded,
    notYours: groups.notYours.length,
  };
}

/**
 * ★★ Did the window deliver everything it claims?
 *
 * ★ Compares the SHOWABLE totals only. The suppressed rows are deliberately
 * fetched as a bounded sample — the centre lists 50 of them per section behind
 * a true count — so a shortfall there is by design and is stated separately by
 * `suppressedSampleNote`. A shortfall in the showable rows is the bug.
 */
export function isFeedTruncated(
  summary: ActivitySummary | null | undefined,
  rows: ReadonlyArray<ClassifiableRow>,
): boolean {
  if (!summary) return false;
  const shown = rows.filter((r) => !isSuppressedAction(r.action)).length;
  return summary.showable > shown;
}

/** ★ The TS side of `bp_scraper_suppressed_actions`. Reuses `suppressionGroups`
 *  rather than restating the action names, so there is still exactly one list
 *  of them in this codebase. */
function isSuppressedAction(action: string): boolean {
  const g = suppressionGroups([{ action, ent_lead: null }], { name: '' } as BoardViewer);
  return g.retries.length + g.guarded.length > 0;
}

/**
 * ★ A truncated feed must SAY it is truncated.
 *
 * "A capped feed that looks complete is how this went unnoticed" — and the
 * previous one looked complete for four tickets. Returns null when there is
 * nothing to admit, so a caller renders nothing rather than a reassurance
 * nobody needs.
 */
export function truncationNote(
  summary: ActivitySummary | null | undefined,
  rows: ReadonlyArray<ClassifiableRow>,
): string | null {
  if (!summary || !isFeedTruncated(summary, rows)) return null;
  const shown = rows.filter((r) => !isSuppressedAction(r.action)).length;
  return `Showing the most recent ${shown.toLocaleString()} of ${summary.showable.toLocaleString()} events in the last ${summary.window_days} days.`;
}

/**
 * ★★ The suppressed rows are a SAMPLE, and the sample says so.
 *
 * fix-336 built the "Not shown" tab to list the rows behind the number. It does
 * not need all 925 of them to do that — it needs the number to be true and the
 * rows to be real. This is the sentence that keeps those two facts from being
 * read as one.
 */
export function suppressedSampleNote(
  trueCount: number,
  fetched: number,
): string | null {
  if (trueCount <= fetched) return null;
  return `${trueCount.toLocaleString()} in the window · showing the most recent ${fetched.toLocaleString()}`;
}

/** ★ What the Activity page puts in its header — one sentence, all facts. */
export function activityWindowLabel(
  summary: ActivitySummary | null | undefined,
  fetched: number,
  fallbackDays: number,
): string {
  if (!summary) {
    return `${fetched.toLocaleString()} event${fetched === 1 ? '' : 's'} in the last ${fallbackDays} days`;
  }
  const days = summary.window_days;
  if (summary.total > fetched) {
    // ★ Both numbers, always in this order: what you are looking at, then what
    // there was. The old header printed only the first and called it the second.
    return `${fetched.toLocaleString()} of ${summary.total.toLocaleString()} events in the last ${days} days`;
  }
  return `${summary.total.toLocaleString()} event${summary.total === 1 ? '' : 's'} in the last ${days} days`;
}
