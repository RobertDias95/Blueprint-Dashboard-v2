import type {
  PermitWithCycles,
  Project,
  TeamMember,
} from './database.types';
import { formatCompareNumber } from './comparisonCohort';

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

// ============================================================
// fix-127-b: real aggregation
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** fix-132: exported so teamTrends.ts can reuse the same date math
 *  the snapshot uses — no competing definitions of "days between two
 *  ISO dates." UTC-noon anchor dodges DST + TZ drift. */
export function daysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (!a || !b) return null;
  const aMs = new Date(`${a}T12:00:00Z`).getTime();
  const bMs = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((bMs - aMs) / DAY_MS);
}

/** Pick the per-permit field that credits this role.
 *  fix-132: exported so teamTrends.ts can reuse the role-to-field
 *  mapping verbatim. */
export function fieldFor(role: TeamRoleSelection): 'da' | 'dm' | 'ent_lead' {
  if (role === 'da') return 'da';
  if (role === 'dm') return 'dm';
  return 'ent_lead';
}

/** Map TeamRoleSelection to the set of TeamMember.role values that
 *  qualify for the active-only roster lookup. The DB has both 'ent' and
 *  'ent_lead' on the same person; the team tab treats them as one. */
function rolesMatchingSelection(role: TeamRoleSelection): Set<string> {
  if (role === 'da') return new Set(['da']);
  if (role === 'dm') return new Set(['dm']);
  return new Set(['ent', 'ent_lead']);
}

/** fix-127: compute per-associate metrics for the Team tab.
 *
 *  Flow:
 *    1. Filter projects to the date / juris window.
 *    2. For each permit in the cohort whose project survives the filter:
 *       group by the role's credit field (da/dm/ent_lead).
 *    3. For each associate group:
 *       - Split their permits by original vs redesign (project FK).
 *       - Compute volume counts (projects + units + lots + permit count)
 *         on each side.
 *       - Compute phase averages (DD days, city review, corr rounds,
 *         issuance days) — on combined permits when includeRedesigns=true,
 *         on original-only when false.
 *    4. Apply active-only filter against team_members.
 *    5. Compute team averages across the visible rows. */
export function computeTeamMetrics(
  permits: PermitWithCycles[],
  projects: Project[],
  teamMembers: TeamMember[],
  filters: TeamMetricsFilters,
): TeamMetricsResult {
  const projectsById = new Map<string, Project>();
  for (const p of projects) projectsById.set(p.id, p);

  const field = fieldFor(filters.role);
  const targetRoles = rolesMatchingSelection(filters.role);
  // Build a name → TeamMember map. The DB has duplicate names across
  // role variants (e.g. Bobby is both 'ent' and 'ent_lead'); prefer
  // the entry that matches the selection's role set when present, then
  // any fallback. `active` is derived from "any matching row has active=true"
  // (a person is active if any of their role rows are active).
  const memberByName = new Map<string, { isActive: boolean; matchesRole: boolean }>();
  for (const m of teamMembers) {
    const isRoleMatch = targetRoles.has(m.role);
    const existing = memberByName.get(m.name);
    const isActive = m.active !== false;
    if (!existing) {
      memberByName.set(m.name, {
        isActive,
        matchesRole: isRoleMatch,
      });
    } else {
      memberByName.set(m.name, {
        // OR-merge: active if any role variant is active, role-match if
        // any variant matches the selection.
        isActive: existing.isActive || isActive,
        matchesRole: existing.matchesRole || isRoleMatch,
      });
    }
  }

  // Filter projects to the window.
  const projectInWindow = (proj: Project): boolean => {
    if (filters.juris && proj.juris !== filters.juris) return false;
    if (filters.dateFrom || filters.dateTo) {
      const anchor = proj.go_date ?? null;
      if (!anchor) return false;
      if (filters.dateFrom && anchor < filters.dateFrom) return false;
      if (filters.dateTo && anchor > filters.dateTo) return false;
    }
    return true;
  };

  // Group permits by associate name. Each group splits into original
  // vs redesign sides based on the project's redesign_of_project_id.
  interface Bucket {
    original: PermitWithCycles[];
    redesign: PermitWithCycles[];
    originalProjectIds: Set<string>;
    redesignProjectIds: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  for (const permit of permits) {
    const name = (permit[field] ?? '').trim();
    if (!name) continue;
    const proj = projectsById.get(permit.project_id);
    if (!proj) continue;
    if (!projectInWindow(proj)) continue;
    const isRedesign = !!proj.redesign_of_project_id;
    const bucket = buckets.get(name) ?? {
      original: [],
      redesign: [],
      originalProjectIds: new Set(),
      redesignProjectIds: new Set(),
    };
    if (isRedesign) {
      bucket.redesign.push(permit);
      bucket.redesignProjectIds.add(proj.id);
    } else {
      bucket.original.push(permit);
      bucket.originalProjectIds.add(proj.id);
    }
    buckets.set(name, bucket);
  }

  // Compute volume counts on the project IDs, NOT on the permits — a
  // project with 2 permits should only contribute its units/lots once.
  const sumByIds = (
    ids: Set<string>,
    pick: (p: Project) => number | null | undefined,
  ): number => {
    let total = 0;
    for (const id of ids) {
      const proj = projectsById.get(id);
      if (!proj) continue;
      const v = pick(proj);
      if (typeof v === 'number') total += v;
    }
    return total;
  };

  // Phase averages: collect raw day values across the permits feeding
  // the metric (gated by includeRedesigns), then divide by n and round
  // with formatCompareNumber for 1-decimal output (fix-124-a policy).
  const avgOrNull = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    return formatCompareNumber(sum / values.length);
  };

  const rows: TeamMemberMetrics[] = [];
  for (const [name, bucket] of buckets) {
    const member = memberByName.get(name);
    const isActive = member?.isActive ?? true;
    // Drop names that aren't on the selected role's roster — a permit
    // can carry e.g. da='Bobby' even though Bobby is ENT. Without this
    // filter the table would show every name that appears in the
    // permit field, which is noise.
    if (member && !member.matchesRole) continue;

    if (filters.activeOnly && !isActive) continue;

    // Pick which permits feed phase metrics.
    const phasePermits = filters.includeRedesigns
      ? [...bucket.original, ...bucket.redesign]
      : bucket.original;

    const ddDays: number[] = [];
    const cityReviewDays: number[] = [];
    const correctionsCycles: number[] = [];
    const issuanceDays: number[] = [];
    for (const p of phasePermits) {
      const dd = daysBetween(p.dd_start, p.dd_end);
      if (dd !== null && dd >= 0) ddDays.push(dd);
      const c0 = (p.permit_cycles ?? []).find((c) => c.cycle_index === 0);
      const cr = daysBetween(c0?.intake_accepted, p.approval_date);
      if (cr !== null && cr >= 0) cityReviewDays.push(cr);
      if (typeof p.corr_rounds === 'number' && p.corr_rounds >= 0) {
        correctionsCycles.push(p.corr_rounds);
      }
      const iss = daysBetween(p.approval_date, p.actual_issue);
      if (iss !== null && iss >= 0) issuanceDays.push(iss);
    }

    rows.push({
      name,
      role: filters.role,
      isActive,
      projectCount: bucket.originalProjectIds.size,
      unitCount: sumByIds(bucket.originalProjectIds, (p) => p.units),
      lotCount: sumByIds(bucket.originalProjectIds, (p) => p.num_lots),
      permitCount: bucket.original.length,
      redesignProjectCount: bucket.redesignProjectIds.size,
      redesignUnitCount: sumByIds(bucket.redesignProjectIds, (p) => p.units),
      redesignLotCount: sumByIds(bucket.redesignProjectIds, (p) => p.num_lots),
      redesignPermitCount: bucket.redesign.length,
      avgDdDays: avgOrNull(ddDays),
      avgCityReviewDays: avgOrNull(cityReviewDays),
      avgCorrectionsCycles: avgOrNull(correctionsCycles),
      avgIssuanceDays: avgOrNull(issuanceDays),
    });
  }

  // Team averages computed over the VISIBLE rows so a filter that
  // narrows the cohort also tightens the comparison baseline. Rows
  // missing the metric (null) drop out of the team-avg calc.
  const teamAvg = (
    pick: (r: TeamMemberMetrics) => number | null,
  ): number | null => {
    const values: number[] = [];
    for (const r of rows) {
      const v = pick(r);
      if (typeof v === 'number') values.push(v);
    }
    return avgOrNull(values);
  };

  // Default sort: projects desc, then name asc as tiebreaker.
  rows.sort((a, b) => {
    if (a.projectCount !== b.projectCount) {
      return b.projectCount - a.projectCount;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    rows,
    teamAvgDdDays: teamAvg((r) => r.avgDdDays),
    teamAvgCityReviewDays: teamAvg((r) => r.avgCityReviewDays),
    teamAvgCorrectionsCycles: teamAvg((r) => r.avgCorrectionsCycles),
    teamAvgIssuanceDays: teamAvg((r) => r.avgIssuanceDays),
  };
}
