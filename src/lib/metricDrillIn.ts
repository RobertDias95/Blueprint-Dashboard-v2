import type { EnrichedPermit } from './reportMetrics';
import { effectiveStage, isPermitInCorrections } from './permitStage';
import { REPORTS_OVERVIEW_METRICS } from './metricDefinitions';

// fix-184a: the per-metric drill-in. Each Overview card maps to a descriptor
// that knows how to pull, FROM THE SAME filtered EnrichedPermit[] the card
// averaged, one row per contributing permit: its own value + the dates behind
// it. buildDrillIn() filters to the metric's cohort and computes the
// min/median/max/n footer. Pure + framework-free so it's unit-testable; the
// modal (MetricDrillIn.tsx) just renders the result.
//
// Phase A wires every Overview card EXCEPT the three timeline tiles (City
// Review / Response Time / Permit Timeline), whose onClick already drives the
// per-cycle drawer (fix-142) — those + their per-cycle breakdown are Phase B.

const DAY_MS = 86400000;

export interface DrillInDate {
  label: string;
  date: string | null;
}

export interface MetricDrillInRow {
  permitId: number;
  projectId: string;
  num: string | null;
  address: string;
  juris: string;
  type: string;
  /** ent_lead, falling back to the DA. */
  lead: string | null;
  /** The per-permit metric value. Null for count-only metrics. */
  value: number | null;
  /** Supporting dates behind the value (rendered as a timeline). */
  dates: DrillInDate[];
  /** Count-only secondary text (stage/status, or the open-correction date). */
  secondary: string | null;
}

interface MetricDescriptor {
  /** Days, correction rounds, or count-only (''). */
  unit: 'd' | 'rounds' | '';
  /** Count-only metric: no per-row value column, no min/median/max footer. */
  isCount?: boolean;
  /** Which permits contribute. Defaults to value(e) !== null. */
  cohort?: (e: EnrichedPermit) => boolean;
  /** The per-permit value; null for count-only metrics. */
  value: (e: EnrichedPermit) => number | null;
  /** Supporting dates timeline. */
  dates: (e: EnrichedPermit) => DrillInDate[];
  /** Count-only per-row secondary text. */
  secondary?: (e: EnrichedPermit) => string | null;
}

/** Submit variance per permit = firstSubmitted − target_submit (days).
 *  Mirrors the inline computation in computeMetrics (reportMetrics.ts:741). */
function submitVarianceDays(e: EnrichedPermit): number | null {
  const fs = e.firstSubmitted;
  const ts = e.permit.target_submit;
  if (!fs || !ts) return null;
  return Math.round(
    (new Date(`${fs}T12:00:00Z`).getTime() -
      new Date(`${ts}T12:00:00Z`).getTime()) /
      DAY_MS,
  );
}

/** For the In Corrections list: the corr_issued date of the open correction
 *  round (a review cycle with corr_issued set but not yet resubmitted). */
function openCorrectionDate(e: EnrichedPermit): string | null {
  const open = (e.permit.permit_cycles ?? [])
    .filter((c) => c.cycle_index >= 1 && c.corr_issued && !c.resubmitted)
    .sort((a, b) => b.cycle_index - a.cycle_index)[0];
  return open?.corr_issued ?? null;
}

// fix-184a Phase A descriptors. Keys match REPORTS_OVERVIEW_METRICS + the card
// slugs in MetricCards.tsx. The three timeline tiles are intentionally absent.
export const METRIC_DRILLINS: Record<string, MetricDescriptor> = {
  // Count-only.
  totalPermits: {
    unit: '',
    isCount: true,
    value: () => null,
    dates: () => [],
    secondary: (e) =>
      e.permit.status ??
      effectiveStage(e.permit, e.permit.permit_cycles ?? [], e.reviewers),
  },
  inCorrections: {
    unit: '',
    isCount: true,
    // fix-214: same unified hybrid test the count uses (reportMetrics) so the
    // drill-in list and the n= reconcile — reviewer-only corrections (no
    // corr_issued) now appear here too, not just corr_issued rows.
    cohort: (e) =>
      isPermitInCorrections(e.permit, e.permit.permit_cycles ?? [], e.reviewers),
    value: () => null,
    dates: () => [],
    secondary: (e) => {
      const d = openCorrectionDate(e);
      return d ? `corr issued ${d}` : 'in corrections';
    },
  },
  // Averages with a clean per-permit value.
  submitVariance: {
    unit: 'd',
    cohort: (e) => submitVarianceDays(e) !== null,
    value: submitVarianceDays,
    dates: (e) => [
      { label: 'Target', date: e.permit.target_submit ?? null },
      { label: 'Submitted', date: e.firstSubmitted },
    ],
  },
  avgGoToSubmit: {
    unit: 'd',
    value: (e) => e.goToSubmit,
    dates: (e) => [
      { label: 'GO', date: e.goDate },
      { label: 'Submitted', date: e.firstSubmitted },
    ],
  },
  avgGoToDDStart: {
    unit: 'd',
    value: (e) => e.goToDDStart,
    dates: (e) => [
      { label: 'GO', date: e.goDate },
      { label: 'DD Start', date: e.permit.dd_start ?? null },
    ],
  },
  avgDDDuration: {
    unit: 'd',
    value: (e) => e.ddDuration,
    dates: (e) => [
      { label: 'DD Start', date: e.permit.dd_start ?? null },
      { label: 'DD End', date: e.permit.dd_end ?? null },
    ],
  },
  avgDDEndToSubmit: {
    unit: 'd',
    value: (e) => e.ddEndToSubmit,
    dates: (e) => [
      { label: 'DD End', date: e.permit.dd_end ?? null },
      { label: 'Submitted', date: e.firstSubmitted },
    ],
  },
  avgSubmitToIntake: {
    unit: 'd',
    value: (e) => e.submitToIntake,
    dates: (e) => [
      { label: 'Submitted', date: e.firstSubmitted },
      { label: 'Intake', date: e.firstIntakeAccepted },
    ],
  },
  avgApprovalToIssue: {
    unit: 'd',
    value: (e) => e.approvalToIssue,
    dates: (e) => [
      { label: 'Approval', date: e.permit.approval_date ?? null },
      { label: 'Issued', date: e.permit.actual_issue ?? null },
    ],
  },
  avgScheduleVariance: {
    unit: 'd',
    value: (e) => e.variance,
    dates: (e) => [
      { label: 'Expected', date: e.permit.expected_issue ?? null },
      {
        label: 'Approved/Issued',
        date: e.permit.approval_date ?? e.permit.actual_issue ?? null,
      },
    ],
  },
  avgCorrectionCycles: {
    unit: 'rounds',
    cohort: (e) => (e.permit.corr_rounds ?? 0) > 0,
    value: (e) => e.permit.corr_rounds ?? null,
    dates: () => [],
  },
};

/** Phase A metric slugs that have a drill-in (drives the card affordance). */
export function hasMetricDrillIn(key: string): boolean {
  return key in METRIC_DRILLINS;
}

export interface DrillInData {
  key: string;
  label: string;
  unit: 'd' | 'rounds' | '';
  isCount: boolean;
  rows: MetricDrillInRow[];
  /** Cohort count that actually fed the metric (can differ from Total Permits). */
  n: number;
  /** min/median/max over the non-null values; null for count-only / empty. */
  stats: { min: number; median: number; max: number } | null;
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1
    ? sortedAsc[mid]
    : Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2);
}

/** Build the drill-in for one metric from the already-filtered enriched
 *  population the card averaged. Filters to the metric's cohort; computes the
 *  footer stats. Returns null for an unknown metric key. */
export function buildDrillIn(
  metricKey: string,
  enriched: EnrichedPermit[],
): DrillInData | null {
  const d = METRIC_DRILLINS[metricKey];
  if (!d) return null;
  // Default cohort: count metrics include everyone; value metrics include only
  // rows with a non-null value (the same gate the average used).
  const inCohort =
    d.cohort ?? (d.isCount ? () => true : (e: EnrichedPermit) => d.value(e) !== null);
  const rows: MetricDrillInRow[] = enriched
    .filter(inCohort)
    .map((e) => ({
      permitId: e.permit.id,
      projectId: e.permit.project_id,
      num: e.permit.num ?? null,
      address: e.address,
      juris: e.juris,
      type: e.permit.type ?? '',
      lead: e.permit.ent_lead ?? e.permit.da ?? null,
      value: d.value(e),
      dates: d.dates(e),
      secondary: d.secondary?.(e) ?? null,
    }));
  const label = REPORTS_OVERVIEW_METRICS[metricKey]?.label ?? metricKey;
  if (d.isCount) {
    return { key: metricKey, label, unit: d.unit, isCount: true, rows, n: rows.length, stats: null };
  }
  const vals = rows
    .map((r) => r.value)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const stats =
    vals.length > 0
      ? { min: vals[0], max: vals[vals.length - 1], median: median(vals) }
      : null;
  return { key: metricKey, label, unit: d.unit, isCount: false, rows, n: rows.length, stats };
}
