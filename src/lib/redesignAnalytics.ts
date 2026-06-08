import type {
  PermitWithCycles,
  Project,
  RedesignTrigger,
} from './database.types';
import { REDESIGN_TRIGGER_LABELS } from './database.types';
import { formatCompareNumber } from './comparisonCohort';

// fix-134: redesign analytics aggregation.
//
// Bobby's brainstorm framing: "20 verbalized [redesigns], 15 were
// because of builders. What are we doing that we can do to reduce all
// these redesigns? Which builders are triggering a lot of redesigns?"
//
// fix-126 shipped the schema (redesign_of_project_id +
// redesign_trigger + redesign_reuses_original_permit +
// redesign_notes). This module makes the captured data queryable —
// trigger-source breakdown, builder leaderboard with rate, per-role
// associate leaderboards, and a recent-redesigns row list for the
// page table.
//
// REUSES REDESIGN_TRIGGER_LABELS from database.types.ts so the trigger
// labels displayed here cannot drift from the wizard / project
// overview labels.

export interface RedesignAnalyticsFilters {
  /** YYYY-MM-DD inclusive lower bound on redesign project's go_date.
   *  Null = no filter. */
  dateFrom: string | null;
  /** YYYY-MM-DD inclusive upper bound on redesign project's go_date. */
  dateTo: string | null;
  /** Project juris match (exact). Empty string = no filter. */
  juris: string;
}

export interface TriggerSourceEntry {
  /** Trigger enum value or the synthetic 'unknown' bucket for nulls. */
  trigger: RedesignTrigger | 'unknown';
  /** Display label resolved from REDESIGN_TRIGGER_LABELS (or
   *  "Unspecified" for the unknown bucket). */
  label: string;
  count: number;
}

export interface BuilderEntry {
  builderName: string;
  redesignCount: number;
  /** Builder's total projects in the window (originals + redesigns) —
   *  the denominator for redesignRate. */
  totalProjectCount: number;
  /** redesignCount / totalProjectCount, 0–1. Page renders this as % so
   *  the helper keeps it raw to avoid double-formatting. */
  redesignRate: number;
}

export interface AssociateRedesignEntry {
  name: string;
  role: 'da' | 'dm' | 'ent';
  redesignCount: number;
  redesignProjectIds: string[];
}

export interface RecentRedesign {
  redesignProjectId: string;
  redesignAddress: string;
  originalProjectId: string | null;
  originalAddress: string | null;
  trigger: RedesignTrigger | null;
  triggerLabel: string;
  reusesOriginalPermit: boolean | null;
  notes: string | null;
  builderName: string | null;
  /** ISO timestamp used for the most-recent-first sort. Falls back to
   *  the project's updated_at when created_at is absent. */
  createdAt: string;
}

export interface RedesignAnalyticsResult {
  totalRedesigns: number;
  reusePermitCount: number;
  /** reusePermitCount / totalRedesigns. Null when totalRedesigns = 0. */
  reusePermitRate: number | null;
  triggerBreakdown: TriggerSourceEntry[];
  builderLeaderboard: BuilderEntry[];
  daLeaderboard: AssociateRedesignEntry[];
  dmLeaderboard: AssociateRedesignEntry[];
  entLeaderboard: AssociateRedesignEntry[];
  recentRedesigns: RecentRedesign[];
}

const LEADERBOARD_CAP = 10;
const RECENT_REDESIGN_CAP = 25;

function inWindow(
  proj: Project,
  filters: RedesignAnalyticsFilters,
): boolean {
  if (filters.juris && proj.juris !== filters.juris) return false;
  if (filters.dateFrom || filters.dateTo) {
    const anchor = proj.go_date ?? null;
    if (!anchor) return false;
    if (filters.dateFrom && anchor < filters.dateFrom) return false;
    if (filters.dateTo && anchor > filters.dateTo) return false;
  }
  return true;
}

function triggerLabelFor(trigger: RedesignTrigger | null | undefined): string {
  if (!trigger) return 'Unspecified';
  return REDESIGN_TRIGGER_LABELS[trigger] ?? 'Unspecified';
}

/** fix-134: compute redesign analytics across the project + permit
 *  cohort. Pure — no DB calls. The Redesigns tab passes the same
 *  hooks-loaded arrays it already has.
 *
 *  Output structure mirrors the page sections:
 *    KPI row    → totalRedesigns + reusePermitRate (+ builders via
 *                  builderLeaderboard.length)
 *    Trigger    → triggerBreakdown (sorted by count desc)
 *    Builders   → builderLeaderboard (top 10, sorted by count then rate)
 *    DA/DM/ENT  → role leaderboards (top 10 each, sorted by count)
 *    Table      → recentRedesigns (top 25, sorted by createdAt desc) */
export function computeRedesignAnalytics(
  permits: PermitWithCycles[],
  projects: Project[],
  filters: RedesignAnalyticsFilters,
): RedesignAnalyticsResult {
  const projectsById = new Map<string, Project>();
  for (const p of projects) projectsById.set(p.id, p);

  // Step 1: identify redesigns in the window.
  const redesigns = projects.filter(
    (p) => !!p.redesign_of_project_id && inWindow(p, filters),
  );
  const redesignIds = new Set(redesigns.map((p) => p.id));

  // Step 2: KPI totals.
  const totalRedesigns = redesigns.length;
  const reusePermitCount = redesigns.filter(
    (p) => p.redesign_reuses_original_permit === true,
  ).length;
  const reusePermitRate =
    totalRedesigns === 0
      ? null
      : formatCompareNumber(reusePermitCount / totalRedesigns);

  // Step 3: trigger breakdown.
  const triggerCounts = new Map<RedesignTrigger | 'unknown', number>();
  for (const p of redesigns) {
    const key = (p.redesign_trigger ?? 'unknown') as RedesignTrigger | 'unknown';
    triggerCounts.set(key, (triggerCounts.get(key) ?? 0) + 1);
  }
  const triggerBreakdown: TriggerSourceEntry[] = [];
  for (const [trigger, count] of triggerCounts) {
    triggerBreakdown.push({
      trigger,
      label:
        trigger === 'unknown'
          ? 'Unspecified'
          : REDESIGN_TRIGGER_LABELS[trigger] ?? 'Unspecified',
      count,
    });
  }
  triggerBreakdown.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });

  // Step 4: builder leaderboard.
  // Denominator = builder's total projects in the window (originals +
  // redesigns) — answers "this builder's projects churn at N%."
  const builderRedesignCounts = new Map<string, number>();
  for (const p of redesigns) {
    const name = (p.builder_name ?? '').trim();
    if (!name) continue;
    builderRedesignCounts.set(name, (builderRedesignCounts.get(name) ?? 0) + 1);
  }
  const builderTotalCounts = new Map<string, number>();
  for (const p of projects) {
    if (!inWindow(p, filters)) continue;
    const name = (p.builder_name ?? '').trim();
    if (!name) continue;
    builderTotalCounts.set(name, (builderTotalCounts.get(name) ?? 0) + 1);
  }
  const builderLeaderboard: BuilderEntry[] = [];
  for (const [builderName, redesignCount] of builderRedesignCounts) {
    const total = builderTotalCounts.get(builderName) ?? redesignCount;
    builderLeaderboard.push({
      builderName,
      redesignCount,
      totalProjectCount: total,
      redesignRate: total === 0 ? 0 : redesignCount / total,
    });
  }
  builderLeaderboard.sort((a, b) => {
    if (a.redesignCount !== b.redesignCount) {
      return b.redesignCount - a.redesignCount;
    }
    if (a.redesignRate !== b.redesignRate) {
      return b.redesignRate - a.redesignRate;
    }
    return a.builderName.localeCompare(b.builderName);
  });
  const cappedBuilders = builderLeaderboard.slice(0, LEADERBOARD_CAP);

  // Step 5: associate leaderboards. Walk permits, pick the ones tied
  // to redesign projects in the window, then group their da/dm/ent_lead
  // names. Each role uses a separate map so a permit with all three
  // fields filled contributes to all three boards.
  const collect = (
    field: 'da' | 'dm' | 'ent_lead',
  ): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const permit of permits) {
      if (!redesignIds.has(permit.project_id)) continue;
      const name = (permit[field] ?? '').trim();
      if (!name) continue;
      const set = m.get(name) ?? new Set<string>();
      set.add(permit.project_id);
      m.set(name, set);
    }
    return m;
  };
  const buildLeaderboard = (
    field: 'da' | 'dm' | 'ent_lead',
    role: 'da' | 'dm' | 'ent',
  ): AssociateRedesignEntry[] => {
    const collected = collect(field);
    const entries: AssociateRedesignEntry[] = [];
    for (const [name, ids] of collected) {
      entries.push({
        name,
        role,
        redesignCount: ids.size,
        redesignProjectIds: Array.from(ids),
      });
    }
    entries.sort((a, b) => {
      if (a.redesignCount !== b.redesignCount) {
        return b.redesignCount - a.redesignCount;
      }
      return a.name.localeCompare(b.name);
    });
    return entries.slice(0, LEADERBOARD_CAP);
  };
  const daLeaderboard = buildLeaderboard('da', 'da');
  const dmLeaderboard = buildLeaderboard('dm', 'dm');
  const entLeaderboard = buildLeaderboard('ent_lead', 'ent');

  // Step 6: recent redesigns table. created_at falls back to updated_at
  // when missing (older fixtures may not carry created_at).
  const recentRedesigns: RecentRedesign[] = redesigns.map((p) => {
    const original = p.redesign_of_project_id
      ? projectsById.get(p.redesign_of_project_id) ?? null
      : null;
    return {
      redesignProjectId: p.id,
      redesignAddress: p.address,
      originalProjectId: original?.id ?? null,
      originalAddress: original?.address ?? null,
      trigger: p.redesign_trigger ?? null,
      triggerLabel: triggerLabelFor(p.redesign_trigger),
      reusesOriginalPermit: p.redesign_reuses_original_permit ?? null,
      notes: p.redesign_notes ?? null,
      builderName: p.builder_name ?? null,
      createdAt: p.created_at ?? p.updated_at ?? '',
    };
  });
  recentRedesigns.sort((a, b) => {
    if (a.createdAt === b.createdAt) {
      return a.redesignAddress.localeCompare(b.redesignAddress);
    }
    // Descending — most recent first. Empty strings sort to the bottom.
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return a.createdAt > b.createdAt ? -1 : 1;
  });
  const cappedRecent = recentRedesigns.slice(0, RECENT_REDESIGN_CAP);

  return {
    totalRedesigns,
    reusePermitCount,
    reusePermitRate,
    triggerBreakdown,
    builderLeaderboard: cappedBuilders,
    daLeaderboard,
    dmLeaderboard,
    entLeaderboard,
    recentRedesigns: cappedRecent,
  };
}
