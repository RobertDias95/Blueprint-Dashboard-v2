import type { WeeklyDaReportGroup, WeeklyDaReportRow } from './database.types';
import { excludeCancelled } from './projectViewHelpers';

// fix-264: pure post-filter over the bp_get_weekly_da_report payload. Lives here
// rather than in the page because a page module may only export components
// (react-refresh/only-export-components), and because the shape is worth unit
// testing on its own — same reason buildApprovedAwaitingRows is a lib builder.

/** fix-264: strip CANCELLED projects out of the report payload.
 *
 *  The Weekly DA Update is the sheet a DA works from — corrections to answer,
 *  intakes to submit, issuances to chase. A cancelled project has none of that,
 *  so its rows come out of all three sections and a DA left with nothing drops
 *  rather than printing an empty heading.
 *
 *  Filtered client-side rather than in bp_get_weekly_da_report: the RPC predates
 *  project_holds and every row already carries project_id, so this needs no
 *  migration and stays on the SAME cancelled set as the Dashboard / board.
 *  HELD projects are untouched — that DA still owns the work. An empty set
 *  returns the same reference, so the common case costs nothing. */
export function excludeCancelledFromDaReport(
  groups: WeeklyDaReportGroup[],
  cancelledIds: ReadonlySet<string>,
): WeeklyDaReportGroup[] {
  if (cancelledIds.size === 0) return groups;
  const live = (rows: WeeklyDaReportRow[] | undefined) =>
    excludeCancelled(rows ?? [], cancelledIds);
  return groups
    .map((g) => ({
      ...g,
      corrections: live(g.corrections),
      upcoming_intakes: live(g.upcoming_intakes),
      // fix-221's section is optional in the payload — keep it absent if it was
      // absent, so a client ahead of the RPC migration still renders.
      ...(g.approved_awaiting_issuance === undefined
        ? {}
        : { approved_awaiting_issuance: live(g.approved_awaiting_issuance) }),
    }))
    .filter(
      (g) =>
        g.corrections.length > 0 ||
        g.upcoming_intakes.length > 0 ||
        (g.approved_awaiting_issuance?.length ?? 0) > 0,
    );
}
