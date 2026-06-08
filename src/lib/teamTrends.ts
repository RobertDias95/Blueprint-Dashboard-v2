import type {
  PermitWithCycles,
  Project,
  TeamMember,
} from './database.types';
import { formatCompareNumber } from './comparisonCohort';
import {
  daysBetween,
  fieldFor,
  type TeamRoleSelection,
} from './teamPerformance';

// fix-132: monthly phase trends for the per-associate drill-down. The
// snapshot (fix-131-c) tells you who's slow today; the trend tells you
// whether they're getting better. Each of the four phase metrics (DD,
// City Review, Corrections, Issuance) gets a per-month avg for the
// associate AND a per-month avg for the whole role cohort, so the
// chart can overlay the two lines and the user can see deltas across
// time.
//
// REUSES teamPerformance.ts's daysBetween + fieldFor + per-phase field
// definitions so the trend math is byte-identical to the snapshot
// (the only difference is the bucketing).

export interface PhaseMonthEntry {
  /** 'YYYY-MM'. */
  month: string;
  /** Average for the associate that month. Null when n=0 for the
   *  associate (chart renders a gap / null point). */
  associateAvg: number | null;
  /** Average across all role-credited permits that month. Null when
   *  n=0 for the role cohort (no permits anchored in the month). */
  teamAvg: number | null;
  /** Permit-sample count for the associate's avg. */
  associateN: number;
  /** Permit-sample count for the team's avg. */
  teamN: number;
}

export interface TeamTrendsResult {
  ddPhase: PhaseMonthEntry[];
  cityReview: PhaseMonthEntry[];
  corrections: PhaseMonthEntry[];
  issuance: PhaseMonthEntry[];
}

export interface TeamTrendsFilters {
  role: TeamRoleSelection;
  associateName: string;
  /** 'YYYY-MM' inclusive lower bound. */
  monthFrom: string;
  /** 'YYYY-MM' inclusive upper bound. */
  monthTo: string;
}

/** fix-132: build the inclusive 'YYYY-MM' bucket list between monthFrom
 *  and monthTo. Lex-comparable since both are ISO-shaped; iterates
 *  month-by-month via integer math on year/month components to dodge
 *  Date-object timezone weirdness. */
export function buildMonthBuckets(monthFrom: string, monthTo: string): string[] {
  if (monthFrom > monthTo) return [];
  const [fy, fm] = monthFrom.split('-').map((s) => parseInt(s, 10));
  const [ty, tm] = monthTo.split('-').map((s) => parseInt(s, 10));
  if (!fy || !fm || !ty || !tm) return [];
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Pluck the 'YYYY-MM' month from an ISO YYYY-MM-DD date string. Null
 *  when the input is empty/malformed. */
function monthOf(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 7) return null;
  return iso.slice(0, 7);
}

/** Each phase has the same shape: pick the anchor month + pick the
 *  numeric value. Null from either skips the permit in this phase.
 *  Centralized so the same predicate flows through associate AND team
 *  series without drift. */
type PhaseAccessor = {
  anchor: (p: PermitWithCycles) => string | null;
  value: (p: PermitWithCycles) => number | null;
};

const PHASE_ACCESSORS: Record<keyof TeamTrendsResult, PhaseAccessor> = {
  ddPhase: {
    // Anchor on dd_end's month — the DD Phase metric measures
    // dd_start → dd_end. Permits without both endpoints skip.
    anchor: (p) => monthOf(p.dd_end),
    value: (p) => {
      const d = daysBetween(p.dd_start, p.dd_end);
      return d !== null && d >= 0 ? d : null;
    },
  },
  cityReview: {
    // Anchor on approval_date — the city's clock closes when approval
    // lands. Metric is approval_date − c0.intake_accepted (matches
    // teamPerformance.ts's snapshot accessor).
    anchor: (p) => monthOf(p.approval_date),
    value: (p) => {
      const c0 = (p.permit_cycles ?? []).find((c) => c.cycle_index === 0);
      const d = daysBetween(c0?.intake_accepted, p.approval_date);
      return d !== null && d >= 0 ? d : null;
    },
  },
  corrections: {
    // corr_rounds is permit-level. Anchor on approval_date so the
    // metric lands in the month the permit closed out.
    anchor: (p) => monthOf(p.approval_date),
    value: (p) =>
      typeof p.corr_rounds === 'number' && p.corr_rounds >= 0
        ? p.corr_rounds
        : null,
  },
  issuance: {
    // Anchor on actual_issue. Metric is actual_issue − approval_date.
    anchor: (p) => monthOf(p.actual_issue),
    value: (p) => {
      const d = daysBetween(p.approval_date, p.actual_issue);
      return d !== null && d >= 0 ? d : null;
    },
  },
};

/** fix-132: compute per-month per-phase trends for one associate
 *  alongside the team cohort. The team series uses every permit in the
 *  role cohort (not just the associate's), so the overlay reads as
 *  "you vs everyone in your role this month."
 *
 *  Active-only is intentionally NOT a filter here — the drill-down
 *  page respects the user's click-through intent (see fix-131
 *  documentation in ReportsTeamDetail.tsx). Inactive associates'
 *  data still contributes to the team cohort for fairness; we don't
 *  want their phase metrics from when they were active to vanish
 *  from the comparison baseline. */
export function computeTeamTrends(
  permits: PermitWithCycles[],
  projects: Project[],
  teamMembers: TeamMember[],
  filters: TeamTrendsFilters,
): TeamTrendsResult {
  void projects; // currently unused; kept in signature for future
  // juris-narrowing extensions without a downstream API churn.
  const field = fieldFor(filters.role);
  const months = buildMonthBuckets(filters.monthFrom, filters.monthTo);

  // Roster of names that count for the role cohort. The DB has both
  // 'ent' and 'ent_lead' for the same person; union them per fix-127.
  const rolesMatching =
    filters.role === 'da'
      ? new Set(['da'])
      : filters.role === 'dm'
        ? new Set(['dm'])
        : new Set(['ent', 'ent_lead']);
  const rosterNames = new Set<string>();
  for (const m of teamMembers) {
    if (rolesMatching.has(m.role)) rosterNames.add(m.name);
  }

  // For each phase, accumulate per-month sums + counts on both the
  // associate side and the team-cohort side.
  type Bucket = {
    associateSum: number;
    associateN: number;
    teamSum: number;
    teamN: number;
  };
  function emptyBuckets(): Map<string, Bucket> {
    const m = new Map<string, Bucket>();
    for (const mo of months) {
      m.set(mo, { associateSum: 0, associateN: 0, teamSum: 0, teamN: 0 });
    }
    return m;
  }

  const phaseBuckets: Record<keyof TeamTrendsResult, Map<string, Bucket>> = {
    ddPhase: emptyBuckets(),
    cityReview: emptyBuckets(),
    corrections: emptyBuckets(),
    issuance: emptyBuckets(),
  };

  for (const permit of permits) {
    const credit = (permit[field] ?? '').trim();
    // Only role-credited permits count for the team cohort. A permit
    // with empty role field (no DA/DM/ENT assigned) contributes
    // nothing — same gate as the snapshot.
    if (!credit) continue;
    if (!rosterNames.has(credit)) continue;
    const isAssociate = credit === filters.associateName;

    for (const phase of Object.keys(PHASE_ACCESSORS) as (keyof TeamTrendsResult)[]) {
      const acc = PHASE_ACCESSORS[phase];
      const month = acc.anchor(permit);
      if (!month) continue;
      const bucket = phaseBuckets[phase].get(month);
      if (!bucket) continue; // month outside window
      const v = acc.value(permit);
      if (v === null) continue;
      bucket.teamSum += v;
      bucket.teamN += 1;
      if (isAssociate) {
        bucket.associateSum += v;
        bucket.associateN += 1;
      }
    }
  }

  function materialize(
    map: Map<string, Bucket>,
  ): PhaseMonthEntry[] {
    return months.map((month) => {
      const b = map.get(month);
      if (!b) {
        return {
          month,
          associateAvg: null,
          teamAvg: null,
          associateN: 0,
          teamN: 0,
        };
      }
      return {
        month,
        associateAvg:
          b.associateN === 0
            ? null
            : formatCompareNumber(b.associateSum / b.associateN),
        teamAvg:
          b.teamN === 0
            ? null
            : formatCompareNumber(b.teamSum / b.teamN),
        associateN: b.associateN,
        teamN: b.teamN,
      };
    });
  }

  return {
    ddPhase: materialize(phaseBuckets.ddPhase),
    cityReview: materialize(phaseBuckets.cityReview),
    corrections: materialize(phaseBuckets.corrections),
    issuance: materialize(phaseBuckets.issuance),
  };
}
