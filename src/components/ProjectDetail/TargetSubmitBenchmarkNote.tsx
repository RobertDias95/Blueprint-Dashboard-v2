import { useTargetSubmitBenchmark } from '../../hooks/useTargetSubmitBenchmark';
import { useTargetSubmitAnchors } from '../../hooks/useTargetSubmitAnchors';
import { isLearnableAnchor } from '../../lib/targetSubmitLearner';
import { anchorWords, describeBenchmark } from '../../lib/targetSubmitPolicy';

// fix-249 → ★ fix-680: the line under the Target Submit date — WHERE THE
// NUMBER CAME FROM.
//
//   Target Submit  2026-07-20
//   learned: GO+12d (median of last 5)
//
// fix-680 made the learner drive the date again (the median of the 5 most
// recent submittals for this type in this city), with the Settings number as
// the starting point until there is history. So this note no longer compares
// "policy vs history" — it says which of the two the date is built on:
//   learned: …          — our own recent submittals
//   starting number: …  — no history in this city yet (Settings)
//   no history and no starting number — no automatic target

interface Props {
  type: string | null | undefined;
  juris: string | null | undefined;
  /** permits.target_submit_is_projected — the target hangs off an event (BP
   *  cycle-1 resubmit / intake / issue) that has not happened yet. */
  isProjected?: boolean | null;
  /** Manual dates are hand-typed and outrank the engine entirely; the
   *  readout doesn't describe them. */
  isManual?: boolean | null;
  testid?: string;
}

export default function TargetSubmitBenchmarkNote({
  type,
  juris,
  isProjected,
  isManual,
  testid = 'target-submit-benchmark',
}: Props) {
  const benchmarkQ = useTargetSubmitBenchmark(type, juris);
  const { anchorOf } = useTargetSubmitAnchors();

  const anchor = anchorOf(type);
  if (!type) return null;
  // ★ fix-615 (gap 6): mirror types copy the BP target outright; `none` types
  //   get no automatic target from the server at all. Say which.
  if (!isLearnableAnchor(anchor)) {
    return (
      <span
        className="text-[9px] leading-tight italic"
        style={{ color: 'var(--color-dim)' }}
        data-testid={testid}
        data-anchor={anchor}
      >
        {anchorWords(anchor)}
      </span>
    );
  }

  const benchmark = benchmarkQ.data;
  const readout = benchmark ? describeBenchmark(benchmark, anchor) : null;

  return (
    <span
      className="text-[9px] leading-tight flex flex-wrap items-center gap-x-1"
      data-testid={testid}
      data-tier={readout?.tier ?? 'none'}
      data-projected={isProjected ? 'true' : 'false'}
    >
      {isProjected && !isManual && (
        <span
          className="italic font-semibold"
          style={{ color: 'var(--color-co)' }}
          title="Derived from a BP milestone that hasn't happened yet — this is a projection, not a firm date."
          data-testid={`${testid}-projected`}
        >
          projected
        </span>
      )}
      {benchmarkQ.isLoading && (
        <span className="italic" style={{ color: 'var(--color-dim)' }}>
          …
        </span>
      )}
      {readout && !benchmarkQ.isLoading && (
        <span
          style={{ color: 'var(--color-dim)' }}
          title={
            readout.tier === 'learned' && benchmark
              ? `Median of our ${benchmark.n} most recent ${type} submittals in ${juris} (range ${benchmark.minDays}–${benchmark.maxDays}d, ${benchmark.totalSamples} on record).`
              : readout.tier === 'starting'
                ? `No ${type} submittals in ${juris} yet, so the starting number from Settings is used. It switches to our own history after the first submittal.`
                : `No ${type} history in ${juris} and no starting number in Settings, so there is no automatic target.`
          }
          data-testid={`${testid}-gap`}
        >
          {readout.text}
        </span>
      )}
    </span>
  );
}
