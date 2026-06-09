// fix-129-c: tooltip text for every metric surfaced on Reports
// (Overview MetricCards + BarChartCards) and Trends (KPI tiles + chart
// titles). One source of truth so the wording stays consistent across
// surfaces and a single edit propagates everywhere the metric appears.
//
// Each definition has:
//   description : plain-language sentence about what the user is seeing
//   formula     : human-readable computation matching the actual code
//   cohort      : optional filter/gate ("only counts permits with X set")
//
// The formula text intentionally names the underlying fields (e.g.,
// "approval_date − c0.intake_accepted") so a curious user can verify the
// math against a permit's detail view. Wording was derived by reading the
// computation code (see file pointers in each definition's comment).
//
// VERIFICATION PATTERNS (consumed by the test in 129-d): every formula
// references the source field name(s) the code actually uses. The test
// asserts the formula text matches a documented pattern per metric, so
// changes to the math without a tooltip update get caught.

export interface MetricDefinition {
  label: string;
  description: string;
  formula?: string;
  cohort?: string;
}

// ============================================================
// Reports Overview MetricCards (src/lib/reportMetrics.ts:computeMetrics)
// ============================================================

export const REPORTS_OVERVIEW_METRICS: Record<string, MetricDefinition> = {
  totalPermits: {
    // reportMetrics.ts:637 — enriched.length over the filtered cohort.
    label: 'Total Permits',
    description:
      'Number of permits in the current filter, plus total units across the distinct projects they belong to.',
    formula: 'count(permits in filter) · sum(project.units) over distinct projects',
  },
  submitVariance: {
    // reportMetrics.ts:597-614 — actual firstSubmitted − target_submit, averaged.
    label: 'Submit Variance (avg)',
    description:
      'How early or late the team submits relative to its target_submit date. Negative = early, positive = late.',
    formula: 'avg(firstSubmitted − target_submit) in days',
    cohort: 'Only counts permits with both firstSubmitted AND target_submit set.',
  },
  avgGoToSubmit: {
    // reportMetrics.ts:642 — avg of enriched.goToSubmit (reportMetrics:94 = go_date → firstSubmitted).
    label: 'Avg GO → Submit',
    description:
      'Average days from project GO date to first city submission. Captures the team prep window in D&E.',
    formula: 'avg(firstSubmitted − project.go_date) in days',
    cohort: 'Only counts permits with both go_date AND firstSubmitted set.',
  },
  avgGoToDDStart: {
    // reportMetrics.ts:643 — avg of enriched.goToDDStart (go_date → dd_start).
    label: 'Avg GO → DD Start',
    description:
      'Average days from project GO date to when DD (Design Development) starts.',
    formula: 'avg(dd_start − project.go_date) in days',
    cohort: 'Only counts permits with both go_date AND dd_start set.',
  },
  avgCityReview: {
    // fix-141: REDEFINED. avg of cityCourtTimeDays — sum of per-review-cycle
    // (corr_issued − submitted) durations, final cycle anchored to approval.
    label: 'Avg City Review',
    description:
      "Time the permit was in the city's hands — sum of review-cycle durations.",
    formula:
      'sum(cycle.corr_issued − cycle.submitted) across review cycles, with final cycle anchored to approval_date',
    cohort:
      'Only counts permits where all review cycles have both submitted AND a closing event (corr_issued or approval_date). Excludes ongoing cycles.',
  },
  avgSubmitToIntake: {
    // reportMetrics.ts:645 — firstSubmitted → firstIntakeAccepted.
    label: 'Avg Submit → Intake',
    description:
      "City queue lag: average days between the team's submission and the city's intake acceptance.",
    formula: 'avg(firstIntakeAccepted − firstSubmitted) in days',
    cohort: 'Only counts permits with both firstSubmitted AND firstIntakeAccepted set.',
  },
  avgCorrectionCycles: {
    // reportMetrics.ts:617-625 — avg(corr_rounds) where corr_rounds > 0.
    label: 'Avg Correction Cycles',
    description:
      'Average number of correction rounds per permit that went through corrections. Counts how many times the city sent the team back with revisions.',
    formula: 'avg(permits.corr_rounds) where corr_rounds > 0',
    cohort: 'Only counts permits with at least one correction round.',
  },
  inCorrections: {
    // reportMetrics.ts:628-633 — effectiveStage === 'co'.
    label: 'In Corrections',
    description:
      'How many permits are currently in the corrections state — city has issued corrections and the team has not yet resubmitted.',
    formula: 'count(permits where effectiveStage = "co")',
  },
  avgScheduleVariance: {
    // reportMetrics.ts:650 — avg of enriched.variance
    // = (approval_date ?? actual_issue) − expected_issue.
    label: 'Avg Schedule Var.',
    description:
      'How far ahead or behind permits actually approve vs the forecast. Negative = ahead of forecast, positive = behind.',
    formula: 'avg((approval_date ?? actual_issue) − expected_issue) in days',
    cohort: 'Only counts permits with both an approval/issue date AND expected_issue set.',
  },
  avgDDDuration: {
    // reportMetrics.ts:651 — dd_end − dd_start.
    label: 'Avg DD Duration',
    description:
      'Average length of the Design Development phase, from DD Start to DD End.',
    formula: 'avg(dd_end − dd_start) in days',
    cohort: 'Only counts permits with both dd_start AND dd_end set.',
  },
  avgDDEndToSubmit: {
    // reportMetrics.ts:652 — dd_end → firstSubmitted.
    label: 'Avg DD → Submit',
    description:
      'Average days from DD End to first city submission — the team-prep gap before intake.',
    formula: 'avg(firstSubmitted − dd_end) in days',
    cohort: 'Only counts permits with both dd_end AND firstSubmitted set.',
  },
  // fix-140-b: Avg Permit Timeline — the canonical intake → approval clock.
  // fix-141: this is now genuinely distinct from Avg City Review (which was
  // redefined as a sum-over-cycles ball-in-court measure). The tile reads
  // metrics.avgPermitTimeline (the renamed permitTimelineDays field); City
  // Review reads metrics.avgCityReview (cityCourtTimeDays). The two diverge
  // by the team's response time — see the convergence invariant in
  // reportMetrics.test.ts (cityReview + responseTime = permitTimeline).
  avgPermitTimeline: {
    label: 'Avg Permit Timeline',
    description:
      'How long the permit took from city intake acceptance to approval — the total end-to-end clock.',
    formula: 'avg(approval_date − c0.intake_accepted) in days',
    cohort: 'Only counts permits with both intake_accepted AND approval_date set.',
  },
  // fix-141: Avg Response Time — the conceptual sibling of Avg City Review.
  // City's court (City Review) + our court (Response Time) telescopes into
  // the full Permit Timeline.
  avgResponseTime: {
    label: 'Avg Response Time',
    description:
      'Time the permit was in our hands — sum of (corr_issued → next cycle submitted) across review cycles.',
    formula:
      'sum(c[i+1].submitted − c[i].corr_issued) across consecutive review-cycle pairs',
    cohort:
      'Only counts permits with at least one completed correction round-trip (cycle 1 corr_issued + cycle 2 submitted). Excludes permits approved on cycle 1 with no corrections.',
  },
};

// ============================================================
// Trends KPI tiles (src/lib/perfTrends.ts)
// ============================================================

export const TRENDS_KPI_METRICS: Record<string, MetricDefinition> = {
  approvedInWindow: {
    // perfTrends.ts:69 — filtered.length on the filterPermits cohort
    // (which gates on approval_date ?? actual_issue being set + in window).
    label: 'Approved permits in window',
    description:
      'Number of permits whose approval (or issue) date falls inside the current date range.',
    formula: 'count(permits where (approval_date ?? actual_issue) ∈ [from, to])',
    cohort: 'Only counts permits with approval_date or actual_issue set.',
  },
  avgSubmitToIntakeDelay: {
    // Trends.tsx KPI uses submissionToIntakeVariance — perfTrends.ts:261-289.
    // weighted avg of (c0.intake_accepted − c0.submitted).
    label: 'Avg submit → intake delay',
    description:
      "City queue lag: weighted-average days from the team's c0 submission to the city's intake acceptance.",
    formula:
      'weighted-avg(c0.intake_accepted − c0.submitted) across the (juris × type) buckets',
    cohort: 'Only counts permits with both c0.submitted AND c0.intake_accepted set; negative deltas dropped as bad data.',
  },
  avgCityClock: {
    // perfTrends.ts — avgIntakeToApproval. fix-142: renamed label from
    // "Avg city clock" → "Avg Permit Timeline" to align with Reports
    // Overview. Formula + cohort unchanged (intake → approval total).
    label: 'Avg Permit Timeline',
    description:
      'How long permits take end-to-end, from intake acceptance to approval, averaged across the cohort.',
    formula: 'avg(approval_date ?? actual_issue − c0.intake_accepted) in days',
    cohort: 'Only counts permits with both c0.intake_accepted AND approval (or issue) date set.',
  },
  // fix-142: Trends siblings of Avg Permit Timeline — the same City Review /
  // Response Time split Reports Overview surfaces (fix-141), now on Trends.
  // Formula + cohort text mirror the Reports Overview entries; description
  // is tweaked for the cohort-average framing of the Trends KPI row.
  avgCityReview: {
    // perfTrends.ts:avgCityCourtTime — mean of reportMetrics.cityCourtTimeDays.
    label: 'Avg City Review',
    description:
      "Time the permit was in the city's hands, averaged across the cohort — sum of review-cycle durations per permit.",
    formula:
      'sum(cycle.corr_issued − cycle.submitted) across review cycles, with final cycle anchored to approval_date',
    cohort:
      'Only counts permits where all review cycles have both submitted AND a closing event (corr_issued or approval_date). Excludes ongoing cycles.',
  },
  avgResponseTime: {
    // perfTrends.ts:avgResponseCourtTime — mean of reportMetrics.responseCourtTimeDays.
    label: 'Avg Response Time',
    description:
      'Time the permit was in our hands, averaged across the cohort — sum of (corr_issued → next cycle submitted) per permit.',
    formula:
      'sum(c[i+1].submitted − c[i].corr_issued) across consecutive review-cycle pairs',
    cohort:
      'Only counts permits with at least one completed correction round-trip (cycle 1 corr_issued + cycle 2 submitted). Excludes permits approved on cycle 1 with no corrections.',
  },
  avgCyclesPerPermit: {
    // perfTrends.ts:87-107 — count of cycles with any populated date.
    label: 'Avg cycles per permit',
    description:
      'Average number of review cycles a permit goes through. A cycle counts as long as work happened in it (any populated date).',
    formula: 'avg(count(cycles with any populated date)) per permit',
  },
  targetSubmitHitRate: {
    // perfTrends.ts:115-136 — hit = (c0.submitted ≤ permit.target_submit).
    label: 'Target submit hit rate',
    description:
      "How often the team's actual c0 submission lands on or before the engine-derived target_submit.",
    formula: 'count(c0.submitted ≤ target_submit) / count(permits with both dates set)',
    cohort: 'Only counts permits with both c0.submitted AND target_submit set.',
  },
};

// ============================================================
// Trends chart titles
// ============================================================

export const TRENDS_CHART_METRICS: Record<string, MetricDefinition> = {
  cityClockByMonth: {
    // fix-142: relabeled "Avg city clock by month" → "Avg Permit Timeline
    // by Month" to match the renamed KPI tile. The titleSlot (this label)
    // is what ChartCard actually renders. Data path + formula unchanged
    // (intake → approval); the parenthetical distinguishes it from the
    // Volume section's submit-anchored Permit Timeline chart.
    label: 'Avg Permit Timeline by Month (intake → approval)',
    description:
      'Monthly trend of permit timeline. Each point = avg days from c0.intake_accepted to approval, bucketed by approval month.',
    formula: 'avg(approval_date − c0.intake_accepted) per approval-month bucket',
  },
  cycleSplit: {
    label: "Where's time going? City review vs team turnaround per cycle",
    description:
      "Per (juris × type) breakdown of two adjacent durations on each correction round: the city's review (submitted → corr_issued) and the team's turnaround (corr_issued → resubmitted).",
    formula:
      'avg(corr_issued − submitted) and avg(resubmitted − corr_issued) over cycle_index ≥ 1',
  },
  cityReviewByCycle: {
    label: 'Avg city review by cycle',
    description:
      "Cycle-by-cycle (1–4) breakdown of the city's review time. Surfaces cycle-specific slowdowns ('cycle 3 is slower than cycle 2').",
    formula: 'avg(corr_issued − intake_accepted/submitted) per cycle bucket',
    cohort: 'Only counts permits whose extractSample qualifies (approval_date or actual_issue + intake anchor).',
  },
  responseByCycle: {
    label: 'Avg team response by cycle',
    description:
      "Cycle-by-cycle breakdown of the team's correction-turnaround time.",
    formula: 'avg(resubmitted − corr_issued) per cycle bucket',
    cohort: 'Only counts permits whose extractSample qualifies (approval_date or actual_issue + intake anchor).',
  },
  permitsSubmittedByMonth: {
    label: 'Permits Submitted by Month',
    description:
      'Volume of permit submissions per month. Counts every permit whose c0.submitted falls in the month.',
    formula: 'count(permits where c0.submitted ∈ month)',
  },
  permitsApprovedByMonth: {
    label: 'Permits Approved by Month',
    description:
      'Volume of permit approvals per month. Counts every permit whose approval_date (or actual_issue fallback) falls in the month.',
    formula: 'count(permits where (approval_date ?? actual_issue) ∈ month)',
  },
  permitTimelineByMonth: {
    label: 'Avg Permit Timeline by Month',
    description:
      'Average end-to-end time per permit, bucketed by approval month. Honest about the endpoint — uses actual_issue when approval_date is missing.',
    formula: 'avg(approval_date/actual_issue − c0.submitted) per approval-month bucket',
  },
  gosByMonth: {
    label: 'GOs by Month',
    description: 'Number of new projects entering active work each month (by project go_date).',
    formula: 'count(distinct projects where go_date ∈ month)',
  },
};

// ============================================================
// Reports BarChartCards (src/components/Reports/ReportsOverviewTab.tsx)
// ============================================================

export const REPORTS_BARCHART_METRICS: Record<string, MetricDefinition> = {
  permitsByType: {
    label: 'Permits by Type',
    description: 'Permit count grouped by permit type (Building Permit, Demolition, etc.).',
    formula: 'count(permits) grouped by permit.type',
  },
  permitsByJuris: {
    label: 'Permits by Jurisdiction',
    description: 'Permit count grouped by jurisdiction (Seattle, Bellevue, etc.).',
    formula: 'count(permits) grouped by project.juris',
  },
  goToSubmitByType: {
    label: 'GO → Submit (avg days by type)',
    description:
      'Average D&E prep window per permit type — days from project GO date to first submission.',
    formula: 'avg(firstSubmitted − project.go_date) grouped by permit.type',
    cohort: 'Only counts permits with both go_date AND firstSubmitted set.',
  },
  scheduleVarianceByType: {
    label: 'Schedule Variance by Type (avg days off)',
    description:
      'Average forecast accuracy per permit type. Negative = ahead of forecast, positive = behind.',
    formula: 'avg((approval_date ?? actual_issue) − expected_issue) grouped by permit.type',
    cohort: 'Only counts issued permits with expected_issue set.',
  },
  cityReviewByJuris: {
    label: 'City Review by Jurisdiction (avg days)',
    description:
      'Average city review duration per jurisdiction — how fast each city moves from intake to approval.',
    formula: 'avg(approval_date − c0.intake_accepted) grouped by project.juris',
    cohort: 'Only counts permits with both intake_accepted AND approval_date set.',
  },
  corrResponseByType: {
    label: 'Correction Response by Type (avg days)',
    description:
      "Team turnaround per permit type — how fast the team responds to city corrections (corr_issued → resubmitted).",
    formula: 'avg(resubmitted − corr_issued) grouped by permit.type',
    cohort: 'Only counts permits with at least one completed correction cycle.',
  },
};

// ============================================================
// Team detail phase cards (src/pages/ReportsTeamDetail.tsx)
// ============================================================

// fix-131-c: per-associate phrasing for the drill-down's four phase
// cards. The Team tab table reads "DD Phase" / "City Review" /
// "Corrections" / "Issuance" without explanation; on the drill-down
// each card carries the tooltip with the formula + cohort gate so a
// curious manager can verify what they're seeing. computeTeamMetrics
// in src/lib/teamPerformance.ts:235-272 is the source of truth for
// the math.
export const TEAM_DETAIL_PHASE_METRICS: Record<string, MetricDefinition> = {
  avgDdDays: {
    label: 'DD Phase',
    description:
      "Average days this associate spends in the Design Development phase per permit.",
    formula: 'avg(dd_end − dd_start) across the associate\'s permits',
    cohort: 'Only counts permits with both dd_start AND dd_end set.',
  },
  avgCityReviewDays: {
    label: 'City Review',
    description:
      "Average days the city took to approve permits credited to this associate, from intake acceptance to approval.",
    formula:
      'avg(approval_date − c0.intake_accepted) across the associate\'s permits',
    cohort: 'Only counts permits with both intake_accepted AND approval_date set.',
  },
  avgCorrectionsCycles: {
    label: 'Corrections',
    description:
      'Average number of correction rounds this associate handled per permit.',
    formula: 'avg(permits.corr_rounds) across the associate\'s permits',
  },
  avgIssuanceDays: {
    label: 'Issuance',
    description:
      "Average days between approval and actual issue on this associate's permits.",
    formula: 'avg(actual_issue − approval_date) across the associate\'s permits',
    cohort: 'Only counts permits with both approval_date AND actual_issue set.',
  },
};

// ============================================================
// fix-134: Redesigns tab KPI tiles
// (src/lib/redesignAnalytics.ts:computeRedesignAnalytics)
// ============================================================

export const REDESIGNS_KPI_METRICS: Record<string, MetricDefinition> = {
  totalRedesigns: {
    label: 'Total Redesigns',
    description:
      'Distinct projects in the current filter that were spawned as a redesign of a prior project (projects.redesign_of_project_id IS NOT NULL).',
    formula: 'count(projects where redesign_of_project_id is set, filtered by go_date + juris)',
  },
  reusePermitRate: {
    label: 'Reuse Permit Rate',
    description:
      'Share of redesigns flagged as "reuses the original permit set" — metadata-only redesigns that did NOT spawn a fresh permit cohort.',
    formula:
      'count(redesigns where redesign_reuses_original_permit = true) / count(all redesigns in filter)',
    cohort: 'Excludes the rate calc when no redesigns are in the filter (renders em-dash).',
  },
  buildersTriggering: {
    label: 'Builders Triggering Redesigns',
    description:
      'Distinct builders attached to at least one redesign project in the current filter. The builder leaderboard below ranks them.',
    formula: 'count(distinct projects.builder_name where redesign_of_project_id is set)',
    cohort: 'Excludes redesigns with no builder_name on file.',
  },
};

// ============================================================
// fix-136: Redesigns tab Cycle Time vs Originals tiles
// (src/lib/redesignAnalytics.ts:computeRedesignCycleTimeComparison)
// ============================================================
//
// Bobby's brainstorm question: "are redesigns taking longer than
// fresh-from-scratch projects?" Each tile shows the answer for one
// phase, side-by-side with the original-cohort baseline.

export const REDESIGNS_CYCLE_COMPARISON: Record<string, MetricDefinition> = {
  ddPhase: {
    label: 'DD Phase',
    description:
      'Average days in Design Development on redesign projects vs original projects, within the current filter.',
    formula: 'avg(dd_end − dd_start) per cohort',
    cohort: 'Only counts permits with both dd_start AND dd_end set.',
  },
  cityReview: {
    label: 'City Review',
    description:
      'Average days the city takes from intake acceptance to approval, on redesigns vs originals.',
    formula: 'avg(approval_date − c0.intake_accepted) per cohort',
    cohort: 'Only counts permits with both intake_accepted AND approval_date set.',
  },
  corrections: {
    label: 'Corrections',
    description:
      'Average number of correction rounds per permit, on redesigns vs originals.',
    formula: 'avg(permits.corr_rounds) per cohort',
  },
  issuance: {
    label: 'Issuance',
    description:
      'Average days from approval to actual issue, on redesigns vs originals.',
    formula: 'avg(actual_issue − approval_date) per cohort',
    cohort: 'Only counts permits with both approval_date AND actual_issue set.',
  },
};

// ============================================================
// Aggregate roster (for the verification test in 129-d)
// ============================================================

/** Every metric definition in one map, keyed by `${surface}.${slug}` so the
 *  verification test can iterate without duplicating the per-surface
 *  groupings above. */
export const ALL_METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  ...Object.fromEntries(
    Object.entries(REPORTS_OVERVIEW_METRICS).map(([k, v]) => [`reports.${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(TRENDS_KPI_METRICS).map(([k, v]) => [`trends.${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(TRENDS_CHART_METRICS).map(([k, v]) => [`chart.${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(REPORTS_BARCHART_METRICS).map(([k, v]) => [`bar.${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(TEAM_DETAIL_PHASE_METRICS).map(([k, v]) => [
      `team.${k}`,
      v,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(REDESIGNS_KPI_METRICS).map(([k, v]) => [
      `redesigns.${k}`,
      v,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(REDESIGNS_CYCLE_COMPARISON).map(([k, v]) => [
      `cycle.${k}`,
      v,
    ]),
  ),
};
