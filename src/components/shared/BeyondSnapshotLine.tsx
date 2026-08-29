import OriginLink from '../OriginLink';

// ===========================================================================
// ★★★ fix-444 §B (P-064, ruling 2) — THE BOARD STOPS AT SEVEN DAYS
// ===========================================================================
//
// Bobby, 2026-08-29 (D-2026-08-29-board-is-the-snapshot-my-tasks-is-
// everything): *"My Board = short snapshot of what needs you now … 'Needs you
// now' = past due + due within 7 days. Beyond 7 days lives on My Tasks only."*
//
// ★★★ IT IS A COUNT AND A LINK, NEVER A SILENT DROP. fix-298's suppressed-count
// principle and fix-370's lesson both say the same thing: a list that quietly
// omits rows and a list with nothing in it look identical, and the second one
// is the only honest reading of a blank. So the rows leave the Board and the
// Board says how many left and where they went.
//
// ★★ ONE COMPONENT, TWO PANELS. The forecast drops `next_week` (8–14 days) and
// the project queue drops `later` + `no_date`; both are "real work, just not
// this week", and two spellings of that sentence is how the two halves of one
// screen start disagreeing about what a snapshot is.
//
// ★ THE BOUNDARY MATCHES ON BOTH SIDES, checked rather than assumed:
//   projectQueue.bandFor puts 2..7 days in `this_week` and 8+ in `later`;
//   myBoard.bucketFor puts `daysLate >= -7` in this_week and `>= -14` in
//   next_week. Same seven days, opposite sign — see lib/taskBands.

export interface BeyondSnapshotLineProps {
  /** How many rows left this panel. Renders nothing at zero. */
  count: number;
  /** "due in 8–14 days" / "with no target date or further out". */
  describe: string;
  testid: string;
}

export default function BeyondSnapshotLine({
  count,
  describe,
  testid,
}: BeyondSnapshotLineProps) {
  // ★ Nothing to say when nothing was removed. A permanent "0 more" line is
  //   the decoration this ruling is trying to remove from the Board.
  if (count <= 0) return null;
  return (
    <div
      className="px-3.5 py-2 border-t border-border text-[10px] text-muted flex items-baseline gap-1.5"
      data-testid={testid}
    >
      <span data-testid={`${testid}-count`}>
        <strong className="text-text">{count}</strong> more {describe}
      </span>
      {/* ★★ THE LINK IS THE OTHER HALF OF THE RULING. "Beyond 7 days lives on
          My Tasks only" is only true if getting there is one click — otherwise
          the rows have not moved, they have gone missing. OriginLink so
          Previous brings the reader back to the board they left (fix-408). */}
      <OriginLink
        to="/board?tab=tasks"
        className="text-de font-bold hover:underline"
        data-testid={`${testid}-link`}
      >
        see My Tasks →
      </OriginLink>
    </div>
  );
}
