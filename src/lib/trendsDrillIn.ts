import type {
  PermitWithCycles,
  Project,
  ProjectHold,
} from './database.types';
import type {
  DrillInData,
  DrillInDate,
  MetricDrillInRow,
} from './metricDrillIn';
import { cityCourtTimeDays, responseCourtTimeDays } from './reportMetrics';
import { accountableDays } from './holdOverlap';
import { isNotSubPermit } from './subPermit';
import { TRENDS_KPI_METRICS } from './metricDefinitions';

// fix-201: per-tile drill-in for the Reports → Trends KPI row. Each KPI tile
// opens MetricDrillIn (the SAME modal the Reports Overview cards use, fix-184)
// listing the EXACT rows feeding the tile for the CURRENT window — the GO cohort
// (filteredCurrent). Builds the shared DrillInData shape, so no parallel modal.
//
// CURRENT PERIOD ONLY: these builders take the current-window cohort; the
// comparison period stays as the delta number on the tile.
//
// Reconciliation contract: for an average tile, the drill-in row count == the
// tile's sample count AND mean(row values) == the displayed average (modulo the
// tile's Math.round). For Total Projects/Permits, the row count == the number.
//
// Most per-permit values reuse existing helpers: cityCourtTimeDays /
// responseCourtTimeDays (reportMetrics). The intake→approval timeline, the
// submit→intake delay, the cycle count, and the hit-rate offset are computed
// inline here (no exported single-permit helper existed; they're tiny).

const DAY_MS = 86400000;

type Holds = Map<string, ProjectHold[]> | undefined;

function daysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (!a || !b) return null;
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((bMs - aMs) / DAY_MS);
}

function cycle0(p: PermitWithCycles) {
  return (p.permit_cycles ?? []).find((c) => c.cycle_index === 0);
}

/** Count of cycles with at least one populated date — the per-permit value the
 *  Avg Cycles per Permit tile averages (perfTrends.avgCyclesPerPermit). */
function populatedCycleCount(p: PermitWithCycles): number {
  return (p.permit_cycles ?? []).filter(
    (c) =>
      c.submitted ||
      c.intake_accepted ||
      c.city_target ||
      c.corr_issued ||
      c.resubmitted,
  ).length;
}

function approvalOf(p: PermitWithCycles): string | null {
  return p.approval_date ?? p.actual_issue ?? null;
}

/** The identity columns every drill-in row carries (address/juris/lead from the
 *  project + permit). */
function ident(
  p: PermitWithCycles,
  projectsById: Map<string, Project>,
): Pick<MetricDrillInRow, 'permitId' | 'projectId' | 'num' | 'address' | 'juris' | 'type' | 'lead'> {
  const proj = projectsById.get(p.project_id);
  return {
    permitId: p.id,
    projectId: p.project_id,
    num: p.num ?? null,
    address: proj?.address ?? '',
    juris: proj?.juris ?? '',
    type: p.type ?? '',
    lead: p.ent_lead ?? p.da ?? null,
  };
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1
    ? sortedAsc[mid]
    : Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2);
}

export const TRENDS_DRILLIN_KEYS = [
  'totalProjects',
  'approvedInWindow',
  'avgSubmitToIntakeDelay',
  'avgCityClock',
  'avgCityReview',
  'avgResponseTime',
  'avgCyclesPerPermit',
  'targetSubmitHitRate',
] as const;
export type TrendsDrillInKey = (typeof TRENDS_DRILLIN_KEYS)[number];

interface RowBuild {
  value: number | null;
  dates: DrillInDate[];
  secondary?: string | null;
}

/** A value-metric drill-in: filter to contributors, compute per-row value +
 *  dates, footer stats over the values. */
function buildValueMetric(
  key: TrendsDrillInKey,
  permits: PermitWithCycles[],
  projectsById: Map<string, Project>,
  unit: 'd' | '',
  build: (p: PermitWithCycles) => RowBuild | null,
): DrillInData {
  const rows: MetricDrillInRow[] = [];
  for (const p of permits) {
    const b = build(p);
    if (!b) continue;
    rows.push({ ...ident(p, projectsById), value: b.value, dates: b.dates, secondary: b.secondary ?? null });
  }
  const vals = rows
    .map((r) => r.value)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const stats =
    vals.length > 0
      ? { min: vals[0], max: vals[vals.length - 1], median: median(vals) }
      : null;
  return {
    key,
    label: TRENDS_KPI_METRICS[key]?.label ?? key,
    unit,
    isCount: false,
    rows,
    n: rows.length,
    stats,
  };
}

/** Build the drill-in for one Trends KPI from the current GO cohort. */
export function buildTrendsDrillIn(
  key: TrendsDrillInKey,
  cohort: PermitWithCycles[],
  projectsById: Map<string, Project>,
  holdsByProjectId?: Holds,
): DrillInData {
  // Defensive: the cohort (filteredCurrent) already excludes sub-permits, but
  // re-apply so the drill-in can never drift from the metric.
  const permits = cohort.filter(isNotSubPermit);
  const label = TRENDS_KPI_METRICS[key]?.label ?? key;
  const holdsFor = (p: PermitWithCycles) => holdsByProjectId?.get(p.project_id);

  // ── Count tiles ──────────────────────────────────────────────
  if (key === 'totalProjects') {
    // One row per DISTINCT project: address, GO date, # permits. Representative
    // permit = the Building Permit (else the lowest id) so the row links sanely.
    const byProject = new Map<string, PermitWithCycles[]>();
    for (const p of permits) {
      const arr = byProject.get(p.project_id) ?? [];
      arr.push(p);
      byProject.set(p.project_id, arr);
    }
    const rows: MetricDrillInRow[] = [];
    for (const [projectId, ps] of byProject) {
      const rep =
        ps.find((p) => p.type === 'Building Permit') ??
        [...ps].sort((a, b) => a.id - b.id)[0];
      const proj = projectsById.get(projectId);
      rows.push({
        ...ident(rep, projectsById),
        value: null,
        dates: [{ label: 'GO', date: proj?.go_date ?? null }],
        secondary: `${ps.length} permit${ps.length === 1 ? '' : 's'}`,
      });
    }
    return { key, label, unit: '', isCount: true, rows, n: rows.length, stats: null };
  }

  if (key === 'approvedInWindow') {
    // One row per permit: permit #, type, project/address, GO date.
    const rows: MetricDrillInRow[] = permits.map((p) => {
      const proj = projectsById.get(p.project_id);
      return {
        ...ident(p, projectsById),
        value: null,
        dates: [{ label: 'GO', date: proj?.go_date ?? null }],
        secondary: p.type ?? null,
      };
    });
    return { key, label, unit: '', isCount: true, rows, n: rows.length, stats: null };
  }

  // ── Average tiles ────────────────────────────────────────────
  if (key === 'avgSubmitToIntakeDelay') {
    // Per-permit delay = c0.intake_accepted − c0.submitted (skip negatives).
    return buildValueMetric(key, permits, projectsById, 'd', (p) => {
      const c0 = cycle0(p);
      const d = daysBetween(c0?.submitted ?? null, c0?.intake_accepted ?? null);
      if (d === null || d < 0) return null;
      return {
        value: d,
        dates: [
          { label: 'Submitted', date: c0?.submitted ?? null },
          { label: 'Intake', date: c0?.intake_accepted ?? null },
        ],
      };
    });
  }

  if (key === 'avgCityClock') {
    // Avg Permit Timeline = intake_accepted → approval (hold-aware, skip < 0).
    return buildValueMetric(key, permits, projectsById, 'd', (p) => {
      const c0 = cycle0(p);
      const approval = approvalOf(p);
      const d = accountableDays(holdsFor(p), c0?.intake_accepted ?? null, approval);
      if (d === null || d < 0) return null;
      return {
        value: d,
        dates: [
          { label: 'Intake', date: c0?.intake_accepted ?? null },
          { label: 'Approved/Issued', date: approval },
        ],
      };
    });
  }

  if (key === 'avgCityReview') {
    return buildValueMetric(key, permits, projectsById, 'd', (p) => {
      const d = cityCourtTimeDays(p, holdsFor(p));
      if (d === null) return null;
      const c0 = cycle0(p);
      return {
        value: d,
        dates: [
          { label: 'Intake', date: c0?.intake_accepted ?? null },
          { label: 'Approved/Issued', date: approvalOf(p) },
        ],
      };
    });
  }

  if (key === 'avgResponseTime') {
    return buildValueMetric(key, permits, projectsById, 'd', (p) => {
      const d = responseCourtTimeDays(p, holdsFor(p));
      if (d === null) return null;
      const c0 = cycle0(p);
      return {
        value: d,
        dates: [
          { label: 'Submitted', date: c0?.submitted ?? null },
          { label: 'Approved/Issued', date: approvalOf(p) },
        ],
      };
    });
  }

  if (key === 'avgCyclesPerPermit') {
    // Every permit in the cohort contributes its populated-cycle count.
    return buildValueMetric(key, permits, projectsById, '', (p) => ({
      value: populatedCycleCount(p),
      dates: [],
    }));
  }

  // targetSubmitHitRate: denominator = permits with target_submit + c0.submitted.
  // value = signed days off (positive = late); secondary = hit/miss.
  return buildValueMetric(key, permits, projectsById, 'd', (p) => {
    const c0 = cycle0(p);
    const sub = c0?.submitted ?? null;
    const target = p.target_submit ?? null;
    if (!sub || !target) return null;
    const off = daysBetween(target, sub); // + = submitted after target = miss
    return {
      value: off,
      dates: [
        { label: 'Target', date: target },
        { label: 'Submitted', date: sub },
      ],
      secondary: sub <= target ? '✓ hit' : '✗ miss',
    };
  });
}
