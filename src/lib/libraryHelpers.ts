import type {
  ParkingKind,
  PermitWithCycles,
  Project,
  Stage,
  UnitType,
} from './database.types';
import { effectiveStage } from './permitStage';
import { multiMatchAddress } from './drawScheduleHelpers';
import { parseUnitTypes } from './unitTypeNaming';
import { structAddressHaystack } from './structAddressSearch';
import {
  matchParkingKind,
  matchRoofDeck,
  matchStallsTier,
  type RoofDeckFilter,
  type StallsTier,
} from './unitParking';
import {
  isNoWorkUnit,
  matchWorkScope,
  type WorkScopeFilter,
} from './unitWorkScope';

// Q6.3.a: pure helpers for the Library matrix view (Settings → Library tab).
// Mirrors v1's renderMatrix (index.html lines 5680-5778). The matrix shows
// one row per project, surfacing lot/unit dim data for the "match new lot
// against past projects" workflow. Filters use a min/max + buffer tolerance
// (matchRange) ported from v1 line 5709.

/** One row of the Library matrix, derived from a project + its permits. */
export interface LibraryRow {
  projectId: string;
  address: string;
  juris: string;
  /** fix-91: was `productType: string`, now an array. A site can carry
   *  multiple product types (SFR + Attached Units + Cottages). The
   *  filter (also multi-select) matches any-of. */
  productTypes: string[];
  units: number;
  zone: string;
  lotWidth: number;
  lotDepth: number;
  alley: string;
  tags: string[];
  stage: Stage;
  /** fix-81: per-structure dims from projects.unit_types. Powers the
   * per-row caret expansion + the unit-width / unit-depth filters. */
  unitTypes: UnitType[];
  /** fix-122: distinct-lots count, null when not entered.
   *
   *  ★★ fix-406: NO LONGER RENDERED OR SORTED ANYWHERE. The filter went in
   *  fix-402 and the column and sort in fix-406, both by Bobby's ruling. The
   *  field is kept populated because it is the project's own datum and every
   *  other surface that shows lots (`projects.num_lots` in the wizard, the
   *  Project Overview header, the redesign modal, corrections segments,
   *  team-volume) is untouched — and because restoring the column, if he asks,
   *  is then one `<Th>` rather than a re-plumb of the row builder. Flagged
   *  rather than assumed: if it should go, it goes in one line. */
  numLots: number | null;
  /** fix-122: corner-lot flag. null = "not answered". Surfaced as a
   *  Library column + Any/Yes/No filter. */
  isCornerLot: boolean | null;
  /** ★ fix-410: regular-shape flag. null = "not answered" — a distinct third
   *  state the filter can select for, never folded into No. A SITE field
   *  (fix-406's teal group), like every other fact about the lot itself. */
  isRegularShape: boolean | null;
  /** fix-206: the project's OCC token (projects.updated_at). The Library unit
   *  table is now editable and writes via the SAME useUpdateProject path as
   *  Project Overview; this carries the expectedUpdatedAt for that write. Null
   *  when the project row predates the OCC trigger (then editing is disabled,
   *  mirroring Project Overview's occMissing gate). */
  updatedAt: string | null;
  /** fix-380: the struct_address text of the project's permits ('' when none)
   *  — searchable, never displayed. Bobby: "Maybe I don't know the project by
   *  the project address, but I know it by the structure address." Optional so
   *  older fixtures without it behave exactly as before. */
  structAddressHay?: string;
}

/** Q6.3.a-fix: target ± buffer filter. "50 ± 5" matches every value in
 * [45, 55] inclusive. Replaces v1's min/max+buf asymmetric range — the
 * team thinks about lot sizing as "find me similar lots near 50ft", not
 * as "lots between X and Y." Null target → no filter; falsy val with an
 * active filter → fails (filter requires the row to have data). */
export function matchTargetWithBuffer(
  val: number | null | undefined,
  target: number | null,
  bufWidth: number,
): boolean {
  if (target === null) return true;
  if (!val) return false;
  return Math.abs(val - target) <= (bufWidth || 0);
}

/** Pick one permit per project for matrix dim fields. Prefer the project's
 * Building Permit (drives the schedule + carries the dims in Bobby's
 * workflow). Fall back to the first permit so the project still renders if
 * BP data is missing. */
export function pickBpForProject(
  projectPermits: PermitWithCycles[],
): PermitWithCycles | null {
  if (projectPermits.length === 0) return null;
  const bp = projectPermits.find((p) => p.type === 'Building Permit');
  return bp ?? projectPermits[0];
}

/** Worst (latest-stage) of a project's permits. Used by the matrix Stage
 * column. v1's render does the same rollup (line 5690-5695). */
const STAGE_ORDER: Record<Stage, number> = {
  de: 0,
  pm: 1,
  co: 2,
  ap: 3,
  is: 4,
};
export function worstStage(projectPermits: PermitWithCycles[]): Stage {
  let best: Stage = 'de';
  for (const p of projectPermits) {
    const s = effectiveStage(p, p.permit_cycles ?? []) as Stage;
    if ((STAGE_ORDER[s] ?? 0) > (STAGE_ORDER[best] ?? 0)) best = s;
  }
  return best;
}

/** Safely coerce a permit's project_tags (typed `unknown`) into string[]. */
export function extractTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}

/** Build the full matrix row set from projects + permits. Projects with no
 * permits at all are skipped (the matrix is permit-data-driven). */
export function buildLibraryRows(
  projects: Project[],
  permits: PermitWithCycles[],
): LibraryRow[] {
  const permitsByProject = new Map<string, PermitWithCycles[]>();
  for (const p of permits) {
    const list = permitsByProject.get(p.project_id) ?? [];
    list.push(p);
    permitsByProject.set(p.project_id, list);
  }

  const rows: LibraryRow[] = [];
  for (const proj of projects) {
    if (proj.archived) continue;
    const projectPermits = permitsByProject.get(proj.id) ?? [];
    if (projectPermits.length === 0) continue;
    // fix-22 Migration 3 read-surface sweep: matrix rows source the physical
    // fields directly from the project now (they moved off permits.*).
    // BP is still used for the worst-stage rollup below.
    rows.push({
      projectId: proj.id,
      address: proj.address,
      juris: proj.juris ?? '',
      productTypes: Array.isArray(proj.product_types) ? proj.product_types : [],
      units: proj.units ?? 0,
      zone: proj.zone ?? '',
      lotWidth: proj.lot_width ?? 0,
      lotDepth: proj.lot_depth ?? 0,
      alley: proj.alley ?? '',
      tags: Array.isArray(proj.project_tags) ? proj.project_tags : [],
      stage: worstStage(projectPermits),
      // fix-206: parse into the canonical UnitType[] (shared with the Project
      // Overview editor) so the now-editable Library table reads + writes the
      // identical shape.
      unitTypes: parseUnitTypes(proj.unit_types),
      numLots: proj.num_lots ?? null,
      isCornerLot:
        typeof proj.is_corner_lot === 'boolean' ? proj.is_corner_lot : null,
      // ★ fix-410: `typeof === 'boolean'`, not a truthiness check — an
      //   undefined column (the useProjects select-list trap) and a recorded
      //   `false` must not collapse into the same answer.
      isRegularShape:
        typeof proj.is_regular_shape === 'boolean'
          ? proj.is_regular_shape
          : null,
      updatedAt: proj.updated_at ?? null,
      structAddressHay: structAddressHaystack(projectPermits),
    });
  }
  return rows;
}

/** ★★★ fix-447 (P-055) — WHICH SHAPE OF ANSWER THE TABLE GIVES BACK.
 *
 *  Bobby, 2026-08-26: *"the pills should switch the view. Click SITE and it
 *  highlights, and the results below reformat to address + site information.
 *  Click UNIT and the same table reformats to address + unit information. The
 *  metric you are searching by decides the columns you get back."*
 *
 *  ★★ It is NOT a filter — it changes the COLUMNS, never which rows match.
 *  Both filter cards stay live in both views and the conjunction across them
 *  (fix-402) is untouched; switching view can never drop a row that a filter
 *  was letting through. It rides in `LibraryFilters` because that is the blob
 *  fix-403 already persists per user, which is what ruling 4 of 2026-08-29
 *  asks for ("the Library OPENS ON SITE, and the choice is remembered per
 *  person") — but see `clearFilters`, which deliberately does NOT reset it. */
export type LibraryView = 'site' | 'unit';

export interface LibraryFilters {
  /** ★ fix-447: 'site' | 'unit'. Default and fallback both 'site'. */
  view: LibraryView;
  search: string;
  lotwTarget: number | null;
  lotwBuf: number;
  lotdTarget: number | null;
  lotdBuf: number;
  /** fix-81: filter by structure (unit_type) width/depth. A project matches
   * when at least one of its unit_types lands inside the target ± buf
   * window. Projects with no unit_types don't match when either unit
   * filter is active. */
  unitwTarget: number | null;
  unitwBuf: number;
  unitdTarget: number | null;
  unitdBuf: number;
  zone: string;
  alley: string;
  /** fix-91: multi-select. Project matches when its product_types[]
   *  intersects this list (any-of). Empty array = no filter. */
  productTypes: string[];
  tag: string;
  juris: string;
  /** ★★★ fix-402 — THE LOTS FILTER IS REMOVED, BY RULING. Bobby, 2026-08-25:
   *  *"we dont need it as a filtering option for this screen"*.
   *
   *  ★★★ fix-406 THEN TOOK THE COLUMN AND THE SORT. Bobby, 2026-08-26: *"we
   *  can remove lots from the vertical bar below for the sort column as it
   *  isnt really relevant here."* fix-402's note here read "THE LOTS COLUMN
   *  STAYS — he removed the FILTER, not the data", which was right on the
   *  evidence it had; it is SUPERSEDED, NOT MISTAKEN, and both rulings stay
   *  visible (fix-400's rule).
   *
   *  ★ fix-122's other half (the corner-lot filter) is untouched and lives on
   *  the SITE card. Recorded here rather than silently deleted so the next
   *  reader finds a ruling instead of a gap (the fix-326 pattern). */

  // ★★★ fix-402 — THE UNIT CARD'S THREE NEW FILTERS.
  /** '' = Any. A picked kind requires that RECORDED kind on a unit. */
  parkingKind: '' | ParkingKind;
  /** '' = Any · '1+' · '2+' stalls on a unit. */
  stalls: StallsTier;
  /** '' = Any · Yes · No, tri-state like fix-122's corner. */
  roofDeck: RoofDeckFilter;
  /** ★★★ fix-412 Scope B4: the work-scope filter.
   *
   *  '' = Any · 'performed' · 'none' · 'unanswered'.
   *
   *  ★★ `''` IS NOT "SHOW EVERYTHING" — it excludes a CONFIRMED no-work unit,
   *  which is Bobby's ruling: such a unit has no drawn detail worth filtering
   *  on. A not-yet-answered unit is NOT excluded, or the field would hide
   *  exactly the units somebody needs to chase. See lib/unitWorkScope for why a
   *  hidden default exclusion is honest here (because it is askable). */
  workScope: WorkScopeFilter;
  /** fix-122: tri-state Corner Lot filter. '' = no filter (Any);
   *  'Yes' = only is_corner_lot === true; 'No' = only false.
   *  Rows with NULL is_corner_lot fall out under Yes/No (no implicit
   *  default — they're literally unanswered). */
  isCornerLot: '' | 'Yes' | 'No';
  /** ★★ fix-410: the regular-shape filter, and it has FOUR states where corner
   *  has three.
   *
   *  '' = Any · 'Regular' = true · 'Irregular' = false · 'Not set' = null.
   *
   *  ★ "Not set" is selectable, unlike on Corner, where a NULL can only ever
   *  fall out of Yes/No. Bobby's default means the null population should be
   *  empty in practice; making it FINDABLE is how anybody notices when it is
   *  not — a state you cannot filter for is a state you cannot audit. */
  isRegularShape: '' | 'Regular' | 'Irregular' | 'Not set';
  /** fix-205: Stories tier filter on a project's unit_types. '' = no filter;
   *  '1'/'2'/'3' = at least one unit_type has exactly that many stories;
   *  '4+' = at least one has 4 or more. Like the unit width/depth filters it
   *  acts on the unit_types rows (and highlights the matching ones); rows
   *  whose units have no stories fall out when a tier is picked. */
  stories: '' | '1' | '2' | '3' | '4+';
}

/** fix-205: does a unit-type's `stories` satisfy the picked tier? Empty tier
 *  matches everything; a picked tier requires a non-null stories that equals it
 *  ('1'–'3') or is ≥ 4 ('4+'). */
export function matchStoriesTier(
  stories: number | null | undefined,
  tier: LibraryFilters['stories'],
): boolean {
  if (tier === '') return true;
  if (stories == null) return false;
  if (tier === '4+') return stories >= 4;
  return stories === Number(tier);
}

/** fix-81: indices of unit_types on `row` that satisfy BOTH active unit
 * filters. Returns all indices when neither filter is active. Drives row
 * filtering AND the "highlight matching unit row" visual treatment. */
export function matchingUnitIndices(
  row: LibraryRow,
  filters: LibraryFilters,
): number[] {
  // fix-205: stories joins width/depth as a per-unit filter dimension.
  // fix-402: and so do parking kind, stalls and roof deck.
  if (!hasAnyUnitFilter(filters)) {
    return row.unitTypes.map((_, i) => i);
  }
  const out: number[] = [];
  for (let i = 0; i < row.unitTypes.length; i++) {
    const u = row.unitTypes[i];
    // ★★★ fix-402 — THE CONJUNCTION IS PER UNIT, AND THAT IS THE RULING.
    //
    // A project qualifies when AT LEAST ONE unit satisfies ALL the active unit
    // filters TOGETHER — not when each filter finds some unit somewhere.
    //
    // ★★ The difference is the whole point: a project with unit A (garage, no
    // deck) and unit B (surface, deck) must NOT match "garage AND roof deck".
    // Under a per-filter reading it would, and the reader would open it to find
    // no such unit exists. Every condition below is ANDed on the SAME `u`.
    if (
      matchTargetWithBuffer(u.width_ft, filters.unitwTarget, filters.unitwBuf) &&
      matchTargetWithBuffer(u.depth_ft, filters.unitdTarget, filters.unitdBuf) &&
      matchStoriesTier(u.stories, filters.stories) &&
      matchParkingKind(u.parking_kind, filters.parkingKind) &&
      matchStallsTier(u.parking_stalls, filters.stalls) &&
      matchRoofDeck(u.roof_deck, filters.roofDeck) &&
      // ★★★ fix-412: ANDed onto the SAME unit like every other condition here,
      //   so "garage AND work performed" means one unit with both — the fix-402
      //   per-unit conjunction, extended rather than worked around.
      matchWorkScope(u.work_scope, filters.workScope)
    ) {
      out.push(i);
    }
  }
  return out;
}

/** ★ Is any UNIT-card filter active? One definition, used by both the index
 *  helper and the row filter — they drifted apart once already when fix-205
 *  added stories to one list and the other had to be chased. */
export function hasAnyUnitFilter(filters: LibraryFilters): boolean {
  return (
    filters.unitwTarget !== null ||
    filters.unitdTarget !== null ||
    filters.stories !== '' ||
    filters.parkingKind !== '' ||
    filters.stalls !== '' ||
    filters.roofDeck !== '' ||
    // ★★★ fix-412: WITHOUT THIS LINE THE FILTER IS INERT. `hasAnyUnitFilter`
    //   gates whether `matchingUnitIndices` is consulted at all, so a workScope
    //   pick that is not listed here would narrow nothing — the exact defect
    //   this function's own comment records fix-205 causing with `stories`.
    filters.workScope !== ''
  );
}

// ===========================================================================
// ★★★ fix-469 §2 (P-122) — EACH CARD CLEARS ITSELF
// ===========================================================================
//
// Bobby, 2026-09-01: *"can we add a clear button to the search filters of
// units/site?"*
//
// ★★ THE CARDS WERE SEPARATED FOR EXACTLY THIS REASON. fix-447 split SITE from
// UNIT because *"the metric you are searching by decides the columns you get
// back"* — two independent questions. The single toolbar Clear is a leftover
// from when there was one card, and keeping a lot search while dropping the
// unit dimensions meant blanking up to nine controls by hand.
//
// ★★★ THESE TWO LISTS LIVE HERE, BESIDE `LibraryFilters`, AND NOT IN THE
// COMPONENT. Two reasons, and the second is the one that matters:
//   1. `react-refresh/only-export-components` is an ERROR in this repo, so a
//      component file cannot export them.
//   2. ★★ A NEW FILTER FIELD MUST FORCE THE QUESTION "WHICH CARD?". Declared
//      next to the interface, adding a field and not listing it is visible
//      here rather than three hundred lines away — and `libraryFilterKeyCoverage`
//      below turns that into a test failure rather than a filter that silently
//      cannot be cleared.
//
// ★ `view` and `search` are in NEITHER list, deliberately:
//   · `view` IS NOT A FILTER (fix-447). It changes the columns you get back,
//     never which rows match, and clearing a search must never move somebody to
//     a different table.
//   · `search` is the free-text box above both cards and belongs to neither, so
//     only the global Clear owns it.
export const SITE_FILTER_KEYS = [
  'lotwTarget',
  'lotwBuf',
  'lotdTarget',
  'lotdBuf',
  'zone',
  'juris',
  'alley',
  'isCornerLot',
  'isRegularShape',
  'tag',
] as const satisfies readonly (keyof LibraryFilters)[];

export const UNIT_FILTER_KEYS = [
  'unitwTarget',
  'unitwBuf',
  'unitdTarget',
  'unitdBuf',
  'parkingKind',
  'stalls',
  'roofDeck',
  'stories',
  'workScope',
  // ★ Product type sits in the UNIT card on screen (it describes the building,
  //   not the lot), so it clears with the UNIT card. Read off the rendered
  //   card boundaries, not guessed: the SITE card is one JSX block and the
  //   UNIT card is the next, and this control is in the second.
  'productTypes',
] as const satisfies readonly (keyof LibraryFilters)[];

/**
 * ★★★ THE PARTITION, AS A VALUE A TEST CAN CHECK. Every key of `LibraryFilters`
 * belongs to exactly one of: the SITE card, the UNIT card, or the two that
 * belong to neither. Add a filter and forget to file it, and the coverage test
 * fails naming the key — instead of shipping a control that no Clear can reach.
 */
export function libraryFilterKeyCoverage(initial: LibraryFilters): {
  unfiled: string[];
  duplicated: string[];
} {
  const site = new Set<string>(SITE_FILTER_KEYS);
  const unit = new Set<string>(UNIT_FILTER_KEYS);
  const neither = new Set<string>(['view', 'search']);
  const unfiled: string[] = [];
  const duplicated: string[] = [];
  for (const key of Object.keys(initial)) {
    const hits =
      (site.has(key) ? 1 : 0) + (unit.has(key) ? 1 : 0) + (neither.has(key) ? 1 : 0);
    if (hits === 0) unfiled.push(key);
    if (hits > 1) duplicated.push(key);
  }
  return { unfiled, duplicated };
}

/**
 * Does this card hold anything worth clearing?
 *
 * ★★ COMPARED AGAINST `initial`, NOT AGAINST EMPTINESS, and the buffers are
 * why: `lotwBuf` and its three siblings default to **2**, not to null. A card
 * whose buffer somebody moved to 5 is a card holding a value, and a test for
 * "is it blank" would call it empty and hide the Clear that would restore it.
 */
export function cardHasValue(
  filters: LibraryFilters,
  keys: readonly (keyof LibraryFilters)[],
  initial: LibraryFilters,
): boolean {
  return keys.some((k) => {
    const now = filters[k];
    const base = initial[k];
    if (Array.isArray(now) && Array.isArray(base)) return now.length !== base.length;
    return now !== base;
  });
}

/** Reset only this card's fields. Everything else — the other card, the search
 *  box, and above all `view` — is carried through untouched. */
export function clearCardFilters(
  filters: LibraryFilters,
  keys: readonly (keyof LibraryFilters)[],
  initial: LibraryFilters,
): LibraryFilters {
  const next = { ...filters };
  for (const k of keys) {
    // ★ A fresh copy for the array-valued field, so the cleared object can
    //   never share `productTypes` with the object it replaced.
    (next as Record<string, unknown>)[k] = Array.isArray(initial[k])
      ? [...(initial[k] as unknown[])]
      : initial[k];
  }
  return next;
}

/** Apply the active filters to the matrix rows. */
export function filterLibraryRows(
  rows: LibraryRow[],
  filters: LibraryFilters,
): LibraryRow[] {
  const zoneQ = filters.zone.trim().toLowerCase();
  const searchQ = filters.search.trim();
  const hasUnitFilter = hasAnyUnitFilter(filters);
  return rows.filter((r) => {
    if (!matchTargetWithBuffer(r.lotWidth, filters.lotwTarget, filters.lotwBuf)) return false;
    if (!matchTargetWithBuffer(r.lotDepth, filters.lotdTarget, filters.lotdBuf)) return false;
    if (hasUnitFilter && matchingUnitIndices(r, filters).length === 0) return false;
    // ★★★ fix-412 Scope B4 — THE DEFAULT EXCLUSION, AND IT RUNS UNCONDITIONALLY.
    //
    // Bobby: *"a confirmed No-work remodel drops out of the Library set by
    // default."* That cannot live inside `matchingUnitIndices`, because
    // `hasAnyUnitFilter` gates whether that runs at all — and with no other
    // unit filter picked it does not run, which made the ruling inert. (The
    // fix-412 suite caught it: all three fixture rows came back.)
    //
    // ★★ THE RULE IS PER PROJECT, NOT PER UNIT, and the difference matters. A
    // project with one no-work unit AND three real ones is still a project
    // worth finding — dropping it would hide three units to hide one. So a row
    // leaves the default set only when it has units and EVERY one of them is a
    // confirmed no-work.
    //
    // ★ A project with NO unit rows at all is untouched: it has not answered
    //   the question, and "no units recorded" is not "no work".
    if (
      filters.workScope === '' &&
      r.unitTypes.length > 0 &&
      r.unitTypes.every((u) => isNoWorkUnit(u))
    ) {
      return false;
    }
    // ★★★ fix-415 A5 — EXACT MATCH, NOT SUBSTRING, AND THAT IS A BUG FIX.
    //
    // This read `.includes(zoneQ)` while the control was a free-text box, which
    // was reasonable for typing a fragment. It is wrong the moment the control
    // offers exact canonical values: **"NR" is a substring of "NR3"**, so
    // picking NR returned all 127 NR projects *plus* the 13 NR3 ones — the
    // grouping this ticket exists to deliver, silently not delivered.
    //
    // ★ Measured 2026-08-26: NR/NR3 is the only colliding pair among the 21,
    //   which is exactly why a substring match survived this long unnoticed.
    if (zoneQ && r.zone.trim().toLowerCase() !== zoneQ) return false;
    if (filters.alley && r.alley !== filters.alley) return false;
    if (filters.productTypes.length > 0) {
      // fix-91: any-of. Project matches when at least one of its
      // product_types is in the selected filter set.
      const hit = filters.productTypes.some((t) => r.productTypes.includes(t));
      if (!hit) return false;
    }
    if (filters.tag && !r.tags.includes(filters.tag)) return false;
    if (filters.juris && r.juris !== filters.juris) return false;
    // ★ fix-402: the num_lots FILTER is gone by ruling (see LibraryFilters),
    //   and fix-406 took the COLUMN and the SORT with it. `r.numLots` is still
    //   built; nothing in the Library reads it any more.
    // fix-122: tri-state Corner — Yes/No each require a non-null match.
    if (filters.isCornerLot === 'Yes' && r.isCornerLot !== true) return false;
    if (filters.isCornerLot === 'No' && r.isCornerLot !== false) return false;
    // ★ fix-410: three explicit arms, so `null` is a value you can ASK for
    //   rather than only something that falls out of the other two.
    if (filters.isRegularShape === 'Regular' && r.isRegularShape !== true) {
      return false;
    }
    if (filters.isRegularShape === 'Irregular' && r.isRegularShape !== false) {
      return false;
    }
    if (filters.isRegularShape === 'Not set' && r.isRegularShape !== null) {
      return false;
    }
    if (searchQ && !matchRowSearch(r, searchQ)) return false;
    return true;
  });
}

/** fix-81: search hits address OR any unit_type label, so typing
 * "cottage" surfaces every project that has a "Cottage *" unit.
 * fix-380: the permits' struct_address joins the address haystack — same
 * multi-token matcher, so a structure address finds the project's row. */
function matchRowSearch(row: LibraryRow, query: string): boolean {
  const structHay = row.structAddressHay ?? '';
  const addressHay = structHay ? `${row.address} ${structHay}` : row.address;
  if (multiMatchAddress(query, addressHay)) return true;
  const q = query.toLowerCase();
  return row.unitTypes.some((u) => u.label.toLowerCase().includes(q));
}

// ★★★ fix-406 — `numLots` LEFT THIS UNION WITH ITS COLUMN.
//
// Bobby, 2026-08-26: *"we can remove lots from the vertical bar below for the
// sort column as it isnt really relevant here."* A sort on a column nobody can
// see is not a feature, so the arm went with the header.
//
// ★★ AND THE LIST IS NOW A RUNTIME VALUE, not only a type. A union type is
// erased at build time and defends nothing against a string that arrives from
// storage, a URL, or a fixture written against an older build — see
// `sortLibraryRows` below for what that used to cost.
export const SORTABLE_COLUMNS = [
  'address',
  'juris',
  'productTypes',
  'units',
  'zone',
  'lotWidth',
  'alley',
  'stage',
  'isCornerLot',
  // ★★★ fix-410: ADDING THE COLUMN HERE IS HALF THE JOB — the other half is the
  //   sort ARM below. `SORTABLE_COLUMNS` is what `isSortableColumn` guards
  //   with, so a name listed here but not handled below falls through to
  //   `a[col].localeCompare(...)` on a boolean and throws the fix-406 TypeError
  //   during render. Both are done; the test asserts every member has an arm.
  'isRegularShape',
] as const;

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export interface SortState {
  col: SortableColumn;
  asc: boolean;
}

/** What the Library sorts by when nothing else has been chosen — and what an
 *  unrecognised column falls back to. ONE definition, so the component's
 *  initial state and the fallback cannot disagree about the default. */
export const DEFAULT_LIBRARY_SORT: SortState = { col: 'address', asc: true };

/** Is this a column the Library can actually sort by?
 *
 *  ★ Takes `unknown` deliberately. Every caller that needs this is handling a
 *  value that is NOT yet known to be a SortableColumn — that is the entire
 *  point — so a `SortableColumn` parameter would make it unusable at the only
 *  boundaries it exists to guard. */
export function isSortableColumn(v: unknown): v is SortableColumn {
  return (
    typeof v === 'string' &&
    (SORTABLE_COLUMNS as readonly string[]).includes(v)
  );
}

/** Sort rows by the named column. Stage uses the workflow rank
 * (de < pm < co < ap < is); other text columns use locale compare;
 * numeric columns use subtraction. */
export function sortLibraryRows(
  rows: LibraryRow[],
  state: SortState,
): LibraryRow[] {
  // ★★★ fix-406 — AN UNRECOGNISED COLUMN FALLS BACK; IT DOES NOT THROW.
  //
  // The last branch of this function is `a[col].localeCompare(...)`. For any
  // column name this function does not know — `'numLots'` from a fixture or a
  // session written against yesterday's build, a hand-edited value, a future
  // rename — `a[col]` is `undefined` and that line throws a TypeError **during
  // render**, taking the whole Library down rather than showing an odd order.
  //
  // ★★ That was a live hazard the moment `numLots` left the union: TypeScript
  // stops accepting it, and TypeScript is not what a stored string has to get
  // past. The guard makes the failure mode "sorted by address" instead of a
  // blank screen.
  //
  // ★ It re-reads the DIRECTION from the caller, not from the default. Somebody
  // holding a descending sort keeps descending when their column disappears;
  // resetting both would move the list twice for one missing thing.
  const col = isSortableColumn(state.col) ? state.col : DEFAULT_LIBRARY_SORT.col;
  const dir = state.asc ? 1 : -1;
  const sorted = [...rows];
  // Local const `col` so TS narrows inside each sort callback. Branching by
  // the column type avoids `(string | number)` widening that breaks
  // `localeCompare` and arithmetic at the same site.
  if (col === 'stage') {
    sorted.sort((a, b) => (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) * dir);
    return sorted;
  }
  if (col === 'units' || col === 'lotWidth') {
    sorted.sort((a, b) => (a[col] - b[col]) * dir);
    return sorted;
  }
  // ★★★ fix-406: the `numLots` arm was here and left with the column. Its
  //   NULLs-last rule survives below on `isCornerLot`, which was written
  //   against it and is the only remaining reader of that idea.
  // ★ fix-410: ONE tri-state arm serving both boolean columns, rather than a
  //   second copy of the same nine lines. The NULLs-last rule is the same rule
  //   and must stay the same rule.
  if (col === 'isCornerLot' || col === 'isRegularShape') {
    // Tri-state sort: true < false < null. NULL last (the rule fix-122 wrote
    // for numLots — unanswered rows shouldn't dilute the result band).
    const rank = (v: boolean | null) =>
      v === true ? 0 : v === false ? 1 : 2;
    const key = col;
    sorted.sort((a, b) => {
      const ra = rank(a[key]);
      const rb = rank(b[key]);
      if (ra === 2 && rb === 2) return 0;
      if (ra === 2) return 1;
      if (rb === 2) return -1;
      return (ra - rb) * dir;
    });
    return sorted;
  }
  if (col === 'productTypes') {
    // fix-91: sort by the joined string of types so a multi-type row
    // still sorts stably. Empty array sorts last per the '￿' sentinel.
    sorted.sort((a, b) => {
      const ka = a.productTypes.length ? a.productTypes.join(', ') : '￿';
      const kb = b.productTypes.length ? b.productTypes.join(', ') : '￿';
      return ka.localeCompare(kb) * dir;
    });
    return sorted;
  }
  sorted.sort((a, b) => a[col].localeCompare(b[col]) * dir);
  return sorted;
}
