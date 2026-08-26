import { useEffect, useMemo, useRef, useState } from 'react';
import OriginLink from './OriginLink';
import { PREVIOUS_ORIGINS } from '../lib/previousOrigin';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useUpdateProject } from '../hooks/useUpdateProject';
import {
  DEFAULT_LIBRARY_SORT,
  buildLibraryRows,
  filterLibraryRows,
  hasAnyUnitFilter,
  matchingUnitIndices,
  sortLibraryRows,
  type LibraryFilters,
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
import {
  ParkingKindSelect,
  RoofDeckSelect,
  StallsInput,
} from './shared/UnitParkingInputs';
import { PARKING_KINDS, type ParkingKind } from '../lib/database.types';
import {
  PARKING_KIND_LABEL,
  parkingRollup,
  parseStalls,
  roofDeckRollup,
  type RoofDeckFilter,
  type StallsTier,
} from '../lib/unitParking';
import {
  resolveUnitLabel,
  resolveUnitTypesForSave,
} from '../lib/unitTypeNaming';
import {
  SITE_PALETTE,
  UNIT_PALETTE,
  cardBorderStyle,
  chipStyle,
} from '../lib/libraryGroupPalette';
import { useAppConfig, readAppConfigStringArray } from '../hooks/useAppConfig';
import { useAuthStore } from '../stores/authStore';
import { zoneOptions } from '../lib/zoneOptions';
import { formatLotPair } from '../lib/lotDimensions';
import {
  clearLibraryFilters,
  loadLibraryFilters,
  saveLibraryFilters,
} from '../lib/surfaceFilterPrefs';
import { SkeletonRows } from './Skeleton';
import QueryError from './QueryError';

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

// v1's tag dropdown (index.html line 9377). Matches v1's `array.includes`
// predicate on each row's project_tags array.
const TAG_OPTIONS = ['ECA', 'SIP', 'TRAL', 'LBA', 'Short Plat'];

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
    <Body projects={projectsQ.data ?? []} permits={permitsQ.data ?? []} />
  );
}

interface BodyProps {
  projects: Project[];
  permits: PermitWithCycles[];
}
const INITIAL_FILTERS: LibraryFilters = {
  search: '',
  lotwTarget: null,
  lotwBuf: 2,
  lotdTarget: null,
  lotdBuf: 2,
  unitwTarget: null,
  unitwBuf: 2,
  unitdTarget: null,
  unitdBuf: 2,
  zone: '',
  alley: '',
  productTypes: [],
  tag: '',
  juris: '',
  // fix-122: isCornerLot is tri-state. (Its numLots sibling was removed as a
  // FILTER by fix-402 on Bobby's ruling; the lots COLUMN is untouched.)
  isCornerLot: '',
  // ★ fix-410: '' = Any. See LibraryFilters.isRegularShape for why "Not set"
  //   is one of the pickable states rather than only a fall-out.
  isRegularShape: '',
  // fix-205: Stories tier filter on a project's unit_types.
  stories: '',
  // ★★ fix-402: the UNIT card's parking trio. All start Any — and note that
  // "Any" is the only state in which a NOT-RECORDED unit can match, which is
  // the correct behaviour while 231 unit rows await their backfill.
  parkingKind: '',
  stalls: '',
  roofDeck: '',
  // ★ fix-412: '' = Any, which EXCLUDES confirmed no-work units by ruling.
  workScope: '',
};

function Body({ projects, permits }: BodyProps) {
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
  // fix-206: the unit table is editable through the SAME write path as Project
  // Overview (useUpdateProject patch { unit_types } with the project's OCC
  // token). One store — the optimistic projects-cache patch reflects on Project
  // Overview immediately, and a Project Overview edit reflects here, with no
  // second store or sync engine.
  const updateProject = useUpdateProject();
  function writeUnitTypes(row: LibraryRow, next: UnitType[]) {
    if (!row.updatedAt) return; // occMissing → editing disabled (parity w/ PO)
    void updateProject
      .mutateAsync({
        projectId: row.projectId,
        expectedUpdatedAt: row.updatedAt,
        patch: { unit_types: resolveUnitTypesForSave(next, row.productTypes) },
        fieldLabel: 'Unit Dimensions',
      })
      .catch(() => {
        /* useUpdateProject.onError already surfaced the toast + rolled back */
      });
  }
  // fix-81: per-row caret state. Map value: true=explicitly open,
  // false=explicitly closed. Missing key = "auto" (driven by unit
  // filter). Component-local; expansion isn't precious enough to
  // persist to localStorage.
  const [expandedById, setExpandedById] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  // ★ fix-402: one definition of "a unit filter is on", shared with the
  //   matcher — this list drifted from that one when fix-205 added stories.
  const unitFilterActive = hasAnyUnitFilter(filters);

  const allRows = useMemo(
    () => buildLibraryRows(projects, permits),
    [projects, permits],
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
  function clearFilters() {
    setFilters(INITIAL_FILTERS);
    // ★★ AND THE STORED COPY GOES TOO. Resetting only the React state would
    //    put every filter back the next time you navigated away and returned —
    //    a Clear button that un-clears itself.
    clearLibraryFilters(prefsUserId);
  }

  function isExpanded(projectId: string): boolean {
    const explicit = expandedById.get(projectId);
    if (explicit !== undefined) return explicit;
    return unitFilterActive;
  }
  function toggleExpanded(projectId: string) {
    setExpandedById((prev) => {
      const next = new Map(prev);
      next.set(projectId, !isExpanded(projectId));
      return next;
    });
  }

  return (
    <div className="space-y-3" data-testid="library-matrix">
      {/* Search bar */}
      <input
        type="text"
        value={filters.search}
        onChange={(e) => update('search', e.target.value)}
        placeholder="Search by address or unit type name (space/comma separated tokens)…"
        // ★★ fix-406: the top search box had the same problem as the ones
        //    inside the cards — `bg-bg` on the page's own `bg-bg`, so it was a
        //    border floating on nothing. It joins the field surface too.
        className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-xs font-display text-text shadow-sm placeholder:text-dim focus:outline-none focus:border-de focus:ring-1 focus:ring-de/30"
        data-testid="library-search"
      />

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
          className="flex-1 min-w-[300px] bg-s2 border rounded-lg p-3"
          style={cardBorderStyle(SITE_PALETTE)}
          data-testid="filter-card-site"
        >
          <div className="flex items-center gap-2 mb-2">
            {/* ★★★ fix-406: this chip used to read `var(--color-ok)`, WHICH IS
                DEFINED NOWHERE IN THE APP. An undefined custom property with no
                fallback invalidates the whole declaration, so all three styles
                were dropped and the chip rendered with no background, no border
                and inherited ink — the "near-monochrome" in Bobby's screenshot.
                It was never a colour that was too subtle; it was no colour. */}
            <span
              className="text-[9px] font-display font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={chipStyle(SITE_PALETTE)}
              data-testid="filter-chip-site"
            >
              Site
            </span>
            <span className="text-[10px] text-muted">the lot</span>
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
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {/* ★★★ fix-415 SCOPE A5 — THE FILTER THAT GROUPING WAS FOR.
                This was a free-text box doing a substring match, over a column
                holding 33 spellings of 21 zones: asking for LR1 found three of
                the ten projects that ARE LR1, because the other seven were
                stored "LR 1", "LR1 (M)", "LR1 (M1)" or "LR1 M". Both halves are
                fixed — the data is canonical now, and the control offers only
                the canonical list, so a person cannot type a spelling that
                matches nothing. */}
            <FieldLabel label="Zone">
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
            </FieldLabel>

            <FieldLabel label="Jurisdiction">
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
            </FieldLabel>

            <FieldLabel label="Alley">
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
            </FieldLabel>

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

            {/* ★★★ fix-410 (P-040): Regular Shape. A SITE field, so it sits on
                the SITE card beside Corner — fix-406's teal group is about the
                LOT, and "is it a rectangle" is a fact about the lot.

                ★★ FOUR OPTIONS, NOT THREE. "Not set" is pickable because the
                whole point of Bobby's default is that the unanswered population
                should be empty; a state nobody can filter for is a state nobody
                can audit. The words are Regular / Irregular rather than
                Yes / No — on a filter, "Yes" alone does not say yes to what. */}
            <FieldLabel label="Shape">
              <select
                value={filters.isRegularShape}
                onChange={(e) =>
                  update(
                    'isRegularShape',
                    e.target.value as LibraryFilters['isRegularShape'],
                  )
                }
                className={FIELD_CLASS}
                data-testid="filter-regular-shape"
              >
                <option value="">Any</option>
                <option value="Regular">Regular</option>
                <option value="Irregular">Irregular</option>
                <option value="Not set">Not set</option>
              </select>
            </FieldLabel>

            <FieldLabel label="Tag">
              <select
                value={filters.tag}
                onChange={(e) => update('tag', e.target.value)}
                className={FIELD_CLASS}
                data-testid="filter-tag"
              >
                <option value="">Any</option>
                {TAG_OPTIONS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </FieldLabel>

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
          className="flex-1 min-w-[300px] bg-s2 border rounded-lg p-3"
          style={cardBorderStyle(UNIT_PALETTE)}
          data-testid="filter-card-unit"
        >
          <div className="flex items-center gap-2 mb-2">
            {/* ★★ fix-406: was `--color-de` — the app's BLUE. It rendered
                correctly, it was simply the wrong colour: blue is Design /
                Entitlements everywhere else in the app, and the approved mockup
                had UNIT in purple against SITE's teal. Two hues, so the eye
                separates the layers before it reads a single label. */}
            <span
              className="text-[9px] font-display font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={chipStyle(UNIT_PALETTE)}
              data-testid="filter-chip-unit"
            >
              Unit
            </span>
            {/* ★★★ The conjunction rule, said where somebody choosing filters
                can read it — not only in the code that implements it. */}
            <span className="text-[10px] text-muted">
              one unit must match all of these
            </span>
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

            {/* ★★★ fix-412 Scope B4: the work-scope filter. A UNIT field, so
                it sits on the UNIT card beside Roof Deck.

                ★★ FOUR OPTIONS FOR THREE STATES. "Any" is not neutral here —
                it excludes a confirmed No-work unit (Bobby's ruling: no drawn
                detail worth filtering on) while keeping every not-yet-answered
                one visible. The other three make each state reachable by name,
                which is what stops a default exclusion from being a trap:
                nothing becomes unfindable, it just stops being in the way. */}
            <FieldLabel label="Work">
              <select
                value={filters.workScope}
                onChange={(e) =>
                  update(
                    'workScope',
                    e.target.value as LibraryFilters['workScope'],
                  )
                }
                className={FIELD_CLASS}
                data-testid="filter-work-scope"
              >
                <option value="">Any</option>
                <option value="performed">Work performed</option>
                <option value="none">No work</option>
                <option value="unanswered">Not answered</option>
              </select>
            </FieldLabel>

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

            <FieldLabel label="Product Type">
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
        <button
          type="button"
          onClick={clearFilters}
          className="text-xs px-3 py-1 rounded border border-border bg-surface text-muted hover:bg-bg transition font-display"
          data-testid="filter-clear"
        >
          Clear
        </button>
        <span
          className="text-[11px] text-dim font-mono ml-auto"
          data-testid="library-count"
        >
          {sorted.length} project{sorted.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Matrix table */}
      <div className="bg-surface border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-xs" data-testid="library-table">
          <thead>
            <tr className="bg-s2 border-b-2 border-border">
              <th
                className="px-1 py-1.5 w-6"
                aria-label="Expand row"
              />
              <Th sort={sort} col="address" onClick={toggleSort} align="left">Address</Th>
              <Th sort={sort} col="juris" onClick={toggleSort} align="left">Juris</Th>
              <Th sort={sort} col="productTypes" onClick={toggleSort} align="left">Type</Th>
              <Th sort={sort} col="units" onClick={toggleSort} align="center">Units</Th>
              {/* ★★★ fix-406 — THE LOTS COLUMN IS GONE BY RULING.
                  Bobby, 2026-08-26: *"we can remove lots from the vertical bar
                  below for the sort column as it isnt really relevant here."*

                  ★★ fix-402 removed the lots FILTER and DELIBERATELY KEPT this
                  column, recording that decision three lines above the filter
                  it deleted. He has now ruled the column out too, so the note
                  is superseded rather than mistaken — the earlier call was
                  right on the evidence it had.

                  ★ The DATA is untouched: `projects.num_lots` still renders in
                  the New Project wizard, the Project Overview header, the
                  redesign modal, the corrections segments and the team-volume
                  report. This is the Library table only. */}
              <Th sort={sort} col="zone" onClick={toggleSort} align="center">Zone</Th>
              <Th sort={sort} col="lotWidth" onClick={toggleSort} align="center">Lot W×D</Th>
              <Th sort={sort} col="alley" onClick={toggleSort} align="center">Alley</Th>
              {/* fix-122: Corner Lot — same dimensions feel very
                  different on a corner. */}
              <Th sort={sort} col="isCornerLot" onClick={toggleSort} align="center">Corner</Th>
              {/* ★ fix-410: beside Corner — the two shape-of-the-lot columns
                  read together, and both sort NULLs last through the one
                  shared tri-state arm in sortLibraryRows. */}
              <Th sort={sort} col="isRegularShape" onClick={toggleSort} align="center">Shape</Th>
              {/* ★★ fix-402: the unit rollups. Bobby: *"in the Project
                  Overview and in the Library, we need to make that not only a
                  searchable but a displayable thing."* Not sortable — they are
                  derived summaries, and a sort on "Mixed · 4 stalls" would
                  order on a sentence. */}
              <th className="px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-text text-center">
                Parking
              </th>
              <th className="px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-text text-center">
                Roof Deck
              </th>
              <th className="px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-text text-left">
                Tags
              </th>
              <Th sort={sort} col="stage" onClick={toggleSort} align="center">Stage</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row
                key={r.projectId}
                row={r}
                expanded={isExpanded(r.projectId)}
                onToggle={() => toggleExpanded(r.projectId)}
                matchedUnitIndices={
                  unitFilterActive
                    ? matchingUnitIndices(r, filters)
                    : null
                }
                onWriteUnitTypes={(next) => writeUnitTypes(r, next)}
              />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  // ★ fix-410: 14 = caret + 10 sortable + 3 derived headers.
                  //   Was 13; the Shape column makes it 14.
                  //
                  // ★★ fix-406's note, kept because it is the reason anyone
                  //   checks: it read 12 while the table had 14 columns, so the
                  //   "no projects match" row had been two short since fix-402
                  //   added Parking and Roof Deck — and nothing showed it,
                  //   because a stale colSpan is invisible until the table is
                  //   EMPTY. Both spans here are asserted against the rendered
                  //   header count, so adding a column cannot quietly break
                  //   the empty state again.
                  colSpan={14}
                  className="px-4 py-8 text-center text-xs text-dim italic"
                >
                  No projects match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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

interface RowProps {
  row: LibraryRow;
  expanded: boolean;
  onToggle: () => void;
  /** When a unit filter is active, this is the list of unit_type
   * indices that satisfied the filter — the nested table highlights
   * exactly those rows. Null when no unit filter is active (in which
   * case nothing gets highlighted). */
  matchedUnitIndices: number[] | null;
  /** fix-206: persist an edited unit_types array for this project. */
  onWriteUnitTypes: (next: UnitType[]) => void;
}
function Row({
  row,
  expanded,
  onToggle,
  matchedUnitIndices,
  onWriteUnitTypes,
}: RowProps) {
  const hasUnits = row.unitTypes.length > 0;
  // ★ fix-402: derived per render from the row's own units — no second source.
  const parking = parkingRollup(row.unitTypes);
  const roofDeck = roofDeckRollup(row.unitTypes);
  return (
    <>
      <tr
        className="border-b border-border hover:bg-s2 transition"
        data-testid={`library-row-${row.projectId}`}
      >
        <td className="px-1 py-1.5 text-center align-middle">
          {hasUnits ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse unit types' : 'Expand unit types'}
              className="text-dim hover:text-text font-mono leading-none px-1 select-none"
              data-testid={`library-caret-${row.projectId}`}
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="text-dim/40" aria-hidden>
              ·
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 font-display font-bold text-text">
          <OriginLink
            to={`/project/${row.projectId}`}
            // ★ fix-403: tell Project Overview where this click came from, so
            //   its Previous button knows which list to go back to. The FILTERS
            //   do not travel here — they live in sessionStorage, so the
            //   browser back button and the ribbon restore them too.
            state={{ from: PREVIOUS_ORIGINS.library }}
            className="hover:underline"
          >
            {row.address}
          </OriginLink>
        </td>
        <td className="px-2 py-1.5 text-muted">{row.juris || '—'}</td>
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
        {/* ★★★ fix-406: the Lots cell left with its header — see the ruling
            quoted at the <Th> block above. */}
        <td className="px-2 py-1.5 text-center">
          {row.zone ? (
            <span className="font-mono text-text">{row.zone}</span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-center">
          {/* ★ fix-411 §2: whole feet. The SORT still reads row.lotWidth
              unrounded (see SORTABLE_COLUMNS' lotWidth arm), so 100.47 and
              100.4 keep their real order while both render "100". */}
          {row.lotWidth && row.lotDepth ? (
            <span className="font-mono text-text">
              {formatLotPair(row.lotWidth, row.lotDepth)}
            </span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-center">
          {row.alley ? (
            <span className="font-mono text-text">{row.alley}</span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </td>
        {/* fix-122: Corner column. Tri-state — NULL renders as the dim
            em dash so unanswered rows are visually distinct from a
            confirmed No. */}
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
        {/* ★★ fix-410: Regular / Irregular / em dash. THREE renderings for
            three states — a null must never read as "Regular", which is the
            same rule the Site section follows and the reason the column has no
            DDL default. The words match the filter's, so a row and the control
            that found it say the same thing. */}
        <td
          className="px-2 py-1.5 text-center"
          data-testid={`library-regular-shape-${row.projectId}`}
        >
          {row.isRegularShape === true ? (
            <span className="font-mono text-text">Regular</span>
          ) : row.isRegularShape === false ? (
            <span className="font-mono text-text">Irregular</span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </td>
        {/* ★★★ fix-402: the parking rollup chip. Same kind everywhere → that
            kind; kinds disagree → "Mixed"; nothing recorded → "—" and nothing
            else. When SOME units are recorded and others are not it appends
            "N of M recorded", because a confident "Garage · 4 stalls" read off
            two of five units would be actively misleading during the backfill. */}
        <td
          className="px-2 py-1.5 text-center"
          data-testid={`library-parking-${row.projectId}`}
        >
          {parking.total === 0 || parking.label === '—' ? (
            <span className="text-dim">—</span>
          ) : (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                parking.partial
                  ? 'bg-wa-bg text-wa border-wa'
                  : 'bg-de-bg text-de border-de-border'
              }`}
              title={parking.partial ? 'Some units have no recorded parking' : undefined}
            >
              {parking.label}
            </span>
          )}
        </td>
        <td
          className="px-2 py-1.5 text-center font-mono text-text"
          data-testid={`library-roof-deck-${row.projectId}`}
        >
          {roofDeck.recorded === 0 ? (
            <span className="text-dim">—</span>
          ) : (
            roofDeck.label
          )}
        </td>
        <td className="px-2 py-1.5">
          {row.tags.length === 0 ? (
            <span className="text-dim">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.tags.map((t) => (
                <span
                  key={t}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-de-bg text-de border border-de-border"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5 text-center">
          <span
            className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border ${STAGE_BADGE[row.stage]}`}
          >
            {STAGE_LABEL[row.stage]}
          </span>
        </td>
      </tr>
      {expanded && hasUnits && (
        <tr
          className="border-b border-border bg-bg/40"
          data-testid={`library-expansion-${row.projectId}`}
        >
          <td />
          {/* ★ fix-410: 13, not 14 — the caret cell above takes one. (fix-406:
              "12, not 13 — the caret cell above takes one and Lots took one
              away"; the Shape column adds it back.) */}
          <td colSpan={13} className="px-2 pb-2 pt-1">
            <UnitTypeMiniTable
              projectId={row.projectId}
              unitTypes={row.unitTypes}
              productTypes={row.productTypes}
              matchedIndices={matchedUnitIndices}
              disabled={!row.updatedAt}
              onWriteUnitTypes={onWriteUnitTypes}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// fix-206: the unit table is EDITABLE inline. Each cell writes through the same
// useUpdateProject path as Project Overview (one store), reusing resolveUnitLabel
// for the product-type Label rules so the two editors behave identically.
function UnitTypeMiniTable({
  projectId,
  unitTypes,
  productTypes,
  matchedIndices,
  disabled,
  onWriteUnitTypes,
}: {
  projectId: string;
  unitTypes: LibraryRow['unitTypes'];
  /** fix-205: drives the "unnamed" → single-product-type fallback for a
   *  blank-label row (now via the Label input's placeholder / dropdown). */
  productTypes: string[];
  matchedIndices: number[] | null;
  /** fix-206: occMissing (no OCC token) → inputs read-only (parity w/ PO). */
  disabled: boolean;
  onWriteUnitTypes: (next: UnitType[]) => void;
}) {
  const matchSet = matchedIndices ? new Set(matchedIndices) : null;
  // ★ fix-402 widened the value type: roof_deck is a BOOLEAN, and a signature
  //   stopping at string|number would have quietly excluded `false`.
  function commit(
    idx: number,
    field: keyof UnitType,
    val: string | number | boolean | null,
  ) {
    onWriteUnitTypes(
      unitTypes.map((t, i) => (i === idx ? { ...t, [field]: val } : t)),
    );
  }
  return (
    <table
      className="w-full text-[11px]"
      data-testid={`library-unit-table-${projectId}`}
    >
      <thead>
        <tr className="text-dim">
          <th className="px-2 py-0.5 text-left text-[9px] font-extrabold uppercase tracking-wide">
            Type
          </th>
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Width
          </th>
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Depth
          </th>
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Qty
          </th>
          {/* fix-205: Stories column alongside Width/Depth/Qty. */}
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Stories
          </th>
          {/* ★★ fix-402: parking and roof deck are UNIT properties now — this
              is where the backfill actually gets typed. */}
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Parking
          </th>
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Stalls
          </th>
          <th className="px-2 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wide">
            Roof Deck
          </th>
        </tr>
      </thead>
      <tbody>
        {unitTypes.map((u, i) => (
          <LibraryUnitRow
            key={i}
            row={u}
            projectId={projectId}
            index={i}
            productTypes={productTypes}
            disabled={disabled}
            matched={matchSet?.has(i) ?? false}
            onChange={(field, val) => commit(i, field, val)}
          />
        ))}
      </tbody>
    </table>
  );
}

// fix-206: one editable unit_types row in the Library table. Mirrors the
// Project Overview UnitRow (fix-205) semantics exactly — product-type Label
// (dropdown when several types, freeform auto-labelled when one), W/D decimals
// (step 0.5), Qty, Stories — but laid out as table cells and keeping the
// fix-205 matched-highlight + testids. The fix-73/98 dirty-flag prop sync keeps
// a mid-typed value from being clobbered by an external cache refresh (the
// optimistic projects-cache patch from this or the Project Overview editor).
function LibraryUnitRow({
  row,
  projectId,
  index,
  productTypes,
  disabled,
  matched,
  onChange,
}: {
  row: UnitType;
  projectId: string;
  index: number;
  productTypes: string[];
  disabled: boolean;
  matched: boolean;
  // ★ fix-402 widened this: roof_deck is a BOOLEAN, and a value type that
  //   stopped at string|number would have quietly excluded it.
  onChange: (field: keyof UnitType, val: string | number | boolean | null) => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [w, setW] = useState(row.width_ft != null ? String(row.width_ft) : '');
  const [d, setD] = useState(row.depth_ft != null ? String(row.depth_ft) : '');
  const [qty, setQty] = useState(String(row.qty || 1));
  const [stories, setStories] = useState(
    row.stories != null ? String(row.stories) : '',
  );
  // ★ fix-402: stalls is a text box, so it buffers like W/D/Qty/Stories above
  //   — the fix-73/98 dirty-flag pattern, not a per-keystroke write.
  const [stalls, setStalls] = useState(
    row.parking_stalls != null ? String(row.parking_stalls) : '',
  );
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setLabel(row.label);
    setW(row.width_ft != null ? String(row.width_ft) : '');
    setD(row.depth_ft != null ? String(row.depth_ft) : '');
    setQty(String(row.qty || 1));
    setStories(row.stories != null ? String(row.stories) : '');
    setStalls(row.parking_stalls != null ? String(row.parking_stalls) : '');
  }, [
    row.label,
    row.width_ft,
    row.depth_ft,
    row.qty,
    row.stories,
    row.parking_stalls,
  ]);

  // fix-209 → fix-212: product-type-driven Label whenever the project has ANY
  // product type. The shown/selected value is the RESOLVED label — with several
  // types it's the value only if it's a product type (else "Pick type…"); with
  // EXACTLY ONE type it's always that type, overriding a legacy custom.
  const hasProductTypes = productTypes.length >= 1;
  const selectValue = resolveUnitLabel(label, productTypes);

  const idBase = `library-unit-${projectId}-${index}`;
  const numClass =
    'w-12 bg-transparent border-0 border-b border-border text-center font-mono text-text text-[11px] outline-none focus:border-de disabled:opacity-50';
  // fix-209: Qty + Sty are single-digit (occasionally 2) — narrow + equal
  // (w-7 ≈ 28px). W/D keep numClass (w-12).
  const narrowNumClass = numClass.replace('w-12', 'w-7');

  return (
    <tr
      data-testid={`library-unit-row-${projectId}-${index}`}
      data-matched={matched ? 'true' : undefined}
      className={matched ? 'bg-de-bg/40 border-l-2 border-de' : ''}
    >
      <td className="px-2 py-0.5 font-mono text-text">
        {hasProductTypes ? (
          <select
            value={selectValue}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              dirtyRef.current = true;
              setLabel(v);
              if (v !== row.label) onChange('label', v);
              dirtyRef.current = false;
            }}
            className="bg-transparent border-0 border-b border-border text-text text-[11px] outline-none focus:border-de disabled:opacity-50"
            data-testid={`${idBase}-label`}
          >
            <option value="">Pick type…</option>
            {productTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={label}
            placeholder="Label"
            disabled={disabled}
            onChange={(e) => {
              dirtyRef.current = true;
              setLabel(e.target.value);
            }}
            onBlur={() => {
              if (label !== row.label) onChange('label', label);
              dirtyRef.current = false;
            }}
            className="w-24 bg-transparent border-0 border-b border-border text-text text-[11px] outline-none focus:border-de placeholder:text-dim disabled:opacity-50"
            data-testid={`${idBase}-label`}
          />
        )}
      </td>
      <td className="px-2 py-0.5 text-center">
        <input
          type="number"
          min={0}
          step="0.5"
          value={w}
          placeholder="—"
          disabled={disabled}
          onChange={(e) => {
            dirtyRef.current = true;
            setW(e.target.value);
          }}
          onBlur={() => {
            const v = w === '' ? null : Number(w) || 0;
            if (v !== (row.width_ft ?? null)) onChange('width_ft', v);
            dirtyRef.current = false;
          }}
          className={numClass}
          data-testid={`${idBase}-w`}
        />
      </td>
      <td className="px-2 py-0.5 text-center">
        <input
          type="number"
          min={0}
          step="0.5"
          value={d}
          placeholder="—"
          disabled={disabled}
          onChange={(e) => {
            dirtyRef.current = true;
            setD(e.target.value);
          }}
          onBlur={() => {
            const v = d === '' ? null : Number(d) || 0;
            if (v !== (row.depth_ft ?? null)) onChange('depth_ft', v);
            dirtyRef.current = false;
          }}
          className={numClass}
          data-testid={`${idBase}-d`}
        />
      </td>
      <td className="px-2 py-0.5 text-center">
        <input
          type="number"
          min={1}
          value={qty}
          placeholder="1"
          disabled={disabled}
          onChange={(e) => {
            dirtyRef.current = true;
            setQty(e.target.value);
          }}
          onBlur={() => {
            const v = Number(qty) || 1;
            if (v !== row.qty) onChange('qty', v);
            dirtyRef.current = false;
          }}
          className={narrowNumClass}
          data-testid={`${idBase}-qty`}
        />
      </td>
      <td className="px-2 py-0.5 text-center">
        <input
          type="number"
          min={1}
          value={stories}
          placeholder="—"
          disabled={disabled}
          onChange={(e) => {
            dirtyRef.current = true;
            setStories(e.target.value);
          }}
          onBlur={() => {
            const v =
              stories === '' ? null : Math.max(1, Number(stories) || 0) || null;
            if (v !== (row.stories ?? null)) onChange('stories', v);
            dirtyRef.current = false;
          }}
          className={narrowNumClass}
          data-testid={`${idBase}-stories`}
        />
      </td>
      {/* ★★★ fix-402 — the three shared controls. Each writes null when
          cleared, so a row can always return to NOT RECORDED. */}
      <td className="px-2 py-0.5 text-center">
        <ParkingKindSelect
          value={row.parking_kind}
          disabled={disabled}
          onChange={(v) => onChange('parking_kind', v)}
          testid={`${idBase}-parking-kind`}
        />
      </td>
      <td className="px-2 py-0.5 text-center">
        <StallsInput
          value={stalls}
          disabled={disabled}
          onChange={(raw) => {
            dirtyRef.current = true;
            setStalls(raw);
          }}
          onBlur={() => {
            const v = parseStalls(stalls);
            if (v !== (row.parking_stalls ?? null)) onChange('parking_stalls', v);
            dirtyRef.current = false;
          }}
          testid={`${idBase}-stalls`}
        />
      </td>
      <td className="px-2 py-0.5 text-center">
        <RoofDeckSelect
          value={row.roof_deck}
          disabled={disabled}
          onChange={(v) => onChange('roof_deck', v)}
          testid={`${idBase}-roof-deck`}
        />
      </td>
    </tr>
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

function TargetRange({
  label,
  target,
  buf,
  onTarget,
  onBuf,
  testIdPrefix,
}: {
  label: string;
  target: number | null;
  buf: number;
  onTarget: (v: number | null) => void;
  onBuf: (v: number) => void;
  testIdPrefix: string;
}) {
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
          className={`w-16 text-center ${FIELD_CLASS}`}
          data-testid={`${testIdPrefix}-target`}
        />
        <span>±</span>
        <input
          type="number"
          min={0}
          value={buf}
          onChange={(e) => onBuf(Number(e.target.value) || 0)}
          className={`w-10 text-center ${FIELD_CLASS}`}
          data-testid={`${testIdPrefix}-buf`}
        />
      </div>
    </FieldLabel>
  );
}
