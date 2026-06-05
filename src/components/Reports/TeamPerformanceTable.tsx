import type { TeamMetricsResult } from '../../lib/teamPerformance';

// fix-127: per-associate metrics table for the Team tab.
//
// 127-a: stub renderer — shows the result count so the page wires up
// end-to-end. 127-c replaces this with the full sortable table +
// vs-team-avg color treatment on the phase metric cells.

interface Props {
  result: TeamMetricsResult;
}

export default function TeamPerformanceTable({ result }: Props) {
  return (
    <div
      className="bg-surface border border-border rounded-lg p-4 text-xs text-muted"
      data-testid="team-performance-table"
    >
      Team performance table — {result.rows.length} associate
      {result.rows.length === 1 ? '' : 's'} (table coming in fix-127-c).
    </div>
  );
}
