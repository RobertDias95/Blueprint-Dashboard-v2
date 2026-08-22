import { OverviewSection } from './OverviewCard';
import { useProjectTimeBlocks } from '../../hooks/useProjectTimeBlocks';

// ★★★ fix-384 — the other windows this project took.
//
// THIS IS WHAT THE LINK BUYS. A column nobody can see is a column nobody
// fills, so the link had to become visible somewhere a person would look, and
// the project's own page is where somebody asking "when did we design this?"
// is already standing. It sits directly under DD window because that is the
// same question: DD window is the ONE window draw_schedule can hold (its PK is
// project_id), and these are the ones it cannot.
//
// ★★ WHAT THIS IS NOT. These are non-project blocks — somebody's TIME, filed
// under their name on the draw schedule. They are not a project's design
// window of record, they do not feed the vendor reports or deal volume, and
// nothing here writes anything. The card states that in its own words rather
// than leaving the reader to infer it from a date range.
//
// ★ Renders NOTHING when there are no linked blocks, which is almost every
// project — an empty "Other windows" section on 180-odd projects would be
// furniture. There is no empty state on purpose.

function formatWeek(weekKey: string): string {
  const d = new Date(`${weekKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return weekKey;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatSpan(startWeek: string, endWeek: string): string {
  const year = new Date(`${endWeek}T12:00:00`).getFullYear();
  const span =
    startWeek === endWeek
      ? formatWeek(startWeek)
      : `${formatWeek(startWeek)} – ${formatWeek(endWeek)}`;
  return Number.isNaN(year) ? span : `${span}, ${year}`;
}

export default function LinkedTimeBlocksSection({
  projectId,
}: {
  projectId: string;
}) {
  const blocksQ = useProjectTimeBlocks(projectId);
  const blocks = blocksQ.data ?? [];
  if (blocks.length === 0) return null;

  return (
    <OverviewSection title="Other scheduled time">
      <div className="flex flex-col gap-1" data-testid="pd-linked-time-blocks">
        {blocks.map((b) => (
          <div
            key={b.id}
            className="flex items-baseline gap-1.5 min-w-0 text-[11px]"
            data-testid={`pd-linked-block-${b.id}`}
          >
            <span className="text-text font-semibold flex-shrink-0">
              {formatSpan(b.start_week, b.end_week)}
            </span>
            <span className="text-dim flex-shrink-0">{b.da_name}</span>
            <span className="text-dim truncate min-w-0">
              {b.label && b.label !== b.type ? b.label : b.type}
            </span>
          </div>
        ))}
        {/* ★★ Says plainly what these rows are, so nobody reads a linked
            block as a second DD window that the reports have somehow missed. */}
        <div className="text-[9px] text-dim italic">
          Draw-schedule time linked to this project — not a design window of
          record, and not counted in reports.
        </div>
      </div>
    </OverviewSection>
  );
}
