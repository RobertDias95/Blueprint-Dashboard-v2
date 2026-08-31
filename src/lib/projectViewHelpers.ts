import type {
  Permit,
  PermitCycleReviewer,
  PermitWithCycles,
  Project,
  Stage,
} from './database.types';
import { effectiveStage } from './permitStage';
import { multiMatchAddress } from './drawScheduleHelpers';
import { structAddressHaystack } from './structAddressSearch';
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

/** fix-302: the DA multi-select's pseudo-option for "nobody is assigned".
 *
 *  `permits.da` is how work is routed, and the per-user notification centre
 *  routes on it — so a blank DA is not a cosmetic gap, it is work that reaches
 *  nobody. Before fix-302 the only way to find one was to write SQL: `das`
 *  collected non-empty names only, so an unassigned permit contributed nothing
 *  and the filter could not select it. Four bugs this year had this shape — a
 *  missing value looking identical to an absent one.
 *
 *  The em-dashes are load-bearing: this string sits in the same option list as
 *  roster names, and no person can be named "— Unassigned —", so the sentinel
 *  cannot collide with a real DA. */
export const UNASSIGNED_DA = '— Unassigned —';

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
  /** Distinct da values across the project's permits. fix-302: a project with
   *  at least one non-sub permit carrying NO da also gets {@link UNASSIGNED_DA},
   *  so "what has nobody on it" is answerable from the existing DA filter
   *  rather than from SQL. */
  das: Set<string>;
  /** fix-245: did the project have ANY permit (sub OR non-sub) before the
   *  sub-permit exclusion below? Distinguishes a permit-less shell (keep ACTIVE)
   *  from a project whose only permits are subs (hidden). See projectIsActive. */
  hasAnyPermit: boolean;
  /** fix-380: the struct_address text of ALL the project's permits (subs
   *  included — "a project matches when ANY of its permits' struct_address
   *  matches", and a structure can live on a sub-permit). '' when none.
   *  Searchable only, never displayed. Optional so older fixtures without it
   *  behave exactly as before. */
  structAddressHay?: string;
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
  // fix-245: track which projects have ANY permit (before excluding subs) so the
  // Active filter can tell a permit-less shell (active) from a sub-only project.
  const projectsWithAnyPermit = new Set<string>();
  // fix-380: struct-address search text per project, collected from ALL
  // permits (BEFORE the sub exclusion — a structure can live on a sub-permit,
  // and the semantic is "any of its permits' struct_address finds the project").
  const allPermitsByProject = new Map<string, PermitWithCycles[]>();
  for (const p of permits) {
    projectsWithAnyPermit.add(p.project_id);
    const all = allPermitsByProject.get(p.project_id) ?? [];
    all.push(p);
    allPermitsByProject.set(p.project_id, all);
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
      // fix-302: an ABSENT da is a value the filter has to be able to name.
      // Before this, `das` only ever collected non-empty names, so a permit
      // with no DA contributed nothing and the DA filter could not reach it —
      // the gap was invisible on the one screen built for triage. Sub-permits
      // cannot reach here (fix-194 drops them above), so every blank counted
      // is a real unrouted permit.
      if (permit.da) das.add(permit.da);
      else das.add(UNASSIGNED_DA);
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
      hasAnyPermit: projectsWithAnyPermit.has(project.id),
      structAddressHay: structAddressHaystack(
        allPermitsByProject.get(project.id),
      ),
    });
  }
  return rows;
}

// ---- fix-245: "Active" filter (hide fully-issued / done projects) ----

/** The permit statuses that mean a permit is DONE (issued or later) for the
 *  Active filter. Centralized here as the single source of truth. Deliberately
 *  NARROWER than effectiveStage's 'is' (which folds 'Approved' / 'Conceptually
 *  Approved' in) and than isEffectivelyIssued (which counts approved-not-issued
 *  as done): per Bobby, a permit that is Approved / Ready-to-Issue but NOT yet
 *  issued keeps its project ACTIVE. */
export const PROJECT_DONE_STATUSES: ReadonlySet<string> = new Set([
  'Issued',
  'Completed',
  'Finaled',
  'Closed',
  'Withdrawn',
]);

/** fix-245: is a single permit DONE (issued or later)?
 *   - physically issued (actual_issue set) — this also covers SDOT
 *     "Conceptually Approved" records, which all carry an issue date; OR
 *   - portal status is terminal-done (PROJECT_DONE_STATUSES).
 *  Callers pass NON-sub permits (buildProjectRows already excludes subs). */
export function isPermitDone(
  permit: Pick<Permit, 'actual_issue' | 'status'>,
): boolean {
  if (permit.actual_issue != null) return true;
  const s = (permit.status ?? '').trim();
  return s !== '' && PROJECT_DONE_STATUSES.has(s);
}

/** fix-264: THE cancelled rule, in one place.
 *
 *  fix-262 established that a cancelled project is no longer active, but it
 *  composed that rule into {@link projectIsActive} — a ProjectRow predicate only
 *  the Project List can reach. Every other live-work surface (Dashboard, My
 *  Tasks, the weekly reports) holds raw `Project`s / permit rows, so it would
 *  have had to re-implement "is this cancelled" locally. This is that rule,
 *  lifted out so there is exactly ONE definition and projectIsActive delegates
 *  to it rather than duplicating it.
 *
 *  The set always comes from `cancelledProjectIds(holds)` (hooks/useProjectHolds)
 *  — open cancel rows only. HOLDS are deliberately never in it: a held project is
 *  still active and stays on every surface. Omitted set → false (nothing hidden),
 *  so a caller that hasn't loaded holds yet renders pre-fix-262 behaviour rather
 *  than flickering rows away. */
export function isCancelledProject(
  // ★ fix-460: nullable because a TEAM TASK has no project. A task that
  //   belongs to no project cannot be on a cancelled one — answering `false`
  //   is the correct answer, not a fallback.
  projectId: string | null | undefined,
  cancelledIds?: ReadonlySet<string>,
): boolean {
  if (!projectId) return false;
  return cancelledIds?.has(projectId) ?? false;
}

/** fix-264: drop cancelled projects from a list of anything project-keyed.
 *
 *  Works on `Project[]` (keyed by `id`) and on permit/task/report rows (keyed by
 *  `project_id`) — the live-work surfaces hold one shape or the other, and both
 *  route through {@link isCancelledProject}. Returns the SAME array reference
 *  when nothing is cancelled, so the no-holds common case adds no re-render. */
export function excludeCancelled<T extends { id: string } | { project_id: string }>(
  rows: T[],
  cancelledIds?: ReadonlySet<string>,
): T[] {
  if (!cancelledIds || cancelledIds.size === 0) return rows;
  return rows.filter(
    (r) =>
      !isCancelledProject(
        'project_id' in r ? r.project_id : r.id,
        cancelledIds,
      ),
  );
}

/** fix-245: is the project ACTIVE (kept visible when the Active toggle is on)?
 *  ACTIVE iff the project has NO permits at all (a fresh / redesign shell — keep
 *  it visible) OR at least one of its non-sub permits is not yet done. A project
 *  whose only permits are sub-permits (row.permits empty but hasAnyPermit true),
 *  or whose every non-sub permit is done, is NOT active (hidden). row.permits
 *  already excludes sub-permits (fix-194). */
export function projectIsActive(
  row: ProjectRow,
  /** fix-262: project ids with an OPEN cancel row. A CANCELLED project is not
   *  active — Bobby: "A hold is still an ACTIVE project. A cancelled project is
   *  no longer active." This composes with (and short-circuits) the fix-245
   *  permit-done rules: a cancelled project is inactive even if every one of its
   *  permits is still open, and a permit-less cancelled shell is inactive too.
   *  A project on HOLD is deliberately NOT passed here — a hold is still active.
   *  Omitted → pre-fix-262 behaviour exactly. fix-264: the cancelled half is now
   *  {@link isCancelledProject}, shared with every other live-work surface. */
  cancelledIds?: ReadonlySet<string>,
): boolean {
  if (isCancelledProject(row.project.id, cancelledIds)) return false;
  if (!row.hasAnyPermit) return true;
  return row.permits.some((p) => !isPermitDone(p.permit));
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
      // fix-380: the permits' struct_address joins the haystack — a structure
      // address finds the PROJECT's row.
      const haystack = `${r.project.address} ${tagHay} ${r.project.notes ?? ''} ${noteHay} ${r.structAddressHay ?? ''}`;
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
