import { useMemo } from 'react';
import { useWeeklySnapshot } from '../../hooks/useWeeklySnapshot';
import { SNAPSHOT_SECTIONS, type SnapshotBucket, type SnapshotRow } from '../../lib/weeklySnapshot';
import SnapshotSection from './SnapshotSection';
import SssCard from './SssCard';

// ===========================================================================
// ★★★ fix-463 §A1 (P-108) — THE WEEKLY UPDATE
// ===========================================================================
//
// The mock-up's order, which is the spec: the agenda block (rendered by the
// Agenda page around this), then the five snapshot sections, then the SSS card.
//
// ★★ §B4: this is the SAME CONTENT the modal shows, and the Agenda screen keeps
// it permanently. Acknowledging dismisses a REMINDER; it never dismisses the
// report. So the modal renders this component too rather than a summary of it —
// two renderings of one report is how they start disagreeing.

export default function WeeklyUpdate() {
  const snapQ = useWeeklySnapshot();

  const byBucket = useMemo(() => {
    const m = new Map<SnapshotBucket, SnapshotRow[]>();
    for (const s of SNAPSHOT_SECTIONS) m.set(s.key, []);
    for (const r of snapQ.data?.rows ?? []) m.get(r.bucket)?.push(r);
    return m;
  }, [snapQ.data]);

  if (snapQ.isLoading) {
    return (
      <div className="text-xs text-muted" data-testid="weekly-update-loading">
        Loading this week's snapshot…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="weekly-update">
      <h2 className="text-[12px] font-display font-bold text-text">
        This week&apos;s snapshot
      </h2>
      {SNAPSHOT_SECTIONS.map((spec) => (
        <SnapshotSection key={spec.key} spec={spec} rows={byBucket.get(spec.key) ?? []} />
      ))}

      <h2 className="text-[12px] font-display font-bold text-text pt-1">
        Consultant report — outgoing
      </h2>
      <SssCard />

      {/* ★ The mock-up's footer, kept: it says what the numbers are and are not. */}
      <p className="text-[10px] text-muted">
        Each row opens its permit. Counts are live at the moment the summary is
        generated.
      </p>
    </div>
  );
}
