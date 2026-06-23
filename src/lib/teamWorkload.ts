import type {
  PermitWithCycles,
  Project,
  TeamMember,
} from './database.types';
import { effectiveStage } from './permitStage';
import { fieldFor, type TeamRoleSelection } from './teamPerformance';
import { formatCompareNumber } from './comparisonCohort';
import { isSubPermit } from './subPermit';

// fix-133: current workload balance per associate.
//
// Bobby's framing (brainstorm): "how many projects or how many permits
// are we managing? How do we keep a steady plate versus loading someone
// up and then the other person who isn't busy?" The Team tab today
// shows HISTORICAL performance — useful for "who's good at what" but
// silent on bandwidth right now.
//
// This helper answers the operational question: at this moment, how is
// open work distributed across the team? The output drives a horizontal
// bar chart per associate so visual imbalance ("Trevor has 12 open BPs,
// Cam has 2") signals when to redistribute or hire.
//
// REUSES effectiveStage (permitStage.ts) for the "open" gate and
// fieldFor (teamPerformance.ts) for the role-to-credit-field mapping —
// no competing definitions.

export interface AssociateWorkload {
  name: string;
  role: TeamRoleSelection;
  isActive: boolean;
  /** Distinct projects with ≥1 open permit credited to this associate. */
  activeProjectCount: number;
  /** Open permit count = sum of the three lifecycle counts below. */
  activePermitCount: number;
  /** effectiveStage === 'de' — DD / pre-submit. */
  inDesignCount: number;
  /** effectiveStage === 'pm' — submitted, no corrections open. */
  inReviewCount: number;
  /** effectiveStage === 'co' — corrections issued, no resubmitted yet. */
  inCorrectionsCount: number;
}

export interface TeamWorkloadResult {
  rows: AssociateWorkload[];
  /** Avg activeProjectCount across the VISIBLE rows. Null when no rows. */
  teamAvgActiveProjectCount: number | null;
  /** Avg activePermitCount across the VISIBLE rows. Null when no rows.
   *  Drives the dashed vertical "team avg" line on the bar chart. */
  teamAvgActivePermitCount: number | null;
}

export interface TeamWorkloadFilters {
  role: TeamRoleSelection;
  activeOnly: boolean;
}

/** Roles that count for a TeamRoleSelection. fix-127 treats ENT and
 *  ENT_LEAD as the same person; we mirror that here so the roster
 *  lookup matches the snapshot's behavior. */
function rolesMatchingSelection(role: TeamRoleSelection): Set<string> {
  if (role === 'da') return new Set(['da']);
  if (role === 'dm') return new Set(['dm']);
  return new Set(['ent', 'ent_lead']);
}

/** fix-133: compute the current workload per associate for the role
 *  cohort. Pure — no DB calls, no DOM. The Team tab passes the same
 *  permits/projects/teamMembers arrays it already has loaded. */
export function computeTeamWorkload(
  permits: PermitWithCycles[],
  projects: Project[],
  teamMembers: TeamMember[],
  filters: TeamWorkloadFilters,
): TeamWorkloadResult {
  void projects; // currently unused — held in the signature so future
  // juris / window narrowing can land without churning callers.

  const field = fieldFor(filters.role);
  const targetRoles = rolesMatchingSelection(filters.role);

  // Roster of names that count for the role cohort, plus active state
  // (OR-merged across role variants — Bobby active under 'ent_lead'
  // counts as active for 'ent' too).
  const memberByName = new Map<string, { isActive: boolean; matchesRole: boolean }>();
  for (const m of teamMembers) {
    const existing = memberByName.get(m.name);
    const isRoleMatch = targetRoles.has(m.role);
    const isActive = m.active !== false;
    if (!existing) {
      memberByName.set(m.name, { isActive, matchesRole: isRoleMatch });
    } else {
      memberByName.set(m.name, {
        isActive: existing.isActive || isActive,
        matchesRole: existing.matchesRole || isRoleMatch,
      });
    }
  }

  interface Bucket {
    inDesign: number;
    inReview: number;
    inCorrections: number;
    projectIds: Set<string>;
  }
  const buckets = new Map<string, Bucket>();

  for (const permit of permits) {
    // fix-194: sub/child placeholder permits never count toward workload.
    if (isSubPermit(permit)) continue;
    const credit = (permit[field] ?? '').trim();
    if (!credit) continue;
    // Gate the bucket on open-only — use effectiveStage so the
    // terminal-positive status overrides (fix-31c/d) flow through. A
    // permit at "Conceptually Approved" or with actual_issue stamped
    // is NOT current workload even if some cycle is still open.
    const stage = effectiveStage(permit, permit.permit_cycles ?? [], null);
    if (stage === 'is' || stage === 'ap') continue;

    const bucket = buckets.get(credit) ?? {
      inDesign: 0,
      inReview: 0,
      inCorrections: 0,
      projectIds: new Set<string>(),
    };
    if (stage === 'de') bucket.inDesign += 1;
    else if (stage === 'pm') bucket.inReview += 1;
    else if (stage === 'co') bucket.inCorrections += 1;
    bucket.projectIds.add(permit.project_id);
    buckets.set(credit, bucket);
  }

  // Materialize rows, applying the role-roster gate + activeOnly filter.
  const rows: AssociateWorkload[] = [];
  for (const [name, bucket] of buckets) {
    const member = memberByName.get(name);
    // A permit can carry e.g. da='Bobby' even though Bobby is ENT in
    // the roster — drop names not on the selected role's roster, same
    // rule as fix-127's TeamPerformanceTable.
    if (member && !member.matchesRole) continue;
    const isActive = member?.isActive ?? true;
    if (filters.activeOnly && !isActive) continue;

    const activePermitCount =
      bucket.inDesign + bucket.inReview + bucket.inCorrections;
    rows.push({
      name,
      role: filters.role,
      isActive,
      activeProjectCount: bucket.projectIds.size,
      activePermitCount,
      inDesignCount: bucket.inDesign,
      inReviewCount: bucket.inReview,
      inCorrectionsCount: bucket.inCorrections,
    });
  }

  // Highest load first — the imbalance is the whole point of the view.
  // Tie-break by name asc for stable ordering across re-renders.
  rows.sort((a, b) => {
    if (a.activePermitCount !== b.activePermitCount) {
      return b.activePermitCount - a.activePermitCount;
    }
    return a.name.localeCompare(b.name);
  });

  // Team averages across visible rows so a filter change tightens the
  // baseline. 1-decimal rounding via formatCompareNumber (same policy
  // as the snapshot / trends helpers).
  const avg = (pick: (r: AssociateWorkload) => number): number | null => {
    if (rows.length === 0) return null;
    const sum = rows.reduce((acc, r) => acc + pick(r), 0);
    return formatCompareNumber(sum / rows.length);
  };

  return {
    rows,
    teamAvgActiveProjectCount: avg((r) => r.activeProjectCount),
    teamAvgActivePermitCount: avg((r) => r.activePermitCount),
  };
}
