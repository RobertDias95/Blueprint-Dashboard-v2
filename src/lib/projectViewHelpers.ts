import type {
  PermitCycleReviewer,
  PermitWithCycles,
  Project,
  Stage,
} from './database.types';
import { effectiveStage } from './permitStage';
import { multiMatchAddress } from './drawScheduleHelpers';
import {
  currentCycleIndex,
  rollupCounts,
  rowsForCycle,
} from './reviewerRollup';
import { isSubPermit } from './subPermit';

// fix-90: pure helpers for the Project View overhaul. The page composes
// projects + permits + reviewers into rows, applies multi-select filters
// (stage / ent / da / juris) plus free-text search, then sorts by one
// of six columns. Filter + sort state persist to localStorage so the
// Monday-triage workspace survives reloads.

export const STAGE_ORDER: ReadonlyArray<Stage> = ['de', 'pm', 'co', 'ap', 'is'];

// fix-105: STAGE_LABEL moved to src/lib/stageLabel.ts (single source of
// truth started by fix-104). Consumers that imported STAGE_LABEL from
// here now import from '../lib/stageLabel' directly — see ProjectList.

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
    /** fix-186: the permit's CURRENT cycle index (from permit_cycles), i.e. the
     *  cycle the counts came from. null when the permit has no cycles. */
    cycleIndex: number | null;
    /** fix-186: the current cycle has no reviewer rows yet but an earlier cycle
     *  does — the round hasn't been assigned. The cell shows "Cycle N — not yet
     *  assigned" instead of "no reviewers" (or a stale earlier cycle). */
    awaitingCurrentCycle: boolean;
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
  | 'target_submit'
  | 'ent_lead'
  | 'da'
  | 'permits';

export interface SortState {
  col: SortableColumn;
  asc: boolean;
}

export const DEFAULT_SORT: SortState = { col: 'address', asc: true };

/** fix-90 / fix-95: Reviewer rollup compressed to the four numbers the
 *  expansion row's cell renders. Keeps the page's render simple + means
 *  buildProjectRows owns the rollup math instead of the JSX.
 *
 *  fix-95: total now EXCLUDES not_required rows (those reviewers are
 *  "N/A" — they shouldn't count toward Bobby's "how many people still
 *  need to act" question). outstanding = inReview + pending stays
 *  algebraically equivalent to total − approved − corrections under the
 *  new total (rows.length − notRequired). */
function summarizeReviewers(
  permitId: number,
  reviewersByPermit: Map<number, PermitCycleReviewer[]>,
  permitStatus: string | null,
  permitType: string | null,
  // fix-186: the permit's cycles, so the rollup reads the CURRENT cycle's
  // reviewers (not the latest reviewer-ROW cycle, which can lag a cycle behind).
  cycles: ReadonlyArray<{ cycle_index: number }>,
): ProjectPermitRow['reviewer'] {
  const rows = reviewersByPermit.get(permitId) ?? [];
  const current = currentCycleIndex(cycles, rows);
  if (current === null) {
    return {
      total: 0,
      approved: 0,
      correctionsRequired: 0,
      outstanding: 0,
      cycleIndex: null,
      awaitingCurrentCycle: false,
    };
  }
  const visible = rowsForCycle(rows, current);
  if (visible.length === 0) {
    // fix-186: no reviewer rows on the current cycle. If the permit has rows on
    // an earlier cycle, the current round simply hasn't been assigned yet —
    // flag it so the cell reads "Cycle N — not yet assigned" rather than the
    // ambiguous "no reviewers" (which should mean "never had any").
    return {
      total: 0,
      approved: 0,
      correctionsRequired: 0,
      outstanding: 0,
      cycleIndex: current,
      awaitingCurrentCycle: rows.length > 0,
    };
  }
  const counts = rollupCounts(visible, permitStatus, permitType);
  const outstanding = counts.inReview + counts.pending;
  return {
    // fix-95: exclude not_required from the visible total. The shared
    // rollupCounts helper keeps its own contract (total = rows.length)
    // for ReviewerRollupChip + Schedule Health; the subtraction lives
    // here so Project View can answer Bobby's "who's left to act" math
    // without spilling into the shared component.
    total: counts.total - counts.notRequired,
    approved: counts.approved,
    correctionsRequired: counts.correctionsRequired,
    outstanding,
    cycleIndex: current,
    awaitingCurrentCycle: false,
  };
}

export function buildProjectRows(
  projects: Project[],
  permits: PermitWithCycles[],
  reviewers: PermitCycleReviewer[],
): ProjectRow[] {
  const permitsByProject = new Map<string, PermitWithCycles[]>();
  for (const p of permits) {
    // fix-194: exclude sub/child placeholder permits from the Project List
    // rollups (stage set, reviewer chips, DA/ENT sets, permit count).
    if (isSubPermit(p)) continue;
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
          permit.permit_cycles ?? [],
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
  /** fix-notes-2: project_id → concatenated active-note bodies (holistic +
   *  permit notes). Appended to the free-text search haystack so searching a
   *  note's text finds the project. Omit for note-agnostic filtering. */
  noteTextByProject?: Map<string, string>,
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
      // fix-notes-2: legacy project.notes is kept (now unwritten) AND the
      // active-note bodies from the notes table are appended, so both old and
      // new note text find the project.
      const noteHay = noteTextByProject?.get(r.project.id) ?? '';
      const haystack = `${r.project.address} ${tagHay} ${r.project.notes ?? ''} ${noteHay}`;
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

/** fix-142: the project's soonest upcoming Target Submit — min(target_submit)
 *  across its permits where target_submit IS NOT NULL, over ALL permit types
 *  (Bobby's "what's next on my plate", not just the BP). Returns null when the
 *  project has no permits or every permit's target_submit is null; the Target
 *  Submit column + sort treat that as "—" / NULLS-last. ISO date strings
 *  compare lexicographically = chronologically, so a plain `<` finds the min. */
export function minTargetSubmit(row: ProjectRow): string | null {
  let min: string | null = null;
  for (const { permit } of row.permits) {
    const ts = permit.target_submit;
    if (!ts) continue;
    if (min === null || ts < min) min = ts;
  }
  return min;
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
  if (col === 'target_submit') {
    // Per-project min(target_submit). NULLS (no permits or all-null) always
    // sort LAST, in BOTH directions — only the non-null pair flips with dir.
    // (The go_date column below uses a '￿' sentinel * dir, which lands nulls
    // first when descending; Target Submit pins them last so "soonest" and
    // "latest" both keep undated projects out of the way.) Two-null ties break
    // by address asc, deterministically. min is precomputed once per row so the
    // comparator stays O(1) — fine for Blueprint's hundreds-of-projects scale.
    const keyById = new Map<string, string | null>();
    for (const r of sorted) keyById.set(r.project.id, minTargetSubmit(r));
    sorted.sort((a, b) => {
      const ka = keyById.get(a.project.id) ?? null;
      const kb = keyById.get(b.project.id) ?? null;
      if (ka === null && kb === null) {
        return a.project.address.localeCompare(b.project.address);
      }
      if (ka === null) return 1;
      if (kb === null) return -1;
      return ka.localeCompare(kb) * dir;
    });
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
      'target_submit',
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
