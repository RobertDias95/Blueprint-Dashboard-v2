import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import migrationSql from '../../migrations/fix_488_lot_size.sql?raw';
import {
  LOT_IRREGULAR_TOLERANCE,
  LOT_VARIES_LABEL,
  formatLotPair,
  formatLotSizeSf,
  lotSizeView,
} from '../lib/lotDimensions';
import { parseUnitTypes } from '../lib/unitTypeNaming';
import {
  SITE_FILTER_KEYS,
  UNIT_FILTER_KEYS,
  SORTABLE_COLUMNS,
  filterLibraryRows,
  libraryFilterKeyCoverage,
  matchingUnitIndices,
  hasAnyUnitFilter,
  sortLibraryRows,
  type LibraryFilters,
  type LibraryRow,
} from '../lib/libraryHelpers';
import { UNIT_ROW_COLUMNS, UNIT_MATRIX_WIDTH } from '../lib/unitRowLayout';
import { OVERVIEW_ROW_MIN_WIDTH } from '../lib/overviewCardLayout';
import type { UnitType } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-488 (P-142, P-150) — LOT SIZE WITH "VARIES", AND TYPED UNIT SIZE
// ===========================================================================
//
// Bobby on the lot (2026-09-02): *"if I put width 100 and depth 100, lot size is
// 10,000 — quick math. But if I put width 100 and lot size 10,000 and leave
// depth blank, that's because the depth is irregular… instead of Target it would
// say Varies."*
//
// Bobby on the unit (2026-09-03): *"how we have lot size, we also want unit size
// too. It won't be W×D = unit size, but something we actually type in. That way
// we can search for units that fit that criteria — show me all my 1,700 sqft
// units with a garage."*

// ---------------------------------------------------------------------------
// §A · THE RULE, OVER ALL EIGHT COMBINATIONS
// ---------------------------------------------------------------------------

describe('fix-488 §A: lotSizeView — every combination of {width, depth, size}', () => {
  it('★ 1/8 · nothing recorded → nothing said', () => {
    const v = lotSizeView(null, null, null);
    expect(v.pairText).toBeNull();
    expect(v.sizeSf).toBeNull();
    expect(v.sizeText).toBeNull();
    expect(v.sizeDerived).toBe(false);
    expect(v.irregular).toBe(false);
    expect(v.widthVaries || v.depthVaries).toBe(false);
  });

  it('★★★ 2/8 · a width alone is NOT "varies" — nobody said the lot was irregular', () => {
    // ★★★ THE DISTINCTION THE WHOLE FEATURE RESTS ON. A blank depth on its own
    //     means NOT RECORDED. It only becomes "varies" beside a typed SIZE,
    //     because that is what says somebody knew the area and could not give a
    //     single depth. Getting this wrong would relabel 205 ordinary prod lots
    //     as irregular the moment one dimension went missing.
    const v = lotSizeView(60, null, null);
    expect(v.widthText).toBe('60');
    expect(v.depthText).toBeNull();
    expect(v.depthVaries).toBe(false);
    expect(v.pairText).toBeNull();
    expect(v.sizeSf).toBeNull();
  });

  it('★ 3/8 · a depth alone, mirrored', () => {
    const v = lotSizeView(null, 100, null);
    expect(v.depthText).toBe('100');
    expect(v.widthVaries).toBe(false);
    expect(v.pairText).toBeNull();
  });

  it('★★★ 4/8 · width + depth, no size → the size is DERIVED, never stored', () => {
    const v = lotSizeView(60, 100, null);
    expect(v.pairText).toBe('60 × 100');
    expect(v.sizeSf).toBe(6000);
    expect(v.sizeText).toBe('6,000 sf');
    // ★★★ THE FLAG THAT MUST SURVIVE EVERY SURFACE. A derived area is
    //     arithmetic; a typed one is a survey. The migration writes neither.
    expect(v.sizeDerived).toBe(true);
    expect(v.irregular).toBe(false);
  });

  it('★★ 5/8 · a size with NO dimensions → the size alone, and no "varies"', () => {
    // ★★★ COWORK'S CALL, NOT BOBBY'S — flagged in the fix-488 PR. With neither
    //     dimension known we have an AREA and nothing else; "varies × varies"
    //     would assert an irregular parcel from an entry that says only "I know
    //     the square footage".
    const v = lotSizeView(null, null, 9000);
    expect(v.sizeSf).toBe(9000);
    expect(v.sizeText).toBe('9,000 sf');
    expect(v.sizeDerived).toBe(false);
    expect(v.pairText).toBeNull();
    expect(v.widthVaries).toBe(false);
    expect(v.depthVaries).toBe(false);
  });

  it('★★★ 6/8 · BOBBY\'S CASE — width + size, blank depth → "60 × varies"', () => {
    const v = lotSizeView(60, null, 7200);
    expect(v.pairText).toBe(`60 × ${LOT_VARIES_LABEL}`);
    expect(v.depthVaries).toBe(true);
    expect(v.widthVaries).toBe(false);
    expect(v.sizeSf).toBe(7200);
    expect(v.sizeText).toBe('7,200 sf');
    expect(v.sizeDerived).toBe(false);
    expect(v.irregular).toBe(false);
  });

  it('★★ 7/8 · depth + size, blank width → the mirror', () => {
    const v = lotSizeView(null, 100, 9000);
    expect(v.pairText).toBe(`${LOT_VARIES_LABEL} × 100`);
    expect(v.widthVaries).toBe(true);
    expect(v.depthVaries).toBe(false);
    expect(v.sizeSf).toBe(9000);
  });

  it('★★★ 8/8 · all three typed → all three shown; >5% apart is a NOTE', () => {
    // Agreeing: 60 × 100 = 6,000 against a typed 6,000.
    const agree = lotSizeView(60, 100, 6000);
    expect(agree.pairText).toBe('60 × 100');
    expect(agree.sizeSf).toBe(6000);
    expect(agree.sizeDerived).toBe(false);
    expect(agree.irregular).toBe(false);

    // Disagreeing: 60 × 100 = 6,000 against a typed 9,000 — 50% out.
    const clash = lotSizeView(60, 100, 9000);
    expect(clash.sizeSf).toBe(9000);
    expect(clash.irregular).toBe(true);
    // ★★★ NO AUTO-CORRECT AND NO ERROR. Both numbers are things a person
    //     typed; a tool that "fixed" one would be overwriting a survey with
    //     arithmetic. The typed size is what is shown, and the note is the
    //     whole intervention.
    expect(clash.pairText).toBe('60 × 100');
  });

  it('★★★ the 5% boundary is exact, and the number is COWORK\'S not Bobby\'s', () => {
    // ★ Recorded in the test as well as the code: Bobby did not rule on this
    //   figure, so the next person to change it is changing a Cowork decision
    //   rather than overriding him.
    expect(LOT_IRREGULAR_TOLERANCE).toBe(0.05);
    // 100 × 100 = 10,000 against 10,500 → exactly 5%, INSIDE the tolerance.
    expect(lotSizeView(100, 100, 10500).irregular).toBe(false);
    // …and 10,499 → 4.77% out the other way, also inside.
    expect(lotSizeView(100, 100, 10499).irregular).toBe(false);
    // 10,000 against 9,500 → 5.26%, outside.
    expect(lotSizeView(100, 100, 9500).irregular).toBe(true);
  });

  it('★★★ "varies" NEVER renders as a number, in any of the eight', () => {
    // ★★ The brief's own acceptance line, asserted over the whole matrix rather
    //    than on the one case that motivated it.
    const dims = [null, 60] as const;
    const sizes = [null, 7200] as const;
    for (const w of dims) {
      for (const d of dims) {
        for (const s of sizes) {
          const v = lotSizeView(w, d, s);
          if (v.widthVaries) expect(v.widthText).toBe(LOT_VARIES_LABEL);
          if (v.depthVaries) expect(v.depthText).toBe(LOT_VARIES_LABEL);
          // The inverse: a numeric text is never flagged as varying.
          if (v.widthText !== null && v.widthText !== LOT_VARIES_LABEL) {
            expect(v.widthVaries).toBe(false);
            expect(Number.isNaN(Number(v.widthText))).toBe(false);
          }
          if (v.depthText !== null && v.depthText !== LOT_VARIES_LABEL) {
            expect(v.depthVaries).toBe(false);
            expect(Number.isNaN(Number(v.depthText))).toBe(false);
          }
        }
      }
    }
  });

  it('★★ fix-411\'s whole-feet rule still owns how a DIMENSION looks', () => {
    // ★★★ AND THE DERIVED PRODUCT IS COMPUTED FROM THE ROUNDED FEET. The card
    //     shows "100 × 120"; a size of 12,057 under it would read as an
    //     arithmetic bug rather than as the two hidden decimals it is.
    const v = lotSizeView(100.47, 120.5, null);
    expect(v.pairText).toBe('100 × 121');
    expect(v.sizeSf).toBe(12100);
  });

  it('★★ `formatLotPair`\'s "both or neither" is UNCHANGED — two rules, one older', () => {
    // ★★★ fix-488 SUPERSEDES IT ONLY WHERE A SIZE IS INVOLVED. That rule was
    //     right while a half-known lot was always an unknown lot, and its
    //     existing callers still want it. Changing its meaning under the old
    //     name would have moved every one of them silently.
    expect(formatLotPair(60, null)).toBeNull();
    expect(formatLotPair(60, 100)).toBe('60×100');
    // …while the size-aware rule says something useful about the same input.
    expect(lotSizeView(60, null, 7200).pairText).toBe('60 × varies');
  });

  it('★ the size is grouped and suffixed, once', () => {
    expect(formatLotSizeSf(7200)).toBe('7,200 sf');
    expect(formatLotSizeSf(950)).toBe('950 sf');
    expect(formatLotSizeSf(null)).toBeNull();
    expect(formatLotSizeSf(Number.NaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §B · UNIT SIZE IS TYPED, NEVER COMPUTED
// ---------------------------------------------------------------------------

describe('fix-488 §B: unit_types[].size_sf', () => {
  it('★★★ `parseUnitTypes` carries it — the whitelist is the only thing that can', () => {
    // ★★★ THE MECHANISM: `parseUnitTypes` rebuilds each unit key by key and
    //     both editors write the PARSED array back, so a key it does not name
    //     is DELETED from the row on the next edit of any other field.
    //     fix-412 discovered it, fix-486 used it deliberately to retire
    //     `work_scope`, and it is the entire reason this field needs no
    //     migration.
    const parsed = parseUnitTypes([
      { label: 'Detached', width_ft: 20, depth_ft: 40, qty: 1, size_sf: 1700 },
    ]);
    expect(parsed[0].size_sf).toBe(1700);
    expect('size_sf' in parsed[0]).toBe(true);
  });

  it('★★★ THERE IS NO W×D FALLBACK, and the units are why', () => {
    // ★★★ `width_ft × depth_ft` is a FOOTPRINT — square feet of ground. This is
    //     a FLOOR AREA across `stories`. A two-storey 20×40 covers 800 sf of
    //     lot and has ~1,600 sf of floor, so a fallback would answer "show me
    //     my 1,700 sf units" with the wrong rows and no way to tell. Bobby
    //     ruled it out in the sentence that asked for the field.
    const parsed = parseUnitTypes([
      { label: 'Detached', width_ft: 20, depth_ft: 40, qty: 1, stories: 2 },
    ]);
    expect(parsed[0].size_sf).toBeNull();
    expect(parsed[0].width_ft).toBe(20);
    expect(parsed[0].depth_ft).toBe(40);
  });

  it('★★ NULL is NOT RECORDED, never 0 — and a 0 is a typo, not a recorded zero', () => {
    // ★ Unlike `parking_stalls`, where 0 is a real answer. A unit cannot have
    //   zero floor area, so a 0 here is somebody's slip and must not become a
    //   value the Library filter then matches on.
    const rows = parseUnitTypes([
      { label: 'A', size_sf: 0 },
      { label: 'B', size_sf: -50 },
      { label: 'C', size_sf: 'big' },
      { label: 'D' },
      { label: 'E', size_sf: 1700 },
    ]);
    expect(rows.map((r) => r.size_sf)).toEqual([null, null, null, null, 1700]);
  });

  it('★★ every OTHER unit key survives beside it — the blanket half', () => {
    // ★ A whitelist edit is exactly the change that quietly takes a neighbour
    //   along; fix-486 asserted this in the other direction for the same reason.
    const [row] = parseUnitTypes([
      {
        label: 'Attached',
        width_ft: 24.5,
        depth_ft: 40,
        qty: 2,
        stories: 3,
        parking_kind: 'garage',
        parking_stalls: 0,
        roof_deck: true,
        size_sf: 2100,
      },
    ]);
    expect(row).toEqual({
      label: 'Attached',
      width_ft: 24.5,
      depth_ft: 40,
      qty: 2,
      stories: 3,
      parking_kind: 'garage',
      parking_stalls: 0,
      roof_deck: true,
      size_sf: 2100,
    });
  });
});

// ---------------------------------------------------------------------------
// THE MIGRATION
// ---------------------------------------------------------------------------

describe('fix-488: the migration', () => {
  it('★★★ it adds the column and writes NOTHING', () => {
    // ★ The `?raw` guard (fix-406): assert the file arrived before trusting a
    //   "contains" check, or an empty string passes everything below.
    expect(migrationSql.length).toBeGreaterThan(2000);
    expect(migrationSql).toMatch(
      /add column if not exists lot_size_sf integer;/,
    );
    // ★★★ NO DEFAULT, unlike fix-487's `construction_admin`. There a column
    //     default was right because every project had the same answer; here the
    //     empty state IS the answer, and a default would fabricate 211 surveys.
    expect(migrationSql).not.toMatch(/lot_size_sf integer default/i);
    expect(migrationSql).not.toMatch(/update public\.projects[\s\S]{0,200}lot_size_sf/i);
    // …and it says so out loud, in its own verify block.
    expect(migrationSql).toMatch(/this migration writes none/);
  });

  it('★★★ the CREATE rpc patch keeps the column list and the value list ALIGNED', () => {
    // ★★★ THE FAILURE MODE THIS GUARDS: those two lists are POSITIONAL.
    //     Inserting `lot_size_sf` into the column list and not into the values
    //     would shift every column after it by one and write the `unit_types`
    //     array into `lot_depth` — a silent, total corruption of every new
    //     project. Both replacements happen in one pass.
    // ★ Sliced from the `v_cols` DECLARATION, not from the first mention of
    //   the function name — that first mention is inside a comment, and a
    //   slice anchored on it is two words long and passes nothing.
    const block = migrationSql.slice(migrationSql.indexOf('v_cols :='));
    expect(block).toContain('lot_width, lot_depth, lot_size_sf, unit_types');
    expect(block).toContain(`NULLIF(v_pd->>''lot_size_sf'', '''')::int`);
    expect(block).toMatch(/replace\(\s*\n?\s*replace\(v_src, v_cols/);
  });

  it('★★★ the signature is rebuilt WITH parameter defaults', () => {
    // ★★★ THE TRAP THIS TICKET HIT ON THE FIRST ATTEMPT.
    //     `pg_get_function_identity_arguments` STRIPS parameter defaults, and
    //     `bp_create_project_with_permits` has them — so the CREATE OR REPLACE
    //     was rejected outright with *"cannot remove parameter defaults from
    //     existing function"*. It failed loudly, which is the only reason this
    //     is a note rather than a bug; fix-487 patched a function that happens
    //     to have none and never met it.
    expect(migrationSql).toContain('pg_get_function_arguments(');
    expect(migrationSql).not.toContain('pg_get_function_identity_arguments(');
  });

  it('★★ and NOTHING is migrated for the unit field, deliberately', () => {
    // ★ `projects.unit_types` is jsonb and both RPCs pass it through wholesale,
    //   so the database has no opinion about a unit row's keys. Asserted so a
    //   future reader does not go looking for the migration that is missing.
    // ★ `lot_size_sf integer` is the projects column, so the check is that
    //   there is exactly ONE `alter table` in the file and it is that one.
    const alters = migrationSql
      .split('\n')
      .filter((l) => l.trim().startsWith('alter table '));
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain('public.projects');
    expect(migrationSql).toMatch(/parseUnitTypes is the only gate|WHITELIST/);
  });

  it('★★★ the four-place rule: the select list carries the column', () => {
    // ★★★ FIFTH TIME. `useProjects` uses an EXPLICIT PostgREST select list, so
    //     an unlisted column arrives `undefined` on every read surface for ever
    //     with no error — fix-122, fix-386, fix-410 and fix-487 all recorded it
    //     in this same file.
    const hook = readFileSync(
      resolve(process.cwd(), 'src/hooks/useProjects.ts'),
      'utf8',
    );
    expect(hook).toContain('lot_size_sf');
    expect(hook).toMatch(/lot_width, lot_depth, lot_size_sf/);
  });
});


// ---------------------------------------------------------------------------
// THE LIBRARY — the two ± filters, and Bobby's acceptance query
// ---------------------------------------------------------------------------

const FILTERS: LibraryFilters = {
  view: 'site',
  lotwTarget: null, lotwBuf: 2, lotdTarget: null, lotdBuf: 2,
  lotsizeTarget: null, lotsizeBuf: 500,
  unitwTarget: null, unitwBuf: 2, unitdTarget: null, unitdBuf: 2,
  unitsizeTarget: null, unitsizeBuf: 100,
  zone: '', alley: '', productTypes: [], juris: '',
  isCornerLot: '', stories: '', parkingKind: '', stalls: '', roofDeck: '',
};

const unit = (over: Partial<UnitType> = {}): UnitType =>
  ({ label: 'Detached', width_ft: 20, depth_ft: 40, qty: 1, ...over }) as UnitType;

const row = (id: string, over: Partial<LibraryRow> = {}): LibraryRow =>
  ({
    projectId: id, address: id, juris: 'Seattle', productTypes: [],
    units: 1, zone: 'NR', lotWidth: 60, lotDepth: 100, lotSizeSf: null,
    alley: 'No', tags: [], stage: 'de', unitTypes: [], numLots: null,
    isCornerLot: null, isRegularShape: null, updatedAt: null,
    ...over,
  }) as unknown as LibraryRow;

describe('fix-488: the Library lot-size filter', () => {
  it('★★★ it matches the TYPED size and NEVER a derived one', () => {
    // ★★★ THE RULE THAT MAKES THE FILTER MEAN SOMETHING. 205 of 211 prod
    //     projects have a width and a depth, so a filter that also matched
    //     `w × d` would answer "which lots are about 7,000 sf" with two hundred
    //     rectangles nobody measured — a calculator, not a search.
    const typed = { ...row('typed'), lotSizeSf: 7200 };
    const derivable = { ...row('derivable'), lotWidth: 72, lotDepth: 100 };
    const out = filterLibraryRows([typed, derivable], {
      ...FILTERS,
      lotsizeTarget: 7200,
    });
    expect(out.map((r) => r.projectId)).toEqual(['typed']);
  });

  it('★★ ±500 by default, and the window is inclusive on both sides', () => {
    const rows = [
      { ...row('in-low'), lotSizeSf: 6700 },
      { ...row('in-high'), lotSizeSf: 7700 },
      { ...row('out'), lotSizeSf: 7701 },
    ];
    const out = filterLibraryRows(rows, { ...FILTERS, lotsizeTarget: 7200 });
    expect(out.map((r) => r.projectId)).toEqual(['in-low', 'in-high']);
  });

  it('★ inactive by default — a null target matches everything', () => {
    const rows = [{ ...row('a'), lotSizeSf: 7200 }, row('b')];
    expect(filterLibraryRows(rows, FILTERS)).toHaveLength(2);
  });
});

describe("fix-488 §B: Bobby's acceptance query", () => {
  it('★★★ size 1,700 ±100 AND parking = Garage returns exactly the rows that match BOTH', () => {
    // ★★★ *"show me all my 1,700 sqft units with a garage."* Verbatim, as a
    //     test — and the conjunction is PER UNIT (fix-402), which is the part
    //     that makes the answer mean what the sentence means.
    const both = row('both', {});
    both.unitTypes = [unit({ size_sf: 1700, parking_kind: 'garage' })];

    const sizeOnly = row('size-only', {});
    sizeOnly.unitTypes = [unit({ size_sf: 1700, parking_kind: 'surface' })];

    const garageOnly = row('garage-only', {});
    garageOnly.unitTypes = [unit({ size_sf: 2400, parking_kind: 'garage' })];

    // ★★★ THE ONE THAT WOULD PASS UNDER A PER-*FILTER* READING AND MUST NOT:
    //     unit A is 1,700 sf with no garage, unit B has a garage and is 2,400.
    //     No single unit is both, so the project does not match.
    const split = row('split', {});
    split.unitTypes = [
      unit({ size_sf: 1700, parking_kind: 'surface' }),
      unit({ size_sf: 2400, parking_kind: 'garage' }),
    ];

    const unmeasured = row('unmeasured', {});
    unmeasured.unitTypes = [unit({ parking_kind: 'garage' })];

    const q: LibraryFilters = {
      ...FILTERS,
      unitsizeTarget: 1700,
      parkingKind: 'garage',
    };
    const out = filterLibraryRows(
      [both, sizeOnly, garageOnly, split, unmeasured],
      q,
    );
    expect(out.map((r) => r.projectId)).toEqual(['both']);

    // ★ …and the matching UNIT is identified, not just the project — which is
    //   what stops the unit view printing the other rows (fix-469).
    expect(matchingUnitIndices(both, q)).toEqual([0]);
    expect(matchingUnitIndices(split, q)).toEqual([]);
  });

  it('★★★ WITHOUT `hasAnyUnitFilter` KNOWING THE KEY THE FILTER IS INERT', () => {
    // ★★ fix-412's warning, still load-bearing: `matchingUnitIndices`
    //    early-returns EVERY index when this says no filter is active, so a
    //    target the function does not know about changes nothing at all.
    expect(hasAnyUnitFilter({ ...FILTERS, unitsizeTarget: 1700 })).toBe(true);
    expect(hasAnyUnitFilter(FILTERS)).toBe(false);
  });

  it('★★ an unmeasured unit does not match an ACTIVE size filter', () => {
    // ★ `matchTargetWithBuffer` treats null as "no". That is right here: a unit
    //   nobody has measured is not evidence of a 1,700 sf unit — and leaving
    //   them in would make the answer useless while every row is still null.
    const r = row('u', {});
    r.unitTypes = [unit({ size_sf: null })];
    expect(
      filterLibraryRows([r], { ...FILTERS, unitsizeTarget: 1700 }),
    ).toHaveLength(0);
  });
});

describe('fix-488: sorting and the card partition', () => {
  it('★★★ the site sort has an ARM, and NULLs go last in BOTH directions', () => {
    // ★★★ fix-410's warning: a name in `SORTABLE_COLUMNS` without a handler
    //     falls through to `a[col].localeCompare(...)` and throws DURING
    //     RENDER. And this column is the only NULLABLE number in the site
    //     sorter — under the plain-subtraction arm, `null - 5` is `-5`, so
    //     every unmeasured lot would sort as the smallest in both directions.
    expect(SORTABLE_COLUMNS).toContain('lotSizeSf');
    const rows = [
      { ...row('big'), lotSizeSf: 9000 },
      { ...row('none'), lotSizeSf: null },
      { ...row('small'), lotSizeSf: 5000 },
    ];
    expect(
      sortLibraryRows(rows, { col: 'lotSizeSf', asc: true }).map((r) => r.projectId),
    ).toEqual(['small', 'big', 'none']);
    expect(
      sortLibraryRows(rows, { col: 'lotSizeSf', asc: false }).map((r) => r.projectId),
    ).toEqual(['big', 'small', 'none']);
  });

  it('★★★ every new filter key is filed to exactly one card', () => {
    // ★★ `libraryFilterKeyCoverage` is what turns a forgotten key into a test
    //    failure instead of a control no Clear can reach.
    const cov = libraryFilterKeyCoverage(FILTERS);
    expect(cov.unfiled).toEqual([]);
    expect(cov.duplicated).toEqual([]);
    expect(SITE_FILTER_KEYS).toContain('lotsizeTarget');
    expect(SITE_FILTER_KEYS).toContain('lotsizeBuf');
    expect(UNIT_FILTER_KEYS).toContain('unitsizeTarget');
    expect(UNIT_FILTER_KEYS).toContain('unitsizeBuf');
  });

  it('★★★ the stored-filter decoder names both pairs, or they reset on reload', () => {
    // ★★★ SILENT OTHERWISE. `loadLibraryFilters` is field-by-field: a key it
    //     does not name is never read back, so the filters would work all
    //     session and forget themselves on every refresh, with no error.
    const decoder = readFileSync(
      resolve(process.cwd(), 'src/lib/surfaceFilterPrefs.ts'),
      'utf8',
    );
    for (const k of ['lotsizeTarget', 'lotsizeBuf', 'unitsizeTarget', 'unitsizeBuf']) {
      expect(decoder, k).toContain(k);
    }
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE COLUMN THAT DID NOT SHIP, AND THE NUMBER THAT STOPPED IT
// ---------------------------------------------------------------------------

describe('fix-488 §B: why the overview units matrix has no Size column', () => {
  it('★★★ the matrix is UNCHANGED at eight data columns and 274px', () => {
    // ★★★ BUILT, MEASURED, REVERTED. A ninth column took the matrix to 312px,
    //     the PROJECT card floor to 334, the row minimum to 1,248 and the wrap
    //     point to 1,818 — and then broke fix-423 §D's guarantee that below the
    //     wrap point BOTH LINES FIT AT 1280: the wider line needed 736px
    //     against 710 available, i.e. a sideways scrollbar on the overview,
    //     which is the exact defect fix-417 exists to prevent.
    //
    // ★★ fix-422's note said "a ninth data column costs nothing but a row in
    //    the table above". That was wrong, and lib/unitRowLayout now carries
    //    the correction with the arithmetic.
    expect(UNIT_ROW_COLUMNS.map((c) => c.key)).toEqual([
      'label', 'width_ft', 'depth_ft', 'qty', 'stories',
      'parking_kind', 'parking_stalls', 'roof_deck', 'remove',
    ]);
    expect(UNIT_MATRIX_WIDTH).toBe(274);
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(1172);
    expect(UNIT_ROW_COLUMNS.some((c) => c.key === 'size_sf')).toBe(false);
  });

  it('★★ …and the FIELD still ships — typed and searchable, which is the ask', () => {
    // ★ Bobby: *"something we actually type in… so we can search for units that
    //   fit that criteria."* Both halves are live; only the overview DISPLAY is
    //   missing, and the PR puts the options to him.
    const [u] = parseUnitTypes([{ label: 'A', size_sf: 1700 }]);
    expect(u.size_sf).toBe(1700);
    const r = row('x', {});
    r.unitTypes = [unit({ size_sf: 1700 })];
    expect(
      filterLibraryRows([r], { ...FILTERS, unitsizeTarget: 1700 }),
    ).toHaveLength(1);
    // The Library's unit table is where it is typed, and it has a cell.
    const matrix = readFileSync(
      resolve(process.cwd(), 'src/components/LibraryMatrix.tsx'),
      'utf8',
    );
    expect(matrix).toContain('-size`');
    expect(matrix).toContain("onChange('size_sf'");
  });
});
