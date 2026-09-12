import { useMemo, useState } from 'react';
import OriginLink from './OriginLink';
import { PREVIOUS_ORIGINS } from '../lib/previousOrigin';
import { useProjects } from '../hooks/useProjects';
import RetiredBadge from './shared/RetiredBadge';
import { LibraryChoiceCell, LibraryDimensionCell } from './LibraryEditCell';
import { parseUnitTypes } from '../lib/unitTypeNaming';
import { useArchivedFallbackProjects } from '../hooks/useArchivedFallbackProjects';
import {
  ARCHIVED_FALLBACK_LABEL,
  ARCHIVED_FALLBACK_SHORT,
} from '../lib/archivedFallback';
import {
  useMayEditLibrary,
  useUpdateLibraryFields,
  type LibraryFieldPatch,
} from '../hooks/useUpdateLibraryFields';
import { useAllProjectHolds, cancelledProjectIds } from '../hooks/useProjectHolds';
import {
  RETIRED_VISIBILITY,
  redesignedAwayProjectIds,
  retiredCause,
  retiredHiddenFrom,
  type RetiredCause,
  type RetiredSets,
} from '../lib/retiredState';
import { usePermits } from '../hooks/usePermits';
import {
  DEFAULT_LIBRARY_SORT,
  buildLibraryRows,
  filterLibraryRows,
  projectBands,
  // ★ fix-469/fix-472: `hasAnyUnitFilter` and `matchingUnitIndices` are not
  //   imported HERE — both were used only by the matched-highlight, which is
  //   now deleted. Both are still exported, still tested, and both are on the
  //   hot path for choosing the UNIT view's rows one level down, in
  //   lib/libraryUnitRows. ★ They are NOT dead: `matchingUnitRows` composes
  //   them, and that composition is what stops a unit search printing a
  //   project's non-matching units.
  SITE_FILTER_KEYS,
  UNIT_FILTER_KEYS,
  cardHasValue,
  clearCardFilters,
  sortLibraryRows,
  type LibraryFilters,
  type LibraryView,
  type LibraryRow,
  type SortableColumn,
  type SortState,
} from '../lib/libraryHelpers';
import type {
  PermitWithCycles,
  Project,
  Stage,
  UnitType,
} from '../lib/database.types';
import { STAGE_LABEL } from '../lib/stageLabel';
import { PARKING_KINDS, type ParkingKind } from '../lib/database.types';
import {
  NOT_RECORDED,
  PARKING_KIND_LABEL,
  // ★ fix-519 §A: `parkingKindCode` moved to `lib/libraryUnitColumns` with the
  //   cell that calls it — the column declares what it prints.
  type RoofDeckFilter,
  type StallsTier,
} from '../lib/unitParking';
import {
  isOffListUnitLabel,
  resolveUnitLabel,
} from '../lib/unitTypeNaming';

import { useAppConfig, readAppConfigStringArray } from '../hooks/useAppConfig';
// ★★★ fix-447 §B3: the unit view's own row shape and sorter. A SEPARATE
// module because the unit sort is a separate union from the site one — see
// lib/libraryUnitRows for why mixing them is a render-time throw.
import {
  DEFAULT_UNIT_SORT,
  matchingUnitRows,
  sortUnitRows,
  unitRowProjectCount,
  type UnitSortState,
  type UnitSortableColumn,
} from '../lib/libraryUnitRows';
// ★★★ fix-519 §A (P-230): the unit table's columns, declared ONCE. The
// `<thead>` and `LibraryUnitRow`'s cells both render from this list, which is
// what stops a heading and its value drifting apart again.
import { LIBRARY_UNIT_COLUMNS } from '../lib/libraryUnitColumns';
// ★★★ fix-519 §C (P-228): the SITE fields whose order the filter box and the
// table share — jurisdiction, then zone, then alley, in both.
import { LIBRARY_SITE_SHARED_FIELDS } from '../lib/librarySiteFields';
import { useAuthStore } from '../stores/authStore';
import { zoneOptions } from '../lib/zoneOptions';
// ★ fix-488: `formatLotPair` is no longer imported here — the site row's lot
//   cell asks `lotSizeView` instead, because it has to be able to say
//   "varies". The function itself is UNCHANGED and still serves its other
//   callers (the wizard's reuse picker); see its note in lib/lotDimensions.
import { lotSizeView } from '../lib/lotDimensions';
// ★ fix-483 §A4: `clearLibraryFilters` is no longer imported — the page-level
//   Clear was its only caller. It STAYS in surfaceFilterPrefs (exported,
//   symmetric with its two siblings, independently tested); see the note where
//   `clearFilters` used to be.
import {
  loadLibraryFilters,
  saveLibraryFilters,
} from '../lib/surfaceFilterPrefs';
import { SkeletonRows } from './Skeleton';
import QueryError from './QueryError';
import { ToggleChip } from './shared/TwoStateToggle';

// Q6.3.a: Library matrix view. Per-project
// lot/unit-dim matrix used to match new lots against past projects.
// Mirrors v1's renderMatrix layout (index.html lines 5717-5772) minus
// the dead-code Unit W×D column + unit-width filter (spike confirmed
// no DB column, no JSON data, orphan form fields in v1).
//
// ★ WHERE IT LIVES: its own top-level route, /library, wired in router.tsx and
// reachable from the main nav. It was a Settings sub-tab once (hence the
// original Q6.3.a note), then a sub-tab of Draw Schedule, and the comment kept
// claiming Settings through both moves. fix-297 moved it out and corrected
// this: a stale "where does this live" comment is what sent an earlier ticket
// looking in the wrong place entirely.

// fix-105: STAGE_LABEL is the shared map from src/lib/stageLabel.ts.

const STAGE_BADGE: Record<Stage, string> = {
  de: 'bg-de-bg text-de border-de-border',
  pm: 'bg-pm-bg text-pm border-pm-border',
  co: 'bg-co-bg text-co border-co-border',
  ap: 'bg-jv-bg text-jv border-jv-border',
  is: 'bg-is-bg text-is border-is-border',
};

// v1's Product Type dropdown options (index.html line 9365). Filter is
// exact-match so the list must match what's persisted in the column.
// fix-232: the Product Type filter reads the canonical registry
// (app_config.productTypeOptions) — the SAME single source the project + wizard
// editors use — instead of a hardcoded list. The old constant carried the stale
// legacy values ('SFR w/ Accessory Units', 'Attached Units') that drifted onto
// projects; sourcing from the registry keeps every product-type option list in
// lockstep. (Read from useAppConfig inside Body.)

// ★ fix-483 §A2: `TAG_OPTIONS` went with the Tag filter — v1's tag dropdown
//   (index.html line 9377) and its `array.includes` predicate, retired by
//   Bobby's 2026-09-02 ruling. `projects.project_tags` is untouched.

// ★★★ fix-406 — THE FIELD SURFACE, AND WHY IT IS ONE CONSTANT
//
// Bobby: *"there is still a lot of gray on gray clashing with letters,
// backgrounds, boxes etc."*
//
// ★★★ THE NUMBERS BEHIND THAT SENTENCE. Every filter box was `bg-bg`
// (#f0f4f8) sitting on a `bg-s2` card (#e8edf3): a 2% luminance step. The box
// did not read as a box — it read as a slightly different patch of the same
// card. The fix is the app's FIELD surface, `bg-surface` (#ffffff), which is
// the colour every other input in the app already uses on a tinted panel, plus
// a hairline shadow so the box reads as a layer ABOVE the card rather than a
// shape carved out of it.
//
// ★★ SELECTS INCLUDED — the brief calls them out by name, and they were the
// worse half: a native select on #f0f4f8 also renders its own chrome in the
// UA's grey, so the gray-on-gray was doubled.
//
// ★ ONE CONSTANT because there are nine of these boxes across the two cards.
// Nine copies of a class string is how the next ticket restyles eight of them.
const FIELD_CLASS =
  'bg-surface border border-border rounded px-2 py-1 text-[11px] text-text ' +
  'shadow-sm focus:outline-none focus:border-de focus:ring-1 focus:ring-de/30';

export default function LibraryMatrix() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  // ★★★ fix-524 §B — A RETIRED PROJECT IS NOT IN THE LIBRARY.
  //
  //     Bobby, 2026-09-10: *"for simplicity's sake, it does not appear."* The
  //     Library answers *what do we have*, and a cancelled project is not part
  //     of the answer.
  const holdsQ = useAllProjectHolds();

  const error = projectsQ.error ?? permitsQ.error;
  if (error) {
    return (
      <QueryError
        title="Library failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
        }}
      />
    );
  }
  if (projectsQ.isLoading || permitsQ.isLoading) {
    return <SkeletonRows count={8} rowClassName="h-9" />;
  }

  return (
    <Body
      projects={projectsQ.data ?? []}
      permits={permitsQ.data ?? []}
      retiredSets={{
        cancelledIds: cancelledProjectIds(holdsQ.data),
        redesignedIds: redesignedAwayProjectIds(projectsQ.data),
      }}
    />
  );
}

interface BodyProps {
  projects: Project[];
  permits: PermitWithCycles[];
  /** ★★★ fix-525 §B — THE TWO RETIRED CAUSES, AND THEY DIVERGE HERE.
   *
   *  fix-524 hid both. Bobby reversed his own 09-10 rule on evidence: hiding a
   *  redesign's ORIGINAL empties **11 of the 17 pairs** out of the unit matrix,
   *  because 11 originals hold the only `unit_types` their pair has. So
   *  **cancelled is hidden and redesigned-away is kept, hatched.**
   *
   *  ★★ The divergence is read from `RETIRED_VISIBILITY`, not decided here —
   *     §B: *"The Library asks the cause and treats them differently; it does
   *     not ask a second question of its own."* */
  retiredSets: RetiredSets;
}
const INITIAL_FILTERS: LibraryFilters = {
  // ★★★ fix-447 ruling 4 (Bobby, 2026-08-29): *"the Library OPENS ON SITE"*.
  //     Same constant the stored-value decoder falls back to, so "what the
  //     Library opens on" has one answer.
  view: 'site',
  lotwTarget: null,
  lotwBuf: 2,
  lotdTarget: null,
  lotdBuf: 2,
  // ★★★ fix-488 — THE TWO NEW BUFFERS ARE NOT 2, AND THAT IS THE DESIGN.
  //
  // `matchTargetWithBuffer` is ABSOLUTE, not proportional, so the default has
  // to be in the unit of the thing. The four dimension buffers are ±2 FEET;
  // ±2 SQUARE FEET on a 7,200 sf lot is a rounding error and the control would
  // read as broken on its first use.
  //
  //   lot  ±500 sf  — ~7% of Bobby's own 7,200 example. Wide enough that
  //                   "about a seven-thousand-foot lot" returns the lots a
  //                   person means; tight enough to separate 5,000 from 9,000.
  //   unit ±100 sf  — a fifth of it, because a unit is an order of magnitude
  //                   smaller. 1,700 ± 100 is the window somebody means when
  //                   they say "seventeen hundred"; ±500 would sweep in 1,200
  //                   and 2,200 and answer a different question.
  lotsizeTarget: null,
  lotsizeBuf: 500,
  unitwTarget: null,
  unitwBuf: 2,
  unitdTarget: null,
  unitdBuf: 2,
  unitsizeTarget: null,
  unitsizeBuf: 100,
  zone: '',
  alley: '',
  productTypes: [],
  juris: '',
  // fix-122: isCornerLot is tri-state. (Its numLots sibling was removed as a
  // FILTER by fix-402 on Bobby's ruling; the lots COLUMN is untouched.)
  isCornerLot: '',
  // fix-205: Stories tier filter on a project's unit_types.
  stories: '',
  // ★★ fix-402: the UNIT card's parking trio. All start Any — and note that
  // "Any" is the only state in which a NOT-RECORDED unit can match, which is
  // the correct behaviour while 231 unit rows await their backfill.
  parkingKind: '',
  stalls: '',
  roofDeck: '',
};

function Body({ projects, permits, retiredSets }: BodyProps) {
  // ★★★ fix-403: the filter panel remembers, for this tab and this login.
  //
  // ★★ READ IN A LAZY INITIALISER, not an effect — fix-324's rule. An effect
  // that setStates on mount renders one frame of the EMPTY filter panel with
  // the full unfiltered list behind it, then corrects itself; the user sees a
  // flinch and, worse, a count that changes under them.
  const prefsUserId = useAuthStore((s) => s.user?.id ?? null);
  const [filters, setFilters] = useState<LibraryFilters>(
    () => loadLibraryFilters(prefsUserId, INITIAL_FILTERS) ?? INITIAL_FILTERS,
  );
  // fix-232: product-type filter options come from the canonical registry
  // (app_config.productTypeOptions) — single source of truth.
  const appConfig = useAppConfig();
  const productTypeOptions = useMemo(
    () => readAppConfigStringArray(appConfig.map, 'productTypeOptions'),
    [appConfig.map],
  );
  // ★ fix-415 A5: the same registry the three write surfaces use, so the filter
  //   can never offer a zone nothing can be stored as — or miss one that can.
  const zoneFilterOptions = useMemo(() => zoneOptions(appConfig.map), [appConfig.map]);
  // ★ fix-406: the default comes from the same constant `sortLibraryRows` falls
  //   back to, so "what the Library sorts by" has one answer.
  const [sort, setSort] = useState<SortState>(DEFAULT_LIBRARY_SORT);
  // ★★ fix-447: a SEPARATE sort for the unit view. The two tables sort
  //    different things — a site sort orders projects, a unit sort orders units
  //    — and one shared column name would be handed to whichever sorter did
  //    not know it (fix-406's render-time throw). Neither is persisted, which
  //    is unchanged: `surfaceFilterPrefs` has never stored a sort.
  const [unitSort, setUnitSort] = useState<UnitSortState>(DEFAULT_UNIT_SORT);
  function toggleUnitSort(col: UnitSortableColumn) {
    setUnitSort((prev) =>
      prev.col === col ? { col, asc: !prev.asc } : { col, asc: true },
    );
  }
  // ===========================================================================
  // ★★★ fix-506 §H (P-167) — `writeUnitTypes` IS GONE, AND WITH IT THE LIBRARY'S
  //     ONLY WRITE PATH
  // ===========================================================================
  //
  // fix-206's note said the unit table was editable *"through the SAME write
  // path as Project Overview (useUpdateProject patch { unit_types } with the
  // project's OCC token). One store."* That was true and it is why this was
  // always defensible — but Bobby has ruled the Library is not a write surface
  // at all, and "one store, two editors" is still two editors.
  //
  // ★★★ THE ASSERTION §H IS ABOUT: this file makes ZERO calls to
  //     `useUpdateProject`. STEP 0-3 enumerated the whole surface and found
  //     exactly one write path feeding eight inputs; both are now the Units tab
  //     of Project Data, which each row links to.
  //
  // ★ THE OPTIMISTIC-CACHE REASONING SURVIVES INTACT, just from one side: an
  //   edit in Project Data patches the projects cache, so it reflects here
  //   immediately. That was half of fix-206's argument and it is the half that
  //   was never about writing.
  // ★★★ fix-447 §B6 — fix-81's CARET IS RETIRED, AND SO IS ITS STATE.
  //
  // The caret existed because site columns and unit detail shared one table:
  // the units had to hide somewhere. The view switch removes the reason —
  // SITE shows site columns and no sub-table, UNIT shows one row per unit — so
  // `expandedById`, `isExpanded` and `toggleExpanded` had no reachable caller
  // and are gone rather than left as scenery.
  //
  // ★★★ WHAT DID *NOT* GO WITH IT: the unit ROW. `LibraryUnitRow` is REUSED as
  // the UNIT view's row (it already renders its own `<tr>`; it now takes
  // leading and trailing cells), so the detail that used to hide behind a caret
  // is now the view itself.
  //
  // ⚠️ fix-525 CORRECTS THE SENTENCE THAT STOOD HERE. It said the row was still
  //    *"the Library's inline unit_types EDITOR … `writeUnitTypes` and its
  //    `expectedUpdatedAt` token are untouched"* — which contradicted the
  //    fix-506 §H block six lines above it, written in the SAME ticket, saying
  //    the write path was removed. §H is the true one: **this file makes zero
  //    calls to `useUpdateProject` and holds no write path at all**, and
  //    fix-514 §H later removed even the link out to one.
  //
  // ★★★ THAT STALE COMMENT COST A RULING. fix-524's report argued the redesign
  //     original could not be read through into the Library because *"the unit
  //     table is an EDITOR, so it would be an editable control writing to a
  //     project §D has just frozen."* That was read off this comment rather
  //     than off the code, and it is wrong — which is why fix-525 §B could
  //     simply keep the row. **A comment is not evidence.**
  // ★★ fix-469/fix-472: `unitFilterActive` lived here to gate the matched
  //    highlight, which fix-472 deleted outright. `hasAnyUnitFilter` itself is
  //    untouched and still very much live — it is what `matchingUnitIndices`
  //    consults to decide whether any unit criteria are active at all, which is
  //    now what chooses the UNIT view's rows. fix-402's "one definition of 'a
  //    unit filter is on'" still holds; this component simply no longer needs
  //    to ask the question itself.

  // ★★★ fix-524 §B: the hide happens BEFORE the rows are built, not after they
  //     are filtered — so every downstream count, band and unit row is derived
  //     from the same population and none of them can disagree about which
  //     projects the Library holds.
  const visibleProjects = useMemo(
    () => projects.filter((p) => !retiredHiddenFrom('library', p.id, retiredSets)),
    [projects, retiredSets],
  );
  /** ★★★ fix-525 §B: project ids that STAY but read as retired. Today that is
   *  the 17 redesign originals and nothing else — `RETIRED_VISIBILITY` decides,
   *  so if the ruling changes again it changes in one record. */
  const hatchedIds = useMemo(() => {
    const m = new Map<string, RetiredCause>();
    for (const p of visibleProjects) {
      const cause = retiredCause(p.id, retiredSets);
      if (cause && RETIRED_VISIBILITY[cause].library === 'hatched') m.set(p.id, cause);
    }
    return m;
  }, [visibleProjects, retiredSets]);
  /** ★ How many the hide removed, so the count line can SAY SO. §B: *"a number
   *  that changes because a filter changed, with nothing saying so, is a bug
   *  report waiting to happen."* fix-447 §B5 made exactly this argument about
   *  the unit view's project count. */
  const hiddenRetiredCount = projects.length - visibleProjects.length;
  const allRows = useMemo(
    () => buildLibraryRows(visibleProjects, permits),
    [visibleProjects, permits],
  );

  const jurisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (r.juris) set.add(r.juris);
    return Array.from(set).sort();
  }, [allRows]);

  const filtered = useMemo(
    () => filterLibraryRows(allRows, filters),
    [allRows, filters],
  );
  const sorted = useMemo(
    () => sortLibraryRows(filtered, sort),
    [filtered, sort],
  );

  // ★★★ fix-447 §B3 — the UNIT view, off the SAME filtered set.
  //
  // ★★ THE FILTERS ARE NOT RE-RUN AND NOT RELAXED. `filtered` is exactly what
  // the SITE view shows; the unit view only reshapes it. That is what makes
  // §B4 true — *"What the pill changes is the columns you get back, not which
  // filters apply"* — and it means fix-402's conjunction across the two cards
  // is untouched by anything in this ticket.
  // ★★★ fix-469 §1 (P-121) — MATCHING UNITS ONLY.
  //
  // Was `flattenUnitRows(filtered)`, which printed every unit of every
  // qualifying project. Measured on prod 2026-09-01 for Bobby's 16×36 ±1
  // search: 35 rows printed, 10 of them matching — **71% of the answer did not
  // match the question**. `matchingUnitRows` composes the same two functions
  // that were already here (see its note in lib/libraryUnitRows).
  //
  // ★★ THE FILTERS ARE STILL NOT RE-RUN AND STILL NOT RELAXED. `filtered` is
  // exactly what the SITE view shows; the SITE card's criteria still qualify
  // PROJECTS, unchanged. What is new is that the UNIT card's criteria now also
  // filter ROWS — so fix-402's conjunction across the two cards is untouched,
  // and so is fix-447 §B4's *"what the pill changes is the columns you get
  // back, not which filters apply"*: the same filters apply, and the unit ones
  // now apply at the grain the unit table is drawn at.
  const unitRows = useMemo(
    () => sortUnitRows(matchingUnitRows(filtered, filters), unitSort),
    [filtered, filters, unitSort],
  );
  const unitProjectCount = useMemo(
    () => unitRowProjectCount(unitRows),
    [unitRows],
  );
  // ★ fix-483 §A1: one band per row, keyed off the row's PROJECT — see
  //   `projectBands` for why this is not `index % 2`.
  const unitBands = useMemo(
    () => projectBands(unitRows.map((u) => u.project.projectId)),
    [unitRows],
  );
  const siteBands = useMemo(
    () => projectBands(sorted.map((r) => r.projectId)),
    [sorted],
  );

  // ★★★ fix-532 §A — THE LIBRARY BECOMES A WRITE SURFACE AGAIN, FOR ONE PERSON.
  //
  //     fix-506 §H removed its only write path because Bobby ruled it was not a
  //     write surface. It is one again for a holder of
  //     `profiles.may_edit_library` — measured 2026-09-11, that is
  //     `cameron@blueprintcap.com` and nobody else.
  //
  // ⚠️⚠️ THIS BOOLEAN DECIDES WHAT RENDERS AND NOTHING ELSE. The gate is
  //      `bp_update_library_fields`, which refuses an uncapable caller with
  //      `42501` — proven on prod in fix-527 §B. ~20 `useIsTenantAdmin` sites
  //      in this app hide a control and enforce nothing (P-243); this is not a
  //      twenty-first, because there is a server behind it.
  //
  // ★ Fail closed: `useMayEditLibrary` answers false while loading, on error,
  //   and for a missing column.
  const canEditLibrary = useMayEditLibrary();
  const saveLibrary = useUpdateLibraryFields();
  // ★★★ fix-532 §C (P-247): the 60 projects whose plan of record is a
  //     superseded drawing. One query for the screen — see the hook.
  const archivedFallbackQ = useArchivedFallbackProjects();

  function toggleSort(col: SortableColumn) {
    setSort((prev) =>
      prev.col === col ? { col, asc: !prev.asc } : { col, asc: true },
    );
  }

  function update<K extends keyof LibraryFilters>(key: K, val: LibraryFilters[K]) {
    setFilters((prev) => {
      const next = { ...prev, [key]: val };
      // ★ Written on every change, in the handler — so the state is already
      //   stored by the time a click on a project row navigates away.
      saveLibraryFilters(prefsUserId, next);
      return next;
    });
  }
  // ★★★ fix-469 §2 (P-122) — ONE CARD'S RESET.
  //
  // Bobby: *"can we add a clear button to the search filters of units/site?"*
  // Keeping a lot search while dropping the unit dimensions meant blanking up
  // to NINE controls by hand — the cards were separated because they are two
  // independent questions, and two independent questions want two independent
  // resets.
  //
  // ★★★ `view` SURVIVES, AND THIS IS THE ONE THAT GETS MISSED. It rides inside
  // `LibraryFilters` because that is the blob fix-403 persists, but it is a
  // PREFERENCE, not a filter. `clearCardFilters` only writes the keys it is
  // given and `view` is in neither card's list — so it cannot be reset here
  // even by accident, which is a stronger guarantee than remembering to
  // re-add it.
  //
  // ★ It goes through `update`'s sibling path so the cleared state is PERSISTED
  //   immediately, exactly like every other filter change. A card Clear that
  //   un-cleared itself on the next navigation would be fix-447's bug again.
  function clearCard(keys: readonly (keyof LibraryFilters)[]) {
    setFilters((prev) => {
      const next = clearCardFilters(prev, keys, INITIAL_FILTERS);
      saveLibraryFilters(prefsUserId, next);
      return next;
    });
  }

  // ★★★ fix-483 §A4 — `clearFilters` IS DELETED. It was the page-level Clear's
  //     only caller and the page-level Clear is gone by ruling (see the note
  //     where the button used to render).
  //
  // ★★ fix-447's RULING SURVIVES IT, and is worth keeping written down because
  //    the next Clear anyone adds will face it: *"CLEAR CLEARS FILTERS — IT
  //    DOES NOT CHANGE THE VIEW."* `view` is a preference, not a filter, so
  //    resetting it would bounce somebody out of the UNIT table for pressing a
  //    button that says Clear. `clearCard` above still honours that — `view` is
  //    in neither card's key list, which is a stronger guarantee than
  //    remembering.
  //
  // ★ `clearLibraryFilters` (lib/surfaceFilterPrefs) now has no caller in the
  //   app. It is KEPT: it is exported, symmetric with `saveLibraryFilters` /
  //   `loadLibraryFilters` in a per-surface module, and independently tested by
  //   PreviousAndFiltersFix403 — fix-467's rule, where a call site is not the
  //   only thing that makes a thing worth keeping. Its last caller was this
  //   function.


  // ★★★ fix-483 §A3 (P-136) — THE WHOLE CARD SWITCHES THE VIEW.
  //
  // Bobby, 2026-09-02: *"there is a ton of open space to the right of Unit and
  // to the right of Site. I want to be able to click anywhere within that and
  // it switches the search parameter. The Unit pill will be the thing that
  // highlights, not the whole box."*
  //
  // ★★★ ONE RULE, NOT A stopPropagation ON EVERY CONTROL. The cards hold
  // eighteen selects, inputs and buttons between them, and a rule that has to
  // be remembered at each of them is a rule that will be forgotten by the
  // twentieth. This asks the EVENT where it landed instead: a click whose
  // target is inside any interactive element is that element's business, and
  // everything else is empty space.
  //
  // ★ `<label>` is in the list because a label IS part of its control — clicking
  //   the word "Zone" focuses the select, and flipping the view underneath that
  //   would be the same defect as flipping it on the select itself.
  //
  // ★★ THE ACCESSIBLE CONTROL IS STILL THE PILL. This div takes no `role` and
  //    no `tabIndex`: it is a convenience for a mouse, and the keyboard path is
  //    the `<button>` inside it, which is focusable and carries `aria-pressed`.
  //    (fix-440's finding, in reverse — a handler on an unfocusable div is dead
  //    for the keyboard, so the keyboard must never have needed it.)
  function selectViewFromCard(e: React.MouseEvent, next: LibraryView) {
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, select, textarea, button, label, a')) return;
    update('view', next);
  }

  return (
    <div className="space-y-3" data-testid="library-matrix">
      {/* ★★★ fix-483 §A4 (P-136) — THE SEARCH BOX IS GONE, AND SO IS THE
          PAGE-LEVEL CLEAR THAT OWNED IT.

          Bobby, 2026-09-02: *"remove the search feature at the top of the
          library and the clear that goes with it… currently there's three clear
          features. We don't want to touch the two within site and unit, just
          the one that is fixed below unit but above address."*

          ★★ THE TWO CARD CLEARS ARE UNTOUCHED — fix-469 §2's `CardClear`, one
          per card, exactly as built. The one that went is the leftover from
          when there was a single toolbar (fix-447 split the cards and the
          global Clear never caught up), and it was also the only control that
          could reset a person out of a card they had not touched.

          ★ `filters.search` went with the box — see lib/libraryHelpers for the
            last call sites of its matcher and of the struct-address haystack
            fix-380 built to feed it. */}

      {/* Filter bar */}
      {/* ★★★ fix-402 — TWO CARDS: SITE AND UNIT.
          Bobby, 2026-08-25: *"lot-specific … and unit-specific"*, with
          width/depth as each group's primary tier, and — on the grey-on-grey
          panel this replaces — *"it's kind of like a lot of grays on grays …
          we want it to be more distinct."*

          ★★ The de-gray is a bordered card per group with a COLOURED chip
          (teal = site, purple = unit), and each card's width/depth sit above a
          hairline as the primary tier. Colours come from the app's own tokens,
          not from the mockup's raw hexes.

          ★★ ALLEY AND CORNER LIVE UNDER SITE — Bobby's own correction to the
          first mockup. They describe the lot, not the building on it. */}
      <div className="flex flex-wrap items-start gap-3" data-testid="library-filters">
        {/* ── SITE ────────────────────────────────────────────────────── */}
        <div
          className="flex-1 min-w-[300px] bg-s2 border rounded-lg p-3 cursor-pointer"
          style={NEUTRAL_CARD_BORDER}
          onClick={(e) => selectViewFromCard(e, 'site')}
          data-testid="filter-card-site"
        >
          <div className="flex items-baseline gap-2 mb-2">
            <GroupHeading
              label="Site"
              caption="the lot"
              view="site"
              active={filters.view === 'site'}
              onSelect={() => update('view', 'site')}
              testid="filter-chip-site"
            />
            <CardClear
              keys={SITE_FILTER_KEYS}
              filters={filters}
              onClear={clearCard}
              testid="filter-clear-site"
            />
          </div>

          {/* ★ PRIMARY TIER — the two dimensions the search actually starts
              from, set above a hairline from the qualifiers below. */}
          <div className="flex flex-wrap items-end gap-3 pb-2.5 mb-2.5 border-b border-border">
            <TargetRange
              label="Lot Width (ft)"
              target={filters.lotwTarget}
              buf={filters.lotwBuf}
              onTarget={(v) => update('lotwTarget', v)}
              onBuf={(v) => update('lotwBuf', v)}
              testIdPrefix="lotw"
            />
            <TargetRange
              label="Lot Depth (ft)"
              target={filters.lotdTarget}
              buf={filters.lotdBuf}
              onTarget={(v) => update('lotdTarget', v)}
              onBuf={(v) => update('lotdBuf', v)}
              testIdPrefix="lotd"
            />
            {/* ★★★ fix-488 §A (P-142) — LOT SIZE JOINS THE PRIMARY TIER.
                It belongs beside the two dimensions rather than among the
                qualifiers below: it is a thing you search FROM ("about a
                7,000-foot lot"), not a thing you narrow BY.

                ★★ IT MATCHES THE TYPED SIZE ONLY — a lot whose area is merely
                derivable from W×D does not answer "which lots did we record as
                about this big". See `filterLibraryRows`. */}
            <TargetRange
              label="Lot Size (sf)"
              target={filters.lotsizeTarget}
              buf={filters.lotsizeBuf}
              onTarget={(v) => update('lotsizeTarget', v)}
              onBuf={(v) => update('lotsizeBuf', v)}
              testIdPrefix="lotsize"
              // ★ fix-489: square feet need more room than feet — see TargetRange.
              unit="sf"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {/* ★★★ fix-519 §C (P-228) — JURISDICTION FIRST, AND THE ORDER
                COMES FROM THE SAME LIST THE TABLE'S HEADERS DO.

                This box asked `Zone · Jurisdiction` while the table read
                `Juris · Zone`. The table was following P-196's ruling and this
                was not. Jurisdiction is the coarser fact and **0 of 219 active
                projects are missing one, where 3 have no zone** — you narrow
                from the field everybody has. So the FILTER moved.

                ★★★ fix-415 SCOPE A5 is untouched and is why the Zone control
                    is a `<select>` rather than a text box: the column held 33
                    spellings of 21 zones, so asking for LR1 found three of the
                    ten projects that ARE LR1. Both halves stay fixed — the data
                    is canonical and the control offers only the canonical
                    list. */}
            {LIBRARY_SITE_SHARED_FIELDS.map((f) => (
              <FieldLabel key={f.key} label={f.filterLabel}>
                {f.key === 'juris' ? (
                  <select
                    value={filters.juris}
                    onChange={(e) => update('juris', e.target.value)}
                    className={FIELD_CLASS}
                    data-testid="filter-juris"
                  >
                    <option value="">Any</option>
                    {jurisOptions.map((j) => (
                      <option key={j}>{j}</option>
                    ))}
                  </select>
                ) : f.key === 'zone' ? (
                  <select
                    value={filters.zone}
                    onChange={(e) => update('zone', e.target.value)}
                    className={`w-28 ${FIELD_CLASS}`}
                    data-testid="filter-zone"
                  >
                    <option value="">Any</option>
                    {zoneFilterOptions.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={filters.alley}
                    onChange={(e) => update('alley', e.target.value)}
                    className={FIELD_CLASS}
                    data-testid="filter-alley"
                  >
                    <option value="">Any</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                )}
              </FieldLabel>
            ))}

            {/* fix-122: Corner Lot filter — tri-state mirroring Alley.
                fix-402 moved it under SITE (Bobby's correction); its meaning
                is unchanged, NULLs still fall out under Yes/No. */}
            <FieldLabel label="Corner">
              <select
                value={filters.isCornerLot}
                onChange={(e) =>
                  update('isCornerLot', e.target.value as '' | 'Yes' | 'No')
                }
                className={FIELD_CLASS}
                data-testid="filter-corner"
              >
                <option value="">Any</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </FieldLabel>

            {/* ★★★ fix-483 §A2 — THE SHAPE FILTER IS GONE. Bobby, 2026-09-02:
                *"Also remove shape."*

                ★★ THE SHAPE **COLUMN** STAYS, and that is not an oversight —
                Tag and Work each lost their filter AND their column in the same
                sentence, and Shape was named alone. fix-410 put the column
                beside Corner because the two shape-of-the-lot facts read
                together, and removing a column he did not ask about is the
                fix-402/fix-406 mistake run backwards.

                ★ What is genuinely lost is fix-410's *"a state you cannot
                  filter for is a state you cannot audit"* — the unanswered
                  population is still VISIBLE in the column, but no longer
                  selectable. Recorded rather than absorbed. */}

            {/* ★★★ fix-483 §A2 — THE TAG FILTER IS GONE, AND SO IS THE TAGS
                COLUMN. Bobby: *"under library, remove the option for tag, and
                remove tags from the list below."* `projects.project_tags` is
                untouched and still edited by the chip editor on the Project
                Overview. */}

            {/* ★★★ THE LOTS FILTER USED TO SIT HERE, and it is gone by ruling.
                Bobby, 2026-08-25: *"we dont need it as a filtering option for
                this screen"*.

                ★★★ AND fix-406 TOOK THE COLUMN TOO. Bobby, 2026-08-26: *"we can
                remove lots from the vertical bar below for the sort column as
                it isnt really relevant here."* The fix-402 note that used to
                stand here said "THE LOTS COLUMN STAYS — he removed the filter,
                not the data", and it was correct on the evidence it had. It is
                SUPERSEDED, NOT MISTAKEN: two rulings a day apart, the second
                widening the first. Both are kept visible rather than the older
                one being quietly overwritten (fix-400's rule). */}
          </div>
        </div>

        {/* ── UNIT ────────────────────────────────────────────────────── */}
        <div
          className="flex-1 min-w-[300px] bg-s2 border rounded-lg p-3 cursor-pointer"
          style={NEUTRAL_CARD_BORDER}
          onClick={(e) => selectViewFromCard(e, 'unit')}
          data-testid="filter-card-unit"
        >
          <div className="flex items-baseline gap-2 mb-2">
            {/* ★★★ The caption still carries fix-402's conjunction rule, said
                where somebody choosing filters can read it — not only in the
                code that implements it. */}
            <GroupHeading
              label="Unit"
              caption="show units matching all of these"
              view="unit"
              active={filters.view === 'unit'}
              onSelect={() => update('view', 'unit')}
              testid="filter-chip-unit"
            />
            <CardClear
              keys={UNIT_FILTER_KEYS}
              filters={filters}
              onClear={clearCard}
              testid="filter-clear-unit"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3 pb-2.5 mb-2.5 border-b border-border">
            <TargetRange
              label="Unit Width (ft)"
              target={filters.unitwTarget}
              buf={filters.unitwBuf}
              onTarget={(v) => update('unitwTarget', v)}
              onBuf={(v) => update('unitwBuf', v)}
              testIdPrefix="unitw"
            />
            <TargetRange
              label="Unit Depth (ft)"
              target={filters.unitdTarget}
              buf={filters.unitdBuf}
              onTarget={(v) => update('unitdTarget', v)}
              onBuf={(v) => update('unitdBuf', v)}
              testIdPrefix="unitd"
            />
            {/* ★★★ fix-488 §B (P-150) — THE CONTROL BOBBY ASKED FOR BY NAME.
                *"show me all my 1,700 sqft units with a garage."* This target,
                ANDed with the Parking select below on the SAME unit — fix-402's
                per-unit conjunction, which is what makes the answer mean what
                the sentence means. */}
            <TargetRange
              label="Unit Size (sf)"
              target={filters.unitsizeTarget}
              buf={filters.unitsizeBuf}
              onTarget={(v) => update('unitsizeTarget', v)}
              onBuf={(v) => update('unitsizeBuf', v)}
              testIdPrefix="unitsize"
              unit="sf"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {/* ★★ fix-402: parking is a UNIT property now. A picked kind
                requires that RECORDED kind — a unit nobody has answered for
                does not match, and `None` matches only an explicit none. */}
            <FieldLabel label="Parking">
              <select
                value={filters.parkingKind}
                onChange={(e) =>
                  update('parkingKind', e.target.value as '' | ParkingKind)
                }
                className={FIELD_CLASS}
                data-testid="filter-parking-kind"
              >
                <option value="">Any</option>
                {PARKING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PARKING_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Stalls / unit">
              <select
                value={filters.stalls}
                onChange={(e) =>
                  update('stalls', e.target.value as StallsTier)
                }
                className={FIELD_CLASS}
                data-testid="filter-stalls"
              >
                <option value="">Any</option>
                <option value="1+">1+</option>
                <option value="2+">2+</option>
              </select>
            </FieldLabel>

            {/* ★★★ fix-483 §A2 — THE WORK FILTER IS GONE, AND SO IS THE WORK
                COLUMN. Bobby: *"Under unit, get rid of work, and the filter
                below for work."*

                ★★★ fix-486 §D (P-143) FINISHED IT: THE FIELD ITSELF IS RETIRED.
                fix-483 kept fix-412's default exclusion — a project whose every
                unit was a confirmed no-work dropped out of the set — while
                noting that removing this control had made it unaskable. Bobby
                then ruled the field out entirely: *one way to say remodel, and
                it is the type.* So the exclusion is gone too, and there is no
                unaskable rule left here.

                ★★ IT NEVER EXCLUDED A ROW. Measured on prod 2026-09-03: 245
                unit rows, ZERO non-null `work_scope`. The predicate fired on
                `'none'`, so in the weeks it shipped it removed nothing from
                anybody's Library — which is why this is a rule being deleted
                rather than a behaviour. See lib/libraryHelpers. */}

            <FieldLabel label="Roof Deck">
              <select
                value={filters.roofDeck}
                onChange={(e) =>
                  update('roofDeck', e.target.value as RoofDeckFilter)
                }
                className={FIELD_CLASS}
                data-testid="filter-roof-deck"
              >
                <option value="">Any</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </FieldLabel>

            {/* fix-205: Stories tier — matches a project that has at least one
                unit_type with the picked stories (4+ = 4 or more). Highlights
                the matching unit rows in the expand, like the W/D filters.
                fix-402 moved it under UNIT; its meaning is unchanged. */}
            <FieldLabel label="Stories">
              <select
                value={filters.stories}
                onChange={(e) =>
                  update('stories', e.target.value as LibraryFilters['stories'])
                }
                className={FIELD_CLASS}
                data-testid="filter-stories"
              >
                <option value="">Any</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4+">4+</option>
              </select>
            </FieldLabel>

            <FieldLabel label="Type">
              {/* fix-91: multi-select. Pick adds a chip; chip × removes it.
                  Matching is any-of in libraryHelpers.filterLibraryRows. */}
              <div className="flex flex-wrap items-center gap-1">
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    if (filters.productTypes.includes(v)) return;
                    update('productTypes', [...filters.productTypes, v]);
                    e.currentTarget.value = '';
                  }}
                  className={FIELD_CLASS}
                  data-testid="filter-product-type"
                >
                  <option value="">Any</option>
                  {productTypeOptions
                    .filter((t) => !filters.productTypes.includes(t))
                    .map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                </select>
                {filters.productTypes.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-surface border border-border text-text"
                    data-testid={`filter-product-type-chip-${t}`}
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() =>
                        update(
                          'productTypes',
                          filters.productTypes.filter((x) => x !== t),
                        )
                      }
                      className="text-dim hover:text-text leading-none"
                      title={`Remove ${t}`}
                      data-testid={`filter-product-type-remove-${t}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </FieldLabel>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span
          className="text-[11px] text-dim font-mono ml-auto"
          data-testid="library-count"
        >
          {/* ★★★ fix-447 §B5 — THE UNIT VIEW SAYS BOTH NUMBERS, AND IT HAS TO.
              Measured on prod: 96 of 202 projects hold no `unit_types` at all,
              so switching to UNIT drops the project count from 202 to 103 while
              showing 235 rows. A bare number changing like that reads as a
              filter that broke; naming both makes it read as what it is. */}
          {filters.view === 'unit'
            ? `${unitRows.length} unit${unitRows.length === 1 ? '' : 's'} across ${unitProjectCount} project${unitProjectCount === 1 ? '' : 's'}`
            : `${sorted.length} project${sorted.length === 1 ? '' : 's'}`}
          {/* ★★★ fix-524 §B — THE HIDE SAYS SO. The Library's population drops
              by the number of cancelled projects the moment this ships, and a
              total that moves with nothing explaining it reads as a filter that
              broke. Same argument fix-447 §B5 made about the unit view's
              project count, applied to a filter the reader did not set. */}
          {hiddenRetiredCount > 0 && (
            <span data-testid="library-retired-hidden">
              {` · ${hiddenRetiredCount} cancelled hidden`}
            </span>
          )}
          {/* ★★★ fix-525 §B: and the ones that STAYED are named too. 17 of them
              are here only because their unit dimensions are the only copy —
              a reader counting projects should know that some of the rows are
              superseded, not current inventory. Same argument as the line
              above it, in the other direction. */}
          {hatchedIds.size > 0 && (
            <span data-testid="library-retired-shown">
              {` · ${hatchedIds.size} superseded`}
            </span>
          )}
        </span>
      </div>

      {/* ★★★ fix-447 §B — TWO TABLES, ONE SET OF FILTERS.
          Bobby, 2026-08-26: *"The metric you are searching by decides the
          columns you get back."* Both cards stay live in both views; only the
          shape of the answer changes. */}
      <div className="bg-surface border border-border rounded-xl overflow-x-auto">
        {filters.view === 'unit' ? (
        <table className="w-full text-xs" data-testid="library-table-unit">
          <thead>
            <tr className="bg-s2 border-b-2 border-border">
              <UTh sort={unitSort} col="address" onClick={toggleUnitSort} align="left">Address</UTh>
              <UTh sort={unitSort} col="juris" onClick={toggleUnitSort} align="left">Juris</UTh>
              {/* ★★★ fix-483 §A5 (P-136) — THE `Type` COLUMN IS GONE FROM THIS
                  TABLE ONLY. Bobby, 2026-09-02: *"under unit, TYPE and UNIT
                  TYPE 2x. seems redundant."*

                  ★★ THE SITE TABLE KEEPS ITS `Type`, and that is the whole
                  point of the ruling rather than an exception to it: over there
                  it is the ONLY answer to "what kind of building is this",
                  because there is no unit row beside it. Here the next column
                  along says it per unit, which is the more specific answer to
                  the same question. */}
              {/* ★★★ fix-519 §A (P-230) — THE HEADER RENDERS FROM
                  `LIBRARY_UNIT_COLUMNS`, AND SO DO THE CELLS.

                  This strip and `LibraryUnitRow`'s `<td>`s were two
                  hand-written lists 500 lines apart, and they had drifted:
                  fix-514 §H reordered THIS one to match the filter box and
                  left the row on fix-402's order, so every value after
                  `Size (sf)` printed under somebody else's heading — a
                  parking code under ROOF DECK on `10150 NE 64th St`.

                  ★★★ fix-412's ruling — *"the header strip and the row are
                      one declaration, so read-only cells line up under their
                      headers for free"* — was quoted at the bottom of this
                      file as still true. It had been false since fix-447 §B6
                      split the row out. **It is true again now, and this list
                      is the declaration.** */}
              {LIBRARY_UNIT_COLUMNS.map((c) => (
                <UTh
                  key={c.col}
                  sort={unitSort}
                  col={c.col}
                  onClick={toggleUnitSort}
                  align={c.align}
                >
                  {c.label}
                </UTh>
              ))}
              {/* ★ fix-483 §A2: the `Work` column went with its filter. */}
              <UTh sort={unitSort} col="stage" onClick={toggleUnitSort} align="center">Stage</UTh>
            </tr>
          </thead>
          <tbody>
            {unitRows.map((u, i) => (
              <LibraryUnitRow
                editable={canEditLibrary}
                // ★★★ fix-532 §A — THE WHOLE ARRAY GOES BACK, not one unit.
                //     `unit_types` is a jsonb column and the RPC replaces it,
                //     so the row being edited is spliced into the project's
                //     CURRENT list. ★★ `parseUnitTypes` is a WHITELIST and both
                //     editors write the result back (fix-412), so reading
                //     through it here is what stops an unnamed key being
                //     dropped on the next save.
                onEditUnit={(idx, key, val) => {
                  const all: UnitType[] = parseUnitTypes(
                    visibleProjects.find((p) => p.id === u.project.projectId)
                      ?.unit_types,
                  );
                  if (!all[idx]) return;
                  const next: UnitType[] = all.map((unit, i) =>
                    i === idx ? { ...unit, [key]: val } : unit,
                  );
                  saveLibrary.mutate({
                    projectId: u.project.projectId,
                    patch: { unit_types: next },
                    fieldLabel: key === 'width_ft' ? 'Unit width' : 'Unit depth',
                  });
                }}
                key={u.key}
                bandClass={unitBands[i] === 1 ? PROJECT_BAND_CLASS : ''}
                row={u.unit}
                projectId={u.project.projectId}
                index={u.index}
                productTypes={u.project.productTypes}
                registryTypes={productTypeOptions}
                // ★★★ THE PROJECT CELLS, PASSED IN. `LibraryUnitRow` renders
                //     its own `<tr>`, so the only way to put Address/Juris/Type
                //     in front of its cells — and Work/Stage after them — is to
                //     hand them to it. That is what keeps this ONE component:
                //     the editable unit row that used to hide behind fix-81's
                //     caret is the unit view's row, writing through the same
                //     untouched OCC path.
                leading={
                  <>
                    <td className="px-2 py-1.5 font-display font-bold text-text">
                      {/* ★ Same OriginLink and the same origin the SITE row
                          uses — a unit row is still a way into the project, and
                          Previous must say "Library" either way (fix-403). */}
                      <OriginLink
                        to={`/project/${u.project.projectId}`}
                        state={{ from: PREVIOUS_ORIGINS.library }}
                        className="hover:underline"
                        data-testid={`library-unit-address-${u.key}`}
                        // ★ fix-530 §D: no strike-through. See the site row.
                        style={undefined}
                      >
                        {u.project.address}
                      </OriginLink>
                      {/* ★★★ fix-525 §B: and on the UNIT row too — this is the
                          view the 11 originals are kept FOR, so it is the one
                          place the mark must not be forgotten. */}
                      {hatchedIds.get(u.project.projectId) && (
                        <>
                          {' '}
                          <RetiredBadge
                            cause={hatchedIds.get(u.project.projectId)!}
                            compact
                            title="Superseded by a redesign — kept here because its unit dimensions are the only copy"
                            testid={`library-retired-unit-${u.key}`}
                          />
                        </>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted">{u.project.juris || '—'}</td>
                  </>
                }
                trailing={
                  <>
                    {/* ★★★ fix-514 §H (P-196) — THE `Edit in Project Data →`
                        LINK IS GONE, AND THIS SUPERSEDES fix-506 §H RATHER
                        THAN CONTRADICTING IT.

                        fix-506 §H added it as the REPLACEMENT when
                        [[P-167-library-fields-are-not-a-write-surface]] made
                        these cells read-only — *"a one-click path to that
                        project's Project Data"* — and that was the right call
                        with the evidence it had. Bobby, 2026-09-10: *"I'm not
                        sure why it says Edit in Project Data — that's something
                        people should already know… If it's blank, it's blank,
                        and then you know to go edit that in Project Details."*

                        ★★ RECORDED AS SUPERSEDING SO NOBODY RE-ADDS IT IN SIX
                           WEEKS CITING P-167. P-167 is untouched: these cells
                           are still read-only, and that is still right. What
                           changed is whether every row needs to carry a
                           signpost to the same place.

                        ★ And they were about to carry a STALE NAME anyway —
                          §A renames the destination to Project Details, so the
                          choice was rename N links or remove them. Removing is
                          cheaper and is what was asked.
                        ★ `projectDataHref` STAYS in `lib/projectDataTabs`: the
                          `?data=` deep link is still how the modal opens on a
                          tab, and fix-362 §2's rule (a link you cannot paste is
                          not a link) is unaffected. */}
                    {/* ★ fix-483 §A2: fix-412's read-only work-scope cell went
                        with the filter it existed to let you SEE. */}
                    <td className="px-2 py-1.5 text-center">
                      <span
                        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border ${STAGE_BADGE[u.project.stage]}`}
                      >
                        {u.project.stage}
                      </span>
                    </td>
                  </>
                }
              />
            ))}
            {unitRows.length === 0 && (
              <tr>
                <td
                  // ★ fix-483: 11. Was 13 — §A5 took `Type` (a project cell)
                  //   and §A2 took `Work` (a trailing cell). Asserted against
                  //   the rendered header count, like its sibling, because
                  //   A STALE colSpan IS INVISIBLE UNTIL THE TABLE IS EMPTY.
                  // ★ fix-488 §B: 12. Was 11 — the Size column joined the
                  //   header. A stale span is invisible until the table is
                  //   empty (the note above).
                  colSpan={12}
                  className="px-4 py-8 text-center text-xs text-dim italic"
                >
                  No units match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        ) : (
        <table className="w-full text-xs" data-testid="library-table">
          <thead>
            <tr className="bg-s2 border-b-2 border-border">
              {/* ★ fix-447 §B2: the caret column is gone with fix-81's path. */}
              {/* =================================================================
                  ★★★ fix-514 §H (P-196) — THE TABLE READS IN THE ORDER THE
                      FILTER BOX READS
                  =================================================================

                  Bobby's markup: **address · lot width · lot depth · lot size ·
                  jurisdiction · zone · alley · corner · stage.**

                  ★★★ THE RULE, STATED SO FUTURE TABS INHERIT IT: *the table
                      reads left-to-right in the order the filter box reads.* A
                      person narrows with the filters and then reads the result;
                      making them re-find each column in a different order is a
                      cost paid on every scan.

                  ★★★ WHICH IS ALSO WHY `Lot W×D` SPLITS INTO TWO. It has been
                      one combined cell since fix-402, and the filter box has
                      offered Lot Width and Lot Depth as two independent ± boxes
                      for just as long — one column can never line up with two
                      controls. `lotDepth` gained a sort key and an arm in
                      `libraryHelpers` in the same change.

                  ★★ `Type` AND `Units` KEEP THEIR CELLS AND MOVE TO THE END.
                     They are not in Bobby's list and they are not struck out
                     either, and there is no SITE filter for either of them —
                     Product Type filters the UNIT view. So the rule places
                     them after the filtered columns rather than inventing a
                     position for them. Nothing was dropped silently.

                  ★ ONE DEVIATION, NAMED: Bobby's list reads jurisdiction before
                    zone; the filter box asks Zone first. His list wins — it is
                    the ruling, and the filter-order sentence is the reason
                    behind it rather than a second authority. */}
              <Th sort={sort} col="address" onClick={toggleSort} align="left">Address</Th>
              <Th sort={sort} col="lotWidth" onClick={toggleSort} align="center">Lot W</Th>
              <Th sort={sort} col="lotDepth" onClick={toggleSort} align="center">Lot D</Th>
              {/* ★★★ fix-488 §A — LOT SIZE, BESIDE THE PAIR IT RELATES TO.
                  A DERIVED size renders in the same face as a typed one
                  (Bobby's rule: the number is the number), with the derived
                  ones marked only by the `~` a hover explains. */}
              <Th sort={sort} col="lotSizeSf" onClick={toggleSort} align="center">Lot SF</Th>
              {/* ★★★ fix-519 §C (P-228) — THESE THREE AND THE FILTER BOX'S
                  THREE ARE ONE LIST NOW. fix-514 §H named the deviation in a
                  comment — *"Bobby's list reads jurisdiction before zone; the
                  filter box asks Zone first"* — and a comment is not a rule.
                  Jurisdiction is first in both, and the order is declared in
                  `lib/librarySiteFields` so it cannot drift again. */}
              {LIBRARY_SITE_SHARED_FIELDS.map((f) => (
                <Th
                  key={f.key}
                  sort={sort}
                  col={f.key}
                  onClick={toggleSort}
                  align={f.align}
                >
                  {f.columnLabel}
                </Th>
              ))}
              {/* fix-122: Corner Lot — same dimensions feel very different on a
                  corner. */}
              <Th sort={sort} col="isCornerLot" onClick={toggleSort} align="center">Corner</Th>
              {/* ★★★ fix-514 §H — THE `Shape` COLUMN IS GONE, STRUCK OUT IN
                  BOBBY'S OWN MARKUP.
                  ★★ AND IT IS CONSISTENT RATHER THAN NEW:
                     [[P-161-lot-shape-is-implied-by-its-dimensions-not-labelled]]
                     removed the same restatement from the Project Overview in
                     fix-506 §C, on the ruling *"the shape is IMPLIED BY THE
                     DIMENSIONS"* — and the two dimension columns are now the
                     second and third things on this row. fix-410's note that
                     the two shape-of-the-lot columns "read together" is
                     superseded: Corner is a fact about the parcel's position,
                     Shape was a restatement of the pair beside it.
                  ★ `projects.is_regular_shape` is UNTOUCHED — fix-410's column,
                    its wizard control and its tri-state NULL rule all stay.
                    This is the Library table only, and the fix-512 read found
                    the stored flag disagreeing with the implied shape on 10 of
                    219 rows, which is a reason to stop printing it here rather
                    than to delete it. */}
              {/* ★★★ fix-406 — THE LOTS COLUMN IS GONE BY RULING (2026-08-26):
                  *"we can remove lots from the vertical bar below for the sort
                  column as it isnt really relevant here."* The DATA is
                  untouched — `projects.num_lots` still renders in five other
                  places. */}
              <Th sort={sort} col="productTypes" onClick={toggleSort} align="left">Type</Th>
              <Th sort={sort} col="units" onClick={toggleSort} align="center">Units</Th>
              {/* ★ fix-483 §A2: the `Tags` header went with the Tag filter —
                  one ruling, both halves. */}
              <Th sort={sort} col="stage" onClick={toggleSort} align="center">Stage</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <Row
                key={r.projectId}
                row={r}
                bandClass={siteBands[i] === 1 ? PROJECT_BAND_CLASS : ''}
                retired={hatchedIds.get(r.projectId) ?? null}
                editable={canEditLibrary}
                archivedPlan={archivedFallbackQ.data?.has(r.projectId) ?? false}
                zoneOptions={zoneFilterOptions}
                onSave={(patch, fieldLabel) =>
                  saveLibrary.mutate({ projectId: r.projectId, patch, fieldLabel })
                }
              />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  // ★ fix-483 §A2: 10. Was 11 — the Tags column left with the
                  //   Tag filter.
                  //
                  // ★ fix-447: 11. Was 14 — the caret cell and fix-402's two
                  //   unit rollups all left in that ticket.
                  //
                  // ★★ fix-410's and fix-406's notes, kept because they are the
                  //   reason anyone checks: this span read 12 while the table
                  //   had 14 columns, so the "no projects match" row had been
                  //   two short since fix-402 added Parking and Roof Deck — and
                  //   nothing showed it, because A STALE colSpan IS INVISIBLE
                  //   UNTIL THE TABLE IS EMPTY. Every span here is asserted
                  //   against the rendered header count, so removing three
                  //   columns cannot quietly break the empty state either.
                  // ★ fix-488 §A: 11. Was 10 — the Lot SF column joined the
                  //   header, and a stale span is invisible until the table is
                  //   empty (the note above, third time it has mattered).
                  colSpan={11}
                  className="px-4 py-8 text-center text-xs text-dim italic"
                >
                  No projects match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

/** ★ fix-447: the UNIT table's sortable header. A twin of `Th` rather than a
 *  generic one, because the two take different column unions and a shared
 *  generic would let a site column be passed to the unit sorter — the exact
 *  mix-up lib/libraryUnitRows exists to prevent. Same markup, same arrows, so
 *  the two tables read identically. */
function UTh({
  sort,
  col,
  onClick,
  align,
  children,
}: {
  sort: UnitSortState;
  col: UnitSortableColumn;
  onClick: (col: UnitSortableColumn) => void;
  align: 'left' | 'center';
  children: React.ReactNode;
}) {
  const isActive = sort.col === col;
  const arrow = isActive ? (sort.asc ? '↑' : '↓') : '↕';
  const alignClass = align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      onClick={() => onClick(col)}
      className={`px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-text cursor-pointer select-none whitespace-nowrap ${alignClass} ${
        isActive ? 'text-text' : 'text-text/80'
      }`}
      data-testid={`library-uth-${col}`}
    >
      {children} {arrow}
    </th>
  );
}

function Th({
  sort,
  col,
  onClick,
  align,
  children,
}: {
  sort: SortState;
  col: SortableColumn;
  onClick: (col: SortableColumn) => void;
  align: 'left' | 'center';
  children: React.ReactNode;
}) {
  const isActive = sort.col === col;
  const arrow = isActive ? (sort.asc ? '↑' : '↓') : '↕';
  const alignClass = align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      onClick={() => onClick(col)}
      className={`px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-text cursor-pointer select-none whitespace-nowrap ${alignClass} ${
        isActive ? 'text-text' : 'text-text/80'
      }`}
      data-testid={`library-th-${col}`}
    >
      {children} {arrow}
    </th>
  );
}

/** ★★ fix-447 §B6: `expanded`, `onToggle`, `matchedUnitIndices` and
 *  `onWriteUnitTypes` are gone from this row. All four served fix-81's
 *  sub-table, which the UNIT view replaces — the highlight and the editing did
 *  not disappear, they moved to the rows that now show the units. */
interface RowProps {
  row: LibraryRow;
  /** ★ fix-483 §A1: '' or the band class. Handed down rather than derived here
   *  — the band depends on the row's POSITION IN THE SORTED LIST, which only
   *  the table knows. */
  bandClass: string;
  /** ★★★ fix-525 §B: `redesigned` for a project another one has superseded —
   *  kept in the Library because 11 of 17 originals hold the only unit
   *  dimensions their pair has. Null for everything else. */
  retired: RetiredCause | null;
  /** ★★★ fix-532 §A: does this viewer hold `may_edit_library`? Cosmetic — the
   *  RPC is the gate. */
  editable: boolean;
  /** ★★★ fix-532 §C: this project's plan of record is a superseded drawing.
   *  60 of 220 on prod, 2026-09-12. */
  archivedPlan: boolean;
  /** fix-415's registry, so a capable typist cannot reintroduce an off-list
   *  zone. */
  zoneOptions: readonly string[];
  onSave: (patch: LibraryFieldPatch, fieldLabel: string) => void;
}
/** ★ The Site card's own list (`SiteSelectRow` for Alley), stated once here so
 *  the two surfaces cannot offer different answers to one question. */
const ALLEY_OPTIONS = ['Yes', 'No'] as const;

function Row({
  row,
  bandClass,
  retired,
  editable,
  archivedPlan,
  zoneOptions,
  onSave,
}: RowProps) {
  return (
    <>
      <tr
        className={`border-b border-border hover:bg-s2 transition ${bandClass}`}
        data-testid={`library-row-${row.projectId}`}
        data-band={bandClass ? 'on' : 'off'}
      >
        <td className="px-2 py-1.5 font-display font-bold text-text">
          <OriginLink
            to={`/project/${row.projectId}`}
            // ★ fix-403: tell Project Overview where this click came from, so
            //   its Previous button knows which list to go back to.
            state={{ from: PREVIOUS_ORIGINS.library }}
            className="hover:underline"
            // ★ fix-530 §D: no strike-through on a retired row either — the
            //   ruling is about the STATE, not about the surface. The badge
            //   beside it carries the hatch and the word.
            style={undefined}
          >
            {row.address}
          </OriginLink>
          {/* ★★★ fix-525 §B — HATCHED, IN THE VOCABULARY THAT ALREADY EXISTS.
              A full-row hatch would make the numbers this table is FOR
              unreadable, so the retired paint goes on the badge fix-524 built
              — same recipe, same palette, same strike-through — and the address
              is struck the way the block's is. A reader who has learned the
              purple on the Draw Schedule recognises it here without being
              taught a second thing. */}
          {/* ★★★ fix-532 §C — WORDS, and in the same place a reader already
              looks for what is odd about this row. The cell has no room for the
              sentence, so the short form carries the `title` — the long one is
              never the only thing said, and it is the SAME string every other
              surface uses. */}
          {archivedPlan && (
            <>
              {' '}
              <span
                className="text-[9px] font-extrabold uppercase tracking-wider"
                style={{ color: 'var(--color-co)' }}
                title={ARCHIVED_FALLBACK_LABEL}
                data-testid={`library-archived-${row.projectId}`}
              >
                {ARCHIVED_FALLBACK_SHORT}
              </span>
            </>
          )}
          {retired && (
            <>
              {' '}
              <RetiredBadge
                cause={retired}
                compact
                title="Superseded by a redesign — kept here because its unit dimensions are the only copy"
                testid={`library-retired-${row.projectId}`}
              />
            </>
          )}
        </td>
        {/* ★★★ fix-514 §H: LOT WIDTH AND LOT DEPTH, two cells, in filter order.
            ★ fix-411 §2's rule survives the split: the SORT reads the
              unrounded value, the CELL renders whole feet, so 100.47 and 100.4
              keep their real order while both print "100".
            ★★ AND `lotSizeView` STILL DECIDES WHAT EACH SIDE SAYS. It is what
               knows about "varies" — a typed size beside a missing dimension —
               so splitting the cell must not mean splitting the rule. The 0
               sentinels map back to null first: `lotWidth: 0` means "not
               recorded" in a `LibraryRow`. */}
        <td className="px-2 py-1.5 text-center" data-testid={`library-lot-w-${row.projectId}`}>
          {/* ★★★ fix-532 §A: editable for a capability holder, and byte-for-byte
              today's cell for everyone else. ★ `lotSizeView`'s "varies" italic
              is a READ-ONLY reading of two dimensions that disagree — an
              editable cell shows the row's own number, because that is the one
              a person is about to change. */}
          {editable ? (
            <LibraryDimensionCell
              value={row.lotWidth || null}
              editable
              label="Lot width"
              testId={`library-lot-w-input-${row.projectId}`}
              onCommit={(v) => onSave({ lot_width: v }, 'Lot width')}
            />
          ) : (
            (() => {
              const v = lotSizeView(row.lotWidth || null, row.lotDepth || null, row.lotSizeSf);
              if (v.widthText === null) return <span className="text-dim">—</span>;
              return v.widthVaries ? (
                <span className="italic text-dim font-mono">{v.widthText}</span>
              ) : (
                <span className="font-mono text-text">{v.widthText}</span>
              );
            })()
          )}
        </td>
        <td className="px-2 py-1.5 text-center" data-testid={`library-lot-d-${row.projectId}`}>
          {editable ? (
            <LibraryDimensionCell
              value={row.lotDepth || null}
              editable
              label="Lot depth"
              testId={`library-lot-d-input-${row.projectId}`}
              onCommit={(v) => onSave({ lot_depth: v }, 'Lot depth')}
            />
          ) : (
            (() => {
              const v = lotSizeView(row.lotWidth || null, row.lotDepth || null, row.lotSizeSf);
              if (v.depthText === null) return <span className="text-dim">—</span>;
              return v.depthVaries ? (
                <span className="italic text-dim font-mono">{v.depthText}</span>
              ) : (
                <span className="font-mono text-text">{v.depthText}</span>
              );
            })()
          )}
        </td>
        <td className="px-2 py-1.5 text-center">
          {(() => {
            const v = lotSizeView(row.lotWidth || null, row.lotDepth || null, row.lotSizeSf);
            if (v.sizeText === null) return <span className="text-dim">—</span>;
            return (
              <span
                className="font-mono text-text"
                // ★★ A DERIVED SIZE IS MARKED, NOT HIDDEN AND NOT RESTYLED. It
                //    is the same number in the same face — a `~` and a title
                //    are the whole distinction.
                title={
                  v.sizeDerived
                    ? 'Width × depth — nobody has typed a lot size'
                    : v.irregular
                      ? 'Typed lot size. It is more than 5% from width × depth — an irregular lot.'
                      : 'Typed lot size'
                }
                data-derived={v.sizeDerived ? 'true' : 'false'}
                data-testid="library-lot-size"
              >
                {v.sizeDerived ? '~' : ''}
                {v.sizeText}
              </span>
            );
          })()}
        </td>
        <td className="px-2 py-1.5 text-muted">{row.juris || '—'}</td>
        <td className="px-2 py-1.5 text-center">
          <LibraryChoiceCell
            value={row.zone || null}
            options={zoneOptions}
            editable={editable}
            testId={`library-zone-${row.projectId}`}
            onCommit={(v) => onSave({ zone: v }, 'Zone')}
          />
        </td>
        <td className="px-2 py-1.5 text-center">
          {/* ★ Alley is the same tri-state the Site card offers — Yes / No /
              not recorded. The list is short and closed, so it is stated here
              rather than threaded from a registry that does not exist. */}
          <LibraryChoiceCell
            value={row.alley || null}
            options={ALLEY_OPTIONS}
            editable={editable}
            testId={`library-alley-${row.projectId}`}
            onCommit={(v) => onSave({ alley: v }, 'Alley')}
          />
        </td>
        {/* fix-122: Corner column. Tri-state — NULL renders as the dim em dash
            so unanswered rows are visually distinct from a confirmed No. */}
        <td
          className="px-2 py-1.5 text-center"
          data-testid={`library-corner-${row.projectId}`}
        >
          {row.isCornerLot === true ? (
            <span className="font-mono text-text">Yes</span>
          ) : row.isCornerLot === false ? (
            <span className="font-mono text-text">No</span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </td>
        {/* ★★★ fix-514 §H: the `Shape` CELL went with its header — see the
            ruling quoted there. `projects.is_regular_shape` is untouched. */}
        <td className="px-2 py-1.5 text-text">
          {row.productTypes.length === 0 ? (
            <span className="text-dim">—</span>
          ) : (
            row.productTypes.join(', ')
          )}
        </td>
        <td className="px-2 py-1.5 text-center font-mono font-bold text-text">
          {row.units || '—'}
        </td>
        {/* ★ fix-483 §A2: the Tags cell went with its header. */}
        <td className="px-2 py-1.5 text-center">
          <span
            className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border ${STAGE_BADGE[row.stage]}`}
          >
            {STAGE_LABEL[row.stage]}
          </span>
        </td>
      </tr>
    </>
  );
}

// ★★★ fix-447 §B6 — `UnitTypeMiniTable` IS GONE, AND ITS JOB IS NOT.
//
// It was the wrapper fix-81's caret opened: a <table> of `LibraryUnitRow`s
// for one project. The UNIT view renders those same rows directly, for every
// project at once, so the wrapper had no caller left — dead code, removed
// rather than left as scenery.
//
// ★★★ fix-506 §H SUPERSEDES THE PARAGRAPH THAT USED TO BE HERE. It said
// fix-206's rule — *"the unit table is EDITABLE inline, each cell writing
// through the same useUpdateProject path as Project Overview (one store)"* —
// was still true. It is not: Bobby ruled on 2026-09-08 that the Library is not
// a write surface (P-167), and the row below is read-only.
//
// ★★ THE "ONE STORE" HALF OF THAT RULE IS UNTOUCHED and is why this reads
//    live: an edit in Project Data patches the projects cache optimistically,
//    so it reflects here immediately. What went is the second EDITOR, not the
//    single source.
//
// ★ THE OTHER WRITE-SURFACE NOTES SHOULD SAY SO TOO — fix-406, fix-488 and
//   fix-415 each enumerate where a unit or site field can be written. The
//   Library left that list on 2026-09-08.

// One READ-ONLY unit_types row in the Library table. It kept fix-205's
// testids.
// ★ fix-472: the fix-205 matched-highlight is no longer among them. fix-469
//   made every printed row a match, so marking them all marked nothing; fix-447
//   §B6 had already removed the only other surface that used it. The fix-73/98 dirty-flag prop sync keeps
// a mid-typed value from being clobbered by an external cache refresh (the
// optimistic projects-cache patch from this or the Project Overview editor).
// ★★★ fix-506 §H — `OffListMark` IS DELETED, AND THE MARK IS NOT.
//
// It was a component because the editable row had two places to put it. The
// read-only row has one, so it is an inline `⚠` there instead — and fix-449
// §C's rule is unchanged: a stored value the registry does not offer is SHOWN,
// and told on. 22 of 235 unit rows carry one.
//
// ★ Kept as a comment rather than a component with a single caller, which is
//   the "keep-this-it-is-used-elsewhere must NAME the call site" rule fix-472
//   banked two hundred lines up this file.


// ===========================================================================
// ★★★ fix-506 §H (P-167) — THE LIBRARY IS NOT A WRITE SURFACE
// ===========================================================================
//
// Bobby, 2026-09-08: *"every inline edit in the Library becomes read-only with
// a one-click path to that project's Project Data."*
//
// ★★★ EVERY CONTROL IN THIS ROW IS GONE — a `<select>` for the label, seven
//     buffered `<input>`s, the parking and roof-deck pickers, and with them the
//     fix-73/98 dirty-flag machinery each one needed. `LibraryMatrix` now makes
//     ZERO calls to `useUpdateProject`, which is the assertion §H is really
//     about: the Library was the second write path to `projects.unit_types`,
//     and a second write path is what fix-415 spent a ticket proving is where
//     server-side rules get bypassed.
//
// ★★ WHAT WAS ACTUALLY LOST IS SMALLER THAN THE DIFF SUGGESTS. STEP 0-3
//    enumerated it: the whole Library had exactly ONE write path —
//    `writeUnitTypes` → `useUpdateProject({ unit_types })` — feeding eight
//    inputs on this row. One store, one editor now, and the editor is the Units
//    tab of Project Data, which is the same `unit_types` array through the same
//    hook with the same OCC token.
//
// ★★★ fix-519 §A (P-230) — THIS PARAGRAPH USED TO SAY fix-412's RULING
//     SURVIVED, AND IT WAS THE LIE THAT LET P-230 HAPPEN.
//
//     It read: *"the header strip and the row are still one declaration, so
//     read-only cells line up under their headers for free."* That stopped
//     being true at fix-447 §B6, which pulled this row out to serve the UNIT
//     view directly — the header went to `LibraryMatrix`'s own `<thead>` and
//     the cells stayed here, 500 lines apart. Nobody noticed, because the
//     comment said otherwise and the columns still lined up by luck. fix-514
//     §H then reordered the header alone and the luck ran out.
//
// ★★★ IT IS TRUE AGAIN, AND FOR REAL: both render from
//     `lib/libraryUnitColumns.LIBRARY_UNIT_COLUMNS`. ★ A comment claiming an
//     invariant is not an invariant — if it is worth writing down it is worth a
//     test, and `LibraryUnitColumnsFix519` holds this one.

function LibraryUnitRow({
  row,
  projectId,
  index,
  productTypes,
  registryTypes,
  leading,
  trailing,
  bandClass = '',
  editable = false,
  onEditUnit,
}: {
  row: UnitType;
  projectId: string;
  index: number;
  productTypes: string[];
  /** ★ fix-449 §C: the CANONICAL product-type registry
   *  (app_config.productTypeOptions), for the off-list mark. Distinct from
   *  `productTypes`, which is this PROJECT's chosen subset. ★ It survives §H
   *  because the MARK is a reading aid, not an edit — a label the app does not
   *  offer anywhere is worth flagging whether or not you can change it here. */
  registryTypes: string[];
  /** ★★★ fix-447: cells rendered BEFORE and AFTER this row's unit cells. This
   *  component owns its `<tr>`, so the UNIT view — which needs Address/Juris/
   *  Type in front and Stage behind — cannot wrap it. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** ★ fix-483 §A1: '' or the alternate-project band class. */
  bandClass?: string;
  /** ★★★ fix-532 §A: does this viewer hold `may_edit_library`? Cosmetic — the
   *  RPC is the gate. */
  editable?: boolean;
  /** Commit one unit's width or depth. Absent when not editable. */
  onEditUnit?: (
    index: number,
    key: 'width_ft' | 'depth_ft',
    value: number | null,
  ) => void;
}) {
  // fix-209 → fix-212: the shown label is the RESOLVED one — with several
  // product types it is the value only if it IS a product type; with exactly
  // one it is always that type, overriding a legacy custom.
  const shown = resolveUnitLabel(row.label, productTypes);
  const offList = isOffListUnitLabel(shown, registryTypes);

  return (
    <tr
      className={`hover:bg-s2 transition ${bandClass}`}
      data-testid={`library-unit-row-${projectId}-${index}`}
      data-band={bandClass ? 'on' : 'off'}
    >
      {leading}
      {/* ★★★ fix-519 §A (P-230) — ONE LIST, TWO READERS. Every cell below is
          bound to its `unit_types` key BY NAME through
          `LIBRARY_UNIT_COLUMNS`, which is the same list the `<thead>` renders
          from. A column and its value can no longer be separated: inserting
          one changes both, or neither.
          ★ `unitLabel` is the exception and is handled inline, because its
            text is RESOLVED against the project's product types (fix-209/212)
            and it carries fix-449 §C's off-list mark. It stays FIRST in the
            list either way, so its position is declared with the rest. */}
      {LIBRARY_UNIT_COLUMNS.map((c) =>
        c.read === null ? (
          <td
            key={c.col}
            className="px-2 py-0.5 font-mono text-text whitespace-nowrap"
          >
            <span data-testid={`library-unit-${projectId}-${index}-${c.testId}`}>
              {shown || '—'}
            </span>
            {offList && (
              // ★ fix-449 §C's mark, unchanged: this label is not in the
              //   registry, so nothing in the app offers it.
              <span
                className="ml-1 text-[9px] font-bold text-co"
                title="Not in the product-type registry"
                data-testid={`library-unit-${projectId}-${index}-offlist`}
              >
                ⚠
              </span>
            )}
          </td>
        ) : editable && (c.sourceKey === 'width_ft' || c.sourceKey === 'depth_ft') ? (
          // ★★★ fix-532 §A — THE FIFTH FIELD, AND ONLY ITS TWO NUMBERS.
          //
          //     `unit_types` is one of the five `bp_update_library_fields`
          //     accepts, and the Library IS the unit-dimension matrix — a width
          //     and a depth are what somebody comes here to correct. The label,
          //     the quantity and the rest stay read-only: they are edited in
          //     Project Data's Units tab, and re-opening a second editor for
          //     them is exactly what fix-506 §H closed.
          //
          // ★★ BOUND BY `sourceKey`, not by column position. fix-519 §A cost a
          //    ticket to the other arrangement — two hand-written lists that
          //    drifted — and this is the same list, asked the same way.
          <td key={c.col} className="px-2 py-0.5">
            <LibraryDimensionCell
              value={c.read(row).value ?? null}
              editable
              label={c.sourceKey === 'width_ft' ? 'Unit width' : 'Unit depth'}
              testId={`library-unit-${projectId}-${index}-${c.testId}`}
              onCommit={(v) => onEditUnit?.(index, c.sourceKey as 'width_ft' | 'depth_ft', v)}
            />
          </td>
        ) : (
          <UnitCell
            key={c.col}
            testId={`library-unit-${projectId}-${index}-${c.testId}`}
            {...c.read(row)}
          />
        ),
      )}
      {trailing}
    </tr>
  );
}

/** ★ One read-only cell. `null` prints the NOT-RECORDED dash and `0` prints
 *  `0` — fix-386's rule, which mattered more here than anywhere: a Library
 *  filter reading an unmeasured unit as zero square feet is how somebody
 *  searching for 1,700 sf units silently misses them. */
function UnitCell({
  value,
  text,
  testId,
}: {
  value?: number | null;
  text?: string;
  testId: string;
}) {
  const shown = text !== undefined ? text : value == null ? NOT_RECORDED : String(value);
  return (
    <td
      className="px-2 py-0.5 text-center font-mono text-[11px] text-text"
      data-testid={testId}
    >
      {shown}
    </td>
  );
}

/** Trim trailing .00 on whole numbers; keep two decimals otherwise. */
// ★★★ fix-411 §2 (P-051): `fmtDim` IS GONE, not repointed.
//
// It read `n % 1 === 0 ? String(n) : n.toFixed(2)` — which is precisely the
// "100.47" Bobby complained about, spelled out. Deleting it rather than
// changing its body is the point: there is now ONE lot formatter, in
// lib/lotDimensions, and no second local one that can drift back toward
// decimals. See that file for why this is display-only and why the editable
// inputs are deliberately untouched.

// ★★★ fix-406 — THE LABELS STEP OUT OF THE CARD
//
// Bobby: *"a lot of gray on gray clashing with letters"*. The letters half of
// that sentence is this function. Every field label was `text-dim` (#8a9bb5) on
// the `bg-s2` card (#e8edf3): **2.4:1**, which is not a readable ratio for 9px
// uppercase — it is below WCAG AA (4.5:1) for normal text and below the 3:1
// floor even for large text. The labels were legible only because you already
// knew what they said.
//
// ★★ TWO TIERS, BECAUSE fix-402'S RULING SURVIVES. Width and depth are each
// group's PRIMARY tier — the dimensions a search actually starts from, set
// above a hairline. Darkening everything to the same weight would flatten that
// back into one undifferentiated list, which is the structure Bobby approved.
// So primary goes all the way to `text-text` (#1a2540, **12.9:1**) at bold, and
// the secondary row goes to `text-muted` (#5a6a85, **4.7:1**) at semibold: both
// clearly readable, still clearly ranked.
type LabelTier = 'primary' | 'secondary';

// ===========================================================================
// ★★★ fix-447 §A/§B (P-055) — THE HEADINGS ARE HEADINGS, AND THEY SWITCH THE
//     VIEW
// ===========================================================================
//
// Bobby, 2026-08-26: *"a clear heading over a clear subheading — bigger than
// the field labels, and without the colour difference."* Then: *"the pills
// should switch the view. Click SITE and it highlights, and the results below
// reformat to address + site information."*
//
// ---------------------------------------------------------------------------
// ★★★ THE COMPLAINT WAS LITERALLY TRUE — MEASURED, NOT ASSUMED
// ---------------------------------------------------------------------------
//
// The old chip was `text-[9px]`. The field labels it heads are
// `LABEL_CLASS.primary` = **10px** bold and `.secondary` = 9px semibold. So the
// heading was SMALLER than the primary fields beneath it and equal to the
// secondary ones — a label pretending to be a heading, propped up by a coloured
// pill. 13px extrabold puts a real step above both (13 > 10 > 9).
//
// ---------------------------------------------------------------------------
// ★★★ §A2 — THE HEADING LOSES ITS COLOUR; THE CARD BORDER KEEPS ITS TINT
// ---------------------------------------------------------------------------
//
// *"without the colour difference"* is about the heading, and it is granted in
// full: SITE and UNIT now render in exactly the same ink, with no pill, no
// tint, no border. Whatever hue was doing to say "these are two different
// groups", 13px extrabold now does.
//
// ★★ THE CARD BORDERS STAY, and it is not sentiment about fix-406's work. They
// do a job the heading cannot: when you are scrolled down among the fields the
// heading is off-screen and the border is not, so it is what still tells you
// which card your cursor is in. Both clear fix-406's floor against the card
// surface — measured in the fix-447 suite, not asserted here.
//
// ★★ THE HISTORY THE CHIPS CARRIED, KEPT BECAUSE IT IS STILL THE REASON THE
// PALETTE FILE STATES HEXES. fix-402 wrote the SITE chip as three inline styles
// reading `var(--color-ok-bg)` / `var(--color-ok)` — variables DEFINED NOWHERE
// in the app. An undefined custom property with no fallback invalidates the
// whole declaration, so all three were dropped and the chip rendered with no
// background, no border and inherited ink: the "near-monochrome" in Bobby's
// screenshot. It was never a colour that was too subtle; it was no colour.
// fix-406 fixed it by stating measured values in lib/libraryGroupPalette
// instead of pointing at a name that might not exist. That lesson outlives the
// chip: this heading takes its ink from `--color-text`, which does exist, and
// the fix-447 suite asserts the rendered value rather than trusting the token.
//
// ★★★ AND NO THIRD HUE FOR "ACTIVE". The obvious move — underline SITE in teal
// and UNIT in purple — would put the colour difference straight back onto the
// heading through the side door. Weight and presence carry the state, hue
// carries nothing, and the two headings stay identical to each other in colour
// whichever one is on.
//
// ===========================================================================
// ★★★ fix-467 §2 (P-112) — LOUDER, FROM CONTRAST RATHER THAN FROM HUE
// ===========================================================================
//
// Bobby: *"can we try something less subtle than just the under line letting
// you know which realm you're searching in — like maybe the whole pill is
// darker and the inactive one is greyed out or white? also — can the whole pill
// area be clickable to toggle."*
//
// ★★★ THIS REVERSES PART OF fix-447 AND THAT TICKET WAS STILL RIGHT. Three days
// earlier he asked for these headings *"without the colour difference"*, and
// fix-447's measurement is the reason the answer here is a FILL and not the old
// teal/purple:
//
//     SITE border  #55abc4 vs the card  →  2.23:1
//     UNIT border  #9a77e8 vs the card  →  2.89:1
//     SITE vs UNIT against EACH OTHER   →  1.30:1   ← the damning number
//
// ★★ 1.30:1 means the hue that was supposed to tell the two groups apart was,
// measurably, very nearly the same hue twice. His new instruction wins on what
// the control should LOOK like; it does not make that measurement false, and
// nothing here reintroduces a pair that close.
//
// ★★★ WHAT THE SEGMENTED CONTROL BUYS, AS THE SAME KIND OF NUMBER:
//
//     ACTIVE   #ffffff on --color-text  → 15.19:1   (the label)
//     INACTIVE --color-muted on white   →  5.48:1   (the label)
//     the two SEGMENT FILLS against each other → 15.19:1
//
// ★★ That last figure is the like-for-like replacement for 1.30:1 — the state
// difference is now the largest contrast the palette can express instead of
// the smallest. It reads across a room, it survives colour-blindness entirely
// because no hue carries meaning, and SITE and UNIT remain identical to each
// other in colour whichever one is on.
//
// ★ `lib/libraryGroupPalette` and its fix-406 suite are KEPT and UNTOUCHED —
//   not painted, not deleted. They are the record of how those hexes were
//   derived, exactly the treatment fix-447 gave them.
//
// ★★ THE WHOLE PILL IS THE BUTTON, and that is the second half of the ask. The
// caption used to be a dead `<span>` sitting BESIDE the button, so half of what
// looks like one control did nothing when clicked. It is now inside the button.
// ★ Still ONE real `<button>` with `aria-pressed` — no onClick on a `<div>`,
//   so keyboard and screen-reader behaviour is unchanged and free.
/**
 * ★★ fix-469 §2 — a card's own Clear.
 *
 * ★ SHOWN ONLY WHEN THE CARD HOLDS A VALUE. fix-406's rule: a control that
 *   cannot act is absent, not present and inert. `cardHasValue` compares
 *   against `INITIAL_FILTERS` rather than against emptiness, because the four
 *   buffer fields default to **2** — a card whose buffer somebody moved is a
 *   card with something to clear, and a blank-check would have hidden the
 *   button that undoes it.
 *
 * ★ It is deliberately quiet: this is the third control on a card header, and
 *   the two loud ones (the segmented SITE/UNIT pill, fix-467) are the ones a
 *   reader is scanning for.
 */
function CardClear({
  keys,
  filters,
  onClear,
  testid,
}: {
  keys: readonly (keyof LibraryFilters)[];
  filters: LibraryFilters;
  onClear: (keys: readonly (keyof LibraryFilters)[]) => void;
  testid: string;
}) {
  if (!cardHasValue(filters, keys, INITIAL_FILTERS)) return null;
  return (
    <button
      type="button"
      onClick={() => onClear(keys)}
      className="ml-auto text-[10px] px-2 py-0.5 rounded border font-display"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
        // ★ `--color-muted` on white = 5.48:1 (fix-467's measurement, same
        //   surface). Not `--color-dim`, which is 2.82:1.
        color: 'var(--color-muted)',
      }}
      data-testid={testid}
    >
      Clear
    </button>
  );
}

// ===========================================================================
// ★★★ fix-483 §B (P-137) — THE CARD HEADING **IS** THE TOGGLE'S HALF
// ===========================================================================
//
// Bobby, 2026-09-02: *"on pipeline it's like a blue highlight. We want that
// toggle feature to be consistent whether we're on agenda or the library."*
// And, on this screen specifically: *"The Unit pill will be the thing that
// highlights, not the whole box."*
//
// ★★★ SO IT IS ONE CONTROL, NOT A PILL PLUS A TOGGLE. SITE's heading and UNIT's
// heading are the two halves of a single two-state switch that happens to be
// drawn in two places. There is no wrapper that could hold both, which is
// exactly why `TwoStateToggle` exports its CHIP: this renders the same button,
// with the same classes and the same `chipStyle`, as the Pipeline's My Work /
// Everyone — and a test asserts that against the Pipeline's own rendering
// rather than against a copy of the class string.
//
// ★★ THE CAPTION COMES BACK OUT OF THE PILL, and fix-406's reason for putting
// it in is what retires it. Its note: *"the caption travels INSIDE the pill now
// — it is what makes the 'whole pill area' a real target rather than a styled
// label with a live corner."* §A3 makes the WHOLE CARD the target, so the pill
// no longer has to be big to be hittable. The reason expired; the decision goes
// with it.
//
// ★ WHAT fix-406 WON IS KEPT: the identity is carried by the word and the
//   fill, not by a hue — its measurement (SITE teal 2.23:1, UNIT purple
//   2.89:1, and 1.30:1 between them) killed the colour split and nothing here
//   brings it back. `chipStyle`'s blue is a STATE, and it is the same blue on
//   every screen.
function GroupHeading({
  label,
  caption,
  view,
  active,
  onSelect,
  testid,
}: {
  label: string;
  caption: string;
  view: LibraryView;
  active: boolean;
  onSelect: () => void;
  testid: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <ToggleChip
        active={active}
        onClick={onSelect}
        testid={testid}
        surface="surface"
        data={{ 'data-view': view, 'data-active': active ? 'true' : 'false' }}
      >
        {label}
      </ToggleChip>
      <span
        className="text-[10px] leading-none"
        style={{ color: 'var(--color-muted)' }}
        data-testid={`${testid}-caption`}
      >
        {caption}
      </span>
    </div>
  );
}

// ★★★ fix-447 §A2 — THE CARD TINT GOES TOO, AND THE MEASUREMENT IS WHY.
//
// A2's test was *"the coloured card BORDERS may stay as a quiet tint IF THEY
// PASS fix-406's floor"*. Measured against the card surface (`--color-s2`,
// #e8edf3):
//
//     SITE border  #55abc4  →  2.23:1
//     UNIT border  #9a77e8  →  2.89:1
//     the two against EACH OTHER → 1.30:1
//
// ★★★ NEITHER CLEARS 4.5:1, and neither clears even WCAG's 3:1 non-text
// threshold. And 1.30:1 between them is the damning number: the hue that was
// supposed to tell SITE from UNIT was, measurably, almost the same hue twice.
// So this is not a case of dropping a colour that was working — it is fix-406's
// own method finding the second half of Bobby's complaint. *"The teal-vs-purple
// colour split is doing work that typography should do"*, and it turns out it
// was barely doing it at all.
//
// ★★ THE HEADING'S OWN INKS DO CLEAR IT: active `--color-text` is 12.9:1 on the
// card and inactive `--color-muted` is 4.65:1, with 2.77:1 between them — so
// the state is legible and the identity is carried by 13px extrabold type.
//
// ★ lib/libraryGroupPalette KEEPS its values and its fix-406 suite. They are
// the record of how those hexes were derived and the regression cover for the
// tokens they came from; what changed is that this screen no longer paints
// them.
const NEUTRAL_CARD_BORDER = { borderColor: 'var(--color-border)' } as const;

/** ★★ fix-483 §A1: the shade, as a CLASS and not an inline style — on purpose.
 *  Both tables' rows carry `hover:bg-s2`, and an inline background beats a
 *  class, so a banded row would have silently lost its hover. A class does not:
 *  `.hover\:bg-s2:hover` carries a pseudo-class and outranks `.bg-bg`.
 *
 *  ★ `--color-bg` (#f0f4f8) on the table's white surface is a ~3% step — under
 *    `--color-s2`'s ~6%, which is what the hover uses. So the band is quieter
 *    than the hover, which is the right way round: the hover has to remain
 *    visible ON a banded row. Subtle, and not a border (the brief's rule). */
const PROJECT_BAND_CLASS = 'bg-bg';

const LABEL_CLASS: Record<LabelTier, string> = {
  primary: 'text-[10px] font-bold text-text uppercase tracking-wide',
  secondary: 'text-[9px] font-semibold text-muted uppercase tracking-wide',
};

function FieldLabel({
  label,
  tier = 'secondary',
  children,
}: {
  label: string;
  /** ★ Defaults to secondary: the qualifier row is the common case, and a new
   *  field added without thinking about tier should not silently claim the
   *  primary weight. */
  tier?: LabelTier;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className={LABEL_CLASS[tier]}>{label}</label>
      {children}
    </div>
  );
}

/**
 * ★★★ fix-489 (P-151) — THE BOXES HAVE TO FIT WHAT THEY HOLD.
 *
 * Bobby, 2026-09-03, with a screenshot of the Library: *"the unit and lot size
 * is not fully visable. that is a problem. the lot size should default +/- 500
 * and the unit size should be +/- 100"*
 *
 * ★★★ THE DEFAULTS WERE ALREADY 500 AND 100 — verified in `INITIAL_FILTERS`,
 *     in `clearCardFilters` (which restores from that same object) and in
 *     `loadLibraryFilters`' fallback. Nothing was resetting them. What he
 *     photographed was a 40px box printing **"5"** and **"1"**: the value was
 *     right and the box was too narrow.
 *
 * ---------------------------------------------------------------------------
 * ★★★ THE CAUSE, MEASURED IN CHROME — IT IS THE SPINNER, NOT THE DIGITS
 * ---------------------------------------------------------------------------
 * At `w-10` the box is 38px of client, 22px of content, and "500" is only
 * 17.8px of text — it should fit. It does not, because Chrome reserves room
 * for `::-webkit-inner-spin-button` inside the box:
 *
 *     input[type=number] "500" at w-10   scrollWidth 49 / clientWidth 38  ✗
 *     …the same box with the spinner suppressed              38 / 38     ✓
 *     input[type=TEXT]   "500" at w-10                       38 / 38     ✓
 *
 * The spinner costs exactly **11px**, and 11px is the whole defect.
 *
 * ★★ SO WHY NOT JUST HIDE THE SPINNER? It would fix this with no width change
 *    (`[appearance:textfield]`, which the unit-matrix cells already use). It is
 *    out of scope by the brief — *"only the widths change"* — and it is a
 *    change to all nine boxes rather than the two that are wrong. Raised in the
 *    fix-489 PR as the cheaper alternative if Bobby wants it.
 *
 * ---------------------------------------------------------------------------
 * ★★★ AND THE WIDTHS ARE MEASURED, NOT ESTIMATED
 * ---------------------------------------------------------------------------
 * The brief proposed `w-20` / `w-14`. Chrome says `w-14` is **one pixel short**:
 *
 *     ±  box   w-14 (54px)   "500" 54/54 ✓   but "1000" 55/54 ✗
 *     ±  box   w-16 (62px)   "2500" 62/62 ✓
 *     target   w-16 (62px)   "12000" 62/62 ✓ but "100000" 67/62 ✗
 *     target   w-20 (78px)   "999999" 78/78 ✓
 *
 * A four-digit tolerance (±1000 on a lot) and a six-digit area (a 2.5-acre
 * parcel is 108,900 sf) are both ordinary, so the sf boxes take **w-16** and
 * **w-20**. Shipping `w-14` would have re-created this ticket the first time
 * somebody typed ±1000.
 *
 * ★ ONE COMPONENT, per D-2026-09-02 (consistency is a brand rule). The `ft`
 *   default leaves the four width/depth callers byte-identical, and only the
 *   two width classes move — `FIELD_CLASS`, the `±` glyph, `text-center` and
 *   the label tier are untouched.
 */
function TargetRange({
  label,
  target,
  buf,
  onTarget,
  onBuf,
  testIdPrefix,
  unit = 'ft',
}: {
  label: string;
  target: number | null;
  buf: number;
  onTarget: (v: number | null) => void;
  onBuf: (v: number) => void;
  testIdPrefix: string;
  /** ★ `'sf'` widens BOTH boxes; `'ft'` is today's geometry, unchanged. */
  unit?: 'ft' | 'sf';
}) {
  const targetWidth = unit === 'sf' ? 'w-20' : 'w-16';
  const bufWidth = unit === 'sf' ? 'w-16' : 'w-10';
  return (
    // ★★ fix-406: width/depth are the PRIMARY tier — fix-402's ruling, kept by
    //    giving this label the heavier weight rather than by darkening
    //    everything equally.
    <FieldLabel label={label} tier="primary">
      <div className="flex items-center gap-1 text-[10px] text-muted">
        <input
          type="number"
          min={0}
          value={target ?? ''}
          onChange={(e) =>
            onTarget(e.target.value === '' ? null : Number(e.target.value))
          }
          placeholder="Target"
          className={`${targetWidth} text-center ${FIELD_CLASS}`}
          data-testid={`${testIdPrefix}-target`}
        />
        <span>±</span>
        <input
          type="number"
          min={0}
          value={buf}
          onChange={(e) => onBuf(Number(e.target.value) || 0)}
          className={`${bufWidth} text-center ${FIELD_CLASS}`}
          data-testid={`${testIdPrefix}-buf`}
        />
      </div>
    </FieldLabel>
  );
}
