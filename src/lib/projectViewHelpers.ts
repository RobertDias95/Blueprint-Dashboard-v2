import type {
  PermitCycleReviewer,
  PermitWithCycles,
  Project,
  Stage,
} from './database.types';
import { effectiveStage } from './permitStage';
import { multiMatchAddress } from './drawScheduleHelpers';
import {
  latestCycleIndex,
  rollupCounts,
  rowsForCycle,
} from './reviewerRollup';

// fix-90: pure helpers for the Project View overhaul. The page composes
// projects + permits + reviewers into rows, applies multi-select filters
// (stage / ent / da / juris) plus free-text search, then sorts by one
// of six columns. Filter + sort state persist to localStorage so the
// Monday-triage workspace survives reloads.

export const STAGE_ORDER: ReadonlyArray<Stage> = ['de', 'pm', 'co', 'ap', 'is'];

export const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

export const STAGE_BADGE: Record<Stage, string> = {
  de: 'bg-de-bg text-de border-de-border',
  pm: 'bg-pm-bg text-pm border-pm-border',
  co: 'bg-co-bg text-co border-co-border',
  ap: 'bg-jv-bg text-jv border-jv-border',
  is: 'bg-is-bg text-is border-is-border',
};

/** One permit on a project, with its effective stage + (optional) latest-
 * cycle reviewer rollup counts pre-computed for the expansion render. */
export interface ProjectPermitRow {
  permit: PermitWithCycles;
  stage: Stage;
  reviewer: {
    total: number;
    approved: number;
    correctionsRequired: number;
    outstanding: number;
    /** Cycle index the counts came from; null when no reviewer rows for
     *  this permit (caller renders fallback). */
    cycleIndex: number | null;
  };
}

/** One row in the Project View table. The page filters + sorts on these. */
export interface ProjectRow {
  project: Project;
  permits: ProjectPermitRow[];
  /** First Building Permit by id (the anchor read by the Ent Lead / DA
   *  columns in the table). null when no BP exists. */
  bpAnchor: PermitWithCycles | null;
  /** Effective stages present across the project's permits — drives the
   *  stage multi-select filter. */
  stages: Set<Stage>;
  /** Distinct ent_lead values across the project's permits (excluding
   *  null/empty). Drives the ent multi-select. */
  entLeads: Set<string>;
  /** Distinct da values across the project's permits. */
  das: Set<string>;
}

export interface ProjectViewFilters {
  search: string;
  /** Selected effective stages. Empty = no filter. */
  stages: Stage[];
  /** Selected ent_lead names. Empty = no filter. */
  entLeads: string[];
  /** Selected da names. Empty = no filter. */
  das: string[];
  /** Selected jurisdictions. Empty = no filter. */
  jurises: string[];
}

export const DEFAULT_FILTERS: ProjectViewFilters = {
  search: '',
  stages: [],
  entLeads: [],
  das: [],
  jurises: [],
};

export type SortableColumn =
  | 'address'
  | 'juris'
  | 'go_date'
  | 'ent_lead'
  | 'da'
  | 'permits';

export interface SortState {
  col: SortableColumn;
  asc: boolean;
}

export const DEFAULT_SORT: SortState = { col: 'address', asc: true };

/** fix-90: Reviewer rollup compressed to the four numbers the expansion
 *  row actually renders. Keeps the page's render simple + means
 *  buildProjectRows owns the rollup math instead of the JSX. */
function summarizeReviewers(
  permitId: number,
  reviewersByPermit: Map<number, PermitCycleReviewer[]>,
  permitStatus: string | null,
  permitType: string | null,
): ProjectPermitRow['reviewer'] {
  const rows = reviewersByPermit.get(permitId) ?? [];
  const latest = latestCycleIndex(rows);
  if (latest === null) {
    return {
      total: 0,
      approved: 0,
      correctionsRequired: 0,
      outstanding: 0,
      cycleIndex: null,
    };
  }
  const visible = rowsForCycle(rows, latest);
  const counts = rollupCounts(visible, permitStatus, permitType);
  const outstanding = counts.inReview + counts.pending;
  return {
    total: counts.total,
    approved: counts.approved,
    correctionsRequired: counts.correctionsRequired,
    outstanding,
    cycleIndex: latest,
  };
}

export function buildProjectRows(
  projects: Project[],
  permits: PermitWithCycles[],
  reviewers: PermitCycleReviewer[],
): ProjectRow[] {
  const permitsByProject = new Map<string, PermitWithCycles[]>();
  for (const p of permits) {
    const list = permitsByProject.get(p.project_id) ?? [];
    list.push(p);
    permitsByProject.set(p.project_id, list);
  }
  const reviewersByPermit = new Map<number, PermitCycleReviewer[]>();
  for (const r of reviewers) {
    const list = reviewersByPermit.get(r.permit_id) ?? [];
    list.push(r);
    reviewersByPermit.set(r.permit_id, list);
  }

  const rows: ProjectRow[] = [];
  for (const project of projects) {
    if (project.archived) continue;
    const projPermits = permitsByProject.get(project.id) ?? [];
    // Sort permits inside a project by id ASC so the BP anchor (the first
    // one by id) is stable, mirroring fix-85's "first BP wins" rule.
    const sortedPermits = [...projPermits].sort((a, b) => a.id - b.id);

    const stages = new Set<Stage>();
    const entLeads = new Set<string>();
    const das = new Set<string>();
    const permitRows: ProjectPermitRow[] = sortedPermits.map((permit) => {
      const stage = effectiveStage(
        permit,
        permit.permit_cycles ?? [],
        reviewersByPermit.get(permit.id),
      );
      stages.add(stage);
      if (permit.ent_lead) entLeads.add(permit.ent_lead);
      if (permit.da) das.add(permit.da);
      return {
        permit,
        stage,
        reviewer: summarizeReviewers(
          permit.id,
          reviewersByPermit,
          permit.status,
          permit.type,
        ),
      };
    });

    const bpAnchor =
      sortedPermits.find((p) => p.type === 'Building Permit') ?? null;

    rows.push({
      project,
      permits: permitRows,
      bpAnchor,
      stages,
      entLeads,
      das,
    });
  }
  return rows;
}

export function filterProjectRows(
  rows: ProjectRow[],
  filters: ProjectViewFilters,
): ProjectRow[] {
  const searchQ = filters.search.trim();
  const stageSet = new Set(filters.stages);
  const entSet = new Set(filters.entLeads);
  const daSet = new Set(filters.das);
  const jurisSet = new Set(filters.jurises);
  return rows.filter((r) => {
    if (jurisSet.size > 0 && !jurisSet.has(r.project.juris ?? '')) return false;
    if (stageSet.size > 0) {
      let hit = false;
      for (const s of r.stages) if (stageSet.has(s)) { hit = true; break; }
      if (!hit) return false;
    }
    if (entSet.size > 0) {
      let hit = false;
      for (const e of r.entLeads) if (entSet.has(e)) { hit = true; break; }
      if (!hit) return false;
    }
    if (daSet.size > 0) {
      let hit = false;
      for (const d of r.das) if (daSet.has(d)) { hit = true; break; }
      if (!hit) return false;
    }
    if (searchQ) {
      const tagHay = (r.project.project_tags ?? []).join(' ');
      const haystack = `${r.project.address} ${tagHay} ${r.project.notes ?? ''}`;
      if (!multiMatchAddress(searchQ, haystack)) return false;
    }
    return true;
  });
}

const STAGE_RANK: Record<Stage, number> = {
  de: 0,
  pm: 1,
  co: 2,
  ap: 3,
  is: 4,
};

/** "Worst" (most advanced) stage on the project — drives the optional
 *  stage column sort if we ever surface one. Kept here for parity with
 *  LibraryMatrix's worstStage. */
function worstStage(row: ProjectRow): Stage {
  let best: Stage = 'de';
  for (const s of row.stages) {
    if ((STAGE_RANK[s] ?? 0) > (STAGE_RANK[best] ?? 0)) best = s;
  }
  return best;
}

export function sortProjectRows(
  rows: ProjectRow[],
  state: SortState,
): ProjectRow[] {
  const dir = state.asc ? 1 : -1;
  const sorted = [...rows];
  const col = state.col;
  if (col === 'permits') {
    sorted.sort((a, b) => (a.permits.length - b.permits.length) * dir);
    return sorted;
  }
  if (col === 'go_date') {
    sorted.sort((a, b) => {
      // null go_date sorts after real dates regardless of direction so
      // a "fresh" project doesn't claim the head of the list. Use the
      // '￿' sentinel + the dir multiplier.
      const ka = a.project.go_date ?? '￿';
      const kb = b.project.go_date ?? '￿';
      return ka.localeCompare(kb) * dir;
    });
    return sorted;
  }
  if (col === 'address') {
    sorted.sort((a, b) => a.project.address.localeCompare(b.project.address) * dir);
    return sorted;
  }
  if (col === 'juris') {
    sorted.sort((a, b) =>
      (a.project.juris ?? '').localeCompare(b.project.juris ?? '') * dir,
    );
    return sorted;
  }
  if (col === 'ent_lead') {
    sorted.sort((a, b) =>
      (a.bpAnchor?.ent_lead ?? '').localeCompare(b.bpAnchor?.ent_lead ?? '') * dir,
    );
    return sorted;
  }
  if (col === 'da') {
    sorted.sort((a, b) =>
      (a.bpAnchor?.da ?? '').localeCompare(b.bpAnchor?.da ?? '') * dir,
    );
    return sorted;
  }
  // Fallback — keeps TS exhaustive.
  void worstStage;
  return sorted;
}

// ---- localStorage persistence ----

const FILTER_STORAGE_KEY = 'projectView.filters.v1';
const SORT_STORAGE_KEY = 'projectView.sort.v1';

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

function isStageArray(x: unknown): x is Stage[] {
  if (!Array.isArray(x)) return false;
  return x.every((v) => STAGE_ORDER.includes(v as Stage));
}

export function loadFilters(): ProjectViewFilters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<ProjectViewFilters>;
    return {
      search: typeof parsed.search === 'string' ? parsed.search : '',
      stages: isStageArray(parsed.stages) ? parsed.stages : [],
      entLeads: isStringArray(parsed.entLeads) ? parsed.entLeads : [],
      das: isStringArray(parsed.das) ? parsed.das : [],
      jurises: isStringArray(parsed.jurises) ? parsed.jurises : [],
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(filters: ProjectViewFilters): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // localStorage full / disabled. Persistence is nice-to-have; don't
    // throw on the UI thread.
  }
}

export function loadSort(): SortState {
  if (typeof window === 'undefined') return DEFAULT_SORT;
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as Partial<SortState>;
    const cols: SortableColumn[] = [
      'address',
      'juris',
      'go_date',
      'ent_lead',
      'da',
      'permits',
    ];
    const col =
      typeof parsed.col === 'string' && cols.includes(parsed.col as SortableColumn)
        ? (parsed.col as SortableColumn)
        : DEFAULT_SORT.col;
    const asc = typeof parsed.asc === 'boolean' ? parsed.asc : DEFAULT_SORT.asc;
    return { col, asc };
  } catch {
    return DEFAULT_SORT;
  }
}

export function saveSort(sort: SortState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // Same as filters — silent.
  }
}
