import { useMemo } from 'react';
import {
  computeLearnedSchedule,
  listTypeJurisCombos,
  type LearnedEstimate,
} from '../../lib/scheduleBenchmarks';
import type { PermitWithCycles, Project } from '../../lib/database.types';

// Q7.2.c: per (type, juris) schedule benchmarks. Renders one card per
// combo from listTypeJurisCombos. Each card shows the 3-tier learned
// estimate (recent → all-time → fallback) from computeLearnedSchedule,
// laid out as a cycle-by-cycle CR/CO breakdown plus headline averages.
//
// Cards are sorted descending by sample count via listTypeJurisCombos.
// Combos with no approved permits show "Insufficient data" — we still
// list them so Bobby knows which combos exist but lack a learned
// baseline (useful planning signal).

interface Props {
  permits: PermitWithCycles[];
  projects: Project[];
}

export default function ScheduleBenchmarks({ permits, projects }: Props) {
  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  const combos = useMemo(
    () => listTypeJurisCombos(permits, projectsById),
    [permits, projectsById],
  );

  const today = useMemo(() => new Date(), []);

  const cards = useMemo(
    () =>
      combos.map((combo) => ({
        ...combo,
        estimate: computeLearnedSchedule(
          permits,
          combo.type,
          combo.juris,
          projectsById,
          today,
        ),
      })),
    [combos, permits, projectsById, today],
  );

  return (
    <div
      className="bg-surface border border-border rounded-lg p-4"
      data-testid="schedule-benchmarks"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
          Schedule Benchmarks
        </div>
        <div className="text-[10px] text-dim">
          Learned from approved permits · recent → all-time fallback
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="text-xs text-dim text-center py-6 italic">
          No (type · juris) combos in the current dataset.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {cards.map((c) => (
            <BenchmarkCard
              key={`${c.type}||${c.juris}`}
              type={c.type}
              juris={c.juris}
              count={c.count}
              estimate={c.estimate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BenchmarkCard({
  type,
  juris,
  count,
  estimate,
}: {
  type: string;
  juris: string;
  count: number;
  estimate: LearnedEstimate | null;
}) {
  return (
    <div
      className="border border-border rounded-lg p-3 flex flex-col gap-2"
      data-testid={`benchmark-card-${type}-${juris}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-display font-bold text-text text-sm truncate">
          {type}
        </div>
        <div className="text-[10px] text-muted truncate">{juris}</div>
      </div>

      {estimate === null ? (
        <div className="text-[11px] text-dim italic py-2">
          Insufficient data ({count} permit{count === 1 ? '' : 's'} in set, none
          approved yet)
        </div>
      ) : (
        <>
          <div className="text-[10px] text-dim">
            {estimate.source} · {estimate.sampleCount} sample
            {estimate.sampleCount === 1 ? '' : 's'}
            {estimate.isAllTime && (
              <span className="ml-1 text-[#dc2626]">(fallback)</span>
            )}
          </div>
          {estimate.dateRange && (
            <div className="text-[10px] text-muted truncate">
              {estimate.dateRange}
            </div>
          )}

          <table className="w-full text-[11px] mt-1">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-dim">
                <th className="text-left font-normal py-0.5">Cycle</th>
                <th className="text-right font-normal py-0.5">City Review</th>
                <th className="text-right font-normal py-0.5">Corr. Resp.</th>
              </tr>
            </thead>
            <tbody>
              <CycleRow
                n={1}
                cr={estimate.cityReview1}
                crCount={estimate.cr1Count}
                co={estimate.corrResponse1}
                coCount={estimate.co1Count}
              />
              <CycleRow
                n={2}
                cr={estimate.cityReview2}
                crCount={estimate.cr2Count}
                co={estimate.corrResponse2}
                coCount={estimate.co2Count}
              />
              <CycleRow
                n={3}
                cr={estimate.cityReview3}
                crCount={estimate.cr3Count}
                co={estimate.corrResponse3}
                coCount={estimate.co3Count}
              />
              <CycleRow
                n={4}
                cr={estimate.cityReview4}
                crCount={estimate.cr4Count}
                co={estimate.corrResponse4}
                coCount={estimate.co4Count}
              />
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-2 text-[10px] mt-1 pt-2 border-t border-border/50">
            <div>
              <div className="text-dim">GO → Submit</div>
              <div className="font-bold text-text">
                {estimate.goToSubmit !== null ? `${estimate.goToSubmit}d` : '—'}
              </div>
            </div>
            <div>
              <div className="text-dim">Submit → Issue</div>
              <div className="font-bold text-text">
                {estimate.avgSubmitToIssue !== null
                  ? `${estimate.avgSubmitToIssue}d`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-dim">Avg cycles</div>
              <div className="font-bold text-text">
                {estimate.avgCycles ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-dim">Most likely</div>
              <div className="font-bold text-text">
                Cycle {estimate.mostLikelyCycle}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CycleRow({
  n,
  cr,
  crCount,
  co,
  coCount,
}: {
  n: number;
  cr: number;
  crCount: number;
  co: number;
  coCount: number;
}) {
  // Dim a cell when we had no samples for it (the value is a default
  // fallback, not a learned estimate). v1 shows this with reduced opacity.
  const crDim = crCount === 0;
  const coDim = coCount === 0;
  return (
    <tr>
      <td className="py-0.5 text-muted">C{n}</td>
      <td
        className={`py-0.5 text-right ${crDim ? 'text-dim italic' : 'text-text'}`}
      >
        {cr}d
        {crCount > 0 && (
          <span className="text-dim text-[9px] ml-1">(n={crCount})</span>
        )}
      </td>
      <td
        className={`py-0.5 text-right ${coDim ? 'text-dim italic' : 'text-text'}`}
      >
        {co}d
        {coCount > 0 && (
          <span className="text-dim text-[9px] ml-1">(n={coCount})</span>
        )}
      </td>
    </tr>
  );
}
