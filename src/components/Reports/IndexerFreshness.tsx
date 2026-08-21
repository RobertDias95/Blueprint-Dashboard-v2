import {
  useIndexerLastAttempt,
  useIndexerReconciliation,
  useIndexerRunCurrent,
} from '../../hooks/useIndexerRun';
import {
  RUN_STALE_DAYS,
  ageDaysOf,
  numbersProvenance,
  runFreshness,
  runHeadline,
  runMode,
  runState,
  unmatchedReconciliation,
} from '../../lib/indexerRun';

// ===========================================================================
// ★★★ fix-376 — the run behind the list, and the projects that index nothing
// ===========================================================================
//
// fix-374's worklist is live and correct. What it could not say is HOW OLD the
// index behind it is — and the indexer needs the `\\bpc-file` UNC share, so it
// cannot run in GitHub Actions. It runs when Bobby types the command. There is
// no schedule and this ticket does not build one.
//
// ★★★ So the run stamp is what makes an unscheduled tool safe to trust, in
// fix-373's own words. This renders it. It is a date and a state on a page
// somebody already has open — not an alarm, not a channel.

export default function IndexerFreshness() {
  const currentQ = useIndexerRunCurrent();
  const attemptQ = useIndexerLastAttempt();
  const reconQ = useIndexerReconciliation();

  const current = currentQ.data ?? null;
  const attempt = attemptQ.data ?? null;
  const state = runState(current, attempt);
  const freshness = runFreshness(
    state === 'ok' ? ageDaysOf(current) : ageDaysOf(attempt),
  );
  const unmatched = unmatchedReconciliation(reconQ.data ?? [], current);

  // ★ While the three reads are in flight, say nothing rather than flashing
  // "has not run" at somebody — that sentence is a claim, and a claim made from
  // an empty cache is a wrong one.
  if (currentQ.isLoading || attemptQ.isLoading) {
    return (
      <div className="text-[11px] text-dim" data-testid="indexer-freshness-loading">
        Checking when the index last ran…
      </div>
    );
  }

  const tone =
    state === 'failed' || state === 'killed'
      ? 'er'
      : freshness === 'stale' || state === 'never'
        ? 'co'
        : 'de';

  return (
    <div className="space-y-2" data-testid="indexer-freshness">
      <div
        className="text-[11px] rounded-md px-3 py-2 border"
        style={{
          background: `var(--color-${tone}-bg)`,
          borderColor: `var(--color-${tone}-border)`,
        }}
        data-testid={`indexer-state-${state}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-text" data-testid="indexer-headline">
            {runHeadline(state, current, attempt)}
          </strong>
          {/* ★★ STALE IS VISIBLY STALE. Seven days, because the list exists so
              somebody can chase a correction round the week it lands — a run
              older than a week can be missing a whole week of new rounds. */}
          {freshness === 'stale' && state !== 'never' && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide"
              style={{
                background: 'var(--color-co-bg)',
                color: 'var(--color-co)',
                borderColor: 'var(--color-co-border)',
              }}
              title={`Anything older than ${RUN_STALE_DAYS} days can be missing a week of new correction rounds.`}
              data-testid="indexer-stale-badge"
            >
              stale
            </span>
          )}
          {runMode(state === 'ok' ? current : attempt) && (
            <span className="text-dim font-mono text-[10px]" data-testid="indexer-mode">
              {runMode(state === 'ok' ? current : attempt)}
            </span>
          )}
        </div>

        {/* ★★★ WHAT THE NUMBERS ARE ACTUALLY FROM. For a failed or killed
            attempt they are an EARLIER run's, and saying so is the point. */}
        <div className="text-muted mt-0.5" data-testid="indexer-provenance">
          {numbersProvenance(state, current)}
        </div>

        {/* ★★★ `ok = NULL` IS NOT `ok = false`. A killed process reported no
            outcome at all; calling that a failure would claim knowledge nobody
            has. fix-373 left the column three-valued precisely for this. */}
        {state === 'killed' && (
          <div className="text-muted mt-0.5" data-testid="indexer-killed-note">
            It never reported one, so nothing is known about how far it got —
            that is different from a run that failed and said so.
          </div>
        )}
        {state === 'failed' && attempt?.error && (
          <div
            className="text-muted mt-0.5 font-mono text-[10px] break-words"
            data-testid="indexer-error"
          >
            {attempt.error}
          </div>
        )}

        {/* ★★★ THE EMPTY CASE IS TODAY'S CASE, and it must read as neither
            healthy nor broken. fix-373 merged after Bobby's last run, so all
            three snapshot tables hold zero rows. The list below is live and has
            its 152 rows regardless; the snapshot simply has nothing to say. */}
        {state === 'never' && (
          <div className="text-muted mt-0.5" data-testid="indexer-never-note">
            The list below is live and unaffected — it is read from the tool and
            the file index, not from this record. What is missing is the stamp
            saying when the share was last walked, which arrives with the next
            run.
          </div>
        )}

        {state === 'ok' && current && (
          <div className="text-dim mt-1 flex flex-wrap gap-x-3" data-testid="indexer-counts">
            <span>{current.projects_with_corrections ?? '—'} projects with corrections</span>
            <span>{current.letters_level ?? '—'} level</span>
            <span>{current.letters_behind ?? '—'} behind</span>
            <span>{current.no_letters_found ?? '—'} with no letter</span>
            <span>{current.unmatched_projects ?? '—'} unmatched</span>
          </div>
        )}
      </div>

      {/* ★★ A DIFFERENT PROBLEM, SO A DIFFERENT LIST. An unreachable or
          differently-named folder is a FILING question; a missing letter is a
          FETCHING one. Merging them would put a question for whoever names
          folders into a list for whoever chases letters. */}
      {unmatched.rows.length > 0 && (
        <div
          className="text-[11px] rounded-md px-3 py-2 border border-border bg-s2"
          data-testid="indexer-unmatched"
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <strong className="text-text">
              {unmatched.rows.length} project
              {unmatched.rows.length === 1 ? '' : 's'} matched no folder on the share
            </strong>
            {/* ★★ The run's own count against the rows it wrote — fix-370's
                lesson applied to a second pair of numbers. */}
            {unmatched.disagrees && (
              <span className="text-co" data-testid="indexer-unmatched-disagree">
                the run reported {unmatched.reported}
              </span>
            )}
          </div>
          <div className="text-muted mt-0.5">
            These index <strong className="text-text">nothing</strong> — no design
            guidance, no marketing, no corrections — so they are absent from every
            report. The folder is unreachable or named differently: a filing
            question, not a missing letter.
          </div>
          <ul className="mt-1 space-y-0.5">
            {unmatched.rows.map((r) => (
              <li
                key={r.project_id}
                className="text-text flex items-baseline gap-2"
                data-testid={`indexer-unmatched-${r.project_id}`}
              >
                <span className="truncate flex-1">{r.address ?? 'Unknown address'}</span>
                <span className="text-dim flex-none">{r.juris ?? '—'}</span>
                {/* ★ The indexer's own word for the row. Shown because it is
                    the record's vocabulary — it does not decide membership,
                    which is structural. See lib/indexerRun.isUnmatched. */}
                {r.status && (
                  <span className="text-dim font-mono text-[9.5px] flex-none">
                    {r.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
