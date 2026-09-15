import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MIGRATION from '../../migrations/fix_562_unit_matrix_vocabulary_PENDING_APPROVAL.sql?raw';
import {
  CANONICAL_PARKING,
  CANONICAL_ROOF_DECK,
  CANONICAL_STORIES,
  NOT_RECORDED,
  PARKING_OPTIONS_KEY,
  ROOF_DECK_OPTIONS_KEY,
  STORIES_OPTIONS_KEY,
  UNIT_VOCABULARY_KEYS,
  decodeParking,
  decodeRoofDeck,
  decodeStories,
  isStorableVocabularyEntry,
  matchParkingOption,
  matchRoofDeckOption,
  parkingLabel,
  parkingOptions,
  roofDeckLabel,
  roofDeckOptions,
  storiesLabel,
  storiesOptions,
  unitVocabularyIssues,
  withCurrent,
} from '../lib/unitVocabulary';
import { parseUnitTypes } from '../lib/unitTypeNaming';
import {
  DEFAULT_UNIT_SORT,
  UNIT_SORTABLE_COLUMNS,
  sortUnitRows,
  type LibraryUnitRow,
} from '../lib/libraryUnitRows';
import { LIBRARY_UNIT_COLUMNS } from '../lib/libraryUnitColumns';
import { UNIT_CONFIG_FIELDS } from '../lib/unitConfigFields';
import {
  UNIT_FILTER_KEYS,
  SITE_FILTER_KEYS,
  matchingUnitIndices,
  type LibraryFilters,
  type LibraryRow,
} from '../lib/libraryHelpers';
import type { UnitType } from '../lib/database.types';

// ===========================================================================
// fix-562 — the unit matrix says what drives the floor plan (P-268, P-274)
// ===========================================================================
//
// Bobby, 2026-09-14:
//
//   *"the main thing we're trying to identify is, does this unit width/depth or
//    unit size, how is parking driving that? Is it one-car, two-car, three,
//    four, or surface/none?"*
//
// Three vocabularies replace fix-402's and fix-205's:
//
//   parking    1-car garage · 2-car garage · 3-car garage · 4-car garage ·
//              Surface / None        (`parking_stalls` leaves the product)
//   roof deck  W/ PH · W/O PH · None
//   stories    1 · 1+B · 2 · 2+B · 3 · 3+B · 4 · 4+B   (B is a basement)
//
// ---------------------------------------------------------------------------
// ★★★ MEASURED ON PROD 2026-09-15 — AND IT MOVED WHILE THIS WAS BEING WRITTEN
// ---------------------------------------------------------------------------
//
//   at ~14:05   267 units · 123 parking · 123 roof deck · 256 stories
//   at ~14:30   270 units · 126 parking · 126 roof deck · 259 stories
//
// ★★★ SOMEBODY IS BACKFILLING THIS BOOK RIGHT NOW, and the wipe clears their
//     work too. Bobby ruled it after being told ~105 of 123 parking rows would
//     convert automatically — *"Wipe it all as I said"* — so nothing here
//     softens it. What changed is that every count in the migration is
//     RE-DERIVED at run time rather than compared against a literal.

const unit = (over: Partial<UnitType> = {}): UnitType => ({
  label: 'Detached',
  width_ft: 20,
  depth_ft: 40,
  qty: 1,
  stories: null,
  basement: null,
  parking_kind: null,
  parking_count: null,
  roof_deck: null,
  penthouse: null,
  ...over,
});

// ---------------------------------------------------------------------------
// §A1 · THE COMPOSER — the three assertions the brief names by hand
// ---------------------------------------------------------------------------

describe('fix-562 §A: the composer says exactly what the vocabulary says', () => {
  it('★★★ garage + 2 → `2-car garage`; surface + anything → `Surface / None`', () => {
    expect(parkingLabel('garage', 2)).toBe('2-car garage');
    expect(parkingLabel('garage', 1)).toBe('1-car garage');
    expect(parkingLabel('garage', 4)).toBe('4-car garage');
    // ★ The surface answer takes NO count, and a stray one does not leak into
    //   the label — there is no "2-car surface" in the vocabulary.
    expect(parkingLabel('surface_none', null)).toBe('Surface / None');
    expect(parkingLabel('surface_none', 3)).toBe('Surface / None');
  });

  it('★★★ null → `—`, and never a guessed default', () => {
    // ★★★ AFTER §B ALMOST EVERY UNIT IS EMPTY, so this is the common case
    //     rather than the corner. A blank that looks like a real answer is
    //     worse than a blank (fix-386, in the place it bites hardest).
    expect(parkingLabel(null, null)).toBe(NOT_RECORDED);
    expect(parkingLabel(undefined, undefined)).toBe(NOT_RECORDED);
    expect(roofDeckLabel(null, null)).toBe(NOT_RECORDED);
    expect(storiesLabel(null, null)).toBe(NOT_RECORDED);
    // ★ …and a garage with no count has no label at all, so it reads `—`
    //   rather than inventing a sixth string.
    expect(parkingLabel('garage', null)).toBe(NOT_RECORDED);
  });

  it('★★★ stories 3 + basement true → `3+B`; false → `3`; null stories → `—`', () => {
    expect(storiesLabel(3, true)).toBe('3+B');
    expect(storiesLabel(3, false)).toBe('3');
    expect(storiesLabel(null, true)).toBe(NOT_RECORDED);
    // ★★ `basement` is a MODIFIER of a recorded count, not an independent
    //    field: no vocabulary entry means "3 storeys, basement unknown", so a
    //    missing flag beside a recorded count reads as no basement.
    expect(storiesLabel(3, null)).toBe('3');
  });

  it('★★★ roof_deck true + penthouse true → `W/ PH`; true + false → `W/O PH`; false → `None`', () => {
    expect(roofDeckLabel(true, true)).toBe('W/ PH');
    expect(roofDeckLabel(true, false)).toBe('W/O PH');
    expect(roofDeckLabel(false, false)).toBe('None');
    // ★ `deck: false` wins outright — a penthouse over no roof deck is not a
    //   state the vocabulary can describe, and `None` is the honest answer.
    expect(roofDeckLabel(false, true)).toBe('None');
    expect(roofDeckLabel(true, null)).toBe('W/O PH');
  });

  it('★★★ every canonical option round-trips through the codec', () => {
    // ★★ THE PROPERTY THAT KEEPS THE REGISTRY AND THE STORAGE IN STEP: what
    //    the dropdown offers must be storable, and what is stored must compose
    //    back to what the dropdown offered.
    for (const label of CANONICAL_PARKING) {
      const p = decodeParking(label);
      expect(p, label).not.toBeNull();
      expect(parkingLabel(p!.kind, p!.count)).toBe(label);
    }
    for (const label of CANONICAL_ROOF_DECK) {
      const p = decodeRoofDeck(label);
      expect(p, label).not.toBeNull();
      expect(roofDeckLabel(p!.deck, p!.penthouse)).toBe(label);
    }
    for (const label of CANONICAL_STORIES) {
      const p = decodeStories(label);
      expect(p, label).not.toBeNull();
      expect(storiesLabel(p!.stories, p!.basement)).toBe(label);
    }
  });

  it('★★ `both` is GONE BY DESIGN, and nothing infers it', () => {
    // Bobby removed it; the 11 prod rows that held it are in the snapshot, not
    // converted. The parser is where that is enforced.
    expect(CANONICAL_PARKING.join(' ')).not.toContain('Both');
    const [u] = parseUnitTypes([{ label: 'A', qty: 1, parking_kind: 'both' }]);
    expect(u!.parking_kind).toBeNull();
    expect(decodeParking('Both')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §A2 · THE STORAGE DECISION — parts, not a composed string
// ---------------------------------------------------------------------------

const uRow = (i: number, u: UnitType): LibraryUnitRow => ({
  key: `p:${i}`,
  index: i,
  unit: u,
  project: {
    projectId: 'p', address: '1 Main St', juris: 'Seattle', productTypes: [],
    units: 1, zone: 'NR', lotWidth: 50, lotDepth: 100, lotSizeSf: null,
    alley: 'No', tags: [], stage: 'de', unitTypes: [], numLots: null,
    isCornerLot: null, isRegularShape: null, updatedAt: null,
  } as unknown as LibraryRow,
});

describe('fix-562 §A: the parts are stored, and THIS is why', () => {
  it('★★★ STORIES STILL SORTS NUMERICALLY across a mix of 2, 2+B and 3', () => {
    // ★★★ THE ASSERTION THE STORAGE DECISION RESTS ON, and it asserts the
    //     ORDER rather than that a sort function was called. A stored `"3+B"`
    //     string would sort as TEXT: `3+B` away from `3`, and `10` between `1`
    //     and `2` the first time anybody records a tall one.
    const rows = [
      uRow(0, unit({ stories: 3, basement: false })),
      uRow(1, unit({ stories: 2, basement: true })),
      uRow(2, unit({ stories: 2, basement: false })),
      uRow(3, unit({ stories: 10, basement: false })),
      uRow(4, unit({ stories: null })),
    ];
    const asc = sortUnitRows(rows, { col: 'stories', asc: true });
    expect(asc.map((r) => storiesLabel(r.unit.stories, r.unit.basement))).toEqual([
      '2', '2+B', '3', '10', NOT_RECORDED,
    ]);
    // ★ NULLS LAST IN BOTH DIRECTIONS — "not recorded" is not a small number.
    const desc = sortUnitRows(rows, { col: 'stories', asc: false });
    expect(desc.map((r) => storiesLabel(r.unit.stories, r.unit.basement))).toEqual([
      '10', '3', '2+B', '2', NOT_RECORDED,
    ]);
  });

  it('★★★ …and PARKING sorts by (kind, count), not by its label', () => {
    // As text `10-car garage` would sort between `1-car` and `2-car`.
    const rows = [
      uRow(0, unit({ parking_kind: 'surface_none' })),
      uRow(1, unit({ parking_kind: 'garage', parking_count: 10 })),
      uRow(2, unit({ parking_kind: 'garage', parking_count: 2 })),
      uRow(3, unit({ parking_kind: null })),
    ];
    expect(
      sortUnitRows(rows, { col: 'parking', asc: true }).map((r) =>
        parkingLabel(r.unit.parking_kind, r.unit.parking_count),
      ),
    ).toEqual(['2-car garage', '10-car garage', 'Surface / None', NOT_RECORDED]);
  });

  it('★★★ SUPERSEDED BY fix-571 §A: filtering by 3 returns ONLY `3`', () => {
    // ★★★ THIS ASSERTION USED TO READ `[0, 1]`, AND fix-562 FLAGGED IT.
    //
    //     It said: *"every 3-storey unit is ONE question — stated in the PR in
    //     case Bobby wants them separately; it would be two more options on the
    //     Stories filter and nothing else."* He wanted them separately
    //     (2026-09-15: *"i figured, in the unit stories, it would show 1, 1+b,
    //     2, 2+B, etc."*), and it was two more options and nothing else.
    //
    // ★★ SUPERSEDED, NOT MISTAKEN (fix-400's rule). The old expectation is
    //    quoted above rather than deleted, so the reversal is a decision on the
    //    record and not a test that quietly changed sign.
    //
    // ★★★ AND THE SECTION THIS TEST LIVES IN IS UNTOUCHED, WHICH IS THE POINT.
    //     *"The parts are stored, and THIS is why"* rested on TWO benefits;
    //     Bobby has spent the second one. The FIRST — the numeric sort, asserted
    //     directly above — is why `stories` is still an int and `basement`
    //     still a bool, and it is what made fix-571 a two-line change instead
    //     of a re-storage. A ruling changing does not make the reasoning behind
    //     the other half wrong.
    const row = {
      projectId: 'p',
      unitTypes: [
        unit({ stories: 3, basement: false }),
        unit({ stories: 3, basement: true }),
        unit({ stories: 2, basement: false }),
      ],
    } as unknown as LibraryRow;
    expect(matchingUnitIndices(row, { ...BASE, stories: '3' })).toEqual([0]);
    expect(matchingUnitIndices(row, { ...BASE, stories: '3+B' })).toEqual([1]);
  });

  it('★★ every member of UNIT_SORTABLE_COLUMNS still sorts without throwing', () => {
    // fix-410's rule: a name in the list without an arm falls through to a
    // comparison the value cannot support.
    const rows = [uRow(0, unit({ stories: 2 })), uRow(1, unit({ stories: 3 }))];
    for (const col of UNIT_SORTABLE_COLUMNS) {
      expect(() => sortUnitRows(rows, { col, asc: true }), col).not.toThrow();
    }
    expect(UNIT_SORTABLE_COLUMNS).toContain(DEFAULT_UNIT_SORT.col);
  });
});

// ---------------------------------------------------------------------------
// §A3 · THE REGISTRIES — and the one that cannot be fully open
// ---------------------------------------------------------------------------

describe('fix-562 §A: all three lists are app_config registries', () => {
  it('★★★ each key falls back to its canonical list, and reads the registry when set', () => {
    const empty = new Map<string, unknown>();
    expect(parkingOptions(empty)).toEqual([...CANONICAL_PARKING]);
    expect(roofDeckOptions(empty)).toEqual([...CANONICAL_ROOF_DECK]);
    expect(storiesOptions(empty)).toEqual([...CANONICAL_STORIES]);

    const cfg = new Map<string, unknown>([
      [PARKING_OPTIONS_KEY, ['Surface / None', '1-car garage']],
      [ROOF_DECK_OPTIONS_KEY, ['None']],
      [STORIES_OPTIONS_KEY, ['2', '2+B']],
    ]);
    expect(parkingOptions(cfg)).toEqual(['Surface / None', '1-car garage']);
    expect(roofDeckOptions(cfg)).toEqual(['None']);
    expect(storiesOptions(cfg)).toEqual(['2', '2+B']);
  });

  it('★★★ PARKING AND STORIES ARE GENUINELY OPEN — a new option needs no deploy', () => {
    // ★★ Shape-based decoding, which is what makes "registry-driven" true
    //    rather than decorative for these two.
    const cfg = new Map<string, unknown>([
      [PARKING_OPTIONS_KEY, ['5-car garage']],
      [STORIES_OPTIONS_KEY, ['6+B']],
    ]);
    expect(unitVocabularyIssues(cfg).map((i) => i.label)).not.toContain('5-car garage');
    expect(decodeParking('5-car garage')).toEqual({ kind: 'garage', count: 5 });
    expect(decodeStories('6+B')).toEqual({ stories: 6, basement: true });
    expect(parkingLabel('garage', 5)).toBe('5-car garage');
    expect(storiesLabel(6, true)).toBe('6+B');
  });

  it('★★★ ROOF DECK IS THE ONE THAT CANNOT BE, AND IT SAYS SO', () => {
    // ★★★ THE HONEST LIMIT, REPORTED RATHER THAN HIDDEN. Its three labels map
    //     onto a fixed (deck, penthouse) pair, so a fourth entry has nowhere to
    //     be stored. Dropping it from the dropdown silently is how a Settings
    //     screen starts lying about what it controls — Settings renders a `⚠`
    //     on exactly these pills instead.
    const cfg = new Map<string, unknown>([
      [ROOF_DECK_OPTIONS_KEY, ['W/ PH', 'W/O PH', 'None', 'Rooftop terrace']],
    ]);
    expect(unitVocabularyIssues(cfg)).toEqual([
      { key: ROOF_DECK_OPTIONS_KEY, label: 'Rooftop terrace' },
    ]);
    expect(isStorableVocabularyEntry(ROOF_DECK_OPTIONS_KEY, 'Rooftop terrace')).toBe(false);
    // ★ …and the three that ARE storable are not flagged, so the mark means
    //   something.
    for (const ok of CANONICAL_ROOF_DECK) {
      expect(isStorableVocabularyEntry(ROOF_DECK_OPTIONS_KEY, ok), ok).toBe(true);
    }
    // ★★ The shipped registry is clean — a `⚠` on a default would make the
    //    mark noise from day one.
    expect(unitVocabularyIssues(new Map())).toEqual([]);
  });

  it('★★ a stored answer the registry no longer offers is APPENDED, never dropped', () => {
    // fix-364 / fix-415's rule: a `<select>` whose value matches no option
    // renders BLANK and silently claims the field is empty.
    expect(withCurrent(['1-car garage'], '4-car garage')).toEqual([
      '1-car garage', '4-car garage',
    ]);
    expect(withCurrent(['1-car garage'], '1-car garage')).toEqual(['1-car garage']);
    expect(withCurrent(['1-car garage'], null)).toEqual(['1-car garage']);
    // ★ The NOT-RECORDED dash is not a value to append — the blank option is.
    expect(withCurrent(['1-car garage'], NOT_RECORDED)).toEqual(['1-car garage']);
  });

  it('★★ the three keys are declared in one place, and the seed matches the code', () => {
    expect([...UNIT_VOCABULARY_KEYS]).toEqual([
      'parkingOptions', 'roofDeckOptions', 'storiesOptions',
    ]);
    // ★★★ The migration seeds exactly what `CANONICAL_*` holds, so applying
    //     block D cannot change what the app offers — it makes the list
    //     EDITABLE, it does not switch the feature on.
    for (const key of UNIT_VOCABULARY_KEYS) {
      expect(MIGRATION, key).toContain(`'${key}'`);
    }
    for (const label of [...CANONICAL_PARKING, ...CANONICAL_ROOF_DECK]) {
      expect(MIGRATION, label).toContain(`"${label}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// §A4 · STALLS APPEARS NOWHERE
// ---------------------------------------------------------------------------

// ★★★ `src/lib/database.types.ts` IS DELIBERATELY NOT IN THIS LIST, and the
//     reason is a different field with the same name: `Project.parking_stalls`
//     is fix-402's SITE-level column, `@deprecated`, NULL on all 221 rows, and
//     kept typed ON PURPOSE because it is the only pointer to
//     `_parking_site_archive_2026_08_25` outside a migration (fix-456 proposed
//     deleting it and did not). The UNIT field's absence from that file is
//     asserted on its own below, against `UnitType` rather than against the
//     whole text.
const SRC = [
  'src/lib/unitTypeNaming.ts',
  'src/lib/unitVocabulary.ts',
  'src/lib/libraryHelpers.ts',
  'src/lib/libraryUnitColumns.ts',
  'src/lib/libraryUnitRows.ts',
  'src/lib/unitConfigFields.ts',
  'src/lib/surfaceFilterPrefs.ts',
  'src/components/LibraryMatrix.tsx',
  'src/components/shared/UnitParkingInputs.tsx',
  'src/components/wizard/UnitTypesEditor.tsx',
  'src/components/ProjectDetail/ProjectDataEditors.tsx',
  'src/components/ProjectDetail/ProjectOverviewBoxes.tsx',
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** ★ Comments stripped — the GRAVESTONE TRAP, recorded nineteen times in this
 *  repo: a suite whose subject is REMOVED code will match the note explaining
 *  the removal unless the stripper handles every comment form the files use,
 *  JSX `{/* … *\/}` blocks included. */
const code = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('fix-562 §A: STALLS / UNIT appears nowhere', () => {
  it('★★★ not as a type, a parser key, a column, a filter or an editor field', () => {
    // ★★★ Bobby removed the FIELD, not only the control: *"parking_stalls is
    //     removed from the product."* A leftover reader would render `—`
    //     forever without erroring — fix-122's trap, and fix-402 was bitten by
    //     the same shape when a report SEGMENT was left pointing at a cleared
    //     column.
    for (const f of SRC) {
      expect(code(read(f)), `${f} still names parking_stalls`).not.toMatch(
        /\bparking_stalls\b/,
      );
    }
  });

  it('★★★ …and the gravestone test proves it can fail', () => {
    // ★ THE ASSERTION ABOUT THE ASSERTION. Every file above is stripped of
    //   comments first, and several of them DO discuss `parking_stalls` in
    //   prose — so without the stripper this suite would fail, and with a
    //   stripper that missed a comment form it would fail too. Proving the
    //   un-stripped text still contains the word is what shows the strip is
    //   doing work rather than the word simply being absent everywhere.
    const discussed = SRC.filter((f) => /\bparking_stalls\b/.test(read(f)));
    expect(discussed.length).toBeGreaterThan(0);
  });

  it('★★★ `UnitType` no longer declares it, which is what deletes it from every row', () => {
    // ★★ `parseUnitTypes` is a WHITELIST and both editors write the parsed
    //    array back (fix-412), so a key it does not name is REMOVED from the
    //    row the first time anybody edits any other field on it. §B's migration
    //    strips the key in bulk; this makes sure nothing puts it back.
    const types = read('src/lib/database.types.ts');
    const unitType = types.slice(
      types.indexOf('export interface UnitType {'),
      types.indexOf('export interface Project {'),
    );
    expect(code(unitType)).not.toMatch(/\bparking_stalls\b/);
    // ★ …and the SITE column it shares a name with is still there, still
    //   deprecated, still the only pointer to the fix-402 archive.
    expect(types).toContain('@deprecated fix-402 — see parking_type above.');
    const [u] = parseUnitTypes([
      { label: 'A', qty: 1, parking_stalls: 2 } as Record<string, unknown>,
    ]);
    expect(Object.keys(u!)).not.toContain('parking_stalls');
  });

  it('★★ no column, sort arm, filter key or matrix track survives', () => {
    expect(LIBRARY_UNIT_COLUMNS.map((c) => c.col)).not.toContain('stalls');
    expect(LIBRARY_UNIT_COLUMNS.map((c) => c.sourceKey)).not.toContain('parking_stalls');
    expect(UNIT_SORTABLE_COLUMNS as readonly string[]).not.toContain('stalls');
    expect(UNIT_FILTER_KEYS as readonly string[]).not.toContain('stalls');
    expect(SITE_FILTER_KEYS as readonly string[]).not.toContain('stalls');
    expect(UNIT_CONFIG_FIELDS.map((c) => c.key)).not.toContain('parking_stalls');
  });

  it('★★ `lib/unitParking` is deleted, not left as scenery', () => {
    expect(() => read('src/lib/unitParking.ts')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §B · THE SNAPSHOT AND THE WIPE
// ---------------------------------------------------------------------------

/** ★ SQL comment leaders stripped, so an assertion about what the file DOES is
 *  not satisfied by a paragraph explaining it (the gravestone trap again). */
const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
/** ★ The whole file as prose, whitespace collapsed, for "the ruling is
 *  recorded" assertions that must survive a line wrap. */
const prose = MIGRATION.replace(/^\s*--/gm, ' ').replace(/\s+/g, ' ');

describe('fix-562 §B: the snapshot makes the wipe reversible, not brave', () => {
  it('★★★ EVERY STATEMENT IS COMMENTED OUT — the shelf rule', () => {
    // fix-450's guard covers this repo-wide; asserted here too because this is
    // the first DESTRUCTIVE data file since fix-456, and *"the difference
    // between a document and a loaded gun"* is worth restating where it bites.
    expect(sql.trim()).toBe('');
  });

  it('★★★ THE SNAPSHOT IS TAKEN BEFORE THE WIPE, AND THE WIPE CHECKS IT', () => {
    const snapAt = MIGRATION.indexOf('insert into public._fix562_unit_matrix_snapshot');
    const wipeAt = MIGRATION.indexOf('update public.projects p');
    expect(snapAt).toBeGreaterThan(-1);
    expect(wipeAt).toBeGreaterThan(snapAt);
    // ★★ …and the wipe's own guard re-counts the snapshot, so running C without
    //    B fails loudly rather than clearing 270 answers into nothing.
    expect(MIGRATION).toContain('v_units <> v_snapshot');
  });

  it('★★★ the counts are RE-DERIVED at run time, not compared to a literal', () => {
    // ★★★ THE REASON, AND IT IS NOT A PRINCIPLE — IT IS AN OBSERVATION. The
    //     brief's numbers were 24 hours old; the first measurement for this
    //     file matched them exactly and the second, twenty-five minutes later,
    //     did not. Somebody is filling this book in right now.
    expect(MIGRATION).toContain('lateral jsonb_array_elements(p.unit_types)');
    expect(MIGRATION).toContain('if v_rows <> v_units then');
    // ★ A FLOOR, not an equality: the numbers grow while people work, and a
    //   guard that refused to run because a unit was added would block
    //   everything and protect nothing. What it must never be is SMALLER.
    expect(MIGRATION).toContain('v_parking < 126');
    expect(MIGRATION).toContain('v_stories < 259');
    expect(prose).toContain('SOMEBODY IS BACKFILLING THIS BOOK RIGHT NOW');
  });

  it('★★★ THE SNAPSHOT HOLDS ALL FOUR VALUES, AND WHETHER EACH KEY EXISTED', () => {
    for (const col of ['parking_kind', 'parking_stalls', 'roof_deck', 'stories']) {
      expect(MIGRATION, col).toContain(`t.elem->>'${col}'`);
    }
    // ★★ A key present with a json null and a key that was never there are
    //    different facts, and only these four booleans keep them apart once the
    //    values are read back out (fix-386).
    for (const col of ['had_parking_kind', 'had_parking_stalls', 'had_roof_deck', 'had_stories']) {
      expect(MIGRATION, col).toContain(col);
    }
    // ★★★ …and the WHOLE unit object, so a restore is a copy rather than a
    //     reconstruction.
    expect(MIGRATION).toContain('unit_before');
  });

  it('★★★ THE WIPE LEAVES label/width_ft/depth_ft/size_sf/qty ALONE — asserted key by key', () => {
    // ★★★ COLLATERAL LOSS IS THE WHOLE RISK OF REWRITING A JSONB ARRAY, so the
    //     migration compares each untouched key against the snapshot rather
    //     than trusting the `-` operator. Proved read-only on prod before the
    //     file was written: over all 270 units every one of the five was `is
    //     not distinct from` its original, and the remaining key set was
    //     exactly {depth_ft, label, qty, size_sf, width_ft}.
    for (const key of ['label', 'width_ft', 'depth_ft', 'size_sf', 'qty']) {
      // ★ Whitespace-tolerant: a literal anchor encodes somebody's indentation
      //   as if it were syntax (fix-537's `E"…"` lesson, in a test).
      expect(
        new RegExp(
          `'${key}'\\)\\s+is distinct from \\(x\\.now_elem -> '${key}'`,
        ).test(MIGRATION),
        key,
      ).toBe(true);
    }
    // ★ The strip itself is four `-` operators and nothing else — no rebuild
    //   that has to name the survivors.
    expect(MIGRATION).toContain(
      "t.elem - 'parking_kind' - 'parking_stalls' - 'roof_deck' - 'stories'",
    );
    // ★ …and nothing survives.
    expect(MIGRATION).toContain('% units still carry a wiped key');
  });

  it('★★★ THREE TRIGGERS ARE SUPPRESSED, AND fix-410 ONLY NAMES TWO', () => {
    // ★★★ THE ONE THIS TICKET FOUND. `projects_audit_row` writes a whole
    //     before/after diff into `audit_log` per changed column. Measured
    //     2026-09-15: audit_log holds 16,658 rows of which **123 are
    //     `project_updated`** — this wipe would add 117 more, every one with a
    //     full unit_types blob and `user_id` NULL, nearly doubling that
    //     action's entire history in one statement.
    for (const t of ['projects_set_updated_at', 'bp_log_user_activity', 'projects_audit_row']) {
      expect(MIGRATION, t).toContain(`disable trigger ${t}`);
      expect(MIGRATION, t).toContain(`enable trigger ${t}`);
    }
    expect(prose).toContain('fix-410');
  });

  it('★★ the snapshot table is granted like every other backup table', () => {
    // fix-415: NEW TABLES INHERIT `anon` FULL DML, and fix-412's backup sat
    // with anon DELETE/INSERT/UPDATE for weeks before anybody looked.
    expect(MIGRATION).toContain(
      'revoke all on public._fix562_unit_matrix_snapshot from public, anon, authenticated',
    );
    expect(MIGRATION).toContain('grant select on public._fix562_unit_matrix_snapshot to authenticated');
    expect(MIGRATION).toContain("has_table_privilege('anon'");
  });

  it('★★★ NOTHING CONVERTS A PARKING VALUE — the wipe is the ruling, not a fallback', () => {
    // ★★ ~105 of 123 rows WOULD have converted automatically, Bobby was told
    //    so, and he ruled the wipe anyway. A conversion smuggled in as a
    //    "safety net" would be the opposite of what he decided.
    for (const legacy of ["'surface'", "'both'", "'none'"]) {
      expect(sql, legacy).not.toContain(legacy);
    }
    expect(prose).toContain('Wipe it all as I said');
  });
});

// ---------------------------------------------------------------------------
// §G · THE RPC CAN CLEAR A FIELD
// ---------------------------------------------------------------------------

describe('fix-562 §G: bp_update_library_fields gained three fields and a null', () => {
  it('★★★ THE DEFECT IS RECORDED WITH ITS PROD PROOF', () => {
    // ★★★ Every assignment in the live function is `coalesce(p_X, pr.X)`, so
    //     passing null meant LEAVE UNCHANGED. Called as Cam against prod inside
    //     a rolled-back transaction, exactly the way the Library's `—` option
    //     calls it today: conflict false, zone `NR` before, `NR` after.
    //     A save that reports success and writes nothing.
    expect(prose).toContain('clearing is IMPOSSIBLE (silently ignored)');
    expect(prose).toContain('coalesce(p_X, pr.X)');
  });

  it('★★★ KEY PRESENCE IS THE SHAPE, and every field is whitelisted by name', () => {
    for (const f of [
      'zone', 'alley', 'lot_width', 'lot_depth',
      'lot_size_sf', 'is_corner_lot', 'juris', 'unit_types',
    ]) {
      expect(MIGRATION, f).toContain(`p_patch ? '${f}'`);
    }
    // ★★ Still not a free patch: an unknown key RAISES rather than being
    //    dropped, so a typo is loud.
    expect(MIGRATION).toContain('is not an editable Library field');
    expect(MIGRATION).toContain("errcode = '22023'");
  });

  it('★★★ a changed argument list is DROP then CREATE, never an overload', () => {
    const dropAt = MIGRATION.indexOf('drop function if exists public.bp_update_library_fields');
    const createAt = MIGRATION.indexOf('create or replace function public.bp_update_library_fields');
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
    // ★★ PostgREST cannot choose between two candidates (fix-438, fix-532), and
    //    DROP takes the GRANTS with it — so they are re-issued AND asserted.
    expect(MIGRATION).toContain('% candidates for bp_update_library_fields');
    expect(MIGRATION).toContain('revoke all on function public.bp_update_library_fields');
    expect(MIGRATION).toContain("has_function_privilege('anon'");
    // ★ fix-547's rule: a migration that DROPS a function gets the census.
    expect(prose).toContain('on_conflict_census.sql');
  });

  it('★★★ THE GATE IS STILL FIRST AND STILL COSTS NOTHING TO REACH', () => {
    const gateAt = MIGRATION.indexOf('caller may not edit Library fields');
    const tenantsAt = MIGRATION.indexOf('v_tenants := public.auth_tenant_ids()');
    expect(gateAt).toBeGreaterThan(-1);
    expect(tenantsAt).toBeGreaterThan(gateAt);
    // ★★ fix-527 §B: `declare v_tenants uuid[] := auth_tenant_ids();` would run
    //    BEFORE the body, so the gate would not be first.
    expect(MIGRATION).toContain('v_tenants uuid[];');
  });

  it('★★ `juris` cannot be cleared, and the function says so in words', () => {
    // `projects.juris` is NOT NULL and blank on 0 of 221 rows — jurisdiction is
    // already complete, so this is wired for CORRECTION and nobody should count
    // it as a backfill win.
    expect(MIGRATION).toContain('jurisdiction cannot be cleared');
    expect(MIGRATION).toContain("errcode = '23502'");
    expect(prose).toContain('blank on 0 of 221');
  });

  it('★★★ fix-555: §G writes only what a person types, and touches none of the 39', () => {
    // 39 projects hold a `lot_size_sf` that is NOT width × depth (measured
    // 2026-09-15; the brief said 35). fix-555 (P-261) is told to read those and
    // change none. Making the field editable does not change them either —
    // nothing here derives, rounds or reconciles.
    expect(sql).not.toMatch(/lot_width\s*\*\s*lot_depth/);
    expect(sql).not.toMatch(/round\s*\(\s*p_patch/);
  });
});

// ---------------------------------------------------------------------------
// §C / §H · THE SCREENS
// ---------------------------------------------------------------------------

const BASE: LibraryFilters = {
  view: 'site',
  lotwTarget: null, lotwBuf: 2, lotdTarget: null, lotdBuf: 2,
  lotsizeTarget: null, lotsizeBuf: 500,
  unitwTarget: null, unitwBuf: 2, unitdTarget: null, unitdBuf: 2,
  unitsizeTarget: null, unitsizeBuf: 100,
  zone: '', alley: '', productTypes: [], juris: '',
  isCornerLot: '', stories: '', parkingKind: '', roofDeck: '',
};

describe('fix-562 §C / §H: the Library columns say the new words', () => {
  it('★★★ PARKING · ROOF DECK · STORIES print the composed label', () => {
    const u = unit({
      parking_kind: 'garage', parking_count: 2,
      roof_deck: true, penthouse: true,
      stories: 3, basement: true,
    });
    const by = Object.fromEntries(LIBRARY_UNIT_COLUMNS.map((c) => [c.col, c]));
    expect(by.parking!.read!(u).text).toBe('2-car garage');
    expect(by.roofDeck!.read!(u).text).toBe('W/ PH');
    expect(by.stories!.read!(u).text).toBe('3+B');
  });

  it('★★★ an EMPTY value renders `—`, never a guessed default', () => {
    const by = Object.fromEntries(LIBRARY_UNIT_COLUMNS.map((c) => [c.col, c]));
    for (const col of ['parking', 'roofDeck', 'stories']) {
      expect(by[col]!.read!(unit()).text, col).toBe(NOT_RECORDED);
    }
  });

  it('★★★ §H: QTY is off BOTH views, and the FIELD is untouched', () => {
    // ★★★ THE P-236 SHAPE: drop the INPUT, keep the COLUMN. `unit_types[].qty`
    //     is live data — 2–4 on 102 of 270 units, measured 2026-09-15 — and it
    //     is still parsed, still defaulted to 1, and still typed in Project
    //     Details → Units.
    expect(LIBRARY_UNIT_COLUMNS.map((c) => c.col)).not.toContain('qty');
    expect(UNIT_SORTABLE_COLUMNS as readonly string[]).not.toContain('qty');
    expect(parseUnitTypes([{ label: 'A', qty: 3 }])[0]!.qty).toBe(3);
    // ★ …and the project-grain quantity is still an editable field too — it is
    //   the Library's SITE column that went, not `projects.units`.
    expect(code(read('src/components/ProjectDetail/ProjectDetailsForm.tsx')))
      .toContain("commit('units'");
    expect(code(read('src/components/ProjectDetail/ProjectDataEditors.tsx')))
      .toContain('pd-unit-qty');
  });

  it('★★ the Site filter block is untouched — different half of the screen', () => {
    for (const k of ['lotwTarget', 'lotdTarget', 'lotsizeTarget', 'juris', 'zone', 'alley', 'isCornerLot']) {
      expect(SITE_FILTER_KEYS as readonly string[], k).toContain(k);
    }
  });

  it('★★ a picked option requires that RECORDED answer; Any is the only pass for a null', () => {
    expect(matchParkingOption(null, null, '')).toBe(true);
    expect(matchParkingOption(null, null, 'Surface / None')).toBe(false);
    expect(matchRoofDeckOption(null, null, '')).toBe(true);
    expect(matchRoofDeckOption(null, null, 'None')).toBe(false);
    expect(BASE.parkingKind).toBe('');
  });
});
