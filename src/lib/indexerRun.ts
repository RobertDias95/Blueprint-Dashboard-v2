// ===========================================================================
// ★★★ fix-376 — the worklist is live; the index behind it is not
// ===========================================================================
//
// fix-374 shipped the list and it works: 152 rows across 70 projects, read from
// the LIVE view, paged past the PostgREST cap. Nothing here touches it.
//
// ★★★ WHAT HAS NO CONSUMER AT ALL IS fix-373's SNAPSHOT. `indexer_run`,
// `indexer_project_reconciliation` and `indexer_missing_letter` — the run stamp,
// its outcome, its mode, and the projects that matched no folder — were built,
// are written by every run, and are shown nowhere. That is this file's job.
//
// ---------------------------------------------------------------------------
// ★★★ WHY THE RUN STAMP IS THE WHOLE POINT
// ---------------------------------------------------------------------------
//
// The indexer needs the `\\bpc-file` UNC share, so it cannot run in GitHub
// Actions. It runs when Bobby types the command. There is no schedule and this
// ticket does not build one.
//
// So a person reading "20 projects with no letter" has no way to know whether
// that was true an hour ago or nine days ago. fix-373 anticipated it exactly:
// *"if the last run was nine days ago, the Bridge must be able to say so. The
// run stamp is what makes an unscheduled tool safe to trust."*

/** One row of `indexer_run_current`, or of `indexer_run` for the last attempt. */
export interface IndexerRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  seconds: number | null;
  /** ★★★ THREE-VALUED ON PURPOSE — see runState. */
  ok: boolean | null;
  exit_code: number | null;
  error: string | null;
  mode: string | null;
  scope: string | null;
  dry_run: boolean | null;
  forced: boolean | null;
  reconciliation_written: boolean | null;
  projects_with_corrections: number | null;
  letters_level: number | null;
  letters_behind: number | null;
  no_letters_found: number | null;
  missing_rounds: number | null;
  unmatched_projects: number | null;
  /** Only on `indexer_run_current`. */
  age_days?: number | null;
}

/** One row of `indexer_reconciliation_current`. */
export interface IndexerReconciliation {
  run_id: string;
  project_id: string;
  address: string | null;
  juris: string | null;
  status: string | null;
  expected_max_round: number | null;
  found_max_cycle: number | null;
  items_found: number | null;
  rounds_behind: number | null;
  project_parked: boolean | null;
}

// ---------------------------------------------------------------------------
// ★★★ 1 · THE THREE STATES, AND THE FOURTH THAT IS TODAY'S
// ---------------------------------------------------------------------------

export type RunState =
  /** ★★★ Today's actual state: the snapshot tables hold zero rows. */
  | 'never'
  /** The run finished. The numbers on screen are its numbers. */
  | 'ok'
  /** `ok = false` — it failed, and the numbers are from an earlier run. */
  | 'failed'
  /** ★★★ `ok` still NULL — the process was KILLED. "Never returned" is not
   *  "failed", and fix-373 left the column three-valued to keep them apart. */
  | 'killed';

/**
 * ★★★ THE TRAP THIS FUNCTION EXISTS FOR.
 *
 * `indexer_run_current` is defined `WHERE reconciliation_written` — so a run
 * that was killed before it wrote one **never appears in that view at all**.
 * Reading only the view would make "the process never returned" look exactly
 * like "no run has ever happened", which is the precise distinction fix-373
 * built the three-valued `ok` to preserve.
 *
 * ★★ So the answer needs BOTH: the last run that produced the numbers, and the
 * last run ATTEMPTED. When the latest attempt is not the run behind the
 * numbers, the attempt is what the state describes.
 */
export function runState(
  current: IndexerRun | null,
  lastAttempt: IndexerRun | null,
): RunState {
  if (!current && !lastAttempt) return 'never';
  // ★ The attempt wins when it is newer than the run behind the numbers: it is
  // the thing that just happened, and its outcome is the news.
  const subject =
    lastAttempt && (!current || lastAttempt.started_at > current.started_at)
      ? lastAttempt
      : current;
  if (!subject) return 'never';
  if (subject.ok === true) return 'ok';
  if (subject.ok === false) return 'failed';
  // ★★★ NULL. Not false. The process was killed, or is running right now, and
  // either way it never reported an outcome.
  return 'killed';
}

// ---------------------------------------------------------------------------
// ★★ FRESHNESS — a date and a state, not an alarm
// ---------------------------------------------------------------------------

/**
 * ★★ SEVEN DAYS, and the reason is the work rather than taste.
 *
 * The list exists so somebody can chase a correction round the week it lands. A
 * run older than a week can therefore be missing a whole week of new rounds —
 * which is the point at which the number on screen stops being an answer and
 * starts being a memory. Below it, the list is current enough that a missing
 * letter is genuinely missing rather than merely un-indexed.
 *
 * ★ Deliberately NOT an alarm. The brief says so and it is right: this is a
 * date and a state on a page somebody already has open, not a new channel.
 */
export const RUN_STALE_DAYS = 7;

/** Under this, the run is recent enough that nobody need think about it. */
export const RUN_FRESH_DAYS = 2;

export type RunFreshness = 'fresh' | 'ageing' | 'stale' | 'unknown';

export function runFreshness(ageDays: number | null | undefined): RunFreshness {
  if (ageDays == null || Number.isNaN(ageDays)) return 'unknown';
  if (ageDays >= RUN_STALE_DAYS) return 'stale';
  if (ageDays >= RUN_FRESH_DAYS) return 'ageing';
  return 'fresh';
}

/** ★ Plain words for a number of days. Whole days, because "0.3 days ago" is
 *  not how anybody thinks about when something last ran. */
export function ageWords(ageDays: number | null | undefined): string {
  if (ageDays == null || Number.isNaN(ageDays)) return 'at an unknown time';
  const days = Math.floor(ageDays);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * ★★★ WHAT THE HEADER SAYS, INCLUDING WHEN THERE IS NOTHING TO SAY.
 *
 * ★★★ The empty case is not hypothetical — it is today's. fix-373 merged after
 * Bobby's last run, so all three tables hold zero rows, and that is what ships
 * until he runs it again. It must read as "the index has not run since this was
 * added", NOT as "everything is fine" and NOT as a broken screen. The live
 * worklist below it still works and still has its 152 rows; the snapshot simply
 * has nothing to say yet.
 */
export function runHeadline(
  state: RunState,
  current: IndexerRun | null,
  lastAttempt: IndexerRun | null,
): string {
  switch (state) {
    case 'never':
      return 'The indexer has not run since this record was added.';
    case 'ok':
      return `Indexed ${ageWords(current?.age_days)}.`;
    case 'failed':
      return `The last run failed ${ageWords(ageDaysOf(lastAttempt))}.`;
    case 'killed':
      // ★★★ NOT "failed". A killed process reported nothing at all, and saying
      // it failed would be claiming knowledge of an outcome nobody has.
      return `The last run never reported an outcome (${ageWords(ageDaysOf(lastAttempt))}).`;
  }
}

/** ★ What the numbers below the headline are actually from — which for a failed
 *  or killed attempt is an EARLIER run, and saying so is the whole point. */
export function numbersProvenance(
  state: RunState,
  current: IndexerRun | null,
): string {
  if (state === 'never') {
    return 'There are no run figures yet. The list below is live and unaffected.';
  }
  if (state === 'ok') return 'The figures below are from that run.';
  if (!current) {
    return 'No earlier run wrote figures, so there are none to show.';
  }
  return `The figures below are from the last run that finished, ${ageWords(current.age_days)}.`;
}

/** ★ `age_days` exists only on the `_current` view; for an arbitrary run row it
 *  is computed from `started_at`. One definition either way. */
export function ageDaysOf(run: IndexerRun | null, now: number = Date.now()): number | null {
  if (!run) return null;
  if (run.age_days != null) return run.age_days;
  const started = Date.parse(run.started_at);
  if (Number.isNaN(started)) return null;
  return (now - started) / 86_400_000;
}

/** ★ How the run was invoked, in the words Bobby typed. Absent parts are simply
 *  absent — nothing is invented to fill the sentence out. */
export function runMode(run: IndexerRun | null): string {
  if (!run) return '';
  const parts: string[] = [];
  if (run.mode) parts.push(run.mode);
  if (run.scope) parts.push(run.scope);
  if (run.forced) parts.push('--force');
  if (run.dry_run) parts.push('--dry-run');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// ★★★ 3 · THE AGE WINDOW — default away from the backlog, never hide it
// ---------------------------------------------------------------------------
//
// MEASURED ON THE LIVE VIEW, 2026-08-21, 152 rows across 70 projects:
//
//   no date at all   ★★★ 13
//   within 30 days       13
//   31–90 days           14
//   91–365 days          78
//   over a year          34   (oldest 1,424 days — nearly four years)
//
// ★★★ A page that opens showing all 152, four-year-old rounds included, is
// noise, and a list Gena stops opening is worth nothing.

/** The windows offered. `null` is "all time" and is one click away. */
export const AGE_WINDOWS: ReadonlyArray<{ days: number | null; label: string }> = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'A year' },
  { days: null, label: 'All time' },
];

/**
 * ★★ NINETY DAYS, not thirty.
 *
 * Thirty is this fortnight's work — 13 rows — but a round issued forty-five days
 * ago is still live chasing, and opening on a list that cannot see it would
 * trade one kind of blindness for another. Ninety is where the distribution
 * genuinely breaks: 27 dated rows inside it, 112 beyond. Everything past it has
 * already missed several review cycles and is a records question rather than
 * this fortnight's work.
 */
export const DEFAULT_AGE_WINDOW_DAYS = 90;

/** The shape the window needs. Structural, so the filter can be tested without
 *  building a whole worklist row. */
export interface AgedRow {
  days_since_corr_issued: number | null;
}

/**
 * ★★★ AN UNDATED ROW IS ALWAYS SHOWN, IN EVERY WINDOW.
 *
 * ★★★ THE TRAP, AND IT IS NOT IN THE BRIEF. Thirteen of the 152 rows carry NO
 * `days_since_corr_issued` AT ALL. A window written as `days <= 90` drops every
 * one of them silently — and an undated row is not old, it is UNKNOWN, and
 * arguably the more suspicious kind: the tool recorded a correction round with
 * no issue date against it.
 *
 * ★★ Hiding thirteen rows behind a filter that looks like an age control is the
 * fix-370 mistake exactly — a filtered list that looks complete. So they stay,
 * and the count line names them.
 */
export function withinWindow(row: AgedRow, windowDays: number | null): boolean {
  if (windowDays == null) return true;
  if (row.days_since_corr_issued == null) return true;
  return row.days_since_corr_issued <= windowDays;
}

export interface WindowCounts {
  /** Rows the window shows. */
  shown: number;
  /** ★★ Rows there are ALL TIME. Stated whatever the window — fix-370's rule. */
  total: number;
  /** Of `shown`, how many have no date and are therefore in every window. */
  undated: number;
  /** `total - shown`: the backlog, named rather than hidden. */
  hidden: number;
}

export function windowCounts(
  rows: ReadonlyArray<AgedRow>,
  windowDays: number | null,
): WindowCounts {
  const shownRows = rows.filter((r) => withinWindow(r, windowDays));
  return {
    shown: shownRows.length,
    total: rows.length,
    undated: shownRows.filter((r) => r.days_since_corr_issued == null).length,
    hidden: rows.length - shownRows.length,
  };
}

/**
 * ★★★ THE COUNT LINE, AND IT STATES THE TOTAL WHATEVER IS FILTERED.
 *
 * "14 recent · 152 all time". A filtered list that looks complete is the
 * fix-370 mistake repeated, and this is the sentence that prevents it.
 */
export function windowSummary(c: WindowCounts, windowDays: number | null): string {
  const scope = windowDays == null ? 'all time' : `the last ${windowDays} days`;
  const parts = [`${c.shown} in ${scope}`, `${c.total} all time`];
  if (c.hidden > 0) parts.push(`${c.hidden} older not shown`);
  if (c.undated > 0) {
    // ★★ Named, not merely counted: a reader has to know WHY a row with no date
    // is in a list filtered by age.
    parts.push(`${c.undated} with no issue date, always shown`);
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// ★★ 4 · THE PROJECTS THAT MATCH NO FOLDER
// ---------------------------------------------------------------------------
//
// Every run prints five tool projects that match no share folder at all —
// 10430 66th Ave S · 1301 6th Ave N · 1515 Martin Luther King Jr Way ·
// 1524 Martin Luther King Jr Way · 6825 Seward Park Ave S, all Seattle.
//
// ★★★ They index NOTHING. No design guidance, no marketing, no corrections.
// They are absent from every report and nobody is told.
//
// ★★ A DIFFERENT PROBLEM FROM A MISSING LETTER, and the two lists stay apart:
// an unreachable or differently-named folder is a FILING question, where a
// missing letter is a FETCHING one. Merging them would put a question for
// whoever names folders into a list for whoever chases letters.

/**
 * ★★★ STRUCTURAL, NOT A MAGIC STRING, AND THAT IS DELIBERATE.
 *
 * `indexer_project_reconciliation.status` has no CHECK constraint, no column
 * comment, and — because all three tables are empty today — no observable
 * values. Hard-coding `status === 'unmatched'` against a vocabulary that cannot
 * be checked is how a list silently stays empty for ever.
 *
 * ★★ So the test is what the row SAYS rather than what it is called: a project
 * that matched no folder found nothing, so it has no items and reached no
 * cycle. Those are columns, not a guess. `status` is still rendered — it is the
 * indexer's own word for the row and worth showing — it simply does not decide.
 */
export function isUnmatched(r: IndexerReconciliation): boolean {
  return (r.items_found ?? 0) === 0 && r.found_max_cycle == null;
}

/**
 * ★★ AND THE RUN'S OWN COUNT IS COMPARED AGAINST THE ROWS, OUT LOUD.
 *
 * `indexer_run.unmatched_projects` is what the run reported; the rows are what
 * it wrote. If those two disagree, the screen says so rather than quietly
 * showing whichever it happened to render — the fix-370 lesson applied to a
 * second pair of numbers.
 */
export function unmatchedReconciliation(
  rows: ReadonlyArray<IndexerReconciliation>,
  run: IndexerRun | null,
): { rows: IndexerReconciliation[]; reported: number | null; disagrees: boolean } {
  const matched = rows.filter(isUnmatched);
  const reported = run?.unmatched_projects ?? null;
  return {
    rows: matched.sort((a, b) => (a.address ?? '').localeCompare(b.address ?? '')),
    reported,
    disagrees: reported != null && reported !== matched.length,
  };
}
