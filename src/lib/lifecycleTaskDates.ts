// fix-349: pure mirror of the date derivation inside bp_create_lifecycle_task
// (migrations/fix_349_par_template_and_wac.sql §2).
//
// ★★ WHY A MIRROR. CI has no live database, so the mirror IS the tested
// contract — the fix-153 pattern this repo uses for every RPC rule. The SQL was
// additionally exercised against production inside a transaction that ends in
// RAISE EXCEPTION; the transcript is in the PR body and nothing persisted.
//
// ★★★ THE RULE: A BOT TASK STARTS WHEN THE CITY ACTED, NOT WHEN WE NOTICED.
//
// Bobby: *"That would have a start date of today. So if we got corrections
// today, then a task would get created today, and then that would have a start
// date of today."* — the date the CITY acted. The tool recorded the date the
// SCRAPER NOTICED, which is the same day right up until the scraper catches up
// on a backlog and a permit approved three weeks ago produces a task starting
// today.
//
// Measured on prod 2026-08-19 over all 560 bot tasks: 246 carry no start date
// and 155 carry one that disagrees with the city's own date. Only 36 are right.
// ★ None of them is changed by this ticket — backfilling was not approved.

import type { AutoEvent } from './database.types';

/** The city's own dates for one permit, as the function reads them. */
export interface LifecycleDateSources {
  /** The cycle named by `cycle_idx`, when the event is cycle-scoped. */
  cycle?: {
    submitted?: string | null;
    intake_accepted?: string | null;
    corr_issued?: string | null;
    resubmitted?: string | null;
  } | null;
  /** permits.approval_date — the basis for a `results_ready` 'approved' task. */
  approvalDate?: string | null;
  /** permits.actual_issue — the basis for a `results_ready` 'issued' task. */
  actualIssue?: string | null;
  /** p_context->>'basis' for `results_ready`; defaults to 'issued' like the SQL. */
  basis?: 'approved' | 'issued' | null;
}

/**
 * ★ The city's date for this event, or null when the event genuinely has none.
 *
 * Five of the seven events have one. The two that do not are not oversights:
 *
 *   number_entry      "was this submitted?" is a question ABOUT a missing date,
 *                     so there is nothing to read.
 *   scrape_reconcile  a portal/dashboard mismatch is noticed now, by definition.
 */
export function cityDateForEvent(
  event: AutoEvent,
  src: LifecycleDateSources,
): string | null {
  const c = src.cycle ?? {};
  switch (event) {
    case 'intake_submitted':
      return c.submitted ?? null;
    case 'intake_accepted':
      return c.intake_accepted ?? null;
    case 'corr_issued':
      return c.corr_issued ?? null;
    case 'resubmitted':
      return c.resubmitted ?? null;
    case 'results_ready':
      return (src.basis ?? 'issued') === 'approved'
        ? (src.approvalDate ?? null)
        : (src.actualIssue ?? null);
    case 'number_entry':
    case 'scrape_reconcile':
      return null;
  }
}

/**
 * ★★ The two dates a bot task is born with.
 *
 *   start_date   the city's date — the clock. Never in the future
 *                (LEAST guard) and never null (COALESCE guard): the brief asks
 *                for both, and they are what stop this change from turning
 *                "wrong date" into "no date" or "a date in the future".
 *
 *   target_date  today + 1, ★ deliberately NOT start + 1.
 *
 * ★★★ On target_date, because it is the half that looks like a bug: fix-292 set
 * `target = start + 1`. Now that `start` can be weeks in the past, that formula
 * would create tasks ALREADY past due at the moment they are born — and since
 * fix-348 blended tasks into the forecast, straight into the Past due bucket.
 * You cannot be late for work you did not know about. The gap between the two
 * IS the scraper's lag, shown on the row rather than charged to the team.
 */
export function lifecycleTaskDates(
  event: AutoEvent,
  src: LifecycleDateSources,
  today: string,
  targetDays = 1,
): { start_date: string; target_date: string } {
  const city = cityDateForEvent(event, src);
  // LEAST(city, today) — a start date cannot be in the future.
  const start = city != null && city < today ? city : today;
  return { start_date: start, target_date: addDays(today, targetDays) };
}

/** Add whole days to a YYYY-MM-DD date at UTC noon, so the result never drifts
 *  across a day boundary regardless of the runtime timezone. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
