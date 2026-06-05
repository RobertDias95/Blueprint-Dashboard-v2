import { useMemo, useState } from 'react';
import { formatCompareNumber } from '../../lib/comparisonCohort';
import type {
  TeamMemberMetrics,
  TeamMetricsResult,
} from '../../lib/teamPerformance';

// fix-127-c: per-associate metrics table for the Team tab.
//
// One row per associate, sortable columns, vs-team-avg color treatment
// on the phase metric cells (DD / City Review / Corrections / Issuance).
// "Lower is better" for all four phase metrics — green when faster than
// team avg, red when slower, muted when within ±5%.
//
// No drill-down click — V1 ships read-only (defer to fix-128 per brief).
// Sticky header on scroll so the column labels stay visible.

type SortKey =
  | 'name'
  | 'projectCount'
  | 'unitCount'
  | 'lotCount'
  | 'redesignProjectCount'
  | 'redesignUnitCount'
  | 'redesignLotCount'
  | 'permitCount'
  | 'avgDdDays'
  | 'avgCityReviewDays'
  | 'avgCorrectionsCycles'
  | 'avgIssuanceDays';

interface Props {
  result: TeamMetricsResult;
}

export default function TeamPerformanceTable({ result }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('projectCount');
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const rows = [...result.rows];
    const dir = sortDesc ? -1 : 1;
    rows.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls sort to the end regardless of direction so empty cells
      // don't dominate the top of an asc sort.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
    return rows;
  }, [result.rows, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      // Volume + phase metrics default to desc (highest first); name to asc.
      setSortDesc(key !== 'name');
    }
  }

  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-auto"
      data-testid="team-performance-table"
    >
      <table className="w-full text-[11px]">
        <thead className="bg-s2 sticky top-0 z-10">
          <tr className="border-b-2 border-border">
            <Th col="name" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort} align="left">
              Name
            </Th>
            <Th col="projectCount" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Projects
            </Th>
            <Th col="unitCount" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Units
            </Th>
            <Th col="lotCount" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Lots
            </Th>
            <Th col="redesignProjectCount" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Redesign Projects
            </Th>
            <Th col="redesignUnitCount" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Redesign Units
            </Th>
            <Th col="redesignLotCount" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Redesign Lots
            </Th>
            <Th col="permitCount" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Permits
            </Th>
            <Th col="avgDdDays" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              DD Phase
            </Th>
            <Th col="avgCityReviewDays" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              City Review
            </Th>
            <Th col="avgCorrectionsCycles" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Corrections
            </Th>
            <Th col="avgIssuanceDays" sortKey={sortKey} sortDesc={sortDesc} onClick={toggleSort}>
              Issuance
            </Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <Row
              key={row.name}
              row={row}
              teamAvgDdDays={result.teamAvgDdDays}
              teamAvgCityReviewDays={result.teamAvgCityReviewDays}
              teamAvgCorrectionsCycles={result.teamAvgCorrectionsCycles}
              teamAvgIssuanceDays={result.teamAvgIssuanceDays}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  col,
  sortKey,
  sortDesc,
  onClick,
  align = 'center',
  children,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDesc: boolean;
  onClick: (col: SortKey) => void;
  align?: 'left' | 'center';
  children: React.ReactNode;
}) {
  const isActive = sortKey === col;
  const arrow = isActive ? (sortDesc ? '↓' : '↑') : '↕';
  return (
    <th
      onClick={() => onClick(col)}
      className={`px-2 py-1.5 text-[9px] uppercase tracking-wide font-display font-bold cursor-pointer select-none whitespace-nowrap text-${align} ${
        isActive ? 'text-text' : 'text-text/80'
      }`}
      data-testid={`team-th-${col}`}
      aria-sort={isActive ? (sortDesc ? 'descending' : 'ascending') : 'none'}
    >
      {children} {arrow}
    </th>
  );
}

function Row({
  row,
  teamAvgDdDays,
  teamAvgCityReviewDays,
  teamAvgCorrectionsCycles,
  teamAvgIssuanceDays,
}: {
  row: TeamMemberMetrics;
  teamAvgDdDays: number | null;
  teamAvgCityReviewDays: number | null;
  teamAvgCorrectionsCycles: number | null;
  teamAvgIssuanceDays: number | null;
}) {
  return (
    <tr
      className="border-b border-border hover:bg-s2 transition"
      data-testid={`team-row-${row.name}`}
      data-active={row.isActive ? 'true' : 'false'}
    >
      <td className="px-2 py-1.5 font-display font-bold text-text">
        {row.name}
        {!row.isActive && (
          <span
            className="ml-1.5 text-[9px] uppercase tracking-wide text-dim italic"
            data-testid={`team-row-${row.name}-inactive`}
          >
            inactive
          </span>
        )}
      </td>
      <NumCell value={row.projectCount} testId={`team-cell-${row.name}-projectCount`} />
      <NumCell value={row.unitCount} testId={`team-cell-${row.name}-unitCount`} />
      <NumCell value={row.lotCount} testId={`team-cell-${row.name}-lotCount`} />
      <NumCell
        value={row.redesignProjectCount}
        testId={`team-cell-${row.name}-redesignProjectCount`}
      />
      <NumCell
        value={row.redesignUnitCount}
        testId={`team-cell-${row.name}-redesignUnitCount`}
      />
      <NumCell
        value={row.redesignLotCount}
        testId={`team-cell-${row.name}-redesignLotCount`}
      />
      <NumCell value={row.permitCount} testId={`team-cell-${row.name}-permitCount`} />
      <PhaseCell
        value={row.avgDdDays}
        teamAvg={teamAvgDdDays}
        unit="d"
        testId={`team-cell-${row.name}-avgDdDays`}
      />
      <PhaseCell
        value={row.avgCityReviewDays}
        teamAvg={teamAvgCityReviewDays}
        unit="d"
        testId={`team-cell-${row.name}-avgCityReviewDays`}
      />
      <PhaseCell
        value={row.avgCorrectionsCycles}
        teamAvg={teamAvgCorrectionsCycles}
        unit=""
        testId={`team-cell-${row.name}-avgCorrectionsCycles`}
      />
      <PhaseCell
        value={row.avgIssuanceDays}
        teamAvg={teamAvgIssuanceDays}
        unit="d"
        testId={`team-cell-${row.name}-avgIssuanceDays`}
      />
    </tr>
  );
}

function NumCell({
  value,
  testId,
}: {
  value: number;
  testId: string;
}) {
  return (
    <td
      className="px-2 py-1.5 text-center font-mono text-text"
      data-testid={testId}
    >
      {value || <span className="text-dim">—</span>}
    </td>
  );
}

/** ±5% no-signal zone — within that band the cell renders muted so a
 *  trivial difference doesn't read as red/green-significant. */
const NO_SIGNAL_BAND = 0.05;

function classifyDelta(delta: number, teamAvg: number): 'good' | 'bad' | 'neutral' {
  if (teamAvg === 0) return delta === 0 ? 'neutral' : delta > 0 ? 'bad' : 'good';
  const pct = Math.abs(delta) / Math.abs(teamAvg);
  if (pct < NO_SIGNAL_BAND) return 'neutral';
  // All four phase metrics are "lower is better" — faster than team avg
  // (delta < 0) is good, slower (delta > 0) is bad.
  return delta < 0 ? 'good' : 'bad';
}

function PhaseCell({
  value,
  teamAvg,
  unit,
  testId,
}: {
  value: number | null;
  teamAvg: number | null;
  unit: string;
  testId: string;
}) {
  if (value === null) {
    return (
      <td className="px-2 py-1.5 text-center" data-testid={testId}>
        <span className="text-dim">—</span>
      </td>
    );
  }
  const delta = teamAvg !== null ? formatCompareNumber(value - teamAvg) : null;
  const tone =
    delta === null || teamAvg === null
      ? 'neutral'
      : classifyDelta(delta, teamAvg);
  const color =
    tone === 'good'
      ? 'var(--color-pm)'
      : tone === 'bad'
        ? 'var(--color-co)'
        : 'var(--color-muted)';
  const arrow =
    delta === null ? '' : delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const deltaStr =
    delta === null
      ? ''
      : ` ${arrow} ${delta > 0 ? '+' : ''}${delta}${unit}`;
  return (
    <td
      className="px-2 py-1.5 text-center font-mono"
      data-testid={testId}
      data-tone={tone}
    >
      <span style={{ color }}>
        {value}
        {unit}
        {deltaStr}
      </span>
    </td>
  );
}
