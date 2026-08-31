import { useMemo } from 'react';
import { useWeeklySnapshot } from '../../hooks/useWeeklySnapshot';
import { SNAPSHOT_SECTIONS, type SnapshotBucket, type SnapshotRow } from '../../lib/weeklySnapshot';
import AgendaBlock, { type AgendaSurface } from './AgendaBlock';
import SnapshotSection from './SnapshotSection';
import SssCard from './SssCard';
import { TaskStatusOverlayProvider } from '../../lib/taskStatusOverlay';

// ===========================================================================
// ★★★ fix-463 §A1 (P-108) — THE WEEKLY UPDATE
// ★★★ fix-465 §D (P-115) — …AND IT NOW CONTAINS THE AGENDA
// ===========================================================================
//
// The mock-up's order, which is the spec: the agenda block, then the five
// snapshot sections, then the SSS card.
//
// ★★★ fix-465 — THE AGENDA IS PART OF THIS COMPONENT NOW, NOT AROUND IT. The
// line that used to sit here read *"the agenda block (rendered by the Agenda
// page around this)"*, and that parenthesis was the defect: the modal renders
// this component and nothing else, so the one screen the meeting is looking at
// on a Wednesday morning had no agenda on it. Putting the block INSIDE means
// both surfaces get it from the same place and neither can drift.
//
// ★★ §B4: this is the SAME CONTENT the modal shows, and the Agenda screen keeps
// it permanently. Acknowledging dismisses a REMINDER; it never dismisses the
// report. So the modal renders this component too rather than a summary of it —
// two renderings of one report is how they start disagreeing.

export default function WeeklyUpdate({
  surface = 'page',
}: {
  surface?: AgendaSurface;
}) {
  const snapQ = useWeeklySnapshot();

  const byBucket = useMemo(() => {
    const m = new Map<SnapshotBucket, SnapshotRow[]>();
    for (const s of SNAPSHOT_SECTIONS) m.set(s.key, []);
    for (const r of snapQ.data?.rows ?? []) m.get(r.bucket)?.push(r);
    return m;
  }, [snapQ.data]);

  return (
    // ★★ The optimistic status layer, so ticking an agenda item behaves exactly
    //    as it does on My Tasks (fix-434). It lives HERE rather than on the
    //    Agenda page because the modal renders the same block and would
    //    otherwise get the un-optimistic version: a click that waits for the
    //    round trip, and "the same row" would quietly stop being true on the
    //    one surface everybody uses.
    <TaskStatusOverlayProvider>
      <div className="flex flex-col gap-2" data-testid="weekly-update">
        {/* ★★★ §D5 — THE ORDER IS AGENDA → SNAPSHOT → SSS, ON BOTH SURFACES.
            The meeting opens with what people want to talk about; the numbers
            are what they consult while talking about it. The mock puts the
            agenda first and Bobby approved v4 of it. */}
        <h2 className="text-[13px] font-display font-bold" style={{ color: 'var(--color-text)' }}>
          Agenda
        </h2>
        <AgendaBlock surface={surface} />

        <h2
          className="text-[13px] font-display font-bold pt-1"
          style={{ color: 'var(--color-text)' }}
        >
          This week&apos;s snapshot
        </h2>
        {snapQ.isLoading ? (
          <div
            className="text-xs"
            style={{ color: 'var(--color-muted)' }}
            data-testid="weekly-update-loading"
          >
            Loading this week&apos;s snapshot…
          </div>
        ) : (
          SNAPSHOT_SECTIONS.map((spec) => (
            <SnapshotSection key={spec.key} spec={spec} rows={byBucket.get(spec.key) ?? []} />
          ))
        )}

        <h2
          className="text-[13px] font-display font-bold pt-1"
          style={{ color: 'var(--color-text)' }}
        >
          Consultant report — outgoing
        </h2>
        <SssCard />

        {/* ★ The mock-up's footer, kept: it says what the numbers are and are
            not. ★ fix-465 §B4: it was `text-[10px]` `--color-muted`; the
            colour clears 4.5:1 but 10px does not clear the reason for this
            ticket, so it reads at the mock's 11.5px like every other note. */}
        <p className="text-[11.5px]" style={{ color: 'var(--color-muted)' }}>
          Each row opens its permit. Counts are live at the moment the summary is
          generated.
        </p>
      </div>
    </TaskStatusOverlayProvider>
  );
}
