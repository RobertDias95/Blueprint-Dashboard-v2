import type {
  ParkingKind,
  PermitWithCycles,
  Project,
  Stage,
  UnitType,
} from './database.types';
import { effectiveStage } from './permitStage';
import { parseUnitTypes } from './unitTypeNaming';
import {
  matchParkingKind,
  matchRoofDeck,
  matchStallsTier,
  type RoofDeckFilter,
  type StallsTier,
} from './unitParking';
// ★ fix-486 §D: `isNoWorkUnit` was this module's last reader of `work_scope`,
//   and it left with the default exclusion above. Nothing here reads the field.

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
  /** ★★★ fix-488 §A (P-142): the TYPED lot area, or null when nobody typed one.
   *
   *  ★★ NULLABLE, unlike `lotWidth`/`lotDepth` above, which use a 0 sentinel.
   *  That sentinel is safe for them because `matchTargetWithBuffer` treats 0
   *  and null identically (both fail an active filter) — but the SITE COLUMN
   *  has to tell "nobody typed a size" apart from a derived one, and 0 cannot.
   *  `lotSizeView` decides what the cell says; this carries only what is
   *  stored. */
  lotSizeSf: number | null;
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
  // ★★★ fix-483 §A4 — `structAddressHay` IS GONE FROM THIS ROW. fix-380 put it
  //     here to widen the Library search box's haystack; the box is gone by
  //     ruling and `matchRowSearch` was its only reader. A field built on every
  //     one of 202 rows for a consumer that no longer exists is not scenery,
  //     it is a promise the screen cannot keep.
  //
  // ★ fix-380's ruling stands elsewhere — Project View, Draw Schedule, the
  //   wizard's reuse picker and the Dashboard each build their own haystack
  //   from the same `structAddressHaystack`, and each still has a search box
  //   to type into.
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
      // ★ fix-488: `?? null`, NOT `?? 0` — see the field on LibraryRow.
      lotSizeSf: proj.lot_size_sf ?? null,
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
  // ★★★ fix-483 §A4 (P-136) — `search` IS GONE. Bobby, 2026-09-02: *"remove the
  //     search feature at the top of the library and the clear that goes with
  //     it."* The field went with the box: a filter nothing can write is a
  //     branch in `filterLibraryRows` that can never be true.
  //     ★ Its last readers, named: `matchRowSearch` (deleted with it) and
  //       `LibraryRow.structAddressHay`, which fix-380 added to feed it and
  //       which nothing else on this screen read. `structAddressHaystack`
  //       itself stays — Draw Schedule, Project View, the wizard's reuse
  //       picker and the Dashboard all still call it.
  lotwTarget: number | null;
  lotwBuf: number;
  lotdTarget: number | null;
  lotdBuf: number;
  /** ★★★ fix-488 §A: lot AREA ± tolerance, in square feet.
   *
   *  ★★ THE BUFFER IS ABSOLUTE, LIKE ITS SIBLINGS (`matchTargetWithBuffer` is
   *  `|val − target| ≤ buf`), so its default cannot be 2 the way the four
   *  dimension buffers are — 2 sq ft is a rounding error on a 7,200 sf lot and
   *  the control would look broken. **±500 sf**, which is ~7% of Bobby's own
   *  7,200 example: wide enough that "about a 7,000-foot lot" returns the lots
   *  a person means, tight enough to separate a 5,000 from a 9,000.
   *
   *  ★ It matches the TYPED size only. A lot whose size is merely derivable
   *  from W×D is not what somebody filtering on area is asking for — see
   *  `filterLibraryRows`. */
  lotsizeTarget: number | null;
  lotsizeBuf: number;
  /** fix-81: filter by structure (unit_type) width/depth. A project matches
   * when at least one of its unit_types lands inside the target ± buf
   * window. Projects with no unit_types don't match when either unit
   * filter is active. */
  unitwTarget: number | null;
  unitwBuf: number;
  unitdTarget: number | null;
  unitdBuf: number;
  /** ★★★ fix-488 §B (P-150): unit FLOOR AREA ± tolerance, in square feet.
   *
   *  Bobby, 2026-09-03: *"show me all my 1,700 sqft units with a garage."*
   *  That sentence is the acceptance test — this target ANDed with
   *  `parkingKind`, on the SAME unit (fix-402's per-unit conjunction).
   *
   *  ★★ **±100 sf** by default, a fifth of the lot buffer and for the reason
   *  the two differ: a unit is an order of magnitude smaller than a lot, and
   *  1,700 ± 100 is the window a person means when they say "seventeen
   *  hundred". ±500 there would sweep in 1,200 and 2,200. */
  unitsizeTarget: number | null;
  unitsizeBuf: number;
  zone: string;
  alley: string;
  /** fix-91: multi-select. Project matches when its product_types[]
   *  intersects this list (any-of). Empty array = no filter. */
  productTypes: string[];
  // ★★★ fix-483 §A2 (P-136) — `tag` IS GONE. Bobby: *"under library, remove the
  //     option for tag, and remove tags from the list below."* The Tags COLUMN
  //     went with the filter, in the same ruling. `projects.project_tags` is
  //     untouched and still edited on the Project Overview chip editor.
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
  // ★★★ fix-486 §D (P-143) — AND NOW THE DEFAULT EXCLUSION GOES TOO.
  //
  // fix-412 ruled that *"a confirmed No-work remodel drops out of the Library
  // set by default"*; fix-483 removed the FILTER and kept the exclusion,
  // recording that it had become unaskable. fix-486 retires the FIELD, so the
  // exclusion has nothing left to test.
  //
  // ★★★ IT NEVER EXCLUDED A ROW. Measured on prod 2026-09-03: 245 unit rows,
  //     **zero** non-null `work_scope`. The predicate fires on `'none'`, so in
  //     the six weeks it shipped it removed nothing from anybody's Library.
  //     This is a rule being deleted, not a behaviour — which is why the ruling
  //     can be retired rather than re-homed.
  //
  // ★ Bobby's replacement is the one that was always there: the TYPE. A unit
  //   whose type is `Remodel` says so, on the row, in the word.
  /** fix-122: tri-state Corner Lot filter. '' = no filter (Any);
   *  'Yes' = only is_corner_lot === true; 'No' = only false.
   *  Rows with NULL is_corner_lot fall out under Yes/No (no implicit
   *  default — they're literally unanswered). */
  isCornerLot: '' | 'Yes' | 'No';
  // ★★★ fix-483 §A2 (P-136) — `isRegularShape` IS GONE AS A FILTER. Bobby:
  //     *"Also remove shape."*
  //
  // ★★ THE COLUMN STAYS, and that is the difference from Tag and Work, both of
  //    which lost their column in the same sentence. He named the filter only,
  //    and the Shape column is beside Corner where fix-410 put it — two
  //    shape-of-the-lot facts that read together. Removing a column he did not
  //    ask about would be the fix-402/fix-406 mistake in reverse.
  //
  // ★ fix-410's finding is therefore only half-retired: *"a state you cannot
  //   filter for is a state you cannot audit"* — the null population is now
  //   visible in the column but no longer selectable. Recorded, not hidden.
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
      // ★★★ fix-488 §B — BOBBY'S ACCEPTANCE QUERY LIVES ON THIS LINE.
      //     *"show me all my 1,700 sqft units with a garage"* is this conjunct
      //     ANDed with `matchParkingKind` below, on the SAME `u`. A per-FILTER
      //     reading would return a project with a 1,700 sf unit and a garage on
      //     a different unit, and the reader would open it to find no such unit.
      matchTargetWithBuffer(u.size_sf, filters.unitsizeTarget, filters.unitsizeBuf) &&
      matchStoriesTier(u.stories, filters.stories) &&
      matchParkingKind(u.parking_kind, filters.parkingKind) &&
      matchStallsTier(u.parking_stalls, filters.stalls) &&
      // ★ fix-483 §A2: fix-412's `matchWorkScope` conjunct left with its
      //   filter. The per-unit AND itself (fix-402) is untouched.
      matchRoofDeck(u.roof_deck, filters.roofDeck)
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
    // ★★★ fix-488 §B: WITHOUT THIS LINE THE SIZE FILTER IS INERT — the control
    //     renders, accepts a number, and changes nothing, because
    //     `matchingUnitIndices` early-returns every index when this says no.
    //     fix-412's warning above is the reason this function exists.
    filters.unitsizeTarget !== null ||
    filters.stories !== '' ||
    filters.parkingKind !== '' ||
    filters.stalls !== '' ||
    // ★★ fix-483 §A2: `filters.workScope !== ''` left this list with the
    //    filter — and fix-412's warning that omitting it makes a filter INERT
    //    is kept above, because it is the reason this function exists and the
    //    next filter added to the UNIT card has to be listed here too.
    filters.roofDeck !== ''
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
// ★ `view` is in NEITHER list, deliberately: it IS NOT A FILTER (fix-447). It
//   changes the columns you get back, never which rows match, and clearing a
//   card must never move somebody to a different table.
//
// ★★ fix-483 §A4: `search` used to be the other one, owned by the page-level
//    Clear because it belonged to neither card. Both are gone — Bobby, 2026-09-02:
//    *"currently there's three clear features. We don't want to touch the two
//    within site and unit, just the one that is fixed below unit but above
//    address."* The two card Clears are untouched.
export const SITE_FILTER_KEYS = [
  'lotwTarget',
  'lotwBuf',
  'lotdTarget',
  'lotdBuf',
  // ★ fix-488 §A: the lot-area pair clears with the SITE card, beside the two
  //   dimension pairs it sits next to on screen.
  'lotsizeTarget',
  'lotsizeBuf',
  'zone',
  'juris',
  'alley',
  'isCornerLot',
  // ★ fix-483 §A2: `isRegularShape` and `tag` left this list with their
  //   filters. `libraryFilterKeyCoverage` is what forced the question — a key
  //   removed from the interface and left here is a compile error, and a key
  //   left in the interface and dropped from here fails the coverage test.
] as const satisfies readonly (keyof LibraryFilters)[];

export const UNIT_FILTER_KEYS = [
  'unitwTarget',
  'unitwBuf',
  'unitdTarget',
  'unitdBuf',
  // ★ fix-488 §B: the unit-area pair clears with the UNIT card.
  'unitsizeTarget',
  'unitsizeBuf',
  'parkingKind',
  'stalls',
  'roofDeck',
  'stories',
  // ★ fix-483 §A2: `workScope` left this list with its filter.
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
  // ★ fix-483 §A4: `search` is gone, so `view` is the only key that belongs to
  //   neither card — it is a PREFERENCE, not a filter (fix-447).
  const neither = new Set<string>(['view']);
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

// ===========================================================================
// ★★★ fix-483 §A1 (P-136) — SHADE ALTERNATE PROJECTS SO A ROW READS ACROSS
// ===========================================================================
//
// Bobby, 2026-09-02: *"add a graphic highlight every project or 3rd or 5th
// project so you can follow things left to right."*
//
// ★★★ THE BAND FOLLOWS THE PROJECT, NOT THE POSITION, and that is the whole
// design decision the brief asks to be explicit about. The obvious
// implementation — `index % 2` — is a zebra stripe: on the UNIT table, where a
// project contributes one row per unit type, it would cut a six-unit project
// into three bands and say nothing about where that project ends.
//
// So a project is assigned its band the FIRST TIME it appears, and every row of
// that project takes it. Two consequences, both wanted:
//
//   · A project's rows are ONE block of colour however many units it has, so
//     the shade also draws the boundary Bobby is asking to see.
//   · If a sort SPLITS a project's rows — a width sort interleaves units from
//     different projects — the split halves still share their project's band
//     rather than picking up whatever their neighbours have. The stripe stays
//     an answer to "which project is this row", which is the question, instead
//     of degrading into "is this row odd or even", which is not.
//
// ★ ON THE SITE TABLE each row IS its own project, so the same rule resolves to
//   an ordinary alternating stripe. One rule, both tables — not two.
//
// ★ Returns 0 or 1 per row, in the caller's order. The COLOUR is the caller's:
//   this knows nothing about tokens.
export function projectBands(projectIds: readonly string[]): number[] {
  const band = new Map<string, number>();
  return projectIds.map((id) => {
    let b = band.get(id);
    if (b === undefined) {
      b = band.size % 2;
      band.set(id, b);
    }
    return b;
  });
}

/** Apply the active filters to the matrix rows. */
export function filterLibraryRows(
  rows: LibraryRow[],
  filters: LibraryFilters,
): LibraryRow[] {
  const zoneQ = filters.zone.trim().toLowerCase();
  const hasUnitFilter = hasAnyUnitFilter(filters);
  return rows.filter((r) => {
    if (!matchTargetWithBuffer(r.lotWidth, filters.lotwTarget, filters.lotwBuf)) return false;
    if (!matchTargetWithBuffer(r.lotDepth, filters.lotdTarget, filters.lotdBuf)) return false;
    // ★★★ fix-488 §A — IT MATCHES THE TYPED SIZE ONLY, NOT A DERIVED ONE.
    //
    // The Site card SHOWS `width × depth` where no size was typed, and it is
    // tempting to filter on the same number. It would be wrong: somebody
    // filtering on area is asking "which lots did we record as about this
    // big", and answering with 205 rectangles nobody measured turns a search
    // into a calculator. `matchTargetWithBuffer` already treats null as
    // "no match while the filter is active", which is exactly right here.
    if (!matchTargetWithBuffer(r.lotSizeSf, filters.lotsizeTarget, filters.lotsizeBuf))
      return false;
    if (hasUnitFilter && matchingUnitIndices(r, filters).length === 0) return false;
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
    // ★ fix-483 §A2: the tag arm went with the filter. `r.tags` is still built
    //   — the Project Overview chip editor reads the same column — but nothing
    //   on this screen filters or prints it.
    if (filters.juris && r.juris !== filters.juris) return false;
    // ★ fix-402: the num_lots FILTER is gone by ruling (see LibraryFilters),
    //   and fix-406 took the COLUMN and the SORT with it. `r.numLots` is still
    //   built; nothing in the Library reads it any more.
    // fix-122: tri-state Corner — Yes/No each require a non-null match.
    if (filters.isCornerLot === 'Yes' && r.isCornerLot !== true) return false;
    if (filters.isCornerLot === 'No' && r.isCornerLot !== false) return false;
    // ★ fix-483 §A2: fix-410's three shape arms went with the filter. The
    //   COLUMN stays — `r.isRegularShape` is still read by the site table and
    //   still sorted by `sortLibraryRows`' tri-state arm.
    return true;
  });
}

// ★★★ fix-483 §A4 — `matchRowSearch` IS DELETED, AND SO IS WHAT IT FED ON.
//
// It was the Library search box's matcher: address OR any unit_type label
// (fix-81), widened by fix-380 to include the permits' `struct_address`. The
// box is gone by ruling, and this had exactly one call site — the `searchQ`
// arm of `filterLibraryRows` above.
//
// ★ WHAT SURVIVES, AND WHERE: `multiMatchAddress` (lib/drawScheduleHelpers) is
//   called by Draw Schedule, Project View, intake and the report metrics;
//   `structAddressHaystack` (lib/structAddressSearch) by Draw Schedule, Project
//   View, the wizard's reuse picker and the Dashboard. Only `LibraryRow`'s copy
//   of the haystack went, because this function was its only reader.
//
// ★★ fix-380's RULING IS NOT REVERSED — a struct address still finds its
//    project, on Project View and the Dashboard. What it no longer does is find
//    it HERE, because there is nowhere here to type it.

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
  // ★★★ fix-488 §A: `lotSizeSf` is sortable, AND ITS ARM IS BELOW. fix-410's
  //   warning three lines down is not decoration — a name listed here without
  //   a handler falls through to `a[col].localeCompare(...)` on a number and
  //   throws during render.
  'lotSizeSf',
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
  // ★★★ fix-488 §A — ITS OWN ARM, BECAUSE IT IS THE ONLY NULLABLE NUMBER HERE.
  //
  // `units` and `lotWidth` use a 0 sentinel, so plain subtraction is right for
  // them. `lotSizeSf` is null when nobody typed one, and `null - 5` is `-5`:
  // under the arm above, every unmeasured lot would sort as smaller than the
  // smallest real one, in BOTH directions. NULLs last, which is fix-122's rule
  // for `numLots` and the same rule the tri-state arm below keeps.
  if (col === 'lotSizeSf') {
    sorted.sort((a, b) => {
      const av = a.lotSizeSf;
      const bv = b.lotSizeSf;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
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
