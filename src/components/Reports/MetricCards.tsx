import type { ReportMetrics } from '../../lib/reportMetrics';
import MetricCard from './MetricCard';
import MetricInfoTooltip from '../shared/MetricInfoTooltip';
import { REPORTS_OVERVIEW_METRICS } from '../../lib/metricDefinitions';

// fix-129-c: each MetricCard's label is wrapped in a MetricInfoTooltip
// so the metric definition + formula + cohort gate are one hover away.
// The labelSlot prop on MetricCard owns the in-card label rendering;
// passing a slot replaces the plain label text with the tooltip's
// label + "?" icon group.
function tip(slug: keyof typeof REPORTS_OVERVIEW_METRICS) {
  const def = REPORTS_OVERVIEW_METRICS[slug];
  return (
    <MetricInfoTooltip
      label={def.label}
      description={def.description}
      formula={def.formula}
      cohort={def.cohort}
      slug={`reports-${slug}`}
    />
  );
}

// Q7.2.b: 13 metric cards composed from a single ReportMetrics object.
// Conditional rendering per Q9: cards that need underlying data hide
// when the metric is null; always-show cards display "—".
//
// Tones map to v1's color treatments:
//   - default for counts and totals
//   - de for time-from-go metrics (D&E phase)
//   - co/overdue for late/overdue signals
//   - pm for done/approved signals
//
// fix-115-c → fix-141: optional period-comparison row on every numeric
// card. All 13 tiles now thread the same comparison props (currentNumeric,
// comparisonNumeric, comparisonValueText, comparisonLabel, direction,
// splitProps); when compareTo + range are both set the cards swap to
// KpiSplitView. Direction per metric:
//   - Total Permits          (higher_better)
//   - Submit Variance        (neutral — early/late doesn't map cleanly)
//   - Avg GO → Submit        (lower_better)
//   - Avg GO → DD Start      (lower_better)
//   - Avg City Review        (lower_better — fix-141: city's-court time)
//   - Avg Response Time      (lower_better — fix-141: our-court time, NEW)
//   - Avg Permit Timeline    (lower_better — intake → approval total)
//   - Avg Submit → Intake    (lower_better)
//   - Avg Correction Cycles  (lower_better)
//   - In Corrections         (lower_better)
//   - Avg Schedule Var.      (neutral — early/late ambiguity)
//   - Avg DD Duration        (lower_better)
//   - Avg DD → Submit        (lower_better)

export default function MetricCards({
  metrics,
  comparisonMetrics,
  comparisonLabel,
  currentRangeLabel,
  comparisonRangeLabel,
  comparisonModeLabel,
  onTimelineTileClick,
  drawerOpen,
}: {
  metrics: ReportMetrics;
  comparisonMetrics?: ReportMetrics | null;
  comparisonLabel?: string;
  /** fix-129-b: when present (alongside comparisonRangeLabel), the
   *  per-card render swaps to the KpiSplitView horizontal layout. */
  currentRangeLabel?: string;
  comparisonRangeLabel?: string;
  comparisonModeLabel?: string;
  /** fix-142: toggles the per-cycle breakdown drawer. Wired to all three
   *  timeline tiles (City Review / Response Time / Permit Timeline) — any
   *  of them acts as a unified open/close toggle. */
  onTimelineTileClick?: () => void;
  /** fix-142: drawer open state — drives the chevron glyph + aria-expanded
   *  on the three timeline tiles. */
  drawerOpen?: boolean;
}) {
  const cmp = comparisonMetrics ?? null;
  const cmpLabel = comparisonLabel || undefined;
  // fix-129-b: prop spreader for the split-layout inputs. Drops in on
  // every card that should render the side-by-side split when comparison
  // is active. Reads cleanly inline + keeps the rest of the per-card
  // call site unchanged.
  const splitProps = {
    currentRangeLabel,
    comparisonRangeLabel,
    comparisonModeLabel,
  };
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

  // fix-173: Approval→Issue. Issuance is a heavier step than intake (fees,
  // paperwork), so the tiers are wider: green <7d, amber 7-13d, red ≥14d.
  const a2i = metrics.avgApprovalToIssue;
  const a2iTone: Parameters<typeof MetricCard>[0]['tone'] =
    a2i === null ? 'default' : a2i >= 14 ? 'overdue' : a2i >= 7 ? 'co' : 'pm';

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
      data-testid="report-metric-cards"
    >
      {/* 1. TOTAL PERMITS — always shown */}
      <MetricCard
        label="Total Permits"
        labelSlot={tip('totalPermits')}
        value={metrics.totalPermits}
        subText={`${metrics.totalUnits} units across projects`}
        testId="metric-total-permits"
        currentNumeric={metrics.totalPermits}
        comparisonNumeric={cmp?.totalPermits ?? null}
        comparisonValueText={cmp ? String(cmp.totalPermits) : undefined}
        comparisonLabel={cmpLabel}
        comparisonDirection="higher_better"
        {...splitProps}
      />

      {/* 2. SUBMIT VARIANCE — only when we have data */}
      {variance !== null && (
        <MetricCard
          label="Submit Variance (avg)"
          labelSlot={tip('submitVariance')}
          value={varianceDisplay}
          unit="d"
          subText={`${metrics.onTimeSubmits} on-time · ${metrics.lateSubmits} late`}
          tone={varianceTone}
          testId="metric-submit-variance"
          currentNumeric={variance}
          comparisonNumeric={cmp?.avgSubmitVariance ?? null}
          comparisonValueText={
            cmp?.avgSubmitVariance === null || cmp?.avgSubmitVariance === undefined
              ? undefined
              : `${cmp.avgSubmitVariance > 0 ? '+' : ''}${cmp.avgSubmitVariance}d`
          }
          comparisonLabel={cmpLabel}
          comparisonDirection="neutral"
          {...splitProps}
        />
      )}

      {/* 3. AVG GO → SUBMIT — always shown (defaults to 0d empty state) */}
      <MetricCard
        label="Avg GO → Submit"
        labelSlot={tip('avgGoToSubmit')}
        value={metrics.avgGoToSubmit ?? '—'}
        unit={metrics.avgGoToSubmit !== null ? 'd' : undefined}
        subText="D&E phase average"
        tone="de"
        testId="metric-go-to-submit"
        currentNumeric={metrics.avgGoToSubmit}
        comparisonNumeric={cmp?.avgGoToSubmit ?? null}
        comparisonValueText={
          cmp?.avgGoToSubmit === null || cmp?.avgGoToSubmit === undefined
            ? undefined
            : `${cmp.avgGoToSubmit}d`
        }
        comparisonLabel={cmpLabel}
        comparisonDirection="lower_better"
        {...splitProps}
      />

      {/* 4. AVG GO → DD START — conditional */}
      {metrics.avgGoToDDStart !== null && (
        <MetricCard
          label="Avg GO → DD Start"
          labelSlot={tip('avgGoToDDStart')}
          value={metrics.avgGoToDDStart}
          unit="d"
          subText="GO to design start"
          tone="de"
          testId="metric-go-to-dd-start"
          currentNumeric={metrics.avgGoToDDStart}
          comparisonNumeric={cmp?.avgGoToDDStart ?? null}
          comparisonValueText={
            cmp?.avgGoToDDStart === null || cmp?.avgGoToDDStart === undefined
              ? undefined
              : `${cmp.avgGoToDDStart}d`
          }
          comparisonLabel={cmpLabel}
          comparisonDirection="lower_better"
          {...splitProps}
        />
      )}

      {/* 5. AVG CITY REVIEW — always shown */}
      <MetricCard
        label="Avg City Review"
        labelSlot={tip('avgCityReview')}
        value={metrics.avgCityReview ?? '—'}
        unit={metrics.avgCityReview !== null ? 'd' : undefined}
        subText="time in city's court"
        tone="pm"
        testId="metric-city-review"
        currentNumeric={metrics.avgCityReview}
        comparisonNumeric={cmp?.avgCityReview ?? null}
        comparisonValueText={
          cmp?.avgCityReview === null || cmp?.avgCityReview === undefined
            ? undefined
            : `${cmp.avgCityReview}d`
        }
        comparisonLabel={cmpLabel}
        comparisonDirection="lower_better"
        onClick={onTimelineTileClick}
        expanded={drawerOpen}
        {...splitProps}
      />

      {/* 5a. AVG RESPONSE TIME — fix-141: conceptual sibling of Avg City
          Review. City Review = time the ball was in the city's court;
          Response Time = time it was in ours. The two telescope into the
          full Permit Timeline. Always shown ("—" when no completed
          correction round-trip in the cohort). */}
      <MetricCard
        label="Avg Response Time"
        labelSlot={tip('avgResponseTime')}
        value={metrics.avgResponseTime ?? '—'}
        unit={metrics.avgResponseTime !== null ? 'd' : undefined}
        subText="time in our court"
        tone="co"
        testId="metric-response-time"
        currentNumeric={metrics.avgResponseTime}
        comparisonNumeric={cmp?.avgResponseTime ?? null}
        comparisonValueText={
          cmp?.avgResponseTime === null || cmp?.avgResponseTime === undefined
            ? undefined
            : `${cmp.avgResponseTime}d`
        }
        comparisonLabel={cmpLabel}
        comparisonDirection="lower_better"
        onClick={onTimelineTileClick}
        expanded={drawerOpen}
        {...splitProps}
      />

      {/* 5b. AVG PERMIT TIMELINE — the canonical intake → approval clock.
          fix-141: now reads its own metrics.avgPermitTimeline field
          (renamed permitTimelineDays). Previously it borrowed
          metrics.avgCityReview as a workaround; the field split lets City
          Review (city's court) and Permit Timeline (total) diverge cleanly. */}
      <MetricCard
        label="Avg Permit Timeline"
        labelSlot={tip('avgPermitTimeline')}
        value={metrics.avgPermitTimeline ?? '—'}
        unit={metrics.avgPermitTimeline !== null ? 'd' : undefined}
        subText="intake accepted → approval"
        tone="pm"
        testId="metric-permit-timeline"
        currentNumeric={metrics.avgPermitTimeline}
        comparisonNumeric={cmp?.avgPermitTimeline ?? null}
        comparisonValueText={
          cmp?.avgPermitTimeline === null || cmp?.avgPermitTimeline === undefined
            ? undefined
            : `${cmp.avgPermitTimeline}d`
        }
        comparisonLabel={cmpLabel}
        comparisonDirection="lower_better"
        onClick={onTimelineTileClick}
        expanded={drawerOpen}
        {...splitProps}
      />

      {/* 6. AVG SUBMIT → INTAKE — conditional, color-coded */}
      {s2i !== null && (
        <MetricCard
          label="Avg Submit → Intake"
          labelSlot={tip('avgSubmitToIntake')}
          value={s2i}
          unit="d"
          subText="submit → city accepted intake"
          tone={s2iTone}
          testId="metric-submit-to-intake"
          currentNumeric={s2i}
          comparisonNumeric={cmp?.avgSubmitToIntake ?? null}
          comparisonValueText={
            cmp?.avgSubmitToIntake === null ||
            cmp?.avgSubmitToIntake === undefined
              ? undefined
              : `${cmp.avgSubmitToIntake}d`
          }
          comparisonLabel={cmpLabel}
          comparisonDirection="lower_better"
          {...splitProps}
        />
      )}

      {/* fix-173: AVG APPROVAL → ISSUE — conditional, color-coded. Sibling of
          Submit → Intake; hold-aware (held days subtracted). */}
      {a2i !== null && (
        <MetricCard
          label="Avg Approval → Issue"
          labelSlot={tip('avgApprovalToIssue')}
          value={a2i}
          unit="d"
          subText="approved → permit issued"
          tone={a2iTone}
          testId="metric-approval-to-issue"
          currentNumeric={a2i}
          comparisonNumeric={cmp?.avgApprovalToIssue ?? null}
          comparisonValueText={
            cmp?.avgApprovalToIssue === null ||
            cmp?.avgApprovalToIssue === undefined
              ? undefined
              : `${cmp.avgApprovalToIssue}d`
          }
          comparisonLabel={cmpLabel}
          comparisonDirection="lower_better"
          {...splitProps}
        />
      )}

      {/* 7. AVG CORRECTION CYCLES — always shown */}
      <MetricCard
        label="Avg Correction Cycles"
        labelSlot={tip('avgCorrectionCycles')}
        value={metrics.avgCorrectionCycles ?? '—'}
        subText={`${metrics.permitsWithCorrections} permits with corrections`}
        tone="co"
        testId="metric-avg-correction-cycles"
        currentNumeric={metrics.avgCorrectionCycles}
        comparisonNumeric={cmp?.avgCorrectionCycles ?? null}
        comparisonValueText={
          cmp?.avgCorrectionCycles === null ||
          cmp?.avgCorrectionCycles === undefined
            ? undefined
            : String(cmp.avgCorrectionCycles)
        }
        comparisonLabel={cmpLabel}
        comparisonDirection="lower_better"
        {...splitProps}
      />

      {/* 8. IN CORRECTIONS — always shown.
          fix-113-b: subtext is now "{n} of {total} issued" — universal
          format that names both the count and the cohort denominator. The
          prior "{n} permits issued" was ambiguous once the new Permit Status
          filter narrowed the cohort: with permitStatus='Reviews In Process'
          a subtext of "0 permits issued" could read either as "no issued
          permits anywhere" (false) or "no issued permits in this filtered
          view" (true). Naming the denominator removes the ambiguity. */}
      <MetricCard
        label="In Corrections"
        labelSlot={tip('inCorrections')}
        value={metrics.inCorrections}
        subText={`${metrics.issuedCount} of ${metrics.totalPermits} issued`}
        tone="co"
        testId="metric-in-corrections"
        currentNumeric={metrics.inCorrections}
        comparisonNumeric={cmp?.inCorrections ?? null}
        comparisonValueText={cmp ? String(cmp.inCorrections) : undefined}
        comparisonLabel={cmpLabel}
        comparisonDirection="lower_better"
        {...splitProps}
      />

      {/* 9. AVG SCHEDULE VAR. — always shown (subtext switches by sign) */}
      <MetricCard
        label="Avg Schedule Var."
        labelSlot={tip('avgScheduleVariance')}
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
        currentNumeric={scheduleVar}
        comparisonNumeric={cmp?.avgScheduleVariance ?? null}
        comparisonValueText={
          cmp?.avgScheduleVariance === null ||
          cmp?.avgScheduleVariance === undefined
            ? undefined
            : `${cmp.avgScheduleVariance > 0 ? '+' : ''}${cmp.avgScheduleVariance}d`
        }
        comparisonLabel={cmpLabel}
        // Neutral — for schedule variance, "early" vs "late" doesn't map
        // cleanly to "good" vs "bad" across teams + project types.
        comparisonDirection="neutral"
        {...splitProps}
      />

      {/* 10. AVG DD DURATION — conditional */}
      {metrics.avgDDDuration !== null && (
        <MetricCard
          label="Avg DD Duration"
          labelSlot={tip('avgDDDuration')}
          value={metrics.avgDDDuration}
          unit="d"
          subText="DD Start → DD End"
          tone="de"
          testId="metric-dd-duration"
          currentNumeric={metrics.avgDDDuration}
          comparisonNumeric={cmp?.avgDDDuration ?? null}
          comparisonValueText={
            cmp?.avgDDDuration === null || cmp?.avgDDDuration === undefined
              ? undefined
              : `${cmp.avgDDDuration}d`
          }
          comparisonLabel={cmpLabel}
          comparisonDirection="lower_better"
          {...splitProps}
        />
      )}

      {/* 11. AVG DD→SUBMIT — conditional */}
      {metrics.avgDDEndToSubmit !== null && (
        <MetricCard
          label="Avg DD → Submit"
          labelSlot={tip('avgDDEndToSubmit')}
          value={metrics.avgDDEndToSubmit}
          unit="d"
          subText="DD End to permit intake"
          tone="co"
          testId="metric-dd-end-to-submit"
          currentNumeric={metrics.avgDDEndToSubmit}
          comparisonNumeric={cmp?.avgDDEndToSubmit ?? null}
          comparisonValueText={
            cmp?.avgDDEndToSubmit === null ||
            cmp?.avgDDEndToSubmit === undefined
              ? undefined
              : `${cmp.avgDDEndToSubmit}d`
          }
          comparisonLabel={cmpLabel}
          comparisonDirection="lower_better"
          {...splitProps}
        />
      )}
    </div>
  );
}
