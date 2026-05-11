import type { ReportMetrics } from '../../lib/reportMetrics';
import MetricCard from './MetricCard';

// Q7.2.b: 11 metric cards composed from a single ReportMetrics object.
// Conditional rendering per Q9: cards that need underlying data hide
// when the metric is null; always-show cards display "—".
//
// Tones map to v1's color treatments:
//   - default for counts and totals
//   - de for time-from-go metrics (D&E phase)
//   - co/overdue for late/overdue signals
//   - pm for done/approved signals

export default function MetricCards({ metrics }: { metrics: ReportMetrics }) {
  const variance = metrics.avgSubmitVariance;
  const varianceTone =
    variance === null
      ? 'default'
      : variance > 0
        ? 'overdue' // late
        : 'pm'; // on-time / early
  const varianceDisplay =
    variance === null
      ? '—'
      : `${variance > 0 ? '+' : ''}${variance}`;

  const scheduleVar = metrics.avgScheduleVariance;
  const scheduleVarTone =
    scheduleVar === null
      ? 'default'
      : scheduleVar > 0
        ? 'co' // behind forecast
        : 'pm'; // ahead of forecast
  const scheduleVarDisplay =
    scheduleVar === null
      ? '—'
      : `${scheduleVar > 0 ? '+' : ''}${scheduleVar}`;

  // Submit→Intake color tiers from v1 line 5524: green <3d, amber 3-6d, red ≥7d
  const s2i = metrics.avgSubmitToIntake;
  const s2iTone: Parameters<typeof MetricCard>[0]['tone'] =
    s2i === null
      ? 'default'
      : s2i >= 7
        ? 'overdue'
        : s2i >= 3
          ? 'co'
          : 'pm';

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
      data-testid="report-metric-cards"
    >
      {/* 1. TOTAL PERMITS — always shown */}
      <MetricCard
        label="Total Permits"
        value={metrics.totalPermits}
        subText={`${metrics.totalUnits} units across projects`}
        testId="metric-total-permits"
      />

      {/* 2. SUBMIT VARIANCE — only when we have data */}
      {variance !== null && (
        <MetricCard
          label="Submit Variance (avg)"
          value={varianceDisplay}
          unit="d"
          subText={`${metrics.onTimeSubmits} on-time · ${metrics.lateSubmits} late`}
          tone={varianceTone}
          testId="metric-submit-variance"
        />
      )}

      {/* 3. AVG GO → SUBMIT — always shown (defaults to 0d empty state) */}
      <MetricCard
        label="Avg GO → Submit"
        value={metrics.avgGoToSubmit ?? '—'}
        unit={metrics.avgGoToSubmit !== null ? 'd' : undefined}
        subText="D&E phase average"
        tone="de"
        testId="metric-go-to-submit"
      />

      {/* 4. AVG GO → DD START — conditional */}
      {metrics.avgGoToDDStart !== null && (
        <MetricCard
          label="Avg GO → DD Start"
          value={metrics.avgGoToDDStart}
          unit="d"
          subText="GO to design start"
          tone="de"
          testId="metric-go-to-dd-start"
        />
      )}

      {/* 5. AVG CITY REVIEW — always shown */}
      <MetricCard
        label="Avg City Review"
        value={metrics.avgCityReview ?? '—'}
        unit={metrics.avgCityReview !== null ? 'd' : undefined}
        subText="intake accepted → corrections/issue"
        tone="pm"
        testId="metric-city-review"
      />

      {/* 6. AVG SUBMIT → INTAKE — conditional, color-coded */}
      {s2i !== null && (
        <MetricCard
          label="Avg Submit → Intake"
          value={s2i}
          unit="d"
          subText="submit → city accepted intake"
          tone={s2iTone}
          testId="metric-submit-to-intake"
        />
      )}

      {/* 7. AVG CORRECTION CYCLES — always shown */}
      <MetricCard
        label="Avg Correction Cycles"
        value={metrics.avgCorrectionCycles ?? '—'}
        subText={`${metrics.permitsWithCorrections} permits with corrections`}
        tone="co"
        testId="metric-avg-correction-cycles"
      />

      {/* 8. IN CORRECTIONS — always shown */}
      <MetricCard
        label="In Corrections"
        value={metrics.inCorrections}
        subText={`${metrics.issuedCount} permits issued`}
        tone="co"
        testId="metric-in-corrections"
      />

      {/* 9. AVG SCHEDULE VAR. — always shown (subtext switches by sign) */}
      <MetricCard
        label="Avg Schedule Var."
        value={scheduleVarDisplay}
        unit={scheduleVar !== null ? 'd' : undefined}
        subText={
          scheduleVar === null
            ? 'no issued permits'
            : scheduleVar <= 0
              ? 'ahead of forecast'
              : 'behind forecast'
        }
        tone={scheduleVarTone}
        testId="metric-schedule-variance"
      />

      {/* 10. AVG DD DURATION — conditional */}
      {metrics.avgDDDuration !== null && (
        <MetricCard
          label="Avg DD Duration"
          value={metrics.avgDDDuration}
          unit="d"
          subText="DD Start → DD End"
          tone="de"
          testId="metric-dd-duration"
        />
      )}

      {/* 11. AVG DD→SUBMIT — conditional */}
      {metrics.avgDDEndToSubmit !== null && (
        <MetricCard
          label="Avg DD → Submit"
          value={metrics.avgDDEndToSubmit}
          unit="d"
          subText="DD End to permit intake"
          tone="co"
          testId="metric-dd-end-to-submit"
        />
      )}
    </div>
  );
}
