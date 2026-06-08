import { describe, it, expect } from 'vitest';
import {
  ALL_METRIC_DEFINITIONS,
  REPORTS_OVERVIEW_METRICS,
  REPORTS_BARCHART_METRICS,
  TRENDS_KPI_METRICS,
  TRENDS_CHART_METRICS,
} from '../lib/metricDefinitions';

// fix-129-d: every tooltip definition has a description, and every
// formula text matches a documented pattern from the actual code. If
// someone updates a metric's computation without updating the tooltip,
// the corresponding case below fails — that's the regression net Bobby
// asked for.

describe('metricDefinitions roster (fix-129-c/d)', () => {
  it('Reports Overview ships 12 definitions', () => {
    // fix-140-b added Avg Permit Timeline (12th) — same canonical
    // intake → approval formula as Avg City Review, surfaced under
    // Bobby's preferred label as a second tile.
    expect(Object.keys(REPORTS_OVERVIEW_METRICS)).toHaveLength(12);
  });

  it('Trends KPI tiles ship 5 definitions', () => {
    expect(Object.keys(TRENDS_KPI_METRICS)).toHaveLength(5);
  });

  it('Trends chart titles ship 8 definitions', () => {
    expect(Object.keys(TRENDS_CHART_METRICS)).toHaveLength(8);
  });

  it('Reports BarChartCards ship 6 definitions', () => {
    expect(Object.keys(REPORTS_BARCHART_METRICS)).toHaveLength(6);
  });

  it('every definition has a non-empty description', () => {
    for (const [key, def] of Object.entries(ALL_METRIC_DEFINITIONS)) {
      expect(
        def.description.length,
        `${key}.description must be non-empty`,
      ).toBeGreaterThan(10);
    }
  });

  it('every definition has a non-empty label', () => {
    for (const [key, def] of Object.entries(ALL_METRIC_DEFINITIONS)) {
      expect(
        def.label.length,
        `${key}.label must be non-empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('aggregate roster total = sum of per-surface totals', () => {
    // fix-131-c added a fifth surface (team detail phase cards, 4 entries).
    // fix-134-b added a sixth surface (redesigns KPI tiles, 3 entries).
    // fix-136-b added a seventh surface (cycle-time comparison, 4 entries).
    expect(Object.keys(ALL_METRIC_DEFINITIONS)).toHaveLength(
      12 + 5 + 8 + 6 + 4 + 3 + 4,
    );
  });
});

// ============================================================
// Formula-text verification — every formula must name the underlying
// field(s) from the actual computation in reportMetrics.ts / perfTrends.ts.
// Catches drift if a metric's math is updated without the tooltip text.
// ============================================================
describe('formula text references the source fields (fix-129-d)', () => {
  const cases: Array<{
    key: string;
    must: string[];
  }> = [
    // Reports Overview — reportMetrics.ts:computeMetrics
    { key: 'reports.totalPermits', must: ['count', 'units'] },
    { key: 'reports.submitVariance', must: ['firstSubmitted', 'target_submit'] },
    { key: 'reports.avgGoToSubmit', must: ['firstSubmitted', 'go_date'] },
    { key: 'reports.avgGoToDDStart', must: ['dd_start', 'go_date'] },
    { key: 'reports.avgCityReview', must: ['approval_date', 'intake_accepted'] },
    { key: 'reports.avgSubmitToIntake', must: ['firstSubmitted', 'firstIntakeAccepted'] },
    { key: 'reports.avgCorrectionCycles', must: ['corr_rounds'] },
    { key: 'reports.inCorrections', must: ['effectiveStage'] },
    { key: 'reports.avgScheduleVariance', must: ['approval_date', 'actual_issue', 'expected_issue'] },
    { key: 'reports.avgDDDuration', must: ['dd_end', 'dd_start'] },
    { key: 'reports.avgDDEndToSubmit', must: ['firstSubmitted', 'dd_end'] },
    // fix-140-b: Avg Permit Timeline — same canonical formula as
    // avgCityReview (Bobby's preferred label, surfaced as a second tile).
    { key: 'reports.avgPermitTimeline', must: ['approval_date', 'intake_accepted'] },

    // Trends KPI tiles — perfTrends.ts
    { key: 'trends.approvedInWindow', must: ['count', 'approval_date'] },
    { key: 'trends.avgSubmitToIntakeDelay', must: ['intake_accepted', 'submitted'] },
    { key: 'trends.avgCityClock', must: ['approval_date', 'actual_issue', 'intake_accepted'] },
    { key: 'trends.avgCyclesPerPermit', must: ['cycles'] },
    { key: 'trends.targetSubmitHitRate', must: ['submitted', 'target_submit'] },

    // Trends chart titles
    { key: 'chart.cityClockByMonth', must: ['approval_date', 'intake_accepted'] },
    { key: 'chart.cycleSplit', must: ['corr_issued', 'submitted', 'resubmitted'] },
    { key: 'chart.cityReviewByCycle', must: ['corr_issued', 'intake_accepted'] },
    { key: 'chart.responseByCycle', must: ['resubmitted', 'corr_issued'] },
    { key: 'chart.permitsSubmittedByMonth', must: ['c0.submitted'] },
    { key: 'chart.permitsApprovedByMonth', must: ['approval_date', 'actual_issue'] },
    { key: 'chart.permitTimelineByMonth', must: ['approval_date', 'c0.submitted'] },
    { key: 'chart.gosByMonth', must: ['go_date'] },

    // Reports BarChartCards
    { key: 'bar.permitsByType', must: ['permit.type'] },
    { key: 'bar.permitsByJuris', must: ['project.juris'] },
    { key: 'bar.goToSubmitByType', must: ['firstSubmitted', 'go_date', 'permit.type'] },
    { key: 'bar.scheduleVarianceByType', must: ['approval_date', 'expected_issue', 'permit.type'] },
    { key: 'bar.cityReviewByJuris', must: ['approval_date', 'intake_accepted', 'project.juris'] },
    { key: 'bar.corrResponseByType', must: ['resubmitted', 'corr_issued', 'permit.type'] },
  ];

  it.each(cases)('$key formula references its source fields', ({ key, must }) => {
    const def = ALL_METRIC_DEFINITIONS[key];
    expect(def, `${key} not found in ALL_METRIC_DEFINITIONS`).toBeDefined();
    expect(def!.formula, `${key} must have a formula`).toBeTruthy();
    for (const token of must) {
      expect(
        def!.formula!,
        `${key}.formula must reference "${token}"`,
      ).toContain(token);
    }
  });
});
