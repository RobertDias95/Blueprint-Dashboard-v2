import type {
  PermitWithCycles,
  Project,
  TeamMember,
} from './database.types';

// fix-127: team performance aggregations.
//
// Bobby's framing: today the team's volume + timing per associate isn't
// directly visible. A DA might be doing 50 projects + 80 units + 10
// redesigns (+ 20 redesign units) and the dashboards under-report by
// missing the redesign work entirely. This module aggregates the cohort
// per associate so the Team tab on Reports can render the per-person
// volume + phase metrics with vs-team-avg coloring.
//
// 127-a: types + stub implementation. 127-b fills in the real math.
// 127-c wires the result into the table UI.

/** Which team-role surface the Team tab is currently showing. Maps to
 *  the per-permit field used to assign credit:
 *    'da'  → permits.da
 *    'dm'  → permits.dm
 *    'ent' → permits.ent_lead
 *  Stored as a distinct alias type from the DB's TeamRole union so the
 *  Team tab doesn't have to worry about 'ent_lead' / 'acq' / 'acq_lead'
 *  variants. The tab maps role='ent' onto BOTH team_members.role='ent'
 *  and 'ent_lead' when matching the roster (handled in 127-b). */
export type TeamRoleSelection = 'da' | 'dm' | 'ent';

export interface TeamMemberMetrics {
  name: string;
  role: TeamRoleSelection;
  isActive: boolean;
  // Volume — originals only (projects with redesign_of_project_id IS NULL)
  projectCount: number;
  unitCount: number;
  lotCount: number;
  permitCount: number;
  // Volume — redesigns only (projects with redesign_of_project_id NOT NULL)
  redesignProjectCount: number;
  redesignUnitCount: number;
  redesignLotCount: number;
  redesignPermitCount: number;
  // Phase — averages across associate's permits (per the includeRedesigns
  // filter — when false, only original-project permits contribute). Null
  // when no permits in the cohort had the underlying day pair.
  avgDdDays: number | null;
  avgCityReviewDays: number | null;
  avgCorrectionsCycles: number | null;
  avgIssuanceDays: number | null;
}

export interface TeamMetricsFilters {
  role: TeamRoleSelection;
  activeOnly: boolean;
  /** 'YYYY-MM-DD' inclusive lower bound on project.go_date. Null = no filter. */
  dateFrom: string | null;
  /** 'YYYY-MM-DD' inclusive upper bound on project.go_date. Null = no filter. */
  dateTo: string | null;
  /** Project juris match (exact). Empty string = no filter. */
  juris: string;
  /** When true (default) phase metrics fold redesign permits into the
   *  average; when false the phase metrics are computed over original
   *  projects only. The redesign volume columns are populated either way. */
  includeRedesigns: boolean;
}

export interface TeamMetricsResult {
  rows: TeamMemberMetrics[];
  /** Team averages over the VISIBLE rows. Drive the vs-team-avg color
   *  treatment on the per-row phase cells. */
  teamAvgDdDays: number | null;
  teamAvgCityReviewDays: number | null;
  teamAvgCorrectionsCycles: number | null;
  teamAvgIssuanceDays: number | null;
}

/** fix-127: compute per-associate metrics for the Team tab.
 *  Stub in 127-a — real implementation lands in 127-b. */
export function computeTeamMetrics(
  permits: PermitWithCycles[],
  projects: Project[],
  teamMembers: TeamMember[],
  filters: TeamMetricsFilters,
): TeamMetricsResult {
  void permits;
  void projects;
  void teamMembers;
  void filters;
  return {
    rows: [],
    teamAvgDdDays: null,
    teamAvgCityReviewDays: null,
    teamAvgCorrectionsCycles: null,
    teamAvgIssuanceDays: null,
  };
}
