import { useTargetSubmitBenchmark } from '../../hooks/useTargetSubmitBenchmark';
import {
  resolveTargetSubmitOffset,
  useTargetSubmitFormulas,
} from '../../hooks/useTargetSubmitFormulas';
import { anchorFor } from '../../lib/targetSubmitLearner';
import { anchorWords, describeBenchmarkGap } from '../../lib/targetSubmitPolicy';

// fix-249: the line under the Target Submit date.
//
// Target Submit is now driven purely by the configured policy offset. This
// note shows what the team's history actually says, so the standard can be
// judged against the evidence instead of quietly replaced by it (which is
// what the learner used to do).
//
//   Target Submit  2026-07-20
//   hist. GO+99d (+96 vs target, n=8)
//
// Amber when the historical median runs longer than the configured target;
// neutral otherwise. Below MIN_BENCHMARK_SAMPLES it says "not enough history"
// rather than printing a median built on one or two permits.

interface Props {
  type: string | null | undefined;
  juris: string | null | undefined;
  /** permits.target_submit_is_projected — the target hangs off an event (BP
   *  cycle-1 resubmit / intake / issue) that has not happened yet. */
  isProjected?: boolean | null;
  /** Manual dates are hand-typed and outrank the engine entirely; the
   *  policy-vs-history comparison doesn't describe them. */
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
  const formulasQ = useTargetSubmitFormulas();

  const anchor = anchorFor(type);
  if (!type) return null;
  // ★ fix-615 (gap 6): these used to render NOTHING, so a reader could not
  //   tell "no history yet" from "this type has no target rule". Mirror types
  //   (G&C / LSM) copy the BP target outright; `none` types (PPR, Vault, WAC,
  //   STFI…) get no automatic target from the server at all. Say which.
  if (anchor === 'mirror_bp' || anchor === 'none') {
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

  // Same resolution the SQL does: per-juris override → Base row → null.
  const policyOffset = resolveTargetSubmitOffset(
    formulasQ.byScope,
    type,
    juris ?? null,
  );

  const benchmark = benchmarkQ.data;
  const gap = benchmark
    ? describeBenchmarkGap(benchmark, policyOffset, anchor)
    : null;

  return (
    <span
      className="text-[9px] leading-tight flex flex-wrap items-center gap-x-1"
      data-testid={testid}
      data-tone={gap?.tone ?? 'neutral'}
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
      {gap && !benchmarkQ.isLoading && (
        <span
          style={{
            color:
              gap.tone === 'over' ? 'var(--color-co)' : 'var(--color-dim)',
          }}
          title={
            benchmark && benchmark.n != null
              ? `Median of ${benchmark.n} past ${type} permits (${benchmark.windowLabel.replace('_', ' ')}); range ${benchmark.minDays}–${benchmark.maxDays}d. Display only — it does not set the date.`
              : 'Not enough history to compute a reliable median.'
          }
          data-testid={`${testid}-gap`}
        >
          {gap.text}
        </span>
      )}
    </span>
  );
}
